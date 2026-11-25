/**
 * Research briefs for a Teaching goal.
 *
 * A learner often needs one outside fact a lesson cannot supply. This service
 * fetches the pages the learner names, extracts their text, and asks the model
 * for a **cited** brief: every factual sentence carries `[n]` pointing at a
 * supplied source, and anything that is the model's own explanation is prefixed
 * `(agent explanation)`. A brief with no citation and no label is refused, so
 * research can never quietly become unsourced prose.
 *
 * Storage is two files per brief under `<goal>/research/`:
 *   <id>.md    the brief, with a small frontmatter block
 *   <id>.json  the metadata the list reads
 *
 * The fetch is deliberately narrow: HTTPS only, no credentials in the URL, no
 * loopback or private address, a text content type, an 8 s timeout and a size
 * cap. It is a reading tool, not a browser.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "../../domain/markdown";

export const RESEARCH_DIR = "research";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_SOURCE_CHARS = 20_000;
export const MAX_BRIEF_CHARS = 8_000;
export const MAX_SOURCES = 6;

export type ResearchSource = { url: string; title: string };

export type ResearchItem = {
  id: string;
  question: string;
  created: string;
  sources: ResearchSource[];
};

export type ResearchStoreError = { kind: "storage"; path: string; message: string };

export type FetchedSource = ResearchSource & { text: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function researchDir(goalFolder: string): string {
  return join(goalFolder, RESEARCH_DIR);
}

export function slug(text: string): string {
  const flat = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return flat.slice(0, 40) || "research";
}

export function newResearchId(question: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${stamp}-${slug(question)}`;
}

/** True for a host we refuse to fetch from (SSRF guard, best effort). */
export function unsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

/** Validate a learner-supplied URL before any network call. */
export function checkSourceUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: `"${raw.trim()}" is not a URL` };
  }
  if (url.protocol !== "https:") return { ok: false, message: `${url.href} is not HTTPS` };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "a source URL cannot carry a username or password" };
  }
  if (unsafeHost(url.hostname)) {
    return { ok: false, message: `${url.hostname} is a local address, not a public source` };
  }
  return { ok: true, url };
}

/** Strip tags and decode the handful of entities that matter. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { title: title.replace(/\s+/g, " ").trim(), text };
}

export async function fetchSource(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<FetchedSource, { url: string; message: string }>> {
  const checked = checkSourceUrl(raw);
  if (!checked.ok) return { ok: false, error: { url: raw, message: checked.message } };
  try {
    const response = await fetchImpl(checked.url.href, {
      headers: {
        Accept: "text/html,text/plain,application/xhtml+xml",
        "User-Agent": "lockedin-research",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: { url: checked.url.href, message: `the page returned HTTP ${response.status}` },
      };
    }
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("text/") && !type.includes("xhtml")) {
      return {
        ok: false,
        error: { url: checked.url.href, message: `the page is ${type || "not text"}, not an article` },
      };
    }
    const buffer = await response.arrayBuffer();
    const body = new TextDecoder().decode(buffer).slice(0, MAX_SOURCE_CHARS * 4);
    const parsed = htmlToText(body);
    if (parsed.text.length < 40) {
      return {
        ok: false,
        error: { url: checked.url.href, message: "the page had almost no readable text" },
      };
    }
    return {
      ok: true,
      value: {
        url: checked.url.href,
        title: parsed.title || checked.url.hostname,
        text: parsed.text.slice(0, MAX_SOURCE_CHARS),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "the page timed out"
        : messageOf(error);
    return { ok: false, error: { url: checked.url.href, message } };
  }
}

/** The prompt: answer from these sources, cite every fact, label every aside. */
export function researchPrompt(input: {
  question: string;
  sources: readonly FetchedSource[];
}): string {
  const sources = input.sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title} — ${source.url}\n${source.text}`,
    )
    .join("\n\n");
  return [
    "Write a short research brief for a learner. Reply with prose only, no Markdown headings.",
    "Use only the sources below for facts. Cite the source of every factual sentence with [1], [2], …",
    "Any sentence that is your own explanation, not the sources', must start with (agent explanation).",
    "Two short paragraphs at most. No preamble, no bullet lists, no restating these instructions.",
    "If the sources do not answer the question, say which part is missing in one sentence.",
    "",
    `Question: ${input.question}`,
    "",
    "Sources:",
    sources,
  ].join("\n");
}

/**
 * Accept a brief only when it is grounded: at least one citation, and every
 * citation points at a supplied source. An `(agent explanation)` label is
 * allowed, but it cannot be the *only* thing the brief contains.
 */
export function normaliseBrief(
  raw: string,
  sourceCount: number,
): { ok: true; text: string } | { ok: false; message: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text === "") return { ok: false, message: "the brief was empty; try again" };
  const citations = [...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (citations.length === 0) {
    return {
      ok: false,
      message: "the brief cited no source; add a source the model can quote, or ask again",
    };
  }
  for (const citation of citations) {
    if (!Number.isInteger(citation) || citation < 1 || citation > sourceCount) {
      return { ok: false, message: `the brief cited [${citation}], which is not a supplied source` };
    }
  }
  return {
    ok: true,
    text: text.length <= MAX_BRIEF_CHARS ? text : `${text.slice(0, MAX_BRIEF_CHARS - 1)}…`,
  };
}

/** The Markdown file: a tiny frontmatter block and the brief. */
export function renderBrief(item: ResearchItem, brief: string): string {
  const sources = item.sources
    .map((source, index) => `  - "[${index + 1}] ${source.title}" ${source.url}`)
    .join("\n");
  return [
    "---",
    `question: "${item.question.replace(/"/g, '\\"')}"`,
    `created: "${item.created}"`,
    "sources:",
    sources,
    "---",
    "",
    `# Research — ${item.question}`,
    "",
    brief.trim(),
    "",
  ].join("\n");
}

async function writeAtomic(path: string, body: string): Promise<void> {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(temporary, body, "utf8");
    const handle = await import("node:fs/promises").then((fs) => fs.open(temporary, "r+"));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeResearch(
  goalFolder: string,
  item: ResearchItem,
  brief: string,
): Promise<Result<ResearchItem, ResearchStoreError>> {
  const dir = researchDir(goalFolder);
  const markdown = join(dir, `${item.id}.md`);
  const meta = join(dir, `${item.id}.json`);
  try {
    await mkdir(dir, { recursive: true });
    await writeAtomic(markdown, renderBrief(item, brief));
    await writeAtomic(meta, `${JSON.stringify({ schema: 1, ...item }, null, 2)}\n`);
  } catch (error) {
    return { ok: false, error: { kind: "storage", path: dir, message: messageOf(error) } };
  }
  return { ok: true, value: item };
}

export async function listResearch(
  goalFolder: string,
): Promise<Result<ResearchItem[], ResearchStoreError>> {
  const dir = researchDir(goalFolder);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: true, value: [] };
    return { ok: false, error: { kind: "storage", path: dir, message: messageOf(error) } };
  }
  const items: ResearchItem[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), "utf8")) as Partial<ResearchItem> & {
        schema?: unknown;
      };
      if (parsed.schema !== 1) continue;
      if (typeof parsed.id !== "string" || typeof parsed.question !== "string") continue;
      if (typeof parsed.created !== "string" || !Array.isArray(parsed.sources)) continue;
      const sources = parsed.sources
        .filter(
          (source): source is ResearchSource =>
            typeof source === "object" &&
            source !== null &&
            typeof (source as ResearchSource).url === "string" &&
            typeof (source as ResearchSource).title === "string",
        )
        .map((source) => ({ url: source.url, title: source.title }));
      items.push({
        id: parsed.id,
        question: parsed.question,
        created: parsed.created,
        sources,
      });
    } catch {
      // One broken sidecar must not hide the rest of the library.
      continue;
    }
  }
  items.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
  return { ok: true, value: items };
}

export async function readResearch(
  goalFolder: string,
  id: string,
): Promise<Result<{ item: ResearchItem; markdown: string }, ResearchStoreError>> {
  if (!/^[a-z0-9-]+$/.test(id)) {
    return {
      ok: false,
      error: { kind: "storage", path: researchDir(goalFolder), message: `"${id}" is not a research id` },
    };
  }
  const dir = researchDir(goalFolder);
  try {
    const item = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as ResearchItem;
    const markdown = await readFile(join(dir, `${id}.md`), "utf8");
    return { ok: true, value: { item, markdown } };
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "storage",
        path: join(dir, id),
        message:
          codeOf(error) === "ENOENT"
            ? `there is no research brief "${id}"`
            : `the brief cannot be read (${messageOf(error)})`,
      },
    };
  }
}

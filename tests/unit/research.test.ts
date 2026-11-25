/**
 * Research: URL guards, HTML extraction, citation validation, storage.
 *
 * The point of the feature is that a brief cannot be unsourced prose, so the
 * citation checks are the core of this file.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkSourceUrl,
  fetchSource,
  htmlToText,
  listResearch,
  normaliseBrief,
  readResearch,
  researchPrompt,
  writeResearch,
} from "../../src/services/teaching/research";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(TEMP_BASE, "research-"));
});

afterEach(async () => {
  await removeTemp(folder);
});

describe("source URLs", () => {
  test("accepts a public https page", () => {
    const checked = checkSourceUrl("https://example.org/lesson");
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.url.href).toBe("https://example.org/lesson");
  });

  test("refuses http, credentials and local addresses", () => {
    for (const url of [
      "http://example.org",
      "https://user:pass@example.org",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.1.1/x",
      "https://172.16.4.2/x",
      "https://[::1]/x",
    ]) {
      expect(checkSourceUrl(url).ok).toBe(false);
    }
  });
});

describe("htmlToText", () => {
  test("takes the title and drops scripts and tags", () => {
    const parsed = htmlToText(
      "<html><head><title> A  Lesson </title><style>x{}</style></head>" +
        "<body><script>bad()</script><p>Boundary&nbsp;conditions</p></body></html>",
    );
    expect(parsed.title).toBe("A Lesson");
    expect(parsed.text).toContain("Boundary conditions");
    expect(parsed.text).not.toContain("bad()");
    expect(parsed.text).not.toContain("<p>");
  });
});

describe("fetchSource", () => {
  const html = (text: string) =>
    new Response(`<html><head><title>T</title></head><body><p>${text}</p></body></html>`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  test("returns the extracted article", async () => {
    const result = await fetchSource("https://example.org/a", (async () =>
      html("A source with enough readable words to be an article, not a stub.")) as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("T");
    expect(result.value.text).toContain("enough readable words");
  });

  test("refuses a non-text response and an empty page", async () => {
    const image = await fetchSource("https://example.org/a", (async () =>
      new Response("binary", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch);
    expect(image.ok).toBe(false);

    const empty = await fetchSource("https://example.org/a", (async () =>
      html("short")) as unknown as typeof fetch);
    expect(empty.ok).toBe(false);
  });

  test("reports an HTTP failure", async () => {
    const result = await fetchSource("https://example.org/a", (async () =>
      new Response("no", { status: 503 })) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("503");
  });
});

describe("briefs", () => {
  test("a citation is required and must point at a supplied source", () => {
    expect(normaliseBrief("Registers hold state [1].", 2).ok).toBe(true);
    expect(normaliseBrief("Registers hold state.", 2).ok).toBe(false);
    expect(normaliseBrief("Registers hold state [3].", 2).ok).toBe(false);
    const labelled = normaliseBrief("(agent explanation) A register is a slot.", 1);
    expect(labelled.ok).toBe(false);
  });

  test("the prompt names the question and every source", () => {
    const prompt = researchPrompt({
      question: "why registers?",
      sources: [{ url: "https://example.org/a", title: "A", text: "registers are fast" }],
    });
    expect(prompt).toContain("why registers?");
    expect(prompt).toContain("[1] A — https://example.org/a");
    expect(prompt).toContain("(agent explanation)");
  });

  test("a brief round-trips through the goal folder", async () => {
    const item = {
      id: "202611241000-why-registers",
      question: "why registers?",
      created: "2026-11-24T10:00:00.000Z",
      sources: [{ url: "https://example.org/a", title: "A" }],
    };
    const written = await writeResearch(folder, item, "Registers hold state [1].");
    expect(written.ok).toBe(true);
    const listed = await listResearch(folder);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value).toHaveLength(1);
    const read = await readResearch(folder, item.id);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.markdown).toContain("Registers hold state [1].");
    expect(read.value.markdown).toContain("question:");
  });

  test("an id that could escape the folder is refused", async () => {
    const read = await readResearch(folder, "../../etc/passwd");
    expect(read.ok).toBe(false);
  });
});

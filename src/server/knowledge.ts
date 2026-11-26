import { stat, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { parseDocument, readString, readStringArray } from "../domain/markdown";
import { listNotes } from "../storage/note-store";
import { indexFileExists } from "../storage/index";
import { searchKnowledge as indexedKnowledgeSearch } from "../services/knowledge/search";
import { readMemory, type Memory } from "../services/lockin/memory";
import { listSessions, sessionFolderFor } from "../services/lockin/manager";
import { loadGoalRows } from "../app/actions/skills";
import { loadProjects } from "../app/actions/projects";
import { loadProjectMeta } from "../services/work/agents";
import { openSession } from "../services/lockin/manager";
import {
  goalFolderFor,
  readMeta as readGoalMeta,
} from "../services/skills/progress";
import { SESSION_FILES } from "../domain/session";
import { extract } from "../services/extract/index";
import { confinedJoin } from "../storage/paths";
import { isRecord, oneLine } from "./rpc";

import type { Workspace } from "../storage/workspace";

export const KNOWLEDGE_HIT_LIMIT = 50;

/** One excerpt line, with the match in context. */
export const KNOWLEDGE_EXCERPT_CHARS = 160;

/**
 * The most body text `knowledge.read` returns, in UTF-8 bytes.
 *
 * A reader opens a document, not a download: 64 KiB is far more than a note or
 * a source excerpt needs and small enough that the shell's frame stays honest.
 * A longer body is cut on a character boundary and reported as `truncated`.
 */
export const KNOWLEDGE_BODY_LIMIT = 64 * 1024;

/** The group a note without `topics` frontmatter lands in. */
export const KNOWLEDGE_NO_TOPIC = "(no topic)";

export type KnowledgeSide = "school" | "skills" | "work";

export type KnowledgeHitKind =
  | "note"
  | "memory"
  | "source"
  | "session"
  | "goal"
  | "project"
  | "archive";

/**
 * The one knowledge id scheme, used by both the row builders and the reader.
 *
 * Ids are opaque to the shell but stable inside a workspace, so a row from
 * `knowledge.search` can be passed straight back to `knowledge.read` without a
 * second lookup rule. `note` paths are workspace-relative, as `hit.path` is.
 */
export const knowledgeIds = {
  note: (side: "school" | "skills", path: string): string => `note:${side}:${path}`,
  memory: (sessionId: string, index: number): string => `memory:${sessionId}:${index}`,
  source: (sessionId: string, hash: string): string => `source:${sessionId}:${hash}`,
  session: (sessionId: string): string => `session:${sessionId}`,
  goal: (goalId: string): string => `goal:${goalId}`,
  project: (projectId: string): string => `project:${projectId}`,
  archive: (side: "school" | "skills", entryId: string): string => `archive:${side}:${entryId}`,
};

/**
 * One knowledge search result (`docs/product.md` §6.3).
 *
 * `side` is the wall: a school row can never be a skills row. `path` is always
 * relative to the workspace root — never an absolute path and never note
 * content — so the shell can show it without leaking the machine layout.
 */
export type KnowledgeHit = {
  id: string;
  kind: KnowledgeHitKind;
  title: string;
  excerpt: string;
  side: KnowledgeSide;
  path: string;
  /** ISO-8601, or `""` when the source records no timestamp. */
  updated: string;
  /** 3 = title prefix, 2 = word match, 1 = body substring; 0 on a direct read. */
  score: number;
};

export type KnowledgeScope = "all" | KnowledgeSide;

export const KNOWLEDGE_SCOPES: readonly KnowledgeScope[] = ["all", "school", "skills", "work"];

export type KnowledgeTreeSide = "school" | "skills" | "all";

export const KNOWLEDGE_TREE_SIDES: readonly KnowledgeTreeSide[] = ["school", "skills", "all"];

/** One note row in a topic group. `path` is workspace-relative. */
export type KnowledgeTreeNode = {
  path: string;
  title: string;
  updated: string;
};

/** One topic heading plus its notes; a topic with no notes is kept. */
export type KnowledgeTopicGroup = {
  topic: string;
  notes: KnowledgeTreeNode[];
};

/** A candidate before ranking: the text `excerpt` is cut from. */
export type KnowledgeCandidate = Omit<KnowledgeHit, "excerpt" | "score"> & { text: string };

export function isKnowledgeScope(value: unknown): value is KnowledgeScope {
  return typeof value === "string" && (KNOWLEDGE_SCOPES as readonly string[]).includes(value);
}

export function isKnowledgeTreeSide(value: unknown): value is KnowledgeTreeSide {
  return (
    typeof value === "string" && (KNOWLEDGE_TREE_SIDES as readonly string[]).includes(value)
  );
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One line, capped, with the first match kept in context. */
export function knowledgeExcerpt(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const cap = KNOWLEDGE_EXCERPT_CHARS;
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  let start = at < 0 ? 0 : Math.max(0, at - Math.floor(cap / 4));
  if (start > 0) {
    const space = flat.lastIndexOf(" ", start);
    if (space > 0) start = space + 1;
  }
  let end = Math.min(flat.length, start + cap);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > start + Math.floor(cap / 2)) end = space;
  }
  const body = flat.slice(start, end).trim();
  const lead = start > 0 ? "…" : "";
  const tail = end < flat.length ? "…" : "";
  const combined = `${lead}${body}${tail}`;
  return combined.length > cap ? `${combined.slice(0, cap - 1)}…` : combined;
}

/**
 * Deterministic lexical score: a title/name prefix beats a whole-word match,
 * which beats a body substring. `0` means the query is absent.
 */
export function knowledgeScore(candidate: KnowledgeCandidate, query: string): number {
  const q = query.toLowerCase();
  const title = candidate.title.toLowerCase();
  const text = candidate.text.toLowerCase();
  if (title.startsWith(q)) return 3;
  const word = new RegExp(`(^|[^a-z0-9])${escapeForRegExp(q)}([^a-z0-9]|$)`, "i");
  if (word.test(candidate.title) || word.test(candidate.text)) return 2;
  if (title.includes(q) || text.includes(q)) return 1;
  return 0;
}

/** Score descending, then most recently updated, then path, then id. */
export function knowledgeSort(a: KnowledgeHit, b: KnowledgeHit): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A workspace-relative path with `/` separators; `""` when outside the root. */
export function workspaceRelativePath(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return "";
  return rel.split(sep).join("/");
}

export function firstMarkdownHeading(body: string): string {
  for (const line of body.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  return "";
}

export type VaultNote = {
  path: string;
  title: string;
  updated: string;
  topics: string[];
  /** Title, topics, tags and body: what search ranks against. */
  text: string;
  /** The Markdown body with frontmatter stripped: what the reader shows. */
  body: string;
};

/**
 * Read one vault note from an absolute path inside the vault.
 *
 * The note model lives here so search and `knowledge.read` cannot disagree
 * about a title, an `updated` value or the body bytes: both call this. A note
 * that cannot be read or parsed returns `null` and the caller decides whether
 * that is "skipped" or "reported".
 */
export async function readVaultNoteFile(
  root: string,
  absolute: string,
): Promise<VaultNote | null> {
  let text: string;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    return null;
  }
  const parsed = parseDocument(text);
  if (!parsed.ok) return null;
  const data = parsed.value.data;
  const title =
    (readString(data, "title") ?? "").trim() ||
    firstMarkdownHeading(parsed.value.body) ||
    basename(absolute).replace(/\.md$/i, "");
  const topics = readStringArray(data, "topics");
  const tags = readStringArray(data, "tags");
  let updated = readString(data, "updated") ?? "";
  if (updated === "") {
    try {
      updated = (await stat(absolute)).mtime.toISOString();
    } catch {
      updated = "";
    }
  }
  const path = workspaceRelativePath(root, absolute);
  if (path === "") return null;
  return {
    path,
    title,
    updated,
    topics,
    text: [title, topics.join(" "), tags.join(" "), parsed.value.body].join("\n"),
    body: parsed.value.body,
  };
}

/**
 * Read one vault's Markdown notes directly.
 *
 * Markdown is the source of truth and the index is a rebuildable cache, so this
 * read never opens or rebuilds `index.db`: an unindexed note is still found and a
 * corrupt index changes nothing. A note that cannot be read is skipped.
 */
export async function readVaultNotes(
  root: string,
  vault: string,
): Promise<VaultNote[]> {
  const out: VaultNote[] = [];
  for (const rel of await listNotes(vault)) {
    const note = await readVaultNoteFile(root, join(vault, rel));
    if (note !== null) out.push(note);
  }
  return out;
}

export function noteCandidates(root: string, vault: string, side: "school" | "skills"): Promise<KnowledgeCandidate[]> {
  return readVaultNotes(root, vault).then((notes) =>
    notes.map((note) => ({
      id: knowledgeIds.note(side, note.path),
      kind: "note" as const,
      title: note.title,
      side,
      path: note.path,
      updated: note.updated,
      text: note.text,
    })),
  );
}

/**
 * Vault note candidates from the FTS index, not a walk of every note.
 *
 * The index is a cache and `indexedKnowledgeSearch` rebuilds it when it is
 * missing. Only the matched notes are read from disk, to keep the same title,
 * `updated` value and body the reader sees. A broken index, or a query no note
 * matches, falls back to the direct read so a cache can never hide a note.
 */
export async function indexedNoteCandidates(
  workspace: Workspace,
  side: "school" | "skills",
  query: string,
): Promise<KnowledgeCandidate[]> {
  const vault =
    side === "school" ? workspace.paths.schoolVault : workspace.paths.skillVault;
  // Search is read-only: a missing index is not built here. The direct read is
  // the fallback, so a workspace that has never been indexed still answers and
  // is left byte-identical.
  if (!indexFileExists(workspace.paths, side)) {
    return noteCandidates(workspace.root, vault, side);
  }
  let indexed;
  try {
    indexed = await indexedKnowledgeSearch(workspace, query, { side, limit: 200 });
  } catch {
    return noteCandidates(workspace.root, vault, side);
  }
  if (indexed.diagnostics.length > 0 || indexed.hits.length === 0) {
    return noteCandidates(workspace.root, vault, side);
  }
  const out: KnowledgeCandidate[] = [];
  for (const hit of indexed.hits) {
    const note = await readVaultNoteFile(workspace.root, join(vault, hit.path));
    if (note === null) continue;
    out.push({
      id: knowledgeIds.note(side, note.path),
      kind: "note",
      title: note.title,
      side,
      path: note.path,
      updated: note.updated,
      text: note.text,
    });
  }
  return out;
}

/**
 * Session rows, memory points and copied sources, all school-side.
 *
 * Memory is history, never a source: it is its own `memory` kind and never a
 * `source` row. A broken session folder is skipped, never an error.
 */

/* -------------------------------------------------------------------------- */
/* Knowledge base: open one hit in a reader                                   */
/* -------------------------------------------------------------------------- */

export type KnowledgeReadTarget =
  | { kind: "note"; side: "school" | "skills"; path: string }
  | { kind: "memory"; sessionId: string; index: number }
  | { kind: "source"; sessionId: string; hash: string }
  | { kind: "session"; sessionId: string }
  | { kind: "goal"; goalId: string }
  | { kind: "project"; projectId: string }
  | { kind: "archive"; side: "school" | "skills"; entryId: string };

/**
 * Resolve one knowledge id (or a bare tree path) to a read target.
 *
 * The scheme is exactly what {@link knowledgeIds} builds, so a row from
 * `knowledge.search` round-trips. `knowledge.tree` returns a workspace-relative
 * path rather than an id, and no scheme starts with a vault folder, so a bare
 * `school/…` or `skills/…` path is a note row and is accepted for the note kind
 * only. `null` means "no such item".
 */
export function parseKnowledgeReadTarget(raw: string): KnowledgeReadTarget | null {
  if (raw.startsWith("school/")) return { kind: "note", side: "school", path: raw };
  if (raw.startsWith("skills/")) return { kind: "note", side: "skills", path: raw };

  const note = /^note:(school|skills):(.+)$/s.exec(raw);
  if (note !== null) {
    return { kind: "note", side: note[1] as "school" | "skills", path: note[2]! };
  }

  if (raw.startsWith("memory:")) {
    // `memory:<sessionId>:<index>`: the index is the only colon-suffixed number.
    const rest = raw.slice("memory:".length);
    const at = rest.lastIndexOf(":");
    if (at <= 0) return null;
    const index = rest.slice(at + 1);
    if (!/^\d+$/.test(index)) return null;
    return { kind: "memory", sessionId: rest.slice(0, at), index: Number(index) };
  }

  if (raw.startsWith("source:")) {
    // The hash is `sha256:…`, so only the first colon separates the session.
    const rest = raw.slice("source:".length);
    const at = rest.indexOf(":");
    if (at <= 0 || at === rest.length - 1) return null;
    return { kind: "source", sessionId: rest.slice(0, at), hash: rest.slice(at + 1) };
  }

  if (raw.startsWith("session:")) {
    const sessionId = raw.slice("session:".length);
    return sessionId === "" ? null : { kind: "session", sessionId };
  }

  if (raw.startsWith("goal:")) {
    const goalId = raw.slice("goal:".length);
    return goalId === "" ? null : { kind: "goal", goalId };
  }

  if (raw.startsWith("project:")) {
    const projectId = raw.slice("project:".length);
    return projectId === "" ? null : { kind: "project", projectId };
  }

  if (raw.startsWith("archive:")) {
    const rest = raw.slice("archive:".length);
    const at = rest.indexOf(":");
    if (at <= 0 || at === rest.length - 1) return null;
    const side = rest.slice(0, at);
    if (side !== "school" && side !== "skills") return null;
    return { kind: "archive", side, entryId: rest.slice(at + 1) };
  }

  return null;
}

/**
 * Confine a workspace-relative note path to its own vault.
 *
 * Both `note:<side>:<path>` and a bare tree path are workspace-relative. An
 * absolute path, a `..` segment, or a path that resolves into the other vault
 * is refused before it is opened: the wall is the vault, not a prefix check on
 * a string the shell happened to send.
 */
export function resolveVaultNotePath(
  workspace: Workspace,
  side: "school" | "skills",
  path: string,
): string | null {
  const vault = side === "school" ? workspace.paths.schoolVault : workspace.paths.skillVault;
  const trimmed = path.trim();
  if (trimmed === "" || isAbsolute(trimmed)) return null;
  const normalised = trimmed.split("\\").join("/");
  if (normalised.split("/").some((part) => part === "..")) return null;
  const absolute = resolve(workspace.root, normalised);
  const rel = relative(vault, absolute);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  return absolute;
}

/** Cut a body to {@link KNOWLEDGE_BODY_LIMIT} bytes on a character boundary. */
export function capKnowledgeBody(text: string): { body: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= KNOWLEDGE_BODY_LIMIT) {
    return { body: text, truncated: false };
  }
  let bytes = 0;
  let body = "";
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > KNOWLEDGE_BODY_LIMIT) break;
    bytes += size;
    body += character;
  }
  return { body, truncated: true };
}

/** One `- Label: value` line; an absent value reads as unknown, never empty. */
export function summaryBullet(label: string, value: string): string {
  return `- ${label}: ${value.trim() === "" ? "unknown" : value}`;
}

export function renderMemoryKnowledge(memory: Memory, name: string): string {
  const bullets = [...memory.points, ...memory.folded].map((point) => `- ${point}`);
  return [
    `# Session memory — ${name}`,
    "",
    "Session memory — history, not a source.",
    "",
    `Updated: ${memory.updated || "unknown"}`,
    "",
    ...(bullets.length === 0 ? ["- (no key points recorded yet)"] : bullets),
    "",
  ].join("\n");
}

export function renderSessionKnowledge(input: {
  name: string;
  created: string;
  archived: boolean;
  prompt: string;
  sources: number;
}): string {
  const lines = [
    `# ${input.name}`,
    "",
    "- Kind: lock-in session",
    summaryBullet("Created", input.created),
    `- Sources: ${input.sources}`,
    `- Archived: ${input.archived ? "yes" : "no"}`,
  ];
  const prompt = input.prompt.trim();
  if (prompt !== "") lines.push("", "## Instructions", "", prompt);
  lines.push("");
  return lines.join("\n");
}

export function renderGoalKnowledge(input: {
  name: string;
  created: string;
  lastOpened: string;
  level: string;
  timeBudget: string;
  statement: string;
  stagesDone: number;
  stagesTotal: number;
  chats: number;
  sources: number;
  archived: boolean;
}): string {
  const lines = [
    `# ${input.name}`,
    "",
    "- Kind: skill session",
    summaryBullet("Level", input.level),
    summaryBullet("Time budget", input.timeBudget),
    summaryBullet("Created", input.created),
    summaryBullet("Last opened", input.lastOpened),
    `- Stages: ${input.stagesDone} of ${input.stagesTotal}`,
    `- Chats: ${input.chats}`,
    `- Sources: ${input.sources}`,
    `- Archived: ${input.archived ? "yes" : "no"}`,
  ];
  if (input.statement.trim() !== "") {
    lines.push("", "## Goal", "", input.statement.trim());
  }
  lines.push("");
  return lines.join("\n");
}

export function renderProjectKnowledge(input: {
  name: string;
  created: string;
  lastOpened: string;
  mode: string;
  instructions: string;
  agents: number;
  tasks: number;
  archived: boolean;
}): string {
  const lines = [
    `# ${input.name}`,
    "",
    "- Kind: work project",
    summaryBullet("Mode", input.mode),
    summaryBullet("Created", input.created),
    summaryBullet("Last opened", input.lastOpened),
    `- Agents: ${input.agents}`,
    `- Tasks: ${input.tasks}`,
    `- Archived: ${input.archived ? "yes" : "no"}`,
  ];
  if (input.instructions.trim() !== "") {
    lines.push("", "## Instructions", "", input.instructions.trim());
  }
  lines.push("");
  return lines.join("\n");
}

export function renderArchiveKnowledge(input: {
  title: string;
  kind: string;
  side: "school" | "skills";
  archivedAt: string;
  sizeBytes: number | null;
  tags: string[];
}): string {
  return [
    `# ${input.title}`,
    "",
    summaryBullet("Kind", input.kind),
    summaryBullet("Side", input.side),
    summaryBullet("Archived", input.archivedAt),
    ...(input.sizeBytes === null ? [] : [`- Size: ${input.sizeBytes} bytes`]),
    ...(input.tags.length === 0 ? [] : [`- Tags: ${input.tags.join(", ")}`]),
    "",
  ].join("\n");
}

/**
 * Build the read `hit` from the fields the row builders already produce.
 *
 * `score` is `0` because a read has no query: relevance is the search row's
 * fact, not the document's. Everything else (side, path, updated) is the same
 * value the list row carries, so the reader header cannot drift from it.
 */
export function knowledgeReadHit(
  id: string,
  kind: KnowledgeHitKind,
  title: string,
  side: KnowledgeSide,
  path: string,
  updated: string,
  body: string,
): KnowledgeHit {
  return {
    id,
    kind,
    title,
    excerpt: knowledgeExcerpt(body, ""),
    side,
    path,
    updated,
    score: 0,
  };
}

export type KnowledgeReadResult =
  | { ok: true; hit: KnowledgeHit; body: string }
  | { ok: false; message: string };

/** Read one target's body. Read-only: every file is opened for reading. */
export async function readKnowledgeTarget(
  workspace: Workspace,
  target: KnowledgeReadTarget,
  itemId: string,
): Promise<KnowledgeReadResult> {
  switch (target.kind) {
    case "note": {
      const absolute = resolveVaultNotePath(workspace, target.side, target.path);
      if (absolute === null) {
        return { ok: false, message: `"${itemId}" is not a readable ${target.side} note` };
      }
      const note = await readVaultNoteFile(workspace.root, absolute);
      if (note === null) {
        return { ok: false, message: `note "${target.path}" could not be read` };
      }
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.note(target.side, note.path),
          "note",
          note.title,
          target.side,
          note.path,
          note.updated,
          note.body,
        ),
        body: note.body,
      };
    }

    case "memory": {
      const opened = await openSession({ workspace, id: target.sessionId });
      if (!opened.ok) {
        return { ok: false, message: `"${itemId}" does not name a readable session memory item` };
      }
      const memory = await readMemory(opened.value.folder, target.sessionId);
      if (!memory.ok || memory.value === null) {
        return { ok: false, message: `session memory for "${target.sessionId}" could not be read` };
      }
      const value = memory.value;
      if (target.index < 0 || target.index >= value.points.length) {
        return { ok: false, message: `there is no knowledge item "${itemId}"` };
      }
      const path = workspaceRelativePath(
        workspace.root,
        join(opened.value.folder, SESSION_FILES.memory),
      );
      if (path === "") {
        return { ok: false, message: `session memory for "${target.sessionId}" is outside the workspace` };
      }
      const name = opened.value.session.name || target.sessionId;
      const body = renderMemoryKnowledge(value, name);
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.memory(target.sessionId, target.index),
          "memory",
          `${name} — session memory`,
          "school",
          path,
          value.updated || opened.value.session.created,
          body,
        ),
        body,
      };
    }

    case "source": {
      const opened = await openSession({ workspace, id: target.sessionId });
      if (!opened.ok) {
        return { ok: false, message: `"${itemId}" does not name a readable source` };
      }
      const source = opened.value.session.sources.find((entry) => entry.hash === target.hash);
      if (source === undefined) {
        return {
          ok: false,
          message: `there is no source "${target.hash}" in session "${target.sessionId}"`,
        };
      }
      const absolute = confinedJoin(opened.value.folder, source.storedPath);
      if (absolute === null) {
        return { ok: false, message: `source "${source.name}" is outside its session` };
      }
      const extracted = await extract(absolute);
      if (!extracted.ok) {
        return {
          ok: false,
          message: `source "${source.name}" could not be read: ${oneLine(extracted.error.message)}`,
        };
      }
      const path = workspaceRelativePath(workspace.root, absolute);
      if (path === "") {
        return { ok: false, message: `source "${source.name}" is outside the workspace` };
      }
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.source(target.sessionId, source.hash),
          "source",
          source.name,
          "school",
          path,
          opened.value.session.created,
          extracted.text,
        ),
        body: extracted.text,
      };
    }

    case "session": {
      const opened = await openSession({ workspace, id: target.sessionId });
      if (!opened.ok) {
        return { ok: false, message: `lock-in session "${target.sessionId}" could not be read` };
      }
      const session = opened.value.session;
      const path = workspaceRelativePath(
        workspace.root,
        join(opened.value.folder, SESSION_FILES.meta),
      );
      if (path === "") {
        return { ok: false, message: `lock-in session "${target.sessionId}" is outside the workspace` };
      }
      const name = session.name || target.sessionId;
      const body = renderSessionKnowledge({
        name,
        created: session.created,
        archived: session.archived,
        prompt: session.prompt,
        sources: session.sources.length,
      });
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.session(session.id || target.sessionId),
          "session",
          name,
          "school",
          path,
          session.created,
          body,
        ),
        body,
      };
    }

    case "goal": {
      const folder = goalFolderFor(workspace, target.goalId);
      const loaded = await readGoalMeta(folder);
      if (!loaded.ok) {
        return { ok: false, message: `skill session "${target.goalId}" could not be read` };
      }
      const { meta, goal } = loaded.value;
      const path = workspaceRelativePath(
        workspace.root,
        join(workspace.paths.goals, target.goalId, "meta.json"),
      );
      if (path === "") {
        return { ok: false, message: `skill session "${target.goalId}" is outside the workspace` };
      }
      const name = goal.name || target.goalId;
      const created = goal.created || (typeof meta.created === "string" ? meta.created : "");
      const lastOpened = typeof meta.last_opened_at === "string" ? meta.last_opened_at : "";
      const body = renderGoalKnowledge({
        name,
        created,
        lastOpened,
        level: goal.level,
        timeBudget: goal.timeBudget,
        statement: goal.statement,
        stagesDone: goal.stages.filter((stage) => stage.status === "done").length,
        stagesTotal: goal.stages.length,
        chats: goal.chats.length,
        sources: goal.sources.length,
        archived: goal.archived,
      });
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.goal(target.goalId),
          "goal",
          name,
          "skills",
          path,
          lastOpened || created,
          body,
        ),
        body,
      };
    }

    case "project": {
      const loaded = await loadProjectMeta(workspace, target.projectId);
      if (!loaded.ok) {
        return { ok: false, message: `work project "${target.projectId}" could not be read` };
      }
      const meta = loaded.value;
      const path = workspaceRelativePath(
        workspace.root,
        join(workspace.paths.workProjects, target.projectId, "meta.json"),
      );
      if (path === "") {
        return { ok: false, message: `work project "${target.projectId}" is outside the workspace` };
      }
      const name = meta.name || target.projectId;
      const body = renderProjectKnowledge({
        name,
        created: meta.created,
        lastOpened: meta.last_opened_at,
        mode: meta.mode,
        instructions: meta.instructions,
        agents: meta.agents.length,
        tasks: meta.tasks.length,
        archived: meta.archived,
      });
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.project(target.projectId),
          "project",
          name,
          "work",
          path,
          meta.last_opened_at || meta.created,
          body,
        ),
        body,
      };
    }

    case "archive": {
      const missing = `there is no archived item "${target.entryId}" on the ${target.side} side`;
      let raw: unknown;
      try {
        raw = JSON.parse(
          await readFile(join(workspace.paths.archiveIndex, `${target.side}.json`), "utf8"),
        );
      } catch {
        return { ok: false, message: missing };
      }
      if (!isRecord(raw) || !Array.isArray(raw.entries)) {
        return { ok: false, message: missing };
      }
      const entry = raw.entries.find(
        (candidate): candidate is Record<string, unknown> =>
          isRecord(candidate) &&
          typeof candidate.id === "string" &&
          candidate.id === target.entryId,
      );
      if (entry === undefined) return { ok: false, message: missing };

      const title =
        typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : target.entryId;
      const kind = typeof entry.kind === "string" ? entry.kind : "session";
      const archivedAt = typeof entry.archivedAt === "string" ? entry.archivedAt : "";
      const sizeBytes = typeof entry.sizeBytes === "number" ? entry.sizeBytes : null;
      const tags = Array.isArray(entry.tags)
        ? entry.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      const body = renderArchiveKnowledge({
        title,
        kind,
        side: target.side,
        archivedAt,
        sizeBytes,
        tags,
      });
      return {
        ok: true,
        hit: knowledgeReadHit(
          knowledgeIds.archive(target.side, target.entryId),
          "archive",
          title,
          target.side,
          `archive-index/${target.side}.json`,
          archivedAt,
          body,
        ),
        body,
      };
    }
  }
}


/** At most this many search hits are returned (`knowledge.search`). */
export async function sessionKnowledge(
  workspace: Workspace,
): Promise<KnowledgeCandidate[]> {
  const out: KnowledgeCandidate[] = [];
  let rows;
  try {
    rows = await listSessions({ workspace });
  } catch {
    return out;
  }

  for (const row of rows) {
    if (row.broken) continue;
    const folder = sessionFolderFor(workspace, row.id);
    const opened = await openSession({ workspace, id: row.id });
    if (opened.ok) {
      const session = opened.value.session;
      const metaPath = workspaceRelativePath(workspace.root, join(folder, SESSION_FILES.meta));
      if (metaPath !== "") {
        out.push({
          id: knowledgeIds.session(row.id),
          kind: "session",
          title: row.name || row.id,
          side: "school",
          path: metaPath,
          updated: session.created || row.created,
          text: [row.name, session.prompt].join("\n"),
        });
      }
      for (const source of session.sources) {
        const absolute = confinedJoin(folder, source.storedPath);
        if (absolute === null) continue;
        const path = workspaceRelativePath(workspace.root, absolute);
        if (path === "") continue;
        const extracted = await extract(absolute);
        if (!extracted.ok) continue;
        out.push({
          id: knowledgeIds.source(row.id, source.hash),
          kind: "source",
          title: source.name,
          side: "school",
          path,
          updated: session.created || row.created,
          text: extracted.text,
        });
      }
    }

    const memory = await readMemory(folder, row.id);
    if (memory.ok && memory.value !== null) {
      const memoryPath = workspaceRelativePath(workspace.root, join(folder, SESSION_FILES.memory));
      if (memoryPath !== "") {
        memory.value.points.forEach((point, index) => {
          out.push({
            id: knowledgeIds.memory(row.id, index),
            kind: "memory",
            title: `${row.name || row.id} — session memory`,
            side: "school",
            path: memoryPath,
            updated: memory.value!.updated || row.created,
            text: point,
          });
        });
      }
    }
  }
  return out;
}

export async function goalKnowledge(
  workspace: Workspace,
): Promise<KnowledgeCandidate[]> {
  const out: KnowledgeCandidate[] = [];
  let rows;
  try {
    rows = await loadGoalRows(workspace);
  } catch {
    return out;
  }
  for (const row of rows) {
    if (row.broken !== undefined) continue;
    const path = workspaceRelativePath(
      workspace.root,
      join(workspace.paths.goals, row.id, "meta.json"),
    );
    if (path === "") continue;
    out.push({
      id: knowledgeIds.goal(row.id),
      kind: "goal",
      title: row.name || row.id,
      side: "skills",
      path,
      updated: row.lastOpened,
      text: row.name,
    });
  }
  return out;
}

export async function projectKnowledge(
  workspace: Workspace,
): Promise<KnowledgeCandidate[]> {
  const out: KnowledgeCandidate[] = [];
  let rows;
  try {
    rows = await loadProjects(workspace);
  } catch {
    return out;
  }
  for (const row of rows) {
    const path = workspaceRelativePath(
      workspace.root,
      join(workspace.paths.workProjects, row.id, "meta.json"),
    );
    if (path === "") continue;
    const meta = await loadProjectMeta(workspace, row.id);
    const instructions = meta.ok ? meta.value.instructions : "";
    out.push({
      id: knowledgeIds.project(row.id),
      kind: "project",
      title: row.name,
      side: "work",
      path,
      updated: meta.ok ? meta.value.last_opened_at : "",
      text: [row.name, instructions, ...row.agents.map((agent) => agent.task)].join("\n"),
    });
  }
  return out;
}

/**
 * Local archive index rows, one kind per side.
 *
 * `archive-index/<side>.json` is a cache, not the truth: a missing or corrupt
 * index simply contributes no archive hits.
 */
export async function archiveKnowledge(archiveIndex: string): Promise<KnowledgeCandidate[]> {
  const out: KnowledgeCandidate[] = [];
  for (const side of ["school", "skills"] as const) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(archiveIndex, `${side}.json`), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(raw) || !Array.isArray(raw.entries)) continue;
    for (const entry of raw.entries) {
      if (!isRecord(entry)) continue;
      const entryId = typeof entry.id === "string" ? entry.id : "";
      if (entryId === "") continue;
      const title =
        typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : entryId;
      const tags = Array.isArray(entry.tags)
        ? entry.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      out.push({
        id: knowledgeIds.archive(side, entryId),
        kind: "archive",
        title,
        side,
        path: `archive-index/${side}.json`,
        updated: typeof entry.archivedAt === "string" ? entry.archivedAt : "",
        text: [title, tags.join(" ")].join("\n"),
      });
    }
  }
  return out;
}


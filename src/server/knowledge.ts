import { stat, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";

import { parseDocument, readString, readStringArray } from "../domain/markdown";
import { listNotes } from "../storage/note-store";
import { indexFileExists } from "../storage/index";
import { searchKnowledge as indexedKnowledgeSearch } from "../services/knowledge/search";
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

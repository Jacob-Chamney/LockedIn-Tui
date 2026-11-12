/**
 * Knowledge search across the two walls.
 *
 * The FTS index (WP-105) and the note store (WP-121) existed with no consumer;
 * the parity checklist's "knowledge base" row was unchecked. This is the service
 * the search surface renders.
 *
 * The wall is structural, not a filter: each side has its own index file, and a
 * `side: "all"` search runs two separate queries and labels every hit with the
 * side it came from. There is no code path that merges hits without a label, and
 * no path that opens the other side's index for a single-side request.
 *
 * Read-only over the vaults: a search opens the index, queries it and closes it.
 * A missing index is rebuilt once because the index is a cache; nothing else is
 * ever written.
 */

import {
  indexFileExists,
  openIndex,
  closeIndex,
  rebuildFromScratch,
  search,
  type IndexError,
} from "../../storage/index"
import type { Workspace } from "../../storage/workspace"
import type { NoteKind } from "../../domain/note"

export type KnowledgeSide = "school" | "skills"
export type KnowledgeScope = "all" | KnowledgeSide

/** Snippet bound: the index already limits tokens; this limits characters. */
export const SNIPPET_MAX_CHARS = 200

/** Placeholder for the index path, so no absolute path reaches a hit. */
export type KnowledgeHit = {
  side: KnowledgeSide
  /** Path relative to the side's vault, e.g. `concepts/energy-balance.md`. */
  path: string
  title: string
  snippet: string
  /** Note kind derived from the vault folder the note lives in. */
  kind: NoteKind | "note"
}

export type KnowledgeDiagnostic = {
  kind: "knowledge"
  side: KnowledgeSide
  path: string
  message: string
  /** One actionable sentence; the other side still returns results. */
  next: string
}

export type KnowledgeResult = {
  hits: KnowledgeHit[]
  diagnostics: KnowledgeDiagnostic[]
  /** Hit count per side, so the UI can show "school 3 · skills 0". */
  counts: Record<KnowledgeSide, number>
}

export type SearchOptions = {
  side?: KnowledgeScope
  limit?: number
}

const DEFAULT_LIMIT = 20
const SIDES: readonly KnowledgeSide[] = ["school", "skills"]

const KIND_BY_FOLDER: Record<string, NoteKind> = {
  concepts: "concept",
  courses: "course",
  goals: "goal",
  knowledge: "knowledge",
  sessions: "session-summary",
  sources: "source",
}

/** An `IndexError` only carries a path for some kinds. */
function pathOf(error: IndexError, fallback: string): string {
  return "path" in error && typeof error.path === "string" ? error.path : fallback
}

/** Follow the storage layer's own next step when it offers one. */
function nextOf(error: IndexError): string {
  return "next" in error && typeof error.next === "string"
    ? error.next
    : "Delete that side's index file and search again: the index is a cache and rebuilds itself."
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The note kind the vault folder implies; `note` when the folder is new. */
export function kindForPath(path: string): NoteKind | "note" {
  const folder = path.split("/")[0] ?? ""
  return KIND_BY_FOLDER[folder] ?? "note"
}

/** Bound a snippet by characters without cutting a word in half. */
export function boundSnippet(snippet: string): string {
  const text = snippet.replace(/\s+/g, " ").trim()
  if (text.length <= SNIPPET_MAX_CHARS) return text
  const cut = text.slice(0, SNIPPET_MAX_CHARS)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > SNIPPET_MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** True when a hit belongs to the side that produced it. */
export function hitBelongsToSide(side: KnowledgeSide, path: string): boolean {
  if (path.trim() === "") return false
  if (path.startsWith("/")) return false
  if (path.includes("..")) return false
  // A school hit can never be a path under the skills tree, and vice versa.
  const other = side === "school" ? "skills/" : "school/"
  return !path.startsWith(other)
}

function diagnostic(side: KnowledgeSide, path: string, message: string): KnowledgeDiagnostic {
  return {
    kind: "knowledge",
    side,
    path,
    message,
    next: "Delete that side's index file and search again: the index is a cache and rebuilds itself.",
  }
}

async function searchSide(
  workspace: Workspace,
  side: KnowledgeSide,
  query: string,
  limit: number,
): Promise<{ hits: KnowledgeHit[]; diagnostics: KnowledgeDiagnostic[] }> {
  const diagnostics: KnowledgeDiagnostic[] = []

  // A missing index is a cache miss: build it once, then search.
  if (!indexFileExists(workspace.paths, side)) {
    const rebuilt = rebuildFromScratch(workspace.paths, side)
    if (!rebuilt.ok) {
      diagnostics.push({
        ...diagnostic(side, pathOf(rebuilt.error, workspace.paths.root), `the ${side} index could not be built: ${rebuilt.error.message}`),
        next: nextOf(rebuilt.error),
      })
      return { hits: [], diagnostics }
    }
    closeIndex(rebuilt.value.index)
  }

  const opened = openIndex(workspace.paths, side)
  if (!opened.ok) {
    diagnostics.push({
      ...diagnostic(side, pathOf(opened.error, workspace.paths.root), `the ${side} index could not be opened: ${opened.error.message}`),
      next: nextOf(opened.error),
    })
    return { hits: [], diagnostics }
  }

  try {
    const found = search(opened.value, query, limit)
    if (!found.ok) {
      diagnostics.push({
        ...diagnostic(side, pathOf(found.error, workspace.paths.root), `the ${side} index could not be searched: ${found.error.message}`),
        next: nextOf(found.error),
      })
      return { hits: [], diagnostics }
    }

    const hits: KnowledgeHit[] = []
    for (const hit of found.value) {
      if (!hitBelongsToSide(side, hit.path)) continue
      hits.push({
        side,
        path: hit.path,
        title: hit.title,
        snippet: boundSnippet(hit.snippet),
        kind: kindForPath(hit.path),
      })
    }
    return { hits, diagnostics }
  } catch (error) {
    diagnostics.push(diagnostic(side, workspace.paths.root, `the ${side} search failed: ${messageOf(error)}`))
    return { hits: [], diagnostics }
  } finally {
    closeIndex(opened.value)
  }
}

/**
 * Search one side or both.
 *
 * An empty or whitespace query returns nothing — never everything — and no index
 * is opened for it. Results keep each side's own block; when `side: "all"` the
 * school hits come first and every hit carries its `side`.
 */
export async function searchKnowledge(
  workspace: Workspace,
  query: string,
  options: SearchOptions = {},
): Promise<KnowledgeResult> {
  const empty: KnowledgeResult = {
    hits: [],
    diagnostics: [],
    counts: { school: 0, skills: 0 },
  }
  if (query.trim() === "") return empty

  const scope = options.side ?? "all"
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 200))
  const sides = scope === "all" ? SIDES : [scope]

  const hits: KnowledgeHit[] = []
  const diagnostics: KnowledgeDiagnostic[] = []
  const counts: Record<KnowledgeSide, number> = { school: 0, skills: 0 }

  for (const side of sides) {
    const result = await searchSide(workspace, side, query, limit)
    hits.push(...result.hits)
    diagnostics.push(...result.diagnostics)
    counts[side] = result.hits.length
  }

  return { hits, diagnostics, counts }
}

/** Hits grouped by side, so a renderer cannot accidentally flatten them. */
export function bySide(result: KnowledgeResult): Record<KnowledgeSide, KnowledgeHit[]> {
  return {
    school: result.hits.filter((hit) => hit.side === "school"),
    skills: result.hits.filter((hit) => hit.side === "skills"),
  }
}

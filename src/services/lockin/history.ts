/**
 * Related history for a lock-in chat.
 *
 * Vault material is a **separate** return value, labelled `From your history`.
 * It is never concatenated into a source excerpt, never counted as a source and
 * never written to `meta.json` (`docs/product.md` §4.3, `AGENTS.md` §2.7).
 *
 * A missing index is not an error: history reports `available: false` and the
 * chat answers from its sources.
 */

import type { LockInSession } from "../../domain/session"

export const HISTORY_LABEL = "From your history"
export const EXTERNAL_LABEL = "external explanation"

export type NoteHit = {
  path: string
  title: string
  snippet: string
  score: number
  updated: string
}

export type HistoryBlock = {
  kind: "history"
  label: typeof HISTORY_LABEL
  notes: NoteHit[]
  available: boolean
}

/** The only capability `relatedHistory` needs; the index owns the real one. */
export type HistoryIndex = {
  search(query: string, limit: number): Promise<NoteHit[] | null>
}

export type HistoryInput = {
  session: Pick<LockInSession, "id" | "name"> & { prompt?: string }
  query: string
  index?: HistoryIndex | null
  limit?: number
}

/**
 * Look up related notes. Never throws and never fails the turn: no index, a
 * throwing index and an empty result all produce the same shape, with
 * `available` telling the UI whether the block is meaningful.
 */
export async function relatedHistory(input: HistoryInput): Promise<HistoryBlock> {
  const limit = input.limit ?? 5
  const query = input.query.trim() === "" ? input.session.name : input.query

  if (!input.index) {
    return { kind: "history", label: HISTORY_LABEL, notes: [], available: false }
  }

  try {
    const notes = await input.index.search(query, limit)
    if (notes === null) {
      return { kind: "history", label: HISTORY_LABEL, notes: [], available: false }
    }
    return {
      kind: "history",
      label: HISTORY_LABEL,
      notes: notes.slice(0, limit),
      available: true,
    }
  } catch {
    return { kind: "history", label: HISTORY_LABEL, notes: [], available: false }
  }
}

/** Output that came from a plugin host, labelled on the value. */
export type ExternalExplanation<T> = {
  label: typeof EXTERNAL_LABEL
  external: true
  value: T
}

/**
 * Label plugin output.
 *
 * The label rides on the value, so a renderer shows it and a model cannot drop
 * it. The type is distinct from a source, which is why a labelled result cannot
 * be passed where source text is expected.
 */
export function labelPluginOutput<T>(value: T): ExternalExplanation<T> {
  return { label: EXTERNAL_LABEL, external: true, value }
}

export function isExternalExplanation(value: unknown): value is ExternalExplanation<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "external" in value &&
    (value as { external?: unknown }).external === true
  )
}

/**
 * Session memory: a compact, labelled record of what a session established.
 *
 * Memory is history, never a source (`docs/product.md` §4.5). It is written
 * after a successful turn only, it is deduped by normalised text, and it is
 * capped — with folded bullets, so nothing is silently dropped.
 *
 * Extraction is best-effort: a failure writes nothing and never becomes a chat
 * error, because the turn it describes already succeeded.
 */

import { readFile, rename, rm } from "node:fs/promises"
import { basename, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { parseDocument, patchFrontmatter, serializeDocument } from "../../domain/markdown"
import { SESSION_FILES } from "../../domain/session"

export type MemoryError =
  | { kind: "storage"; path: string; message: string }
  | { kind: "malformed"; path: string; message: string }

/** Label every rendering of memory must carry. */
export const MEMORY_LABEL = "session memory"
export const MAX_POINTS_PER_TURN = 3
export const MAX_POINT_CHARS = 160
export const MAX_BULLETS = 50
export const MEMORY_TITLE = "# Key points"

export type MemoryPoint = string

export type Memory = {
  sessionId: string
  points: MemoryPoint[]
  updated: string
  /** Bullets folded by the cap; each is one `earlier:` line. */
  folded: string[]
}

export function memoryPath(folder: string): string {
  return join(folder, SESSION_FILES.memory)
}

/** Case, whitespace and trailing punctuation are not meaning. */
export function normalisePoint(point: string): string {
  return point.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!,;:]+$/, "")
}

/** Keep the first occurrence of each point; order is preserved. */
export function dedupePoints(
  points: readonly MemoryPoint[],
  existing: readonly MemoryPoint[] = [],
): MemoryPoint[] {
  const seen = new Set(existing.map(normalisePoint))
  const out: MemoryPoint[] = []
  for (const point of points) {
    const key = normalisePoint(point)
    if (key === "" || seen.has(key)) continue
    seen.add(key)
    out.push(point.trim())
  }
  return out
}

/** Trim a model response to the per-turn contract. */
export function boundPoints(points: readonly MemoryPoint[]): MemoryPoint[] {
  return points
    .map((point) => point.trim())
    .filter((point) => point !== "")
    .map((point) => (point.length > MAX_POINT_CHARS ? `${point.slice(0, MAX_POINT_CHARS - 1)}…` : point))
    .slice(0, MAX_POINTS_PER_TURN)
}

/**
 * Apply the cap. Bullets beyond the cap become one folded line each, so the
 * record keeps everything even though the visible list is bounded.
 */
export function applyCap(
  points: readonly MemoryPoint[],
  folded: readonly string[] = [],
): { points: MemoryPoint[]; folded: string[] } {
  if (points.length <= MAX_BULLETS) return { points: [...points], folded: [...folded] }
  const dropped = points.slice(MAX_BULLETS)
  return {
    points: points.slice(0, MAX_BULLETS),
    folded: [...folded, ...dropped.map((point) => `earlier: ${point}`)],
  }
}

/** The body only: title plus bullets. Used when the frontmatter is preserved. */
export function renderMemoryBody(memory: Memory): string {
  const bullets = [...memory.points, ...memory.folded].map((point) => `- ${point}`)
  return ["", MEMORY_TITLE, "", ...bullets, ""].join("\n")
}

export function renderMemory(memory: Memory, updated = memory.updated): string {
  const header = [
    "---",
    `type: session-summary`,
    `session: ${memory.sessionId}`,
    `updated: ${updated}`,
    "---",
  ].join("\n")
  return `${header}\n${renderMemoryBody(memory)}`
}

export function parseMemory(text: string, sessionId: string): Result<Memory, MemoryError> {
  const parsed = parseDocument(text)
  if (!parsed.ok) {
    return err({ kind: "malformed", path: SESSION_FILES.memory, message: parsed.error.message })
  }

  const bullets: string[] = []
  for (const line of parsed.value.body.split("\n")) {
    const match = /^\s*-\s+(.*)$/.exec(line)
    if (match) bullets.push(match[1]!.trim())
  }

  const points = bullets.filter((line) => !line.startsWith("earlier: "))
  const folded = bullets.filter((line) => line.startsWith("earlier: "))
  const updated = parsed.value.data.updated

  return ok({
    sessionId,
    points,
    folded,
    updated: typeof updated === "string" ? updated : "",
  })
}

export async function readMemory(
  folder: string,
  sessionId: string,
): Promise<Result<Memory | null, MemoryError>> {
  let text: string
  try {
    text = await readFile(memoryPath(folder), "utf8")
  } catch {
    return ok(null)
  }
  return parseMemory(text, sessionId)
}

/** Atomic replace; unknown frontmatter keys are preserved through a patch. */
export async function writeMemory(
  folder: string,
  memory: Memory,
  extraFrontmatter: Record<string, string> = {},
): Promise<Result<Memory, MemoryError>> {
  const target = memoryPath(folder)
  const temporary = join(folder, `.${basename(target)}.tmp-${crypto.randomUUID()}`)

  let existing: string | null = null
  try {
    existing = await readFile(target, "utf8")
  } catch {
    existing = null
  }

  const base = existing ?? renderMemory(memory)
  // Patch the frontmatter so unknown keys survive, then rebuild the body from
  // memory: the body is owned here, the header is shared with the user.
  const patched = patchFrontmatter(base, {
    type: "session-summary",
    session: memory.sessionId,
    updated: memory.updated,
    ...extraFrontmatter,
  })
  if (!patched.ok) {
    return err({ kind: "malformed", path: target, message: patched.error.message })
  }
  const document = parseDocument(patched.value)
  if (!document.ok) {
    return err({ kind: "malformed", path: target, message: document.error.message })
  }
  const text = serializeDocument(document.value.data, renderMemoryBody(memory), document.value.raw.eol)

  try {
    await Bun.write(temporary, text)
    await rename(temporary, target)
    return ok(memory)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return err({
      kind: "storage",
      path: target,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export type TurnOutcome = "done" | "cancelled" | "error"

export type ExtractInput = {
  folder: string
  sessionId: string
  /** Terminal event of the turn: memory is written only for `done`. */
  outcome: TurnOutcome
  points: readonly string[]
  now: string
}

/**
 * Record one turn's key points.
 *
 * Returns `written: false` for a cancelled or failed turn, and for a turn whose
 * points are all duplicates — in both cases nothing is written.
 */
export async function recordTurn(input: ExtractInput): Promise<Result<{ written: boolean; memory: Memory | null }, MemoryError>> {
  if (input.outcome !== "done") return ok({ written: false, memory: null })

  const current = await readMemory(input.folder, input.sessionId)
  if (!current.ok) return current

  const existing = current.value
  const bounded = boundPoints(input.points)
  const fresh = dedupePoints(bounded, existing?.points ?? [])
  if (fresh.length === 0) return ok({ written: false, memory: existing })

  const merged = applyCap([...(existing?.points ?? []), ...fresh], existing?.folded ?? [])
  const memory: Memory = {
    sessionId: input.sessionId,
    points: merged.points,
    folded: merged.folded,
    updated: input.now,
  }

  const stored = await writeMemory(input.folder, memory)
  if (!stored.ok) return stored
  return ok({ written: true, memory: stored.value })
}

/** The read API later knowledge search consumes: bullets plus `updated`. */
export async function memoryFor(
  folder: string,
  sessionId: string,
): Promise<{ label: string; points: string[]; folded: string[]; updated: string } | null> {
  const memory = await readMemory(folder, sessionId)
  if (!memory.ok || memory.value === null) return null
  return {
    label: MEMORY_LABEL,
    points: memory.value.points,
    folded: memory.value.folded,
    updated: memory.value.updated,
  }
}

/**
 * Source coverage rules.
 *
 * Coverage answers a narrow, checkable question: **does this session's text
 * mention this source?** It counts case-insensitive occurrences of a source's
 * name and of its origin file name across labelled documents.
 *
 * It deliberately does *not* claim semantic citation. A mention is a lexical
 * fact, not proof that a claim came from that source, and the panel must not
 * present it as one (`docs/product.md` §4.3 says "which sources are referenced
 * by steps, chat, outputs or memory" — referenced, nothing stronger).
 *
 * Pure: the caller supplies the text, nothing is read, nothing is mutated.
 */

import { baseName, type Source } from "./source"

export type CoverageDocumentKind = "steps" | "chat" | "outputs" | "memory"

export const COVERAGE_DOCUMENT_KINDS: readonly CoverageDocumentKind[] = [
  "steps",
  "chat",
  "outputs",
  "memory",
]

export type CoverageDocument = {
  kind: CoverageDocumentKind
  /** Document text exactly as stored. */
  text: string
}

/** The fields coverage needs; a full `Source` satisfies this. */
export type CoverageSource = Pick<Source, "name" | "originalPath" | "hash">

export type SourceCoverage = {
  hash: string
  name: string
  originalPath: string
  /** Occurrences across all documents (overlapping name/origin matches count once). */
  count: number
  /** Documents that mention it, in the order the caller supplied them. */
  documents: CoverageDocumentKind[]
  /** First matching line, trimmed and capped, for the coverage panel. */
  firstLine: string | null
  referenced: boolean
  /** True when `memory` is the only document that mentions it. */
  fromMemoryOnly: boolean
}

export type CoverageReport = {
  /** Sorted by count descending, then by name. */
  sources: SourceCoverage[]
  /** The same entries with `referenced: false`, sorted by name. */
  unreferenced: SourceCoverage[]
  total: number
  referencedCount: number
}

/**
 * Names shorter than this are matched as whole words only.
 *
 * Choice, as the packet requires it to be documented: two-letter file names
 * (`ts`, `md`, `go`) otherwise match inside ordinary prose, which would report
 * coverage that does not exist. Whole-word matching keeps short names usable
 * while removing the false positives.
 */
export const MIN_SUBSTRING_LENGTH = 3

/** Cap for `firstLine`, so one huge line cannot flood the panel. */
export const FIRST_LINE_CHARS = 160

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

type Span = { start: number; end: number }

function findSpans(haystack: string, needle: string): Span[] {
  const spans: Span[] = []
  const wholeWord = needle.length < MIN_SUBSTRING_LENGTH
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    const end = at + needle.length
    const bounded =
      !wholeWord || (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[end]))
    if (bounded) spans.push({ start: at, end })
    from = at + 1
  }
  return spans
}

/** Merge overlapping spans so a name and an origin name count once. */
function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) return spans
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = [{ ...sorted[0]! }]
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
      continue
    }
    merged.push({ ...span })
  }
  return merged
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1
  const newline = text.indexOf("\n", index)
  const end = newline === -1 ? text.length : newline
  const line = text.slice(start, end).trim()
  return line.length > FIRST_LINE_CHARS ? `${line.slice(0, FIRST_LINE_CHARS)}…` : line
}

function needlesFor(source: CoverageSource): string[] {
  const origin = baseName(source.originalPath)
  const lower = source.name.trim().toLowerCase()
  const originLower = origin.trim().toLowerCase()
  if (lower === "") return originLower === "" ? [] : [originLower]
  return lower === originLower ? [lower] : [lower, originLower]
}

/**
 * Compute coverage for one session.
 *
 * Duplicate sources are merged by hash (first wins), so adding the same file
 * twice never inflates a count. An empty source list is a valid empty report.
 */
export function computeCoverage(
  sources: readonly CoverageSource[],
  documents: readonly CoverageDocument[],
): CoverageReport {
  const seen = new Set<string>()
  const unique: CoverageSource[] = []
  for (const source of sources) {
    if (seen.has(source.hash)) continue
    seen.add(source.hash)
    unique.push(source)
  }

  // Lowercase every document once; matching is case-insensitive.
  const haystacks = documents.map((document) => ({
    kind: document.kind,
    lower: document.text.toLowerCase(),
    original: document.text,
  }))

  const entries: SourceCoverage[] = unique.map((source) => {
    const needles = needlesFor(source)
    let count = 0
    let firstLine: string | null = null
    const mentionedIn: CoverageDocumentKind[] = []

    for (const document of haystacks) {
      const spans = mergeSpans(needles.flatMap((needle) => findSpans(document.lower, needle)))
      if (spans.length === 0) continue
      count += spans.length
      mentionedIn.push(document.kind)
      // The first mentioning document in caller order supplies the excerpt.
      firstLine ??= lineAt(document.original, spans[0]!.start)
    }

    return {
      hash: source.hash,
      name: source.name,
      originalPath: source.originalPath,
      count,
      documents: mentionedIn,
      firstLine,
      referenced: count > 0,
      fromMemoryOnly: mentionedIn.length > 0 && mentionedIn.every((kind) => kind === "memory"),
    }
  })

  const sorted = [...entries].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count
    const left = a.name.toLowerCase()
    const right = b.name.toLowerCase()
    if (left !== right) return left < right ? -1 : 1
    return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0
  })

  const unreferenced = entries
    .filter((entry) => !entry.referenced)
    .sort((a, b) => {
      const left = a.name.toLowerCase()
      const right = b.name.toLowerCase()
      if (left !== right) return left < right ? -1 : 1
      return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0
    })

  return {
    sources: sorted,
    unreferenced,
    total: entries.length,
    referencedCount: entries.filter((entry) => entry.referenced).length,
  }
}

/** Convenience for the panel: the entries that need attention, worst first. */
export function coverageGaps(report: CoverageReport): SourceCoverage[] {
  return report.unreferenced
}

/**
 * True when the session has at least one source and every source is mentioned
 * somewhere. An empty source list is never "covered": there is nothing to cite.
 */
export function isFullyCovered(report: CoverageReport): boolean {
  return report.total > 0 && report.referencedCount === report.total
}

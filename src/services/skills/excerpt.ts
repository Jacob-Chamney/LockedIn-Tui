/**
 * Excerpts: the saved, citable slice of a source.
 *
 * A lesson cites `{ name, location, hash, text }` without re-reading the file,
 * so an excerpt is a durable artifact (`docs/product.md` §7.3). Two rules keep
 * it honest: it is the *first* slice of the extracted text, and a source with
 * too little text is `unusable` rather than silently citable.
 */

import { dedupeExcerpts, makeExcerpt, type Excerpt } from "../../domain/note"
import { MIN_SUBSTRING_LENGTH } from "../../domain/coverage"

export const DEFAULT_EXCERPT_CHARS = 400
/** Below this, the text cannot be matched by coverage search. */
export const MIN_EXCERPT_CHARS = MIN_SUBSTRING_LENGTH

export type ExcerptOutcome =
  | { ok: true; excerpt: Excerpt }
  | { ok: false; reason: "too-short"; message: string }

/** Collapse whitespace so an excerpt is one readable line group. */
export function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Cut at a grapheme boundary.
 *
 * `Intl.Segmenter` is used when present; the fallback keeps surrogate pairs and
 * combining marks together so an excerpt never ends mid-character.
 */
export function cutGraphemes(text: string, chars: number): string {
  if (chars <= 0) return ""
  if (text.length <= chars) return text

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null

  // A grapheme may be several UTF-16 units, so the cut always keeps the first
  // one whole even when that overshoots the cap by a unit. Whole characters win
  // over an exact count: a split grapheme is unreadable.
  if (segmenter) {
    let out = ""
    for (const { segment } of segmenter.segment(text)) {
      if (out.length > 0 && (out + segment).length > chars) break
      out += segment
    }
    return out
  }

  let out = ""
  for (const char of Array.from(text)) {
    if (out.length > 0 && (out + char).length > chars) break
    out += char
  }
  return out
}

/**
 * Build the excerpt for one source.
 *
 * Returns `too-short` when the normalised text is shorter than the minimum a
 * coverage search could find; the caller keeps the source but marks it
 * unusable, so it is visible and cannot be cited by accident.
 */
export function buildExcerpt(input: {
  sourceName: string
  location: string
  text: string
  chars?: number
}): ExcerptOutcome {
  const chars = input.chars ?? DEFAULT_EXCERPT_CHARS
  const text = normaliseWhitespace(input.text)

  if (text.length < MIN_EXCERPT_CHARS) {
    return {
      ok: false,
      reason: "too-short",
      message: "not enough text to cite",
    }
  }

  return {
    ok: true,
    excerpt: makeExcerpt({
      sourceName: input.sourceName,
      location: input.location,
      text,
      chars,
    }),
  }
}

/** Keep the first excerpt per hash; order preserved. */
export function uniqueExcerpts(excerpts: readonly Excerpt[]): Excerpt[] {
  return dedupeExcerpts(excerpts)
}

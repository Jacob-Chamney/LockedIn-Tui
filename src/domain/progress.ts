/**
 * Progress engine — the rule that makes Markdown the progress record.
 *
 * `docs/product.md` §5.1 and `docs/data-model.md` §4.4 define the invariant:
 * a toggle rewrites **only** the bracket character and the single progress
 * line. Nothing else in the file may move, re-wrap or re-normalise.
 *
 * Consequences for this module:
 * - lines are split on `\n` and rejoined on `\n`, so a CRLF file keeps its
 *   `\r` bytes and a missing trailing newline stays missing;
 * - indentation, list markers and step text are never rewritten;
 * - a missing progress line is *not* invented (that would be a second edit);
 * - a malformed or duplicated progress line is a typed error, never repaired.
 *
 * Pure functions only: no file IO, no UI, no storage imports.
 */

import { err, ok, type Result } from "./markdown"

export type StepMarker = "-" | "*" | "+"

export type StepItem = {
  /** 0-based ordinal among task-list items, which is what `toggle` takes. */
  index: number
  /** 0-based line number in the document. */
  line: number
  checked: boolean
  /** Step text after the checkbox, verbatim (this is the merge key). */
  text: string
  marker: StepMarker
  indent: string
  /** Column of the checkbox character inside the line. */
  bracketAt: number
}

/** The literal pieces of the progress line, so a rewrite never re-parses. */
export type ProgressFormat = {
  prefix: string
  glue: string
  unit: string
  suffix: string
}

export type ProgressError =
  | { kind: "index-out-of-range"; index: number; total: number; message: string }
  | { kind: "progress-malformed"; line: number; message: string }
  | { kind: "progress-ambiguous"; lines: number[]; message: string }

export type ParsedProgress = {
  items: StepItem[]
  checked: number
  total: number
  /** 0-based line of the progress line, or null when the file has none. */
  progressLine: number | null
  /** Present exactly when `progressLine` is not null. */
  progressFormat: ProgressFormat | null
}

export type ToggleResult = {
  /** The document bytes after the toggle. */
  text: string
  index: number
  checked: boolean
  checkedCount: number
  total: number
  progressLine: number | null
  /** `sha256:…` of `text`, so the caller never re-reads the file to diff. */
  hash: string
}

const STEP = /^(\s*)([-*+])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/
const PROGRESS = /^(\s*>\s*)(\d+)(\s+of\s+)(\d+)(\s+steps?\s+done)(.*)$/
const PROGRESS_LIKE = /\bsteps?\s+done\b/

function splitTrailingCr(line: string): { content: string; cr: string } {
  return line.endsWith("\r")
    ? { content: line.slice(0, -1), cr: "\r" }
    : { content: line, cr: "" }
}

/** True when the line carries a parseable progress count. */
export function isProgressLine(line: string): boolean {
  return PROGRESS.test(splitTrailingCr(line).content)
}

/**
 * Parse task-list items and the progress line.
 * `- [ ]`, `* [x]` and `+ [X]` are all task items; `1. [ ]` is not.
 */
export function parseProgress(raw: string): Result<ParsedProgress, ProgressError> {
  const lines = raw.split("\n")
  const items: StepItem[] = []
  const progressLines: number[] = []
  let progressFormat: ProgressFormat | null = null

  for (let at = 0; at < lines.length; at++) {
    const { content } = splitTrailingCr(lines[at]!)

    const step = STEP.exec(content)
    if (step) {
      items.push({
        index: items.length,
        line: at,
        checked: step[3]!.toLowerCase() === "x",
        text: (step[4] ?? "").trim(),
        marker: step[2] as StepMarker,
        indent: step[1]!,
        bracketAt: step[0].indexOf("[") + 1,
      })
      continue
    }

    const progress = PROGRESS.exec(content)
    if (progress) {
      progressLines.push(at)
      progressFormat = {
        prefix: progress[1]!,
        glue: progress[3]!,
        unit: progress[5]!,
        suffix: progress[6]!,
      }
      continue
    }

    if (PROGRESS_LIKE.test(content) && content.includes(">")) {
      return err({
        kind: "progress-malformed",
        line: at,
        message:
          `malformed progress line at line ${at + 1}: expected "> N of M steps done", got ` +
          `"${content.trim()}"`,
      })
    }
  }

  if (progressLines.length > 1) {
    return err({
      kind: "progress-ambiguous",
      lines: progressLines,
      message:
        `found ${progressLines.length} progress lines (${progressLines
          .map((line) => line + 1)
          .join(", ")}); a document has exactly one`,
    })
  }

  const checked = items.filter((item) => item.checked).length
  const progressLine = progressLines[0] ?? null
  return ok({
    items,
    checked,
    total: items.length,
    progressLine,
    progressFormat: progressLine === null ? null : progressFormat,
  })
}

/** Rebuild the progress line from its parsed pieces; no re-parse, no branch. */
export function renderProgress(format: ProgressFormat, checked: number, total: number): string {
  return `${format.prefix}${checked}${format.glue}${total}${format.unit}${format.suffix}`
}

/** Replace exactly one checkbox character at a known column. */
function withBracket(content: string, bracketAt: number, checked: boolean): string {
  return `${content.slice(0, bracketAt)}${checked ? "x" : " "}${content.slice(bracketAt + 1)}`
}

function hashText(text: string): string {
  return `sha256:${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`
}

/**
 * Toggle the `index`th task item.
 *
 * Exactly two things change: the bracket character of that item, and the counts
 * inside the progress line when the document has one. The result is a fixed
 * point: toggling the same index twice returns the original bytes for any
 * document whose progress line already matched its items.
 */
export function toggle(raw: string, index: number): Result<ToggleResult, ProgressError> {
  const parsed = parseProgress(raw)
  if (!parsed.ok) return parsed
  const { items, total, progressLine, progressFormat } = parsed.value

  const target = items[index]
  if (target === undefined) {
    return err({
      kind: "index-out-of-range",
      index,
      total,
      message: `no step ${index}; the document has ${total} step${total === 1 ? "" : "s"} (0–${
        total - 1
      })`,
    })
  }

  const nextChecked = !target.checked
  const checkedCount = parsed.value.checked + (nextChecked ? 1 : -1)

  const lines = raw.split("\n")
  const { content, cr } = splitTrailingCr(lines[target.line]!)
  lines[target.line] = `${withBracket(content, target.bracketAt, nextChecked)}${cr}`

  if (progressLine !== null && progressFormat !== null) {
    const current = splitTrailingCr(lines[progressLine]!)
    lines[progressLine] = `${renderProgress(progressFormat, checkedCount, total)}${current.cr}`
  }

  const text = lines.join("\n")
  return ok({
    text,
    index,
    checked: nextChecked,
    checkedCount,
    total,
    progressLine,
    hash: hashText(text),
  })
}

/**
 * Merge freshly generated steps into an existing document.
 *
 * Checked state is carried by **exact step text**: a step that was checked and
 * still exists stays checked. New steps arrive unchecked, removed steps
 * disappear, and the fresh document's order and formatting are kept. Two items
 * with identical text share state, because text is the only key the product
 * defines.
 */
export function mergeSteps(oldRaw: string, freshRaw: string): Result<string, ProgressError> {
  const previous = parseProgress(oldRaw)
  if (!previous.ok) return previous
  const fresh = parseProgress(freshRaw)
  if (!fresh.ok) return fresh

  const done = new Set(previous.value.items.filter((item) => item.checked).map((item) => item.text))
  const lines = freshRaw.split("\n")
  let checked = 0

  for (const item of fresh.value.items) {
    const shouldBeChecked = done.has(item.text)
    if (shouldBeChecked) checked++
    if (shouldBeChecked === item.checked) continue
    const { content, cr } = splitTrailingCr(lines[item.line]!)
    lines[item.line] = `${withBracket(content, item.bracketAt, shouldBeChecked)}${cr}`
  }

  const { progressLine, progressFormat, total } = fresh.value
  if (progressLine !== null && progressFormat !== null) {
    const current = splitTrailingCr(lines[progressLine]!)
    lines[progressLine] = `${renderProgress(progressFormat, checked, total)}${current.cr}`
  }

  return ok(lines.join("\n"))
}

/** Counts only, for a status line that must not depend on the document text. */
export function stepCounts(raw: string): Result<{ checked: number; total: number }, ProgressError> {
  const parsed = parseProgress(raw)
  if (!parsed.ok) return parsed
  return ok({ checked: parsed.value.checked, total: parsed.value.total })
}

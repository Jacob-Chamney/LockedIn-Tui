/**
 * Unified diff rows with line-number gutters.
 *
 * One implementation serves the plugin SDK (`diff()` places scene nodes) and
 * the app's Work change review. Each source line becomes one row, plus
 * continuation rows when a long line wraps under the content column. Numbers
 * follow the hunk's starts: context advances both, an addition only the new
 * side, a removal only the old side.
 */
import { calloutLines } from "./callout"

export type DiffLineKind = "context" | "add" | "remove"

export type DiffLine = {
  kind: DiffLineKind
  text: string
}

export type DiffRow = {
  index: number
  kind: DiffLineKind
  oldNo: number | null
  newNo: number | null
  /** Number columns and the `+`/`-`/space marker, or spaces on a continuation. */
  gutter: string
  text: string
  /** True for the wrapped tail of a long line. */
  continuation: boolean
}

export type DiffOptions = {
  lines: readonly DiffLine[]
  /** Total row width in cells. */
  width: number
  /** First old-side line; defaults to 1. */
  oldStart?: number
  /** First new-side line; defaults to 1. */
  newStart?: number
  /** Show line numbers; defaults true. */
  numbers?: boolean
  /** Wrap long lines; defaults true. When false they are ellipsised. */
  wrap?: boolean
}

/** The ink role for one line kind. */
export function diffTone(kind: DiffLineKind): string {
  if (kind === "add") return "success"
  if (kind === "remove") return "error"
  return "muted"
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function diffRows(options: DiffOptions): DiffRow[] {
  const lines = options.lines
  if (lines.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const numbers = options.numbers !== false
  const wrap = options.wrap !== false
  const oldStart = Math.max(1, Math.floor(options.oldStart ?? 1))
  const newStart = Math.max(1, Math.floor(options.newStart ?? 1))
  const oldCount = lines.filter((line) => line.kind !== "add").length
  const newCount = lines.filter((line) => line.kind !== "remove").length
  const numberWidth = numbers
    ? Math.max(2, String(oldStart + oldCount).length, String(newStart + newCount).length)
    : 0
  const gutterWidth = numbers ? numberWidth * 2 + 4 : 2
  const contentWidth = Math.max(1, width - gutterWidth)
  const rows: DiffRow[] = []
  let oldNo = oldStart
  let newNo = newStart

  for (const line of lines) {
    const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "
    const oldShown = line.kind === "add" ? null : oldNo
    const newShown = line.kind === "remove" ? null : newNo
    const gutter = numbers
      ? `${oldShown === null ? " ".repeat(numberWidth) : String(oldShown).padStart(numberWidth)} ${
          newShown === null ? " ".repeat(numberWidth) : String(newShown).padStart(numberWidth)
        } ${marker} `
      : `${marker} `
    const chunks = wrap ? calloutLines(line.text, contentWidth) : [fit(line.text, contentWidth)]
    const parts = chunks.length === 0 ? [""] : chunks
    for (let at = 0; at < parts.length; at++) {
      const continuation = at > 0
      rows.push({
        index: rows.length,
        kind: line.kind,
        oldNo: continuation ? null : oldShown,
        newNo: continuation ? null : newShown,
        gutter: continuation ? " ".repeat(gutterWidth) : gutter,
        text: parts[at]!,
        continuation,
      })
    }
    if (line.kind !== "add") oldNo += 1
    if (line.kind !== "remove") newNo += 1
  }
  return rows
}

/**
 * Definition lists: a term column and wrapped descriptions.
 *
 * One implementation serves the plugin SDK (`definitionList()` paints the
 * rows) and the app's Usage totals. Terms share a fitted column; descriptions
 * wrap to the remaining width and continuation lines align under the first.
 * A row can carry a tone so an error or warning reads without colour alone.
 */
import { calloutLines } from "./callout"

export type DefinitionTone = "normal" | "muted" | "error" | "warning"

export type DefinitionItem = {
  term: string
  description: string
  tone?: DefinitionTone
}

export type DefinitionListOptions = {
  items: readonly DefinitionItem[]
  width: number
  /** Term column width; defaults to the longest term. */
  termWidth?: number
  /** Spaces between the term and description; defaults 2. */
  gap?: number
  /** Wrapped description lines kept per row; omitted means all. */
  maxLines?: number
}

export type DefinitionRow = {
  index: number
  term: string
  /** Description lines after wrapping. */
  lines: string[]
  /** Term + gap + first line; continuation lines are in `continuation`. */
  text: string
  continuation: string[]
  tone: DefinitionTone
}

export type DefinitionListLayout = {
  rows: DefinitionRow[]
  width: number
  termWidth: number
  gap: number
  height: number
  /** Every display line, in order. */
  lines: string[]
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export const DEFINITION_ROLES: Readonly<Record<DefinitionTone, string>> = {
  normal: "foreground",
  muted: "muted",
  error: "error",
  warning: "warning",
}

export function definitionRole(tone: DefinitionTone = "normal"): string {
  return DEFINITION_ROLES[tone] ?? "foreground"
}

export function definitionListLayout(options: DefinitionListOptions): DefinitionListLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.min(
    Math.max(0, Math.min(8, Math.floor(options.gap ?? 2))),
    Math.max(0, width - 1),
  )
  const items = options.items
  if (width === 0 || items.length === 0) {
    return { rows: [], width, termWidth: 0, gap, height: 0, lines: [] }
  }
  const natural = Math.max(1, ...items.map((item) => item.term.length))
  const termWidth = Math.max(
    0,
    Math.min(Math.floor(options.termWidth ?? natural), Math.max(0, width - gap - 1)),
  )
  const descriptionWidth = Math.max(1, width - termWidth - gap)
  const maxLines = options.maxLines === undefined ? Infinity : Math.max(1, Math.floor(options.maxLines))

  const rows = items.map((item, index) => {
    const wrapped = calloutLines(item.description, descriptionWidth)
    const kept = wrapped.slice(0, maxLines)
    if (wrapped.length > kept.length) {
      const last = kept[kept.length - 1] ?? ""
      kept[kept.length - 1] = last.length >= descriptionWidth
        ? `${last.slice(0, Math.max(0, descriptionWidth - 1))}…`
        : `${last}…`
    }
    const term = fit(item.term, termWidth).padEnd(termWidth)
    const prefix = `${term}${" ".repeat(gap)}`
    const lines = kept.length === 0 ? [""] : kept
    return {
      index,
      term,
      lines,
      text: `${prefix}${fit(lines[0] ?? "", descriptionWidth)}`,
      continuation: lines.slice(1).map((line) => `${" ".repeat(termWidth + gap)}${fit(line, descriptionWidth)}`),
      tone: item.tone ?? "normal",
    }
  })

  const lines: string[] = []
  for (const row of rows) {
    lines.push(row.text, ...row.continuation)
  }
  return { rows, width, termWidth, gap, height: lines.length, lines }
}

/** The definition list as plain lines. */
export function definitionListText(options: DefinitionListOptions): string[] {
  return definitionListLayout(options).lines
}

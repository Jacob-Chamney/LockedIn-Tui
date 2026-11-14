/**
 * Empty states: a glyph, a title and an optional hint.
 *
 * One implementation serves the plugin SDK (`emptyState()` places scene nodes)
 * and the app's `EmptyState` component. Titles and hints wrap to the available
 * width, and the SDK centres each row in its box; the app centres with a
 * column, so both land on the same shape.
 */
export type EmptyStateKind = "glyph" | "title" | "hint"

export type EmptyStateRow = {
  kind: EmptyStateKind
  text: string
}

export type EmptyStateOptions = {
  /** Text columns available. */
  width: number
  title: string
  hint?: string
  /** A glyph above the title; omit for a text-only empty state. */
  glyph?: string
}

/** The default mark for an empty surface. */
export const EMPTY_STATE_GLYPH = "○"

/** Wrap a title and hint into rows, with an optional glyph first. */
export function emptyStateRows(options: EmptyStateOptions): EmptyStateRow[] {
  const width = Math.max(1, Math.floor(options.width))
  const rows: EmptyStateRow[] = []
  if (options.glyph !== undefined && options.glyph !== "") {
    rows.push({ kind: "glyph", text: options.glyph.slice(0, width) })
  }
  for (const line of wrapLines(options.title, width)) {
    rows.push({ kind: "title", text: line })
  }
  if (options.hint) {
    for (const line of wrapLines(options.hint, width)) {
      rows.push({ kind: "hint", text: line })
    }
  }
  return rows
}

/** The left offset that centres a row in `width` columns. */
export function emptyStateX(row: EmptyStateRow, width: number): number {
  return Math.max(0, Math.floor((Math.max(0, Math.floor(width)) - row.text.length) / 2))
}

/** Word wrap with a hard break for a word wider than the line. */
function wrapLines(message: string, width: number): string[] {
  if (message === "") return []
  const out: string[] = []
  for (const paragraph of message.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter((word) => word !== "")
    if (words.length === 0) {
      out.push("")
      continue
    }
    let line = ""
    for (const word of words) {
      if (word.length > width) {
        if (line !== "") {
          out.push(line)
          line = ""
        }
        let rest = word
        while (rest.length > width) {
          out.push(rest.slice(0, width))
          rest = rest.slice(width)
        }
        line = rest
        continue
      }
      if (line === "") line = word
      else if (line.length + 1 + word.length <= width) line = `${line} ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line !== "") out.push(line)
  }
  return out
}

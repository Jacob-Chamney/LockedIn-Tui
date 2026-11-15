/**
 * Section dividers: a rule with an optional centred label.
 *
 * One implementation serves the plugin SDK (`divider()` places the line) and
 * the reader's Markdown rules. The line glyphs fill the remaining width; a
 * label is centred between one space on each side, and a label too wide for the
 * rule is fitted with an ellipsis.
 */
export type DividerOptions = {
  width: number
  /** Optional text centred in the rule. */
  label?: string
  /** Line glyph; defaults to `─`. */
  glyph?: string
}

export type DividerLayout = {
  width: number
  label: string
  /** Left line, label (with its spaces) and right line. */
  left: string
  middle: string
  right: string
  text: string
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function dividerLayout(options: DividerOptions): DividerLayout {
  const width = Math.max(0, Math.floor(options.width))
  const glyph = options.glyph === undefined || options.glyph === "" ? "─" : options.glyph
  const raw = options.label ?? ""
  if (width === 0) {
    return { width, label: "", left: "", middle: "", right: "", text: "" }
  }
  if (raw === "") {
    const line = glyph.repeat(width)
    return { width, label: "", left: line, middle: "", right: "", text: line }
  }

  const room = width - raw.length - 2
  if (room < 2) {
    const label = fit(raw, width)
    return { width, label, left: "", middle: label, right: "", text: label }
  }
  const label = fit(raw, width - 2)
  const leftWidth = Math.floor((width - label.length - 2) / 2)
  const rightWidth = Math.max(0, width - label.length - 2 - leftWidth)
  const left = glyph.repeat(leftWidth)
  const right = glyph.repeat(rightWidth)
  const middle = ` ${label} `
  return { width, label, left, middle, right, text: `${left}${middle}${right}` }
}

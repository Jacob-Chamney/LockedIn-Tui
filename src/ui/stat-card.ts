/**
 * Stat cards: a large value with a label and an optional detail line.
 *
 * One implementation serves the plugin SDK (`statCard()` places the lines) and
 * the app's Stats counters. Every line is fitted to the card width and aligned
 * left, centre or right; the value carries the tone, the label and detail stay
 * muted.
 */
export type StatCardTone = "normal" | "primary" | "success" | "warning" | "error" | "muted"
export type StatCardAlign = "left" | "center" | "right"

export type StatCardOptions = {
  value: string
  label: string
  /** An optional third line under the label. */
  detail?: string
  width: number
  tone?: StatCardTone
  align?: StatCardAlign
}

export type StatCardRowKind = "value" | "label" | "detail"

export type StatCardRow = {
  kind: StatCardRowKind
  text: string
  x: number
  width: number
}

export type StatCardLayout = {
  rows: StatCardRow[]
  width: number
  tone: StatCardTone
  align: StatCardAlign
  text: string
}

export function statCardToneRole(tone: StatCardTone = "normal"): string {
  if (tone === "normal") return "foreground"
  return tone
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function offset(text: string, width: number, align: StatCardAlign): number {
  if (align === "left") return 0
  if (align === "right") return Math.max(0, width - text.length)
  return Math.max(0, Math.floor((width - text.length) / 2))
}

export function statCardLayout(options: StatCardOptions): StatCardLayout {
  const width = Math.max(0, Math.floor(options.width))
  const tone = options.tone ?? "normal"
  const align = options.align ?? "center"
  if (width === 0) {
    return { rows: [], width, tone, align, text: "" }
  }
  const lines: Array<{ kind: StatCardRowKind; text: string }> = [
    { kind: "value", text: fit(options.value, width) },
    { kind: "label", text: fit(options.label, width) },
  ]
  if (options.detail !== undefined && options.detail !== "") {
    lines.push({ kind: "detail", text: fit(options.detail, width) })
  }
  const rows = lines.map((line) => ({
    kind: line.kind,
    text: line.text,
    x: offset(line.text, width, align),
    width,
  }))
  return {
    rows,
    width,
    tone,
    align,
    text: rows.map((row) => row.text).join("\n"),
  }
}

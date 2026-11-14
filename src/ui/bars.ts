/**
 * Proportional bar rows: a label, a filled bar and an optional value.
 *
 * One implementation serves the plugin SDK (`bars()` draws scene nodes) and
 * the app's Usage page. Rows share a fixed label column and a value column, so
 * bars line up; the bar width is whatever remains. A non-zero value always
 * keeps at least one cell (`minBar`), so a small slice is still visible.
 */
export type BarItem = {
  label: string
  value: number
  /** Right-hand text; defaults to the raw value. */
  text?: string
}

export type BarRow = {
  /** Fitted and padded to `labelWidth`. */
  label: string
  /** Fitted to `valueWidth`; renderers right-align it. */
  text: string
  /** 0..1 share of the scale. */
  fraction: number
  filled: number
  empty: number
  barWidth: number
  labelWidth: number
  valueWidth: number
  gap: number
  index: number
}

export type BarsLayoutOptions = {
  items: readonly BarItem[]
  /** Total row width in cells. */
  width: number
  labelWidth?: number
  /** Right-hand column; 0 hides it. Defaults to the widest text. */
  valueWidth?: number
  /** Override the computed bar width. */
  barWidth?: number
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Scale top; defaults to the largest value (at least 1). */
  max?: number
  /** Cells kept filled for any non-zero value; defaults to 1. */
  minBar?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function barRows(options: BarsLayoutOptions): BarRow[] {
  const items = options.items
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const gap = clamp(Math.floor(options.gap ?? 1), 0, 4)
  const texts = items.map((item) => item.text ?? String(item.value))
  const valueWidth = clamp(
    Math.floor(options.valueWidth ?? Math.max(0, ...texts.map((text) => text.length))),
    0,
    Math.max(0, width - 3),
  )
  const gaps = valueWidth > 0 ? gap * 2 : gap
  const room = Math.max(2, width - valueWidth - gaps)
  const preferredLabel = Math.min(16, Math.max(4, Math.floor(width / 4)))
  let labelWidth = clamp(Math.floor(options.labelWidth ?? preferredLabel), 1, Math.max(1, room - 1))
  let barWidth = Math.max(1, Math.floor(options.barWidth ?? room - labelWidth))
  if (labelWidth + barWidth > room) labelWidth = Math.max(1, room - barWidth)
  if (labelWidth + barWidth > room) barWidth = Math.max(1, room - labelWidth)
  const peak =
    options.max !== undefined && Number.isFinite(options.max) && options.max > 0
      ? options.max
      : Math.max(1, ...items.map((item) => finite(item.value)))
  const minBar = Math.max(0, Math.floor(options.minBar ?? 1))

  return items.map((item, index) => {
    const fraction = Math.max(0, Math.min(1, finite(item.value) / peak))
    const raw = Math.round(fraction * barWidth)
    const filled =
      finite(item.value) > 0 ? Math.max(minBar, Math.min(barWidth, raw)) : 0
    return {
      label: fit(item.label, labelWidth).padEnd(labelWidth),
      text: fit(texts[index] ?? "", valueWidth),
      fraction,
      filled,
      empty: barWidth - filled,
      barWidth,
      labelWidth,
      valueWidth,
      gap,
      index,
    }
  })
}

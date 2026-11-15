/**
 * Compact progress chips: a mini bar and a done/total count.
 *
 * One implementation serves the plugin SDK (`progressChip()` draws the chip)
 * and the app's Recent rows. The bar is `barWidth` cells; the count follows it.
 * Zero progress reads muted, a partial row reads primary and a complete row
 * reads success, so the state is visible without reading the numbers.
 */
export type ProgressChipTone = "success" | "primary" | "muted"

export type ProgressChipGlyphs = {
  filled: string
  empty: string
}

export const PROGRESS_CHIP_GLYPHS: Readonly<ProgressChipGlyphs> = {
  filled: "▰",
  empty: "▱",
}

export type ProgressChipOptions = {
  done: number
  total: number
  /** Bar cells; defaults to 4. */
  barWidth?: number
  /** Available columns; defaults to the natural text width. */
  width?: number
  glyphs?: Partial<ProgressChipGlyphs>
}

export type ProgressChipLayout = {
  done: number
  total: number
  /** 0..1 share, or 0 when there is no total. */
  fraction: number
  filled: number
  empty: number
  count: string
  text: string
  tone: ProgressChipTone
  width: number
}

export type ProgressChipStyle = {
  /** Palette role for the fill. */
  bg: string
  /** Palette role for the text/bar. */
  fg: string
}

export function progressChipStyle(tone: ProgressChipTone = "muted"): ProgressChipStyle {
  if (tone === "success") return { bg: "success", fg: "background" }
  if (tone === "primary") return { bg: "primary", fg: "background" }
  return { bg: "line", fg: "foreground" }
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function progressChipLayout(options: ProgressChipOptions): ProgressChipLayout {
  const total = Math.max(0, Math.floor(Number.isFinite(options.total) ? options.total : 0))
  const done = Math.max(0, Math.min(total, Math.floor(Number.isFinite(options.done) ? options.done : 0)))
  const barWidth = Math.max(0, Math.floor(options.barWidth ?? 4))
  const fraction = total === 0 ? 0 : done / total
  const filled = total === 0 ? 0 : Math.min(barWidth, Math.round(fraction * barWidth))
  const empty = Math.max(0, barWidth - filled)
  const glyphs = { ...PROGRESS_CHIP_GLYPHS, ...options.glyphs }
  const count = total === 0 ? "—" : `${done}/${total}`
  const bar = `${glyphs.filled.repeat(filled)}${glyphs.empty.repeat(empty)}`
  const natural = bar === "" ? count : `${bar} ${count}`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  const tone: ProgressChipTone =
    total === 0 || done === 0 ? "muted" : done >= total ? "success" : "primary"
  return {
    done,
    total,
    fraction,
    filled,
    empty,
    count,
    text: fit(natural, width),
    tone,
    width,
  }
}

/**
 * Rating pips: a filled/empty run for a level out of a fixed maximum.
 *
 * One implementation serves the plugin SDK (`rating()` draws the pips) and the
 * app's achievement detail. Each pip is one cell; filled pips use the level
 * tone and empty pips stay muted. The text carries the level without relying on
 * colour, so a monochrome terminal still reads it.
 */
export type RatingGlyphs = {
  filled: string
  empty: string
}

export const RATING_GLYPHS: Readonly<RatingGlyphs> = {
  filled: "●",
  empty: "○",
}

export type RatingOptions = {
  /** Level, clamped to 0..max. */
  value: number
  /** Number of pips; defaults to 5. */
  max?: number
  glyphs?: Partial<RatingGlyphs>
}

export type RatingLayout = {
  value: number
  max: number
  filled: number
  empty: number
  text: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function ratingLayout(options: RatingOptions): RatingLayout {
  const max = Math.max(0, Math.floor(options.max ?? 5))
  const value = max === 0 ? 0 : clamp(Math.round(options.value), 0, max)
  const glyphs = { ...RATING_GLYPHS, ...options.glyphs }
  return {
    value,
    max,
    filled: value,
    empty: max - value,
    text: `${glyphs.filled.repeat(value)}${glyphs.empty.repeat(max - value)}`,
  }
}

/** The pip text for a level, without placement. */
export function ratingText(options: Omit<RatingOptions, "value" | "max" | "glyphs"> & {
  value: number
  max?: number
  glyphs?: Partial<RatingGlyphs>
}): string {
  return ratingLayout(options).text
}

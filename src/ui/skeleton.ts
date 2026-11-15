/**
 * Skeleton loading rows.
 *
 * One implementation serves the plugin SDK (`skeleton()` places placeholder
 * lines) and the app's plugin manager while it discovers plugins. Widths follow
 * a deterministic pattern so the rows look like ragged text without animating
 * or depending on random state.
 */
export type SkeletonLine = {
  index: number
  /** The placeholder row, already fitted to its width. */
  text: string
  width: number
}

export type SkeletonOptions = {
  /** Number of rows; defaults to 3. */
  rows?: number
  /** Maximum width in cells. */
  width: number
  /** Fill glyph; defaults to `░`. */
  glyph?: string
  /** Fractions of `width` for successive rows; defaults to a ragged pattern. */
  pattern?: readonly number[]
}

export const SKELETON_PATTERN = [1, 0.78, 0.9, 0.64, 0.84] as const

export function skeletonLines(options: SkeletonOptions): SkeletonLine[] {
  const rows = Math.max(0, Math.floor(options.rows ?? 3))
  const width = Math.max(0, Math.floor(options.width))
  if (rows === 0 || width === 0) return []
  const glyph = options.glyph === undefined || options.glyph === "" ? "░" : options.glyph
  const pattern =
    options.pattern !== undefined && options.pattern.length > 0 ? options.pattern : SKELETON_PATTERN
  return Array.from({ length: rows }, (_, index) => {
    const fraction = pattern[index % pattern.length]!
    const lineWidth = Math.max(1, Math.min(width, Math.round(width * fraction)))
    return {
      index,
      text: glyph.repeat(lineWidth),
      width: lineWidth,
    }
  })
}

/**
 * Swatch rows: a run of solid colour cells.
 *
 * One implementation serves the plugin SDK (`swatches()` draws filled rects)
 * and the app's theme picker. Cells are `cellWidth` wide with a gap; the first
 * that does not fit ends the row and the rest are counted hidden. A very narrow
 * row still shows one cell by shrinking it.
 */
export type SwatchOptions = {
  /** Colours in display order; palette roles or `#rrggbb`. */
  colors: readonly string[]
  /** Available columns. */
  width: number
  /** Cells per swatch; defaults to 2. */
  cellWidth?: number
  /** Spaces between swatches; defaults to 1. */
  gap?: number
}

export type SwatchCell = {
  color: string
  x: number
  width: number
  index: number
}

export type SwatchLayout = {
  cells: SwatchCell[]
  /** Swatches after the first that did not fit. */
  hidden: number
  width: number
  cellWidth: number
  gap: number
}

export function swatchLayout(options: SwatchOptions): SwatchLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  let cellWidth = Math.max(1, Math.floor(options.cellWidth ?? 2))
  if (options.colors.length === 0 || width === 0) {
    return { cells: [], hidden: options.colors.length, width, cellWidth, gap }
  }
  if (cellWidth > width) cellWidth = width
  const cells: SwatchCell[] = []
  let x = 0
  for (let index = 0; index < options.colors.length; index++) {
    const at = cells.length === 0 ? 0 : x + gap
    if (at + cellWidth > width) break
    cells.push({ color: options.colors[index]!, x: at, width: cellWidth, index })
    x = at + cellWidth
  }
  return {
    cells,
    hidden: options.colors.length - cells.length,
    width,
    cellWidth,
    gap,
  }
}

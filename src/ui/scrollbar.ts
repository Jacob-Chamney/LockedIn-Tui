/**
 * Proportional scrollbars.
 *
 * One implementation serves the plugin SDK (`scrollbar()` draws the track) and
 * the app's Knowledge reader. The thumb length is the viewport/content ratio and
 * its start is the offset over the scrollable range; a short document shows a
 * full thumb and reports `scrollable: false`.
 */
export type ScrollbarOrientation = "vertical" | "horizontal"

export type ScrollbarGlyphs = {
  thumb: string
  track: string
}

export type ScrollbarOptions = {
  /** Total content units (rows or columns). */
  content: number
  /** Visible units. */
  viewport: number
  /** First visible unit. */
  offset: number
  /** Track length in cells. */
  length: number
  /** Smallest thumb; defaults to 1. */
  minThumb?: number
  orientation?: ScrollbarOrientation
  glyphs?: Partial<ScrollbarGlyphs>
}

export type ScrollbarLayout = {
  length: number
  scrollable: boolean
  /** 0..1 position in the scrollable range. */
  position: number
  thumbStart: number
  thumbSize: number
  before: number
  after: number
  orientation: ScrollbarOrientation
  glyphs: ScrollbarGlyphs
}

export const SCROLLBAR_GLYPHS: Readonly<ScrollbarGlyphs> = {
  thumb: "█",
  track: "│",
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function scrollbarLayout(options: ScrollbarOptions): ScrollbarLayout {
  const length = Math.max(0, Math.floor(options.length))
  const content = Math.max(0, Math.floor(options.content))
  const viewport = Math.max(0, Math.floor(options.viewport))
  const orientation = options.orientation ?? "vertical"
  const glyphs = {
    thumb: options.glyphs?.thumb ?? (orientation === "vertical" ? "█" : "█"),
    track: options.glyphs?.track ?? (orientation === "vertical" ? "│" : "─"),
  }
  if (length === 0 || content <= viewport) {
    return {
      length,
      scrollable: false,
      position: 0,
      thumbStart: 0,
      thumbSize: length,
      before: 0,
      after: 0,
      orientation,
      glyphs,
    }
  }
  const maxOffset = Math.max(1, content - viewport)
  const position = clamp(options.offset / maxOffset, 0, 1)
  const minThumb = Math.max(1, Math.floor(options.minThumb ?? 1))
  const thumbSize = clamp(Math.round((length * viewport) / content), minThumb, length)
  const thumbStart = Math.round((length - thumbSize) * position)
  return {
    length,
    scrollable: true,
    position,
    thumbStart,
    thumbSize,
    before: thumbStart,
    after: length - thumbStart - thumbSize,
    orientation,
    glyphs,
  }
}

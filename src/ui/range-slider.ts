/**
 * Dual-handle range sliders: two positions on one track.
 *
 * One implementation serves the plugin SDK (`rangeSlider()` paints the track)
 * and the app's Settings threshold row. Handles sit at `round(fraction * (track - 1))`;
 * the span between them is filled, the outside is empty, and an optional label
 * follows the track. The two values may collapse to one handle.
 */
export type RangeSliderGlyphs = {
  empty: string
  filled: string
  handle: string
}

export const RANGE_SLIDER_GLYPHS: Readonly<RangeSliderGlyphs> = {
  empty: "─",
  filled: "━",
  handle: "●",
}

export type RangeSliderOptions = {
  /** Two values; order does not matter. */
  values: readonly [number, number]
  /** Total width including the label when shown. */
  width: number
  min?: number
  max?: number
  /** Text after the track; defaults to the percentage span. */
  label?: string
  /** Show the label; defaults true. */
  showLabel?: boolean
  glyphs?: Partial<RangeSliderGlyphs>
}

export type RangeSliderSegmentKind = "empty" | "handle" | "filled" | "label"

export type RangeSliderSegment = {
  kind: RangeSliderSegmentKind
  text: string
  x: number
  width: number
}

export type RangeSliderLayout = {
  left: number
  right: number
  leftFraction: number
  rightFraction: number
  trackWidth: number
  width: number
  label: string
  /** True when both handles share one cell. */
  collapsed: boolean
  segments: RangeSliderSegment[]
  text: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function rangeSliderLayout(options: RangeSliderOptions): RangeSliderLayout {
  const width = Math.max(0, Math.floor(options.width))
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const max = Number.isFinite(options.max) ? (options.max as number) : 1
  const glyphs = { ...RANGE_SLIDER_GLYPHS, ...options.glyphs }
  const showLabel = options.showLabel !== false
  const raw = options.values
  const first = Number.isFinite(raw[0]) ? raw[0] : min
  const second = Number.isFinite(raw[1]) ? raw[1] : min
  const low = Math.min(first, second)
  const high = Math.max(first, second)
  const fraction = (value: number) => (max <= min ? 0 : clamp((value - min) / (max - min), 0, 1))
  const leftFraction = fraction(low)
  const rightFraction = fraction(high)
  const naturalLabel =
    options.label ??
    `${Math.round(leftFraction * 100)}%–${Math.round(rightFraction * 100)}%`
  const label = showLabel ? naturalLabel : ""
  if (width === 0) {
    return {
      left: 0,
      right: 0,
      leftFraction,
      rightFraction,
      trackWidth: 0,
      width: 0,
      label: "",
      collapsed: true,
      segments: [],
      text: "",
    }
  }
  const labelWidth = label === "" ? 0 : Math.min(label.length, Math.max(0, width - 2))
  const trackWidth = Math.max(1, width - (labelWidth === 0 ? 0 : labelWidth + 1))
  const left = Math.round(leftFraction * Math.max(0, trackWidth - 1))
  const right = Math.round(rightFraction * Math.max(0, trackWidth - 1))
  const collapsed = left === right
  const segments: RangeSliderSegment[] = []
  let x = 0
  if (left > 0) {
    segments.push({ kind: "empty", text: glyphs.empty.repeat(left), x, width: left })
    x += left
  }
  segments.push({ kind: "handle", text: glyphs.handle, x, width: 1 })
  x += 1
  if (!collapsed && right > left + 1) {
    const span = right - left - 1
    segments.push({ kind: "filled", text: glyphs.filled.repeat(span), x, width: span })
    x += span
  }
  if (!collapsed) {
    segments.push({ kind: "handle", text: glyphs.handle, x, width: 1 })
    x += 1
  }
  if (x < trackWidth) {
    segments.push({ kind: "empty", text: glyphs.empty.repeat(trackWidth - x), x, width: trackWidth - x })
    x = trackWidth
  }
  const shownLabel = labelWidth === 0 ? "" : label.length <= labelWidth ? label : `${label.slice(0, Math.max(0, labelWidth - 1))}…`
  if (shownLabel !== "") {
    segments.push({ kind: "empty", text: " ", x: trackWidth, width: 1 })
    segments.push({ kind: "label", text: shownLabel, x: trackWidth + 1, width: shownLabel.length })
  }
  return {
    left,
    right,
    leftFraction,
    rightFraction,
    trackWidth,
    width,
    label: shownLabel,
    collapsed,
    segments,
    text: segments.map((segment) => segment.text).join(""),
  }
}

/** The range slider text without placement. */
export function rangeSliderText(options: RangeSliderOptions): string {
  return rangeSliderLayout(options).text
}

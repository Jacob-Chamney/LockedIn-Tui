/**
 * Slider tracks: filled cells, a knob and a fitted value label.
 *
 * One implementation serves the plugin SDK (`slider()` draws the track) and the
 * app's Settings percentage row. The knob sits at `round(fraction * (width - 1))`
 * so both ends are reachable; the value label is fitted to the space that
 * remains.
 */
export type SliderGlyphs = {
  filled: string
  thumb: string
  empty: string
}

export const SLIDER_GLYPHS: Readonly<SliderGlyphs> = {
  filled: "━",
  thumb: "●",
  empty: "─",
}

export type SliderOptions = {
  value: number
  /** Total width, including the label when shown. */
  width: number
  min?: number
  max?: number
  /** Value label; defaults to the rounded percentage. */
  label?: string
  /** Show the label; defaults true. */
  showLabel?: boolean
  /** Fixed label columns; defaults to the label length. */
  labelWidth?: number
  glyphs?: Partial<SliderGlyphs>
}

export type SliderLayout = {
  /** Clamped 0..1. */
  fraction: number
  /** Track cells, excluding the label and its space. */
  trackWidth: number
  /** Filled cells before the knob. */
  filled: number
  /** Knob cell index (0..trackWidth-1). */
  thumb: number
  /** Empty cells after the knob. */
  empty: number
  /** Fitted value label, or "". */
  label: string
  /** The whole slider as one string. */
  text: string
  width: number
  glyphs: SliderGlyphs
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function sliderLayout(options: SliderOptions): SliderLayout {
  const width = Math.max(0, Math.floor(options.width))
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const max = Number.isFinite(options.max) ? (options.max as number) : 1
  const raw = Number.isFinite(options.value) ? options.value : min
  const fraction = max <= min ? 0 : clamp((raw - min) / (max - min), 0, 1)
  const showLabel = options.showLabel !== false
  const natural = options.label ?? `${Math.round(fraction * 100)}%`
  const glyphs = { ...SLIDER_GLYPHS, ...options.glyphs }
  if (width === 0) {
    return {
      fraction,
      trackWidth: 0,
      filled: 0,
      thumb: 0,
      empty: 0,
      label: "",
      text: "",
      width,
      glyphs,
    }
  }
  const room = Math.max(0, width - 2)
  const labelWidth = showLabel ? Math.min(options.labelWidth ?? natural.length, room) : 0
  const label = showLabel && labelWidth > 0 ? fit(natural, labelWidth) : ""
  const trackWidth = Math.max(1, width - (label !== "" ? label.length + 1 : 0))
  const thumb = Math.round(fraction * (trackWidth - 1))
  const filled = thumb
  const empty = trackWidth - thumb - 1
  const track = `${glyphs.filled.repeat(filled)}${glyphs.thumb}${glyphs.empty.repeat(empty)}`
  return {
    fraction,
    trackWidth,
    filled,
    thumb,
    empty,
    label,
    text: showLabel && label !== "" ? `${track} ${label}` : track,
    width,
    glyphs,
  }
}

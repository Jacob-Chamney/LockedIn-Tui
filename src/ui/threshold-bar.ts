/**
 * Threshold bars: a filled track with tick markers and a current-value handle.
 *
 * One implementation serves the plugin SDK (`thresholdBar()` paints the bar)
 * and the app's contrast preview. The track fills to the value, markers replace
 * the cell at their position with a tick, and the value handle wins when it
 * shares a cell. A label follows the track when it fits.
 */
export type ThresholdMarker = {
  value: number
}

export type ThresholdBarOptions = {
  value: number
  width: number
  min?: number
  max?: number
  markers?: readonly ThresholdMarker[]
  /** Text after the track. */
  label?: string
  /** Show the label; defaults true. */
  showLabel?: boolean
  glyphs?: {
    empty?: string
    filled?: string
    marker?: string
    value?: string
  }
}

export type ThresholdSegmentKind = "empty" | "filled" | "marker" | "value" | "label"

export type ThresholdSegment = {
  kind: ThresholdSegmentKind
  text: string
  x: number
  width: number
}

export type ThresholdBarLayout = {
  value: number
  min: number
  max: number
  fraction: number
  trackWidth: number
  valuePosition: number
  markerPositions: number[]
  label: string
  width: number
  segments: ThresholdSegment[]
  text: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function thresholdBarLayout(options: ThresholdBarOptions): ThresholdBarLayout {
  const width = Math.max(0, Math.floor(options.width))
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const maxRaw = Number.isFinite(options.max) ? (options.max as number) : 1
  const max = maxRaw > min ? maxRaw : min + 1
  const value = Number.isFinite(options.value) ? options.value : min
  const fraction = clamp((value - min) / (max - min), 0, 1)
  const glyphs = {
    empty: options.glyphs?.empty ?? "░",
    filled: options.glyphs?.filled ?? "█",
    marker: options.glyphs?.marker ?? "┊",
    value: options.glyphs?.value ?? "●",
  }
  const showLabel = options.showLabel !== false
  const label = showLabel ? (options.label ?? "") : ""
  if (width === 0) {
    return {
      value,
      min,
      max,
      fraction,
      trackWidth: 0,
      valuePosition: 0,
      markerPositions: [],
      label: "",
      width: 0,
      segments: [],
      text: "",
    }
  }
  const labelWidth = label === "" ? 0 : Math.min(label.length, Math.max(0, width - 2))
  const trackWidth = Math.max(1, width - (labelWidth === 0 ? 0 : labelWidth + 1))
  const valuePosition = Math.round(fraction * Math.max(0, trackWidth - 1))
  const markerPositions = (options.markers ?? []).map((marker) =>
    Math.round(clamp((marker.value - min) / (max - min), 0, 1) * Math.max(0, trackWidth - 1)),
  )
  const kinds: ThresholdSegmentKind[] = Array.from({ length: trackWidth }, (_, index) =>
    index <= valuePosition ? "filled" : "empty",
  )
  markerPositions.forEach((position) => {
    if (position !== valuePosition) kinds[position] = "marker"
  })
  kinds[valuePosition] = "value"

  const segments: ThresholdSegment[] = []
  let start = 0
  for (let index = 1; index <= trackWidth; index++) {
    if (index < trackWidth && kinds[index] === kinds[start]) continue
    const kind = kinds[start]!
    const text =
      kind === "empty"
        ? glyphs.empty.repeat(index - start)
        : kind === "filled"
          ? glyphs.filled.repeat(index - start)
          : kind === "marker"
            ? glyphs.marker.repeat(index - start)
            : glyphs.value
    segments.push({ kind, text, x: start, width: text.length })
    start = index
  }
  if (labelWidth > 0) {
    const shown = label.length <= labelWidth ? label : `${label.slice(0, Math.max(0, labelWidth - 1))}…`
    segments.push({ kind: "empty", text: " ", x: trackWidth, width: 1 })
    segments.push({ kind: "label", text: shown, x: trackWidth + 1, width: shown.length })
  }
  return {
    value,
    min,
    max,
    fraction,
    trackWidth,
    valuePosition,
    markerPositions,
    label: labelWidth > 0 ? segments[segments.length - 1]!.text : "",
    width,
    segments,
    text: segments.map((segment) => segment.text).join(""),
  }
}

/** The threshold bar text without placement. */
export function thresholdBarText(options: ThresholdBarOptions): string {
  return thresholdBarLayout(options).text
}

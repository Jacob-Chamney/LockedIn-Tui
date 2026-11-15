/**
 * Bullet bars: a value fill with a target marker on the same track.
 *
 * One implementation serves the plugin SDK (`bulletChart()` paints the bar)
 * and the app's Usage spend meter. The fill uses the shared meter maths; a
 * target marker replaces the cell at its position, so the warning threshold
 * stays visible whether the value has reached it or not.
 */
import { meterCells } from "./meter"

export type BulletChartGlyphs = {
  empty: string
  filled: string
  target: string
}

export const BULLET_CHART_GLYPHS: Readonly<BulletChartGlyphs> = {
  empty: "░",
  filled: "█",
  target: "┊",
}

export type BulletChartOptions = {
  value: number
  max: number
  min?: number
  /** Target marker position, on the same scale. */
  target?: number
  /** Total width, including the label when shown. */
  width: number
  /** Text after the track. */
  label?: string
  /** Show the label; defaults true. */
  showLabel?: boolean
  glyphs?: Partial<BulletChartGlyphs>
}

export type BulletSegmentKind = "empty" | "filled" | "target" | "label"

export type BulletSegment = {
  kind: BulletSegmentKind
  text: string
  x: number
  width: number
}

export type BulletChartLayout = {
  value: number
  min: number
  max: number
  fraction: number
  targetFraction: number | null
  valuePosition: number
  targetPosition: number | null
  trackWidth: number
  label: string
  width: number
  segments: BulletSegment[]
  text: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function bulletChartLayout(options: BulletChartOptions): BulletChartLayout {
  const width = Math.max(0, Math.floor(options.width))
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const maxRaw = Number.isFinite(options.max) ? (options.max as number) : min
  const max = maxRaw > min ? maxRaw : min + 1
  const value = clamp(Number.isFinite(options.value) ? options.value : min, min, max)
  const fraction = clamp((value - min) / (max - min), 0, 1)
  const targetFraction =
    options.target !== undefined && Number.isFinite(options.target)
      ? clamp((options.target - min) / (max - min), 0, 1)
      : null
  const glyphs = { ...BULLET_CHART_GLYPHS, ...options.glyphs }
  const showLabel = options.showLabel !== false
  const label = showLabel ? (options.label ?? "") : ""
  if (width === 0) {
    return {
      value,
      min,
      max,
      fraction,
      targetFraction,
      valuePosition: 0,
      targetPosition: null,
      trackWidth: 0,
      label: "",
      width: 0,
      segments: [],
      text: "",
    }
  }
  const labelWidth = label === "" ? 0 : Math.min(label.length, Math.max(0, width - 2))
  const trackWidth = Math.max(1, width - (labelWidth === 0 ? 0 : labelWidth + 1))
  const cells = meterCells(value - min, max - min, trackWidth)
  const valuePosition = cells.filled === 0 ? 0 : cells.filled - 1
  const targetPosition =
    targetFraction === null ? null : Math.round(targetFraction * Math.max(0, trackWidth - 1))
  const kinds: BulletSegmentKind[] = Array.from({ length: trackWidth }, (_, index) =>
    index < cells.filled ? "filled" : "empty",
  )
  if (targetPosition !== null) kinds[targetPosition] = "target"

  const segments: BulletSegment[] = []
  let start = 0
  for (let index = 1; index <= trackWidth; index++) {
    if (index < trackWidth && kinds[index] === kinds[start]) continue
    const kind = kinds[start]!
    const text =
      kind === "filled"
        ? glyphs.filled.repeat(index - start)
        : kind === "empty"
          ? glyphs.empty.repeat(index - start)
          : glyphs.target
    segments.push({ kind, text, x: start, width: text.length })
    start = index
  }
  const shownLabel = labelWidth === 0 ? "" : fit(label, labelWidth)
  if (shownLabel !== "") segments.push({ kind: "label", text: ` ${shownLabel}`, x: trackWidth, width: shownLabel.length + 1 })

  return {
    value,
    min,
    max,
    fraction,
    targetFraction,
    valuePosition,
    targetPosition,
    trackWidth,
    label: shownLabel,
    width,
    segments,
    text: segments.map((segment) => segment.text).join(""),
  }
}

/** The bullet bar text without placement. */
export function bulletChartText(options: BulletChartOptions): string {
  return bulletChartLayout(options).text
}

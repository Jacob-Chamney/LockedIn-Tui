/**
 * Threshold bars for app surfaces.
 *
 * The Solid counterpart of the SDK's `thresholdBar()`: fitting, marker
 * positions and segment kinds come from `src/ui/threshold-bar.ts`.
 */
import { thresholdBarLayout, type ThresholdMarker } from "../threshold-bar"
import type { ThemePalette } from "../theme"

export function ThresholdBar(props: {
  theme: ThemePalette
  value: number
  width: number
  min?: number
  max?: number
  markers?: readonly ThresholdMarker[]
  label?: string
  showLabel?: boolean
  glyphs?: {
    empty?: string
    filled?: string
    marker?: string
    value?: string
  }
  emptyFg?: keyof ThemePalette
  filledFg?: keyof ThemePalette
  markerFg?: keyof ThemePalette
  valueFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    thresholdBarLayout({
      value: props.value,
      width: props.width,
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.markers === undefined ? {} : { markers: props.markers }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.showLabel === undefined ? {} : { showLabel: props.showLabel }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })
  const ink = (kind: "empty" | "filled" | "marker" | "value" | "label") =>
    kind === "label"
      ? palette()[props.labelFg ?? "muted"]
      : kind === "empty"
        ? palette()[props.emptyFg ?? "line"]
        : kind === "marker"
          ? palette()[props.markerFg ?? "muted"]
          : kind === "value"
            ? palette()[props.valueFg ?? "foreground"]
            : palette()[props.filledFg ?? "primary"]

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().segments.map((segment) => (
        <text fg={ink(segment.kind)} wrapMode="none" width={segment.width}>
          {segment.text}
        </text>
      ))}
    </box>
  )
}

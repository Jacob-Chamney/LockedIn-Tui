/**
 * Dual-handle range sliders for app surfaces.
 *
 * The Solid counterpart of the SDK's `rangeSlider()`: handle positions, spans
 * and the label come from `src/ui/range-slider.ts`.
 */
import { rangeSliderLayout, type RangeSliderGlyphs } from "../range-slider"
import type { ThemePalette } from "../theme"

export function RangeSlider(props: {
  theme: ThemePalette
  values: readonly [number, number]
  width: number
  min?: number
  max?: number
  label?: string
  showLabel?: boolean
  glyphs?: Partial<RangeSliderGlyphs>
  emptyFg?: keyof ThemePalette
  filledFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    rangeSliderLayout({
      values: props.values,
      width: props.width,
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.showLabel === undefined ? {} : { showLabel: props.showLabel }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })
  const ink = (kind: "empty" | "handle" | "filled" | "label") =>
    kind === "label"
      ? palette()[props.labelFg ?? "muted"]
      : kind === "empty"
        ? palette()[props.emptyFg ?? "line"]
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

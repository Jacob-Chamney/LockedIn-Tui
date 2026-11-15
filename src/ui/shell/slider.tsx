/**
 * Slider tracks for app surfaces.
 *
 * The Solid counterpart of the SDK's `slider()`: the knob position, fitted
 * label and glyphs come from `src/ui/slider.ts`.
 */
import { sliderLayout } from "../slider"
import type { ThemePalette } from "../theme"

export function Slider(props: {
  theme: ThemePalette
  value: number
  width: number
  min?: number
  max?: number
  label?: string
  showLabel?: boolean
  labelWidth?: number
  filledFg?: keyof ThemePalette
  thumbFg?: keyof ThemePalette
  emptyFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    sliderLayout({
      value: props.value,
      width: props.width,
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.showLabel === undefined ? {} : { showLabel: props.showLabel }),
      ...(props.labelWidth === undefined ? {} : { labelWidth: props.labelWidth }),
    })
  const ink = (role: keyof ThemePalette | undefined, fallback: keyof ThemePalette) =>
    palette()[role ?? fallback]

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().filled > 0 ? (
        <text fg={ink(props.filledFg, "primary")} wrapMode="none" width={layout().filled}>
          {layout().glyphs.filled.repeat(layout().filled)}
        </text>
      ) : null}
      <text fg={ink(props.thumbFg, "primary")} wrapMode="none" width={1}>
        {layout().glyphs.thumb}
      </text>
      {layout().empty > 0 ? (
        <text fg={ink(props.emptyFg, "line")} wrapMode="none" width={layout().empty}>
          {layout().glyphs.empty.repeat(layout().empty)}
        </text>
      ) : null}
      {layout().label !== "" ? (
        <text fg={ink(props.labelFg, "muted")} wrapMode="none">
          {` ${layout().label}`}
        </text>
      ) : null}
    </box>
  )
}

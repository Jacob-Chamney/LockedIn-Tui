/**
 * A horizontal rule for app surfaces.
 *
 * The Solid counterpart of the SDK's `divider()`: line sizes, centring and
 * fitting come from `src/ui/divider.ts`. Labels are optional; the rule itself
 * stays muted and the label uses a stronger ink.
 */
import { dividerLayout } from "../divider"
import type { ThemePalette } from "../theme"

export function Divider(props: {
  theme: ThemePalette
  width: number
  label?: string
  glyph?: string
  lineFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    dividerLayout({
      width: props.width,
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.glyph === undefined ? {} : { glyph: props.glyph }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().left !== "" ? (
        <text fg={palette()[props.lineFg ?? "line"]} wrapMode="none">
          {layout().left}
        </text>
      ) : null}
      {layout().middle !== "" ? (
        <text
          fg={palette()[props.label ? (props.labelFg ?? "muted") : (props.lineFg ?? "line")]}
          wrapMode="none"
        >
          {layout().middle}
        </text>
      ) : null}
      {layout().right !== "" ? (
        <text fg={palette()[props.lineFg ?? "line"]} wrapMode="none">
          {layout().right}
        </text>
      ) : null}
    </box>
  )
}

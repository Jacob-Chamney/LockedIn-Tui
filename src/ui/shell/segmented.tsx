/**
 * Segmented controls for app surfaces.
 *
 * The Solid counterpart of the SDK's `segmented()`: equal widths, centred
 * labels and selection come from `src/ui/segmented.ts`.
 */
import { segmentedLayout } from "../segmented"
import type { ThemePalette } from "../theme"

export function Segmented(props: {
  theme: ThemePalette
  options: readonly string[]
  selected: number
  width: number
  selectedBg?: keyof ThemePalette
  bg?: keyof ThemePalette
  selectedFg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () => segmentedLayout(props)

  return (
    <box flexDirection="row" height={1} flexShrink={0} width={props.width}>
      {layout().segments.map((segment) => (
        <text
          fg={palette()[segment.selected ? (props.selectedFg ?? "background") : (props.fg ?? "muted")]}
          bg={palette()[segment.selected ? (props.selectedBg ?? "primary") : (props.bg ?? "surface")]}
          wrapMode="none"
          width={segment.width}
        >
          {segment.text}
        </text>
      ))}
    </box>
  )
}

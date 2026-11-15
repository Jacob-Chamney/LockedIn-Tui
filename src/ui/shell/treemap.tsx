/**
 * Treemaps for app surfaces.
 *
 * The Solid counterpart of the SDK's `treemap()`: tiling, fitted labels and
 * percentages come from `src/ui/treemap.ts`. Tiles are absolutely placed, so
 * their borders line up with the computed rectangle rather than flex order.
 */
import { treemapLayout, type TreemapItem } from "../treemap"
import type { ThemePalette } from "../theme"

const TONES: ReadonlyArray<keyof ThemePalette> = [
  "primary",
  "secondary",
  "success",
  "warning",
  "accent",
]

export function Treemap(props: {
  theme: ThemePalette
  items: readonly TreemapItem[]
  width: number
  height: number
  tones?: ReadonlyArray<keyof ThemePalette>
  fg?: keyof ThemePalette
  valueFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () => treemapLayout({ items: props.items, width: props.width, height: props.height })
  const tones = () => props.tones ?? TONES
  const ink = (index: number) => palette()[tones()[index % tones().length] ?? "primary"]

  return (
    <box position="relative" width={layout().width} height={layout().height} flexShrink={0}>
      {layout().tiles.map((tile) => (
        <box
          position="absolute"
          left={tile.x}
          top={tile.y}
          width={tile.width}
          height={tile.height}
          border={tile.showBorder ? true : false}
          borderStyle="single"
          borderColor={ink(tile.index)}
          backgroundColor={tile.showBorder ? palette().surface : palette()[tones()[tile.index % tones().length] ?? "primary"]}
          flexDirection="column"
          flexShrink={0}
        >
          {tile.showLabel ? (
            <text fg={palette()[props.fg ?? "foreground"]} wrapMode="none">
              {tile.labelText}
            </text>
          ) : null}
          {tile.showValue ? (
            <text fg={palette()[props.valueFg ?? "muted"]} wrapMode="none">
              {tile.valueText}
            </text>
          ) : null}
        </box>
      ))}
    </box>
  )
}

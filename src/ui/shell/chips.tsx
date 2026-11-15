/**
 * Chip rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `chips()`: fitting, gaps and hidden counts
 * come from `src/ui/chips.ts`.
 */
import { chipLayout, type ChipItem } from "../chips"
import type { ThemePalette } from "../theme"

export function ChipList(props: {
  theme: ThemePalette
  items: readonly ChipItem[]
  width: number
  gap?: number
  marker?: string
  fg?: keyof ThemePalette
  activeFg?: keyof ThemePalette
  hiddenFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    chipLayout({
      items: props.items,
      width: props.width,
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().chips.map((chip, index) => (
        <>
          {index > 0 && (props.gap ?? 1) > 0 ? (
            <text fg={palette().muted} wrapMode="none" width={props.gap ?? 1}>
              {" ".repeat(props.gap ?? 1)}
            </text>
          ) : null}
          <text
            fg={palette()[chip.active ? (props.activeFg ?? "background") : (props.fg ?? "foreground")]}
            bg={palette()[chip.tone as keyof ThemePalette]}
            wrapMode="none"
            width={chip.width}
          >
            {chip.text}
          </text>
        </>
      ))}
      {layout().hidden > 0 && layout().chips.length > 0 ? (
        <>
          {(props.gap ?? 1) > 0 ? (
            <text fg={palette()[props.hiddenFg ?? "muted"]} wrapMode="none">
              {" ".repeat(props.gap ?? 1)}
            </text>
          ) : null}
          <text fg={palette()[props.hiddenFg ?? "muted"]} wrapMode="none">
            {`+${layout().hidden}`}
          </text>
        </>
      ) : null}
    </box>
  )
}

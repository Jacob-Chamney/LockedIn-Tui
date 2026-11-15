/**
 * One-row outlines for app surfaces.
 *
 * The Solid counterpart of the SDK's `outline()`: depth markers, fitting and
 * the current-section fallback come from `src/ui/outline.ts`.
 */
import { outlineLayout, type OutlineGlyphs, type OutlineItem } from "../outline"
import type { ThemePalette } from "../theme"

export function Outline(props: {
  theme: ThemePalette
  items: readonly OutlineItem[]
  width: number
  current?: number
  gap?: number
  glyphs?: Partial<OutlineGlyphs>
  currentFg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    outlineLayout({
      items: props.items,
      width: props.width,
      ...(props.current === undefined ? {} : { current: props.current }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().segments.map((segment, index) => {
        const previous = index > 0 ? layout().segments[index - 1]! : null
        const room = previous === null ? 0 : segment.x - (previous.x + previous.width)
        return (
          <>
            {room > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {" ".repeat(room)}
              </text>
            ) : null}
            <text
              fg={palette()[segment.current ? (props.currentFg ?? "primary") : (props.fg ?? "muted")]}
              wrapMode="none"
              width={segment.width}
            >
              {segment.text}
            </text>
          </>
        )
      })}
    </box>
  )
}

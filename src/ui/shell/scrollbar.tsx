/**
 * Scrollbars for app surfaces.
 *
 * The Solid counterpart of the SDK's `scrollbar()`: the thumb ratio, start and
 * glyphs come from `src/ui/scrollbar.ts`. A short document renders nothing
 * unless `always` is set.
 */
import { scrollbarLayout } from "../scrollbar"
import type { ThemePalette } from "../theme"

export function Scrollbar(props: {
  theme: ThemePalette
  length: number
  content: number
  viewport: number
  offset: number
  minThumb?: number
  orientation?: "vertical" | "horizontal"
  thumbFg?: keyof ThemePalette
  trackFg?: keyof ThemePalette
  always?: boolean
}) {
  const palette = () => props.theme
  const layout = () =>
    scrollbarLayout({
      length: props.length,
      content: props.content,
      viewport: props.viewport,
      offset: props.offset,
      ...(props.minThumb === undefined ? {} : { minThumb: props.minThumb }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    })
  if (!layout().scrollable && props.always !== true) return null
  const ink = (thumb: boolean) =>
    thumb ? palette()[props.thumbFg ?? "primary"] : palette()[props.trackFg ?? "line"]

  return (
    <box
      flexDirection={layout().orientation === "vertical" ? "column" : "row"}
      width={layout().orientation === "vertical" ? 1 : undefined}
      height={layout().orientation === "vertical" ? undefined : 1}
      flexShrink={0}
    >
      {Array.from({ length: layout().length }, (_, index) => {
        const thumb =
          index >= layout().thumbStart && index < layout().thumbStart + layout().thumbSize
        return (
          <text fg={ink(thumb)} wrapMode="none">
            {thumb ? layout().glyphs.thumb : layout().glyphs.track}
          </text>
        )
      })}
    </box>
  )
}

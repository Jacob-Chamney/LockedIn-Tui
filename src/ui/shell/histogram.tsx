/**
 * Histograms for app surfaces.
 *
 * The Solid counterpart of the SDK's `histogram()`: binning and levels come
 * from `src/ui/histogram.ts`.
 */
import { histogramLayout } from "../histogram"
import type { ThemePalette } from "../theme"

export function Histogram(props: {
  theme: ThemePalette
  values: readonly number[]
  width: number
  height?: number
  bins?: number
  glyph?: string
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    histogramLayout({
      values: props.values,
      width: props.width,
      ...(props.height === undefined ? {} : { height: props.height }),
      ...(props.bins === undefined ? {} : { bins: props.bins }),
      ...(props.glyph === undefined ? {} : { glyph: props.glyph }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <text fg={palette()[props.fg ?? "primary"]} wrapMode="none">
          {row}
        </text>
      ))}
    </box>
  )
}

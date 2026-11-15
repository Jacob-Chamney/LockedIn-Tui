/**
 * Braille charts for app surfaces.
 *
 * The Solid counterpart of the SDK's chart primitives: sub-cell geometry comes
 * from `src/ui/braille-chart.ts`, so a Stats chart and a plugin chart share the
 * same dots.
 */
import { brailleChartLayout, type BrailleChartMode } from "../braille-chart"
import type { ThemePalette } from "../theme"

export function BrailleChart(props: {
  theme: ThemePalette
  values: readonly number[]
  width: number
  height?: number
  max?: number
  mode?: BrailleChartMode
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    brailleChartLayout({
      values: props.values,
      width: props.width,
      ...(props.height === undefined ? {} : { height: props.height }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.mode === undefined ? {} : { mode: props.mode }),
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

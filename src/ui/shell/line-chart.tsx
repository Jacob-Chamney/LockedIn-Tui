/**
 * Line charts for app surfaces.
 *
 * The Solid counterpart of the SDK's `lineChart()`: bucketing, scale and axis
 * labels come from `src/ui/line-chart.ts`.
 */
import { lineChartLayout, type LineChartGlyphs, type LineChartReduce } from "../line-chart"
import type { ThemePalette } from "../theme"

export function LineChart(props: {
  theme: ThemePalette
  values: readonly number[]
  width: number
  height?: number
  min?: number
  max?: number
  reduce?: LineChartReduce
  axis?: boolean
  axisWidth?: number
  labels?: readonly [string, string]
  glyphs?: Partial<LineChartGlyphs>
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    lineChartLayout({
      values: props.values,
      width: props.width,
      ...(props.height === undefined ? {} : { height: props.height }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.reduce === undefined ? {} : { reduce: props.reduce }),
      ...(props.axis === undefined ? {} : { axis: props.axis }),
      ...(props.axisWidth === undefined ? {} : { axisWidth: props.axisWidth }),
      ...(props.labels === undefined ? {} : { labels: props.labels }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
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

/**
 * Compact column charts for app surfaces.
 *
 * The Solid counterpart of the SDK's `sparkbar()`: bucketing, levels and glyphs
 * come from `src/ui/sparkbar.ts`.
 */
import { sparkbarLayout, type SparkbarReduce } from "../sparkbar"
import type { ThemePalette } from "../theme"

export function Sparkbar(props: {
  theme: ThemePalette
  values: readonly number[]
  width: number
  height?: number
  max?: number
  glyph?: string
  reduce?: SparkbarReduce
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    sparkbarLayout({
      values: props.values,
      width: props.width,
      ...(props.height === undefined ? {} : { height: props.height }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.glyph === undefined ? {} : { glyph: props.glyph }),
      ...(props.reduce === undefined ? {} : { reduce: props.reduce }),
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

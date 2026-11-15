/**
 * Signed percentage chips for app surfaces.
 *
 * The Solid counterpart of the SDK's `delta()`: direction, tone and fitting
 * come from `src/ui/delta.ts`.
 */
import { deltaLayout, type DeltaGlyphs } from "../delta"
import type { ThemePalette } from "../theme"

export function Delta(props: {
  theme: ThemePalette
  value: number
  label?: string
  good?: "up" | "down"
  width?: number
  glyphs?: Partial<DeltaGlyphs>
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    deltaLayout({
      value: props.value,
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.good === undefined ? {} : { good: props.good }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })

  return (
    <text
      fg={palette()[props.fg ?? (layout().tone as keyof ThemePalette)]}
      wrapMode="none"
      width={layout().width}
    >
      {layout().text}
    </text>
  )
}

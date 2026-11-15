/**
 * Progress chips for app surfaces.
 *
 * The Solid counterpart of the SDK's `progressChip()`: bar, count, fitting and
 * tones come from `src/ui/progress-chip.ts`.
 */
import { progressChipLayout, progressChipStyle, type ProgressChipGlyphs } from "../progress-chip"
import type { ThemePalette } from "../theme"

export function ProgressChip(props: {
  theme: ThemePalette
  done: number
  total: number
  barWidth?: number
  width?: number
  glyphs?: Partial<ProgressChipGlyphs>
  bg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    progressChipLayout({
      done: props.done,
      total: props.total,
      ...(props.barWidth === undefined ? {} : { barWidth: props.barWidth }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })
  const style = () => progressChipStyle(layout().tone)

  return (
    <text
      fg={palette()[props.fg ?? (style().fg as keyof ThemePalette)]}
      bg={palette()[props.bg ?? (style().bg as keyof ThemePalette)]}
      wrapMode="none"
      width={layout().width}
    >
      {layout().text}
    </text>
  )
}

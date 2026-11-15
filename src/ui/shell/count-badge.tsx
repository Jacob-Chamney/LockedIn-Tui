/**
 * Numeric count badges for app surfaces.
 *
 * The Solid counterpart of the SDK's `countBadge()`: padding, overflow and tone
 * roles come from `src/ui/count-badge.ts`.
 */
import { countBadgeLayout, countBadgeStyle, type CountBadgeTone } from "../count-badge"
import type { ThemePalette } from "../theme"

export function CountBadge(props: {
  theme: ThemePalette
  count: number
  max?: number
  pad?: number
  tone?: CountBadgeTone
  width?: number
  bg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    countBadgeLayout({
      count: props.count,
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.pad === undefined ? {} : { pad: props.pad }),
      ...(props.tone === undefined ? {} : { tone: props.tone }),
      ...(props.width === undefined ? {} : { width: props.width }),
    })
  const style = () => countBadgeStyle(layout().tone)

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

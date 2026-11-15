/**
 * Stat cards for app surfaces.
 *
 * The Solid counterpart of the SDK's `statCard()`: fitting, alignment and tone
 * roles come from `src/ui/stat-card.ts`.
 */
import { statCardLayout, statCardToneRole, type StatCardAlign, type StatCardTone } from "../stat-card"
import type { ThemePalette } from "../theme"

export function StatCard(props: {
  theme: ThemePalette
  value: string
  label: string
  detail?: string
  width: number
  tone?: StatCardTone
  align?: StatCardAlign
  mutedFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    statCardLayout({
      width: props.width,
      value: props.value,
      label: props.label,
      ...(props.detail === undefined ? {} : { detail: props.detail }),
      ...(props.tone === undefined ? {} : { tone: props.tone }),
      ...(props.align === undefined ? {} : { align: props.align }),
    })

  return (
    <box flexDirection="column" width={layout().width} flexShrink={0}>
      {layout().rows.map((row) => (
        <text
          fg={
            row.kind === "value"
              ? palette()[statCardToneRole(layout().tone) as keyof ThemePalette]
              : palette()[props.mutedFg ?? "muted"]
          }
          wrapMode="none"
          width={layout().width}
          textAlign={layout().align}
        >
          {row.kind === "value" ? <b>{row.text}</b> : row.text}
        </text>
      ))}
    </box>
  )
}

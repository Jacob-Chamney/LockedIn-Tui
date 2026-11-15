/**
 * Legend rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `legend()`: spacing, fitting and tones
 * come from `src/ui/legend.ts`.
 */
import { legendLayout, type LegendItem } from "../legend"
import type { ThemePalette } from "../theme"

export function Legend(props: {
  theme: ThemePalette
  items: readonly LegendItem[]
  width: number
  gap?: number
  labels?: boolean
  tone?: string
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const rows = () =>
    legendLayout({
      items: props.items,
      width: props.width,
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.labels === undefined ? {} : { labels: props.labels }),
      ...(props.tone === undefined ? {} : { tone: props.tone }),
    })
  const ink = (role: string | undefined) =>
    role === undefined ? palette().muted : palette()[role as keyof ThemePalette] ?? palette().muted
  const gap = () => " ".repeat(props.gap ?? 2)

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {rows().map((segment, index) => (
        <>
          {index > 0 && (props.gap ?? 2) > 0 ? (
            <text fg={palette().muted} wrapMode="none">
              {gap()}
            </text>
          ) : null}
          <text fg={ink(segment.tone)} wrapMode="none">
            {segment.glyph}
          </text>
          {segment.label !== "" ? (
            <text fg={palette()[props.labelFg ?? "muted"]} wrapMode="none">
              {` ${segment.label}`}
            </text>
          ) : null}
        </>
      ))}
    </box>
  )
}

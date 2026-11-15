/**
 * Tag clouds for app surfaces.
 *
 * The Solid counterpart of the SDK's `tagCloud()`: wrapping, fitting and the
 * overflow count come from `src/ui/tag-cloud.ts`.
 */
import { tagCloudLayout, type TagCloudItem } from "../tag-cloud"
import type { ThemePalette } from "../theme"

export function TagCloud(props: {
  theme: ThemePalette
  items: readonly TagCloudItem[]
  width: number
  maxRows?: number
  gap?: number
  prefix?: string
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    tagCloudLayout({
      items: props.items,
      width: props.width,
      ...(props.maxRows === undefined ? {} : { maxRows: props.maxRows }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.prefix === undefined ? {} : { prefix: props.prefix }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <text fg={palette()[props.fg ?? "secondary"]} wrapMode="none">
          {row.text}
        </text>
      ))}
    </box>
  )
}

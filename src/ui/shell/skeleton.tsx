/**
 * Skeleton rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `skeleton()`: widths and row count come
 * from `src/ui/skeleton.ts`.
 */
import { skeletonLines } from "../skeleton"
import type { ThemePalette } from "../theme"

export function Skeleton(props: {
  theme: ThemePalette
  width: number
  rows?: number
  glyph?: string
  pattern?: readonly number[]
  tone?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const lines = () =>
    skeletonLines({
      width: props.width,
      ...(props.rows === undefined ? {} : { rows: props.rows }),
      ...(props.glyph === undefined ? {} : { glyph: props.glyph }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
    })
  const ink = () => palette()[props.tone ?? "muted"] ?? palette().muted

  return (
    <box flexDirection="column" flexShrink={0}>
      {lines().map((line) => (
        <text fg={ink()} wrapMode="none">
          {line.text}
        </text>
      ))}
    </box>
  )
}

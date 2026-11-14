/**
 * An empty-state placeholder for app surfaces.
 *
 * The Solid counterpart of the SDK's `emptyState()`: wrapping, row order and
 * the glyph default come from `src/ui/empty-state.ts`.
 */
import { emptyStateRows } from "../empty-state"
import type { ThemePalette } from "../theme"

export function EmptyState(props: {
  theme: ThemePalette
  title: string
  hint?: string
  glyph?: string
  /** Text columns available; rows wrap to it. */
  width: number
}) {
  const palette = () => props.theme
  const rows = () =>
    emptyStateRows({
      title: props.title,
      ...(props.hint === undefined ? {} : { hint: props.hint }),
      ...(props.glyph === undefined ? {} : { glyph: props.glyph }),
      width: props.width,
    })
  const ink = (kind: "glyph" | "title" | "hint") =>
    kind === "hint" ? palette().primary : kind === "glyph" ? palette().primary : palette().muted

  return (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      {rows().map((row) => (
        <text fg={ink(row.kind)} wrapMode="none">
          {row.text}
        </text>
      ))}
    </box>
  )
}

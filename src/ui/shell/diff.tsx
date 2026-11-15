/**
 * Unified diff rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `diff()`: numbering, gutters and wrapping
 * come from `src/ui/diff.ts`.
 */
import { diffRows, type DiffLine } from "../diff"
import type { ThemePalette } from "../theme"

export function DiffView(props: {
  theme: ThemePalette
  lines: readonly DiffLine[]
  width: number
  oldStart?: number
  newStart?: number
  numbers?: boolean
  wrap?: boolean
}) {
  const palette = () => props.theme
  const rows = () =>
    diffRows({
      lines: props.lines,
      width: props.width,
      ...(props.oldStart === undefined ? {} : { oldStart: props.oldStart }),
      ...(props.newStart === undefined ? {} : { newStart: props.newStart }),
      ...(props.numbers === undefined ? {} : { numbers: props.numbers }),
      ...(props.wrap === undefined ? {} : { wrap: props.wrap }),
    })
  const ink = (kind: DiffLine["kind"]) =>
    kind === "add" ? palette().success : kind === "remove" ? palette().error : palette().muted

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows().map((row) => (
        <box flexDirection="row" height={1} flexShrink={0}>
          <text fg={palette().line} wrapMode="none" width={row.gutter.length}>
            {row.gutter}
          </text>
          <text fg={ink(row.kind)} wrapMode="none">
            {row.text}
          </text>
        </box>
      ))}
    </box>
  )
}

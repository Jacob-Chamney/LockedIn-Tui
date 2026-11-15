/**
 * Matrices for app surfaces.
 *
 * The Solid counterpart of the SDK's `matrix()`: column fitting, notes and row
 * tones come from `src/ui/matrix.ts`.
 */
import { matrixLayout, type MatrixRowTone } from "../matrix"
import type { ThemePalette } from "../theme"

export function Matrix(props: {
  theme: ThemePalette
  rows: readonly string[]
  columns: readonly string[]
  cells: readonly (readonly string[])[]
  width: number
  headerWidth?: number
  gap?: number
  notes?: readonly string[]
  rowTones?: readonly MatrixRowTone[]
  showHeader?: boolean
}) {
  const palette = () => props.theme
  const layout = () =>
    matrixLayout({
      rows: props.rows,
      columns: props.columns,
      cells: props.cells,
      width: props.width,
      ...(props.headerWidth === undefined ? {} : { headerWidth: props.headerWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.notes === undefined ? {} : { notes: props.notes }),
      ...(props.rowTones === undefined ? {} : { rowTones: props.rowTones }),
    })
  const ink = (tone: MatrixRowTone) =>
    tone === "muted" ? palette().muted : tone === "error" ? palette().error : palette().foreground

  return (
    <box flexDirection="column" flexShrink={0}>
      {props.showHeader === false ? null : (
        <text fg={palette().muted} wrapMode="none">
          {layout().header}
        </text>
      )}
      {layout().rows.map((row) => (
        <text fg={ink(row.tone)} wrapMode="none">
          {row.text}
        </text>
      ))}
    </box>
  )
}

/**
 * Data tables for app surfaces.
 *
 * The Solid counterpart of the SDK's `dataTable()`: column fitting, header rule
 * and selection markers come from `src/ui/data-table.ts`.
 */
import { dataTableLayout, type DataTableColumn } from "../data-table"
import type { ThemePalette } from "../theme"

export function DataTable(props: {
  theme: ThemePalette
  columns: readonly DataTableColumn[]
  rows: readonly (readonly string[])[]
  width: number
  selected?: number
  gap?: number
  header?: boolean
  headerRule?: boolean
  headerFg?: keyof ThemePalette
  ruleFg?: keyof ThemePalette
  selectedFg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    dataTableLayout({
      columns: props.columns,
      rows: props.rows,
      width: props.width,
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.header === undefined ? {} : { header: props.header }),
      ...(props.headerRule === undefined ? {} : { headerRule: props.headerRule }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().header !== "" ? (
        <text fg={palette()[props.headerFg ?? "muted"]} wrapMode="none">
          {layout().header}
        </text>
      ) : null}
      {layout().rule !== "" ? (
        <text fg={palette()[props.ruleFg ?? "line"]} wrapMode="none">
          {layout().rule}
        </text>
      ) : null}
      {layout().rows.map((row) => (
        <text
          fg={palette()[row.selected ? (props.selectedFg ?? "primary") : (props.fg ?? "foreground")]}
          wrapMode="none"
        >
          {row.text}
        </text>
      ))}
    </box>
  )
}

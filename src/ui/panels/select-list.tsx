/**
 * One selectable list.
 *
 * Selection is always the same three signals — a bar, a fill and bold — whether
 * the rows are a panel, a chooser or the command palette. Two layouts cover the
 * shapes in use: `stacked` (label then detail) and `inline` (label then a
 * right-side note, as the command palette uses).
 */
import type { ThemePalette } from "../theme";
import { ListRow } from "./list-row";
export type SelectRow = {
  id: string
  label: string
  detail?: string
  meta?: string
  /** Muted rows are present but secondary; error rows name a failure. */
  tone?: "normal" | "muted" | "error"
}

/** The row chrome selection always uses, for rows with custom cells. */
export function SelectableRow(props: { theme: ThemePalette; selected: boolean; children?: unknown }) {
  const palette = () => props.theme
  return (
    <box
      flexDirection="row"
      backgroundColor={props.selected ? palette().panel : undefined}
      paddingX={1}
    >
      {(props.children ?? null) as never}
    </box>
  )
}

/** The bar and the colour for a selected row, for custom content. */
/** A window that keeps the cursor visible without jumping on every move. */
export function windowStart(cursor: number, count: number, size: number): number {
  if (count <= size) return 0
  return Math.max(0, Math.min(count - size, cursor - Math.floor(size / 2)))
}

export function selectionMark(theme: ThemePalette, selected: boolean) {
  return { bar: selected ? "▌ " : "  ", fg: theme.foreground }
}

export function SelectList(props: {
  theme: ThemePalette
  rows: SelectRow[]
  cursor: number
  variant?: "stacked" | "inline"
  /** Width reserved for the label in `inline` mode. */
  labelWidth?: number
  /** Rows to show at once; omitted means every row. */
  visibleCount?: number
}) {
  const start = () => (props.visibleCount ? windowStart(props.cursor, props.rows.length, props.visibleCount) : 0)
  const shown = () => {
    if (!props.visibleCount) return props.rows.map((row, index) => ({ row, index }))
    return props.rows
      .slice(start(), start() + props.visibleCount)
      .map((row, offset) => ({ row, index: start() + offset }))
  }
  const palette = () => props.theme
  if ((props.variant ?? "stacked") === "inline") {
    return (
      <box flexDirection="column">
        {shown().map(({ row, index }) => (
          <ListRow
            theme={palette()}
            selected={index === props.cursor}
            label={row.label}
            value={row.meta}
            labelWidth={props.labelWidth}
            tone={row.tone === "error" ? "error" : row.tone === "muted" ? "muted" : "normal"}
          />
        ))}
      </box>
    )
  }

  return (
    <box flexDirection="column">
      {shown().map(({ row, index }) => (
        <ListRow
          theme={palette()}
          selected={index === props.cursor}
          label={row.label}
          detail={row.detail}
          tone={row.tone === "error" ? "error" : row.tone === "muted" ? "muted" : "normal"}
        />
      ))}
    </box>
  )
}

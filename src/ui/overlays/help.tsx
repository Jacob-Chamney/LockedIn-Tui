/**
 * The `?` help screen: the same keymap rows as the leader, paged one group at a
 * time, with the full chord rather than the completing key.
 */
import { GROUP_TITLES, groupKeyRows } from "../keymap/group"
import { LEADER_SYMBOL, type GeneratedRow } from "../keymap/registry"
import type { ThemePalette } from "../theme"
import { ModalFrame } from "./modal-frame"

export function HelpScreen(props: {
  theme: ThemePalette
  width: number
  height: number
  rows: GeneratedRow[]
  /** Which page of the help is showing; one group per page. */
  page?: number
}) {
  const palette = () => props.theme
  const sections = () => groupKeyRows(props.rows)
  const page = () => (props.page ?? 0) % Math.max(1, sections().length)
  const current = () => sections()[page()]
  const pageWidth = () => Math.min(props.width - 4, Math.floor(props.width * 0.85), 100)
  const columnCount = () => (props.width >= 140 ? 3 : 2)
  const columnWidth = () => Math.floor((pageWidth() - 6) / columnCount())
  const format = (row: GeneratedRow) => `${row.keys.padEnd(10)} ${row.label}`
  /** One group per page, split into columns when the list is long. */
  const columns = () => {
    const rows = current()?.rows ?? []
    const perColumn = Math.ceil(rows.length / columnCount())
    return Array.from({ length: columnCount() }, (_, index) =>
      rows.slice(index * perColumn, (index + 1) * perColumn),
    ).filter((column) => column.length > 0)
  }

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={pageWidth()}
      boxHeight={Math.min(props.height - 4, Math.ceil((current()?.rows.length ?? 0) / columnCount()) + 8)}
      title="HELP"
      meta={`${page() + 1}/${Math.max(1, sections().length)}`}
      hint="generated from the keymap registry; only bindings that work are listed"
      footer={`Tab page · Esc close · ${LEADER_SYMBOL} opens the leader`}
    >
      {current() ? (
        <text fg={palette().muted} wrapMode="none">
          {GROUP_TITLES[current()!.group]}
        </text>
      ) : null}
      <box flexDirection="row" flexGrow={1} minHeight={0} marginTop={1}>
        {columns().map((rows) => (
          <box flexDirection="column" width={columnWidth()}>
            {rows.map((row) => (
              <text fg={palette().foreground} wrapMode="none">
                {format(row)}
              </text>
            ))}
          </box>
        ))}
      </box>
    </ModalFrame>
  )
}

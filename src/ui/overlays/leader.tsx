/**
 * The leader popup.
 *
 * Every row is a chord that completes the already-pressed prefix, grouped
 * context / global / system. The rows and their keys come from the keymap
 * registry; this file only lays them out.
 */
import { leaderKeyRows, GROUP_TITLES } from "../keymap/group"
import { LEADER_SYMBOL, keyLabel, type GeneratedRow, type Group } from "../keymap/registry"
import type { ThemePalette } from "../theme"
import { ModalFrame } from "./modal-frame"

/** The key that completes the chord: the leader is already down. */
export function chordKey(row: GeneratedRow): string {
  return keyLabel(row.binding)
}

export function LeaderMenu(props: {
  theme: ThemePalette
  rows: GeneratedRow[]
  width: number
  height: number
  context?: string
}) {
  const palette = () => props.theme
  const sections = () => leaderKeyRows(props.rows)
  const boxWidth = () => Math.min(38, Math.max(30, Math.floor(props.width * 0.32)))
  const rowsIn = (group: { rows: GeneratedRow[] }) => group.rows.length + 1
  const totalRows = () => sections().reduce((total, group) => total + rowsIn(group), 0)
  const boxHeight = () =>
    Math.min(totalRows() + 4, Math.max(8, props.height - 4))

  const column = (groups: Array<{ group: Group; rows: GeneratedRow[] }>) => (
    <box flexDirection="column" width={boxWidth() - 4}>
      {groups.map((section) => (
        <box flexDirection="column">
          <text fg={palette().muted} wrapMode="none">
            {GROUP_TITLES[section.group]}
          </text>
          {section.rows.map((row) => (
            <box flexDirection="row">
              <text fg={palette().secondary} wrapMode="none" width={5}>
                {` ${chordKey(row)}`}
              </text>
              <text fg={palette().foreground} wrapMode="none">
                {row.label}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  )

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={boxWidth()}
      boxHeight={boxHeight()}
      placement="bottom-right"
      backdrop={false}
      title={`${LEADER_SYMBOL}  ${(props.context ?? "CHILL").toUpperCase()}`}
      meta={`${sections().reduce((count, group) => count + group.rows.length, 0)}`}
      footer="Esc close"
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        {column(sections())}
      </box>
    </ModalFrame>
  )
}

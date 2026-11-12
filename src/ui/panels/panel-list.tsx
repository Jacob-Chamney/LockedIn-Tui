/**
 * A generic list surface.
 *
 * The same anatomy as every other panel — a title, rows with a label and a
 * detail, one selected row, an empty state and hints — built from the shared
 * window and one selection list. Feature panels supply copy and rows only.
 */
import type { ThemePalette } from "../theme"
import { PanelEmpty } from "./panel-frame"
import { WindowBody } from "./floating-window"
import { PanelWindow } from "./panel-window"
import { SelectList } from "./select-list"

export type PanelRow = { id: string; label: string; detail: string }

export function PanelList(props: {
  theme: ThemePalette
  width: number
  height: number
  title: string
  meta?: string
  detail: string
  rows: PanelRow[]
  cursor: number
  empty: { line: string; hint: string }
  hints: string[]
}) {
  const palette = () => props.theme

  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title={props.title}
      meta={props.meta}
      detail={props.detail}
      hints={props.hints}
    >
      {props.rows.length === 0 ? (
        <WindowBody center>
          <PanelEmpty theme={palette()} line={props.empty.line} hint={props.empty.hint} />
        </WindowBody>
      ) : (
        <WindowBody>
          <SelectList
            theme={palette()}
            rows={props.rows}
            cursor={props.cursor}
            visibleCount={Math.max(1, Math.floor((props.height - 8) / 2))}
          />
        </WindowBody>
      )}
    </PanelWindow>
  )
}

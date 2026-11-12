/** Session manager overlay. Renders rows and named confirmations; no writes. */
import type { ThemePalette } from "../../theme"
import { PanelEmpty } from "../../panels/panel-frame"
import { FloatingWindow, WindowBody, WindowFooter, WindowHeader } from "../../panels/floating-window"
import { SelectList } from "../../panels/select-list"
import { managerHints } from "../../managers/manager-actions"
import {
  emptyCopy,
  emptyHint,
  rowText,
  visibleRows,
  warningFor,
  type SessionsState,
} from "./sessions-model"

/** The named middle region of the Lock-in sessions window. */
export function SessionList(props: { theme: ThemePalette; height: number; state: SessionsState }) {
  const rows = () => visibleRows(props.state)
  return rows().length === 0 ? (
    <WindowBody center>
      <PanelEmpty theme={props.theme} line={emptyCopy(props.state)} hint={emptyHint(props.state)} />
    </WindowBody>
  ) : (
    <WindowBody>
      <SelectList
        theme={props.theme}
        cursor={props.state.cursor}
        visibleCount={Math.max(1, props.height - 8)}
        rows={rows().map((row) => ({
          id: row.id,
          label: rowText(row),
          tone: row.broken ? "error" : row.archived ? "muted" : "normal",
        }))}
      />
    </WindowBody>
  )
}

export function SessionsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  state: SessionsState
  footer?: string
}) {
  const palette = () => props.theme
  const rows = () => visibleRows(props.state)
  const pending = () => props.state.pending
  const hints = () => (props.footer ? [props.footer] : managerHints())

  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title="Lock-in sessions"
          meta={`${rows().length} · sort ${props.state.sort}${props.state.query ? ` · /${props.state.query}` : ""}`}
          detail="Source-bound study sessions, newest first."
        />
      }
      footer={<WindowFooter theme={palette()} hints={hints()} width={props.width} />}
      pending={pending() ? warningFor(props.state, pending()!.kind) : null}
      notice={props.state.notice}
    >
      <SessionList theme={palette()} height={props.height} state={props.state} />
    </FloatingWindow>
  )
}

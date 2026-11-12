/**
 * Archive manager: what is archived, where, and what can be done with it.
 *
 * The two sides are separate lists and never merge (`AGENTS.md` §2.5). Every
 * action is an intent the shell routes to WP-601; this screen writes nothing,
 * restores nothing and deletes nothing itself.
 */
import { parseBinding, type Binding } from "../../keymap/registry"
import type { ThemePalette } from "../../theme"
import { WindowBody } from "../../panels/floating-window"
import { PanelEmpty } from "../../panels/panel-frame"
import { PanelWindow } from "../../panels/panel-window"
import { SelectList } from "../../panels/select-list"

export type Side = "school" | "skills"
export type Backend = "folder" | "github"

export type ArchiveRow = {
  id: string
  side: Side
  name: string
  date: string
  sizeBytes: number
  backend: Backend
  /** Archived item kind; absent in old callers defaults to a session. */
  kind?: "session" | "goal" | "project"
  /** Set when the last action on this row failed; the row keeps its place. */
  failed?: string
}

export type PrivacyCheck = { result: "private" | "public" | "unchecked"; at: string }

export type ArchiveState = {
  backend: Backend
  configured: boolean
  consent: boolean
  /** Shown for the last push, with its timestamp — never claimed as live. */
  privacy: PrivacyCheck
  rows: ArchiveRow[]
  offline: boolean
  /** Which side the narrow layout shows. */
  side: Side
  cursor: { school: number; skills: number }
  pending?: { kind: "delete" | "backend" | "consent"; id?: string; name?: string; to?: Backend }
  pendingPush?: { name: string; cancelable: boolean }
  notice?: string | null
}

export const initialArchive = (rows: ArchiveRow[] = []): ArchiveState => ({
  backend: "folder",
  configured: true,
  consent: true,
  privacy: { result: "private", at: "2026-11-01T14:00:00Z" },
  rows,
  offline: false,
  side: "school",
  cursor: { school: 0, skills: 0 },
  pending: undefined,
  pendingPush: undefined,
  notice: null,
})

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function rowLine(row: ArchiveRow): string {
  return `${row.name}  ${row.date}  ${sizeLabel(row.sizeBytes)}  archived to ${row.backend}${row.failed ? "  × failed" : ""}`
}

export function rowsFor(state: ArchiveState, side: Side): ArchiveRow[] {
  return state.rows.filter((row) => row.side === side)
}

export function headerLines(state: ArchiveState): string[] {
  const privacy =
    state.privacy.result === "unchecked"
      ? "privacy: unchecked"
      : `last privacy check ${state.privacy.result} at ${state.privacy.at}`
  const base = `${state.backend}${state.configured ? "" : " (not configured)"} · ${privacy} · consent: ${state.consent ? "given" : "not given"}`
  return state.offline ? [base, "showing the local index"] : [base]
}

export function emptyCopy(): string {
  return "nothing archived yet · press a on an open session to archive it"
}

export function consentCopy(): string {
  return "archiving sends this item off this machine · press c to grant consent"
}

export function tokenCopy(): string {
  return "link a github token in settings · press ␣ , to open Settings"
}

/** A lacking prerequisite is a CTA, never a silent no-op. */
export function blockedReason(state: ArchiveState): string | null {
  if (!state.consent) return consentCopy()
  if (state.backend === "github" && !state.configured) return tokenCopy()
  return null
}

export function move(state: ArchiveState, delta: number): ArchiveState {
  const rows = rowsFor(state, state.side)
  if (rows.length === 0) return state
  const current = state.cursor[state.side]
  const next = Math.max(0, Math.min(rows.length - 1, current + delta))
  return { ...state, cursor: { ...state.cursor, [state.side]: next } }
}

export function switchSide(state: ArchiveState): ArchiveState {
  const side: Side = state.side === "school" ? "skills" : "school"
  const count = rowsFor(state, side).length
  // A cursor remembered from a longer list must never point past its end.
  const current = state.cursor[side]
  return {
    ...state,
    side,
    cursor: { ...state.cursor, [side]: count === 0 ? 0 : Math.min(current, count - 1) },
    pending: undefined,
  }
}

export function selected(state: ArchiveState): ArchiveRow | undefined {
  return rowsFor(state, state.side)[state.cursor[state.side]]
}

/** Scoped to the row's own side: a school action can never touch skills. */
export function actionFor(state: ArchiveState, kind: "restore" | "export" | "delete"): { kind: "call"; action: string; side: Side; id: string } | { kind: "refused"; reason: string } {
  const row = selected(state)
  if (!row) return { kind: "refused", reason: "select an archived item first" }
  const blocked = blockedReason(state)
  if (blocked) return { kind: "refused", reason: blocked }
  if (kind === "delete" && state.pending?.kind !== "delete") {
    return { kind: "refused", reason: `press d again to delete “${row.name}” from ${state.backend}` }
  }
  return { kind: "call", action: kind, side: row.side, id: row.id }
}

export function armDelete(state: ArchiveState): ArchiveState {
  const row = selected(state)
  if (!row) return { ...state, notice: "select an archived item first" }
  return { ...state, pending: { kind: "delete", id: row.id, name: row.name }, notice: null }
}

export function armBackend(state: ArchiveState, to: Backend): ArchiveState {
  return {
    ...state,
    pending: { kind: "backend", to },
    notice: `switch to ${to}? future archives go there · press b again to confirm`,
  }
}

export function armConsent(state: ArchiveState): ArchiveState {
  return { ...state, pending: { kind: "consent" }, notice: `${consentCopy()} · Y grant · N cancel` }
}

export function cancelPending(state: ArchiveState): ArchiveState {
  return { ...state, pending: undefined, notice: null }
}

export type ArchiveIntent = "down" | "up" | "restore" | "export" | "delete" | "backend" | "consent" | "side" | "close"

const SPECS: Array<{ intent: ArchiveIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "restore", key: "return", footer: "Enter restore" },
  { intent: "export", key: "x", footer: "x export" },
  { intent: "delete", key: "d", footer: "d delete" },
  { intent: "backend", key: "b", footer: "b backend" },
  { intent: "consent", key: "c", footer: "c consent" },
  { intent: "side", key: "l", footer: "h/l side" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`archive key "${key}": ${binding.message}`)
  return binding
}

export const ARCHIVE_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): ArchiveIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return ARCHIVE_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return ARCHIVE_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function layoutFor(width: number): { columns: 1 | 2; headerLines: 1 | 2 } {
  return width >= 120 ? { columns: 2, headerLines: 1 } : { columns: 1, headerLines: 2 }
}

// ---------------------------------------------------------------- render

/** The named middle region of the Archive window. */
export function ArchiveList(props: {
  theme: ThemePalette
  width: number
  height: number
  state: ArchiveState
}) {
  const palette = () => props.theme
  const layout = layoutFor(props.width)
  const sides: Side[] = layout.columns === 2 ? ["school", "skills"] : [props.state.side]
  return (
    <>
      {props.state.pendingPush ? (
        <text fg={palette().warning} wrapMode="none">
          {`… pushing ${props.state.pendingPush.name}${props.state.pendingPush.cancelable ? " · Esc cancel" : ""}`}
        </text>
      ) : null}

      {props.state.rows.length === 0 ? (
        <WindowBody center>
          <PanelEmpty theme={palette()} line={emptyCopy()} />
        </WindowBody>
      ) : (
        <WindowBody>
          {sides.map((side) => {
            const rows = rowsFor(props.state, side)
            return (
              <box flexDirection="column">
                <text fg={palette().secondary} wrapMode="none">
                  {`${side === "school" ? "LEARN · lock-in" : "LEARN · skills"} · ${rows.length}`}
                </text>
                {rows.length === 0 ? (
                  <text fg={palette().muted} wrapMode="none">
                    {"  nothing archived on this side"}
                  </text>
                ) : (
                  <SelectList
                    theme={palette()}
                    cursor={props.state.cursor[side]}
                    visibleCount={Math.max(2, Math.floor((props.height - 10) / sides.length))}
                    rows={rows.map((row) => ({
                      id: row.id,
                      label: rowLine(row),
                      tone: row.failed ? "error" : "normal",
                    }))}
                  />
                )}
                {rows.some((row) => row.failed) ? (
                  <text fg={palette().muted} wrapMode="none">
                    {`  × ${rows.find((row) => row.failed)!.failed}`}
                  </text>
                ) : null}
              </box>
            )
          })}
        </WindowBody>
      )}

      {blockedReason(props.state) ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${blockedReason(props.state)}`}
        </text>
      ) : null}
    </>
  )
}

export function ArchivePanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: ArchiveState
}) {
  const palette = () => props.theme
  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title="Archive"
      meta={`${props.state.rows.length} items`}
      detailLines={headerLines(props.state)}
      hints={["j/k move", "h/l side", "Enter restore", "Esc back"]}
      notice={props.state.notice}
    >
      <ArchiveList theme={palette()} width={props.width} height={props.height} state={props.state} />
    </PanelWindow>
  )
}

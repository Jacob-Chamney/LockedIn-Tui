/**
 * Keybinds settings: one editor for the one key table.
 *
 * The editor never keeps its own defaults: every row is `editorRows(registry)`
 * and every change goes through `rebind`/`reset`, so help, the leader overlay
 * and this screen cannot disagree.
 */
import {
  bindingLabel,
  editorRows,
  parseBinding,
  type Binding,
  type EditorRow,
  type Group,
  type KeyConflict,
  type KeymapRegistry,
  type RebindResult,
  type Scope,
} from "../keymap/registry"
import { serialize, type KeybindConfig } from "../keymap/persist"
import type { ThemePalette } from "../theme"

export type KeybindsState = {
  query: string
  cursor: number
  /** Non-null while a chord is being captured for this action. */
  capturing: string | null
  /** The captured chord, shown before it is committed. */
  captured: Binding | null
  pendingResetAll: boolean
  notice?: string | null
}

export const initialKeybinds: KeybindsState = {
  query: "",
  cursor: 0,
  capturing: null,
  captured: null,
  pendingResetAll: false,
  notice: null,
}

const SCOPE_ORDER: Scope[] = ["global", "chill", "learn", "work", "reader", "deck"]
const GROUP_ORDER: Group[] = ["context", "global", "system"]

export function search(rows: EditorRow[], query: string): EditorRow[] {
  const text = query.trim().toLowerCase()
  if (!text) return rows
  return rows.filter(
    (row) => row.id.includes(text) || row.label.toLowerCase().includes(text),
  )
}

/** Scope first, then group — the same order the help overlay uses. */
export function groupedRows(rows: EditorRow[]): Array<{ scope: Scope; rows: EditorRow[] }> {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    rows: rows
      .filter((row) => row.scope === scope)
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.label.localeCompare(b.label)),
  })).filter((section) => section.rows.length > 0)
}

export function visibleRows(registry: KeymapRegistry, state: KeybindsState): EditorRow[] {
  return search(editorRows(registry), state.query)
}

export function rowLabel(row: EditorRow): string {
  return `${row.label}${row.overridden ? "  (custom)" : ""}`
}

export function emptyCopy(): string {
  return "no action matches"
}

export function moveCursor(state: KeybindsState, delta: number, count: number): KeybindsState {
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.cursor + delta))
  return { ...state, cursor }
}

export function typeQuery(state: KeybindsState, query: string): KeybindsState {
  return { ...state, query, cursor: 0 }
}

export function beginCapture(state: KeybindsState, row: EditorRow): KeybindsState {
  return { ...state, capturing: row.id, captured: null, notice: null }
}

/** Esc during capture keeps the old binding and nothing is written. */
export function cancelCapture(state: KeybindsState): KeybindsState {
  return { ...state, capturing: null, captured: null, notice: null }
}

/**
 * The captured chord is shown first; `commit` is what changes the registry.
 */
export function capture(state: KeybindsState, chord: string): KeybindsState | { kind: "refused"; reason: string } {
  const parsed = parseBinding(chord)
  if ("reason" in parsed) return { kind: "refused", reason: parsed.message }
  return { ...state, captured: parsed }
}

export type CommitResult =
  | { kind: "applied"; binding: Binding; config: KeybindConfig }
  | { kind: "conflict"; conflict: KeyConflict; sentence: string }
  | { kind: "nothing" }

/** A conflicting chord is refused and never persisted. */
export function commit(registry: KeymapRegistry, state: KeybindsState): CommitResult {
  if (!state.capturing || !state.captured) return { kind: "nothing" }
  const result: RebindResult = registry.rebind(state.capturing, state.captured)
  if (!result.ok) {
    return { kind: "conflict", conflict: result.conflict, sentence: result.conflict.message }
  }
  return { kind: "applied", binding: state.captured, config: serialize(registry) }
}

/** The editor leaves capture state only after a successful apply. */
export function afterApply(state: KeybindsState): KeybindsState {
  return { ...state, capturing: null, captured: null, notice: null }
}

export function resetOne(registry: KeymapRegistry, state: KeybindsState): KeybindConfig {
  if (state.capturing) registry.reset(state.capturing)
  return serialize(registry)
}

export function overrideCount(registry: KeymapRegistry): number {
  return editorRows(registry).filter((row) => row.overridden).length
}

export function armResetAll(state: KeybindsState, count: number): KeybindsState {
  return {
    ...state,
    pendingResetAll: true,
    notice: resetAllCopy(count),
  }
}

export function resetAllCopy(count: number): string {
  return `reset ${count} custom binding${count === 1 ? "" : "s"} to defaults? press R again to confirm`
}

export function confirmResetAll(registry: KeymapRegistry, state: KeybindsState): KeybindConfig | null {
  if (!state.pendingResetAll) return null
  registry.reset()
  return serialize(registry)
}

export function resetAllDone(state: KeybindsState): KeybindsState {
  return { ...state, pendingResetAll: false, notice: null }
}

/** The list refreshes from the registry, so the overlay follows immediately. */
export function listAfterChange(registry: KeymapRegistry, state: KeybindsState): EditorRow[] {
  return visibleRows(registry, state)
}

/** 80 columns truncate labels with `…`; the binding column stays whole. */
export function fitLabel(label: string, width: number, bindingWidth: number): string {
  const room = Math.max(4, width - bindingWidth - 3)
  return label.length <= room ? label : `${label.slice(0, room - 1)}…`
}

export type KeybindsIntent = "down" | "up" | "search" | "rebind" | "reset" | "reset-all" | "cancel" | "commit"

const SPECS: Array<{ intent: KeybindsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "search", key: "/", footer: "/ search" },
  { intent: "rebind", key: "return", footer: "Enter rebind" },
  { intent: "reset", key: "r", footer: "r reset" },
  { intent: "reset-all", key: "shift+r", footer: "R reset all" },
  { intent: "cancel", key: "escape", footer: "Esc cancel" },
  { intent: "commit", key: "ctrl+return", footer: "" },
]

function binding(key: string): Binding {
  const parsed = parseBinding(key)
  if ("reason" in parsed) throw new Error(`keybinds key "${key}": ${parsed.message}`)
  return parsed
}

export const KEYBINDS_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: binding(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean; ctrl?: boolean } = {}): KeybindsIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.ctrl
    ? `ctrl+${lower}`
    : options.shift && lower.length === 1
      ? `shift+${lower}`
      : lower === "enter"
        ? "return"
        : lower
  return KEYBINDS_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return KEYBINDS_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function KeybindsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  rows: EditorRow[]
  state: KeybindsState
}) {
  const palette = () => props.theme
  const overrides = () => props.rows.filter((row) => row.overridden).length
  const bindingWidth = () => 14
  /**
   * The list scrolls with the cursor: a short terminal must still be able to
   * reach every action, so the window follows the selection.
   */
  const windowed = () => {
    const room = Math.max(3, props.height - 5)
    if (props.rows.length <= room) return props.rows.map((row, index) => ({ row, index }))
    const start = Math.max(0, Math.min(props.rows.length - room, props.state.cursor - Math.floor(room / 2)))
    return props.rows.slice(start, start + room).map((row, offset) => ({ row, index: start + offset }))
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} KEYBINDS · ${props.rows.length} actions · ${overrides()} custom`}
      </text>
      <text fg={palette().secondary} wrapMode="none">
        {`/${props.state.query}`}
      </text>

      {props.rows.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {emptyCopy()}
        </text>
      ) : (
        windowed().map(({ row, index }) => {
          return (
            <text
              fg={index === props.state.cursor ? palette().primary : row.overridden ? palette().warning : palette().foreground}
              wrapMode="none"
            >
              {`${index === props.state.cursor ? "▸" : " "} ${fitLabel(row.label, props.width - 2, bindingWidth())}  ${row.keys}`}
            </text>
          )
        })
      )}

      {props.state.capturing ? (
        <text fg={palette().accent} wrapMode="none">
          {`capture  ${props.state.captured ? bindingLabel(props.state.captured) : "press a chord…"}  · Enter commit · Esc cancel`}
        </text>
      ) : null}
      {props.state.pendingResetAll ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${props.state.notice ?? resetAllCopy(overrides())}`}
        </text>
      ) : null}
      {props.state.notice && !props.state.pendingResetAll ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      ) : null}

      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}

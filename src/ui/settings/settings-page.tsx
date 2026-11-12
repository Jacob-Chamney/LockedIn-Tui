/**
 * The settings page: a grouped list of the real configuration on the left and
 * one-sentence detail on the right.
 *
 * Values arrive as a `SettingsView` prop, built by the composition root from the
 * loaded config and runtime. Nothing here reads a file; editing returns a patch
 * through `save()`, which the shell owns.
 */
import { parseBinding, type Binding } from "../keymap/registry";
import type { ThemePalette } from "../theme";
import { getProvider } from "../../llm/catalogue";
import { ListRow, SectionLabel } from "../panels/list-row";
import { TwoColumnSurface } from "../panels/two-column";
export type SettingsView = {
  username: string
  theme: string
  chatModel: string
  baseUrl: string
  maxToolCalls: number
  maxTokensPerRequest: number
  budgetUsd: number
  period: "day" | "month"
  warnAt: number
  pauseAtLimit: boolean
  dataDir: string
  archiveBackend: string
  archiveFolder: string
  historyLimit: number
  responseStyle: string
  tutorPolicy: string
  /** MCP server names from config, for the Plugins surface. */
  pluginServers: string[]
  /** `ui.hide_hints`: the chat's own hint rows are hidden. */
  hideHints: boolean
  /** `ui.plugins.dirs`: folders that contain plugin directories. */
  pluginDirs: string[]
  /** `ui.plugins.disabled`: discovered plugin ids that are not mounted. */
  disabledPlugins: string[]
}

export const NOT_SET = "not set"

/** Everything unset: a pane with no config still renders every row. */
export function emptySettingsView(): SettingsView {
  return {
    username: "",
    theme: "",
    chatModel: "",
    baseUrl: "",
    maxToolCalls: 0,
    maxTokensPerRequest: 0,
    budgetUsd: 0,
    period: "day",
    warnAt: 0,
    pauseAtLimit: false,
    dataDir: "",
    archiveBackend: "",
    archiveFolder: "",
    historyLimit: 0,
    responseStyle: "normal",
    tutorPolicy: "direct",
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
  }
}

export type SettingsRow = {
  id: string
  label: string
  value: string
  hint: string
  /** `text` rows are editable inline; the rest show their value only. */
  edit: "text" | "none"
  /** Config key the patch writes, when editable. */
  key?: string
}

export type SettingsGroup = { id: string; title: string; rows: SettingsRow[] }

export function text(value: string | number, format?: (input: never) => string): string {
  if (typeof value === "number") {
    if (value === 0) return "not set"
    return format ? (format(value as never) as string) : String(value)
  }
  return value.trim() === "" ? NOT_SET : value
}

export function yesNo(value: boolean): string {
  return value ? "yes" : "no"
}

/** Budget 0 means "no limit", which is a fact, not an unset value. */
export function budgetLabel(usd: number): string {
  return usd === 0 ? "no limit" : `$${usd.toFixed(2)}`
}

export function warnLabel(ratio: number): string {
  return ratio === 0 ? NOT_SET : `${Math.round(ratio * 100)}%`
}

/** `provider/model` split at the first slash; the model keeps any later slashes. */
function splitModel(id: string): { provider: string; model: string } {
  const at = id.indexOf("/")
  if (at <= 0) return { provider: "", model: id }
  return { provider: id.slice(0, at), model: id.slice(at + 1) }
}

export function settingsGroups(view: SettingsView): SettingsGroup[] {
  const active = splitModel(view.chatModel)
  const activeProvider = active.provider === "" ? "" : (getProvider(active.provider)?.label ?? active.provider)
  return [
    {
      id: "user",
      title: "USER",
      rows: [
        { id: "username", label: "Username", value: text(view.username), hint: "shown in the greeting and on saved notes.", edit: "text", key: "ui.username" },
        { id: "theme", label: "Theme", value: text(view.theme), hint: "the palette used everywhere; change it in Appearance.", edit: "none" },
        { id: "chat-settings", label: "Chat settings", value: "open", hint: "response length and tutor policy for chats.", edit: "none" },
      ],
    },
    {
      id: "models",
      title: "MODELS",
      rows: [
        { id: "providers", label: "Providers", value: text(activeProvider), hint: "the active provider; Enter links or replaces its key.", edit: "none" },
        { id: "chatModel", label: "Chat model", value: text(active.model), hint: "the active model; the provider is the row above.", edit: "none" },
        { id: "baseUrl", label: "Base URL", value: text(view.baseUrl), hint: "only needed for a custom endpoint; first-class providers use their own URL.", edit: "none" },
        { id: "maxToolCalls", label: "Max tool calls", value: text(view.maxToolCalls), hint: "hard cap per turn; the loop stops at this count.", edit: "none" },
        { id: "maxTokens", label: "Max tokens/request", value: text(view.maxTokensPerRequest, (n: number) => n.toLocaleString("en-US")), hint: "hard cap per request; the loop stops at this count.", edit: "none" },
      ],
    },
    {
      id: "usage",
      title: "USAGE",
      rows: [
        { id: "budget", label: "Budget", value: budgetLabel(view.budgetUsd), hint: "day or month limit; zero means no limit.", edit: "text", key: "usage.budget" },
        { id: "period", label: "Period", value: text(view.period), hint: "when the budget counter resets.", edit: "none" },
        { id: "warnAt", label: "Warn at", value: warnLabel(view.warnAt), hint: "the share of the budget that raises a warning.", edit: "none" },
        { id: "pause", label: "Pause at limit", value: yesNo(view.pauseAtLimit), hint: "refuses a request at the limit; one override is allowed.", edit: "none" },
      ],
    },
    {
      id: "storage",
      title: "STORAGE",
      rows: [
        { id: "dataDir", label: "Data folder", value: text(view.dataDir), hint: "usage, stats and history; set at launch with --data-dir.", edit: "none" },
        { id: "backend", label: "Archive backend", value: text(view.archiveBackend), hint: "where archived sessions are pushed; switch it in Archive.", edit: "none" },
        { id: "archiveFolder", label: "Archive folder", value: text(view.archiveFolder), hint: "the folder that receives archives on the local backend.", edit: "text", key: "archive.folder" },
        { id: "historyLimit", label: "History limit", value: text(view.historyLimit), hint: "how many Chill messages are kept locally; zero disables history.", edit: "none" },
      ],
    },
    {
      id: "plugins",
      title: "PLUGINS",
      rows: [
        { id: "servers", label: "MCP servers", value: view.pluginServers.length === 0 ? "none configured" : `${view.pluginServers.length} configured`, hint: "MCP servers available; enable them per command in MCP servers.", edit: "none" },
        {
          id: "manage-plugins",
          label: "UI plugins",
          value: "open",
          hint: "list sandboxed UI/effect plugins; Space enables or disables one.",
          edit: "none",
        },
      ],
    },
  ]
}

/** A flat cursor path over rows only: headers are never a cursor stop. */
export type FlatRow = { row: SettingsRow; group: string }

export function flatRows(groups: SettingsGroup[]): FlatRow[] {
  return groups.flatMap((group) => group.rows.map((row) => ({ row, group: group.title })))
}

export function clampCursor(rows: FlatRow[], cursor: number): number {
  if (rows.length === 0) return 0
  return Math.max(0, Math.min(rows.length - 1, cursor))
}

export function selectedRow(groups: SettingsGroup[], cursor: number): FlatRow | undefined {
  return flatRows(groups)[clampCursor(flatRows(groups), cursor)]
}

// ---------------------------------------------------------------- editing

export type SettingsState = {
  cursor: number
  /** Row id being edited and its draft. */
  editing?: { id: string; key: string; draft: string } | null
  notice?: string | null
}

export const initialSettingsState: SettingsState = { cursor: 0, editing: null, notice: null }

export function move(state: SettingsState, delta: number, groups: SettingsGroup[]): SettingsState {
  return { ...state, cursor: clampCursor(flatRows(groups), state.cursor + delta), notice: null }
}

export function beginEdit(state: SettingsState, groups: SettingsGroup[]): SettingsState {
  const current = selectedRow(groups, state.cursor)
  if (!current) return { ...state, notice: "no setting selected" }
  if (current.row.edit !== "text" || !current.row.key) {
    return { ...state, notice: `${current.row.label} is changed in its own screen` }
  }
  const draft = current.row.value === NOT_SET ? "" : current.row.value
  return { ...state, editing: { id: current.row.id, key: current.row.key, draft }, notice: null }
}

export function typeEdit(state: SettingsState, draft: string): SettingsState {
  if (!state.editing) return state
  return { ...state, editing: { ...state.editing, draft } }
}

export function cancelEdit(state: SettingsState): SettingsState {
  return { ...state, editing: null, notice: null }
}

export type SaveResult = { kind: "patch"; patch: Record<string, unknown> } | { kind: "refused"; reason: string }

/** One `save()` call per commit; the shell performs the write. */
export async function commitEdit(
  state: SettingsState,
  save: (patch: Record<string, unknown>) => Promise<SettingsView> | SettingsView,
): Promise<{ state: SettingsState; patch: Record<string, unknown> } | { state: SettingsState; refused: string }> {
  if (!state.editing) return { state, refused: "nothing is being edited" }
  const { key, draft } = state.editing
  const trimmed = draft.trim()
  if (trimmed === "") {
    return { state: { ...state, notice: `${key} cannot be empty` }, refused: "empty" }
  }
  const patch = key === "usage.budget" ? { [key]: Number(trimmed) } : { [key]: trimmed }
  if (key === "usage.budget" && !Number.isFinite(Number(trimmed))) {
    return { state: { ...state, notice: "budget must be a number" }, refused: "not a number" }
  }
  await save(patch)
  return { state: { ...state, editing: null, notice: null }, patch }
}

// ---------------------------------------------------------------- keys

export type SettingsIntent = "down" | "up" | "edit" | "commit" | "cancel"

const SPECS: Array<{ intent: SettingsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "edit", key: "return", footer: "Enter edit" },
  { intent: "commit", key: "ctrl+return", footer: "" },
  { intent: "cancel", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`settings key "${key}": ${binding.message}`)
  return binding
}

export const SETTINGS_PAGE_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { ctrl?: boolean } = {}): SettingsIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.ctrl ? `ctrl+${lower}` : lower === "enter" ? "return" : lower
  return SETTINGS_PAGE_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return SETTINGS_PAGE_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

/** The value column starts at the same cell for every row. */
export const VALUE_COLUMN = 24

// ---------------------------------------------------------------- render

export function SettingsPage(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  view: SettingsView
  state: SettingsState
}) {
  const palette = () => props.theme
  const groups = () => settingsGroups(props.view)
  const rows = () => flatRows(groups())
  const cursor = () => clampCursor(rows(), props.state.cursor)
  const current = () => rows()[cursor()]?.row


  /**
   * A popup is not always tall enough for fifteen rows. Rather than clip the
   * list — which silently hides settings — the page shows a window around the
   * cursor, with the group header of the first visible row so the grouping
   * still reads.
   */
  type Entry = { kind: "group"; title: string } | { kind: "row"; id: string }
  const entries = (): Entry[] =>
    groups().flatMap((group) => [
      { kind: "group" as const, title: group.title },
      ...group.rows.map((row) => ({ kind: "row" as const, id: row.id })),
    ])
  const maxVisible = () => Math.max(4, props.height - 2)
  const windowStart = () => {
    const all = entries()
    const at = all.findIndex((entry) => entry.kind === "row" && entry.id === rows()[cursor()]?.row.id)
    if (at === -1) return 0
    const half = Math.floor(maxVisible() / 2)
    return Math.max(0, Math.min(Math.max(0, all.length - maxVisible()), at - half))
  }
  const visibleEntries = () => {
    const window = entries().slice(windowStart(), windowStart() + maxVisible())
    // Never end the window on a group header with none of its rows below it.
    while (window.length > 0 && window[window.length - 1]!.kind === "group") window.pop()
    return window
  }

  return (
    <TwoColumnSurface
      theme={palette()}
      width={props.width}
      height={props.height}
      focused={props.focused}
      title="Settings"
      hints={[footerHints()]}
      notice={props.state.notice}
      detail={
        current()
          ? {
              title: current()!.label,
              meta:
                props.state.editing?.id === current()!.id
                  ? `${props.state.editing!.draft}▏`
                  : current()!.value,
              body: current()!.hint,
            }
          : undefined
      }
    >
      {visibleEntries().map((entry) => {
        if (entry.kind === "group") {
          return <SectionLabel theme={palette()} title={entry.title} />
        }
        const index = rows().findIndex((candidate) => candidate.row.id === entry.id)
        const row = rows()[index]!.row
        const editing = props.state.editing?.id === row.id
        return (
          <ListRow
            theme={palette()}
            selected={index === cursor()}
            label={row.label}
            value={editing ? `${props.state.editing!.draft}▏` : row.value}
            labelWidth={VALUE_COLUMN - 2}
          />
        )
      })}
    </TwoColumnSurface>
  )
}

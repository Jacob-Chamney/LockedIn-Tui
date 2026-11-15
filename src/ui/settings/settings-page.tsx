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
import { ListRow } from "../panels/list-row";
import { accordionRows } from "../accordion";
import { Tooltip } from "../shell/tooltip";
import { Popover } from "../shell/popover";
import { popoverLayout } from "../popover";
import { tooltipLayout } from "../tooltip";
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
  /** Read-only tags shown in the value column. */
  tags?: { labels: readonly string[]; invalid?: readonly boolean[] }
  /** The row is adjusted with -/+ rather than an inline text edit. */
  adjustOnly?: boolean
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
        { id: "maxToolCalls", label: "Max tool calls", value: text(view.maxToolCalls), hint: "hard cap per turn; the loop stops at this count; use -/+ to step it.", edit: "text", key: "models.max_tool_calls" },
        { id: "maxTokens", label: "Max tokens/request", value: text(view.maxTokensPerRequest, (n: number) => n.toLocaleString("en-US")), hint: "hard cap per request; the loop stops at this count; use -/+ to step it.", edit: "text", key: "models.max_tokens_per_request" },
      ],
    },
    {
      id: "usage",
      title: "USAGE",
      rows: [
        { id: "budget", label: "Budget", value: budgetLabel(view.budgetUsd), hint: "day or month limit; zero means no limit.", edit: "text", key: "usage.budget" },
        { id: "period", label: "Period", value: text(view.period), hint: "when the budget counter resets.", edit: "none" },
        { id: "warnAt", label: "Warn at", value: warnLabel(view.warnAt), hint: "the share of the budget that raises a warning; use -/+ to adjust it.", edit: "none", adjustOnly: true },
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
        { id: "historyLimit", label: "History limit", value: text(view.historyLimit), hint: "how many Chill messages are kept locally; zero disables history; use -/+ to step it.", edit: "text", key: "ui.chill_history_limit" },
      ],
    },
    {
      id: "plugins",
      title: "PLUGINS",
      rows: [
        {
          id: "servers",
          label: "MCP servers",
          value: view.pluginServers.length === 0 ? "none configured" : `${view.pluginServers.length} configured`,
          hint: "MCP servers available; enable them per command in MCP servers.",
          edit: "none",
          ...(view.pluginServers.length === 0 ? {} : { tags: { labels: view.pluginServers } }),
        },
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
export type FlatRow = { row: SettingsRow; group: string; groupId: string }

export function flatRows(groups: SettingsGroup[]): FlatRow[] {
  return groups.flatMap((group) =>
    group.rows.map((row) => ({ row, group: group.title, groupId: group.id })),
  )
}

/** Drop the rows of collapsed groups; the headers stay for rendering. */
export function visibleGroups(
  groups: SettingsGroup[],
  collapsed: readonly string[] = [],
): SettingsGroup[] {
  const closed = new Set(collapsed)
  return groups.map((group) => (closed.has(group.id) ? { ...group, rows: [] } : group))
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
  /** Section ids whose rows are hidden. */
  collapsed?: readonly string[]
  /** Show the selected row's hint as a tooltip. */
  help?: boolean
}

export const initialSettingsState: SettingsState = {
  cursor: 0,
  editing: null,
  notice: null,
  collapsed: [],
  help: false,
}

/** Toggle the section that owns the selected row and keep the cursor valid. */
export function toggleSection(state: SettingsState, groups: SettingsGroup[]): SettingsState {
  const current = selectedRow(groups, state.cursor)
  if (!current) return state
  const collapsed = new Set(state.collapsed ?? [])
  if (collapsed.has(current.groupId)) collapsed.delete(current.groupId)
  else collapsed.add(current.groupId)
  return { ...state, collapsed: [...collapsed], notice: null }
}

export function move(state: SettingsState, delta: number, groups: SettingsGroup[]): SettingsState {
  return { ...state, cursor: clampCursor(flatRows(groups), state.cursor + delta), notice: null }
}

export function beginEdit(state: SettingsState, groups: SettingsGroup[]): SettingsState {
  const current = selectedRow(groups, state.cursor)
  if (!current) return { ...state, notice: "no setting selected" }
  if (current.row.adjustOnly) {
    return { ...state, notice: `${current.row.label} is adjusted with -/+` }
  }
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
  const numericKeys = new Set([
    "usage.budget",
    "models.max_tool_calls",
    "models.max_tokens_per_request",
    "ui.chill_history_limit",
  ])
  const numeric = numericKeys.has(key)
  const number = Number(trimmed.replace(/,/g, ""))
  if (numeric && !Number.isFinite(number)) {
    return { state: { ...state, notice: `${key} must be a number` }, refused: "not a number" }
  }
  const patch = numeric ? { [key]: number } : { [key]: trimmed }
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
  const hints = SETTINGS_PAGE_KEYS.filter((entry) => entry.footer && entry.intent !== "cancel").map(
    (entry) => (entry.footer === "j/k move" ? "j/k" : entry.footer),
  )
  return `${hints.join(" · ")} · h/l fold · v hint · -/+ step`
}

function stepped(value: number, delta: number, step: number, min: number, max: number, precision = 0): number {
  const scale = 10 ** precision
  const next = Math.round((value + delta * step) * scale) / scale
  return Math.max(min, Math.min(max, next))
}

/** Adjust a steppable setting by `delta`; null when the row has no stepper. */
export function stepSetting(
  view: SettingsView,
  rowId: string,
  delta: number,
): { patch: Record<string, unknown>; next?: number } | null {
  if (rowId === "budget") {
    const next = stepped(view.budgetUsd, Math.sign(delta), 1, 0, 1000)
    return next === view.budgetUsd ? null : { patch: { "usage.budget": next }, next }
  }
  if (rowId === "warnAt") {
    const next = stepped(view.warnAt, Math.sign(delta), 0.05, 0.05, 1, 2)
    return next === view.warnAt ? null : { patch: { "usage.warn_at": next }, next }
  }
  if (rowId === "maxToolCalls") {
    const next = stepped(view.maxToolCalls, Math.sign(delta), 1, 1, 128)
    return next === view.maxToolCalls ? null : { patch: { "models.max_tool_calls": next }, next }
  }
  if (rowId === "maxTokens") {
    const next = stepped(view.maxTokensPerRequest, Math.sign(delta), 1000, 1, 1_000_000)
    return next === view.maxTokensPerRequest
      ? null
      : { patch: { "models.max_tokens_per_request": next }, next }
  }
  if (rowId === "historyLimit") {
    const next = stepped(view.historyLimit, Math.sign(delta), 10, 0, 10_000)
    return next === view.historyLimit ? null : { patch: { "ui.chill_history_limit": next }, next }
  }
  if (rowId === "period") {
    const next = view.period === "day" ? "month" : "day"
    return { patch: { "usage.period": next } }
  }
  return null
}

/** Enter on a row that toggles or picks: period and pause at limit. */
export function activateSetting(
  view: SettingsView,
  rowId: string,
): { patch: Record<string, unknown> } | null {
  if (rowId === "period") {
    return { patch: { "usage.period": view.period === "day" ? "month" : "day" } }
  }
  if (rowId === "pause") {
    return { patch: { "usage.pause_at_limit": !view.pauseAtLimit } }
  }
  return null
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
  const collapsed = () => props.state.collapsed ?? []
  const rows = () => flatRows(visibleGroups(groups(), collapsed()))
  const cursor = () => clampCursor(rows(), props.state.cursor)
  const current = () => rows()[cursor()]?.row
  const tooltipWidth = () => Math.max(20, Math.min(props.width - 4, 70))
  const usePopover = () => props.height >= 34
  const popover = () =>
    popoverLayout({
      width: tooltipWidth(),
      title: "? hint",
      body: current()?.hint ?? "",
      items: [
        { id: "edit", key: "Enter", label: "edit" },
        { id: "fold", key: "h/l", label: "fold" },
        { id: "close", key: "v", label: "close" },
      ],
      selected: 0,
      maxLines: 3,
    })
  const tooltipHeight = () => {
    const row = current()
    if (!props.state.help || row === undefined) return 0
    return usePopover()
      ? popover().height
      : tooltipLayout({ text: row.hint, width: tooltipWidth(), title: "hint", maxLines: 4 }).height
  }
  const accordion = () =>
    accordionRows({
      sections: groups().map((group) => ({
        id: group.id,
        title: group.title,
        items: group.rows.map((row) => ({ id: row.id, label: row.label })),
      })),
      collapsed: collapsed(),
    })


  /**
   * A popup is not always tall enough for fifteen rows. Rather than clip the
   * list — which silently hides settings — the page shows a window around the
   * cursor, with the group header of the first visible row so the grouping
   * still reads.
   */
  const entries = () => accordion()
  const maxVisible = () => Math.max(4, props.height - 2 - tooltipHeight())
  const windowStart = () => {
    const all = entries()
    const at = all.findIndex((entry) => entry.kind === "item" && entry.id === rows()[cursor()]?.row.id)
    if (at === -1) return 0
    const half = Math.floor(maxVisible() / 2)
    return Math.max(0, Math.min(Math.max(0, all.length - maxVisible()), at - half))
  }
  const visibleEntries = () => entries().slice(windowStart(), windowStart() + maxVisible())

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
        if (entry.kind === "header") {
          return (
            <text fg={palette().primary} wrapMode="none">
              {`${entry.caret === "" ? "" : `${entry.caret} `}${entry.title}`}
            </text>
          )
        }
        const index = rows().findIndex((candidate) => candidate.row.id === entry.id)
        if (index < 0) return null
        const row = rows()[index]!.row
        const editing = props.state.editing?.id === row.id
        return (
          <ListRow
            theme={palette()}
            selected={index === cursor()}
            label={row.label}
            value={editing ? `${props.state.editing!.draft}▏` : row.value}
            labelWidth={VALUE_COLUMN - 2}
            tags={row.tags === undefined ? undefined : { ...row.tags, width: VALUE_COLUMN }}
            background={palette().surface}
            toggle={
              row.id === "pause"
                ? { on: props.view.pauseAtLimit, onLabel: "yes", offLabel: "no" }
                : undefined
            }
            range={
              row.id === "warnAt"
                ? { values: [props.view.warnAt, 1], width: 18 }
                : undefined
            }
            stepper={
              row.id === "budget"
                ? {
                    value: props.view.budgetUsd,
                    min: 0,
                    max: 1000,
                    step: 1,
                    text: budgetLabel(props.view.budgetUsd),
                    width: 14,
                  }
                : row.id === "maxToolCalls"
                  ? { value: props.view.maxToolCalls, min: 1, max: 128, step: 1, width: 14 }
                  : row.id === "maxTokens"
                    ? {
                        value: props.view.maxTokensPerRequest,
                        min: 1,
                        max: 1_000_000,
                        step: 1000,
                        text: props.view.maxTokensPerRequest.toLocaleString("en-US"),
                        width: 14,
                      }
                    : row.id === "historyLimit"
                      ? { value: props.view.historyLimit, min: 0, max: 10_000, step: 10, width: 14 }
                      : undefined
            }
            segments={
              row.id === "period"
                ? {
                    options: ["day", "month"],
                    selected: props.view.period === "day" ? 0 : 1,
                    width: 14,
                  }
                : undefined
            }
          />
        )
      })}
      {props.state.help && current() ? (
        usePopover() ? (
          <Popover
            theme={palette()}
            width={tooltipWidth()}
            title="? hint"
            body={current()!.hint}
            items={[
              { id: "edit", key: "Enter", label: "edit" },
              { id: "fold", key: "h/l", label: "fold" },
              { id: "close", key: "v", label: "close" },
            ]}
            selected={0}
            maxLines={3}
          />
        ) : (
          <Tooltip
            theme={palette()}
            width={tooltipWidth()}
            title="? hint"
            text={current()!.hint}
            maxLines={4}
          />
        )
      ) : null}
    </TwoColumnSurface>
  )
}

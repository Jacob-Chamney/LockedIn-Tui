/** Settings, agent settings, themes and the leader overlay. */
import {
  beginEdit,
  cancelEdit,
  commitEdit,
  emptySettingsView,
  selectedRow,
  settingsGroups,
  typeEdit,
  type SettingsState,
  type SettingsView,
} from "../../ui/settings"
import {
  AGENT_FIELDS,
  type AgentField,
  type AgentSettingsState,
} from "../../ui/features/agents/agent-settings-panel"
import { cancelPending as cancelSessionPending, type SessionsState } from "../../ui/features/sessions"
import { themeEntries, type ThemesState } from "../../ui/settings/themes"
import type { AgentSummary } from "../../ui/shell/explorer"
import { reduce, type ShellState } from "../../ui/shell/state"
import type { ResolveResult } from "../../ui/keymap/resolve"
import type { ThemeId, ThemePalette } from "../../ui/theme"
import type { ModelsController } from "../models-controller"
import { applyViewPatch, nestedPatch } from "../settings-patch"
import { typedCharacter, type ShellPress } from "../keys/press"

export type SettingsKeyDeps = {
  models: ModelsController
  setSessionsState: (updater: (state: SessionsState) => SessionsState) => void
  agentSettings: () => AgentSettingsState
  currentAgent: () => AgentSummary | undefined
  openAgentField: (field: AgentField, agent: { id: string; name: string }) => void
  /** Opens chat settings only where the active surface has any. */
  openChatSettings: () => void
  update: (next: ShellState) => void
  settingsState: () => SettingsState
  setSettingsState: (value: SettingsState | ((current: SettingsState) => SettingsState)) => void
  settingsView: () => SettingsView | undefined
  setSettingsView: (value: SettingsView | undefined | ((current: SettingsView | undefined) => SettingsView | undefined)) => void
  onConfigPatch?: (patch: Record<string, unknown>) => unknown
  themeEntries: () => ReturnType<typeof themeEntries>
  themesState: () => ThemesState
  setTheme: (id: ThemeId) => void
  setCustomTheme: (value: Partial<ThemePalette> | null) => void
  onThemeChange?: (id: string) => unknown
  leaderAllows: (id: string) => boolean
  resolveLeader: (press: ShellPress) => ResolveResult
  dispatch: (id: string) => void
  notify: (text: string, level?: "info" | "warn" | "error") => void
  openPluginManager?: () => void
  movePluginManager?: (delta: number) => void
  togglePluginManager?: () => void
}

export function handleSettingsKeys(
  state: ShellState,
  press: ShellPress,
  event: { preventDefault: () => void },
  deps: SettingsKeyDeps,
): boolean {
  if (state.overlay === null && state.mode === "normal" && state.pane === "manager" && press.name === "escape") {
    deps.setSessionsState((current) => cancelSessionPending(current))
  }
  if (state.overlay === null && state.mode === "normal" && state.pane === "plugin-manager") {
    if (press.name === "escape") {
      deps.update({ ...state, pane: "settings", mode: "normal" })
    } else if (press.name === "space") {
      deps.togglePluginManager?.()
    } else if (press.name === "j" || press.name === "down") {
      deps.movePluginManager?.(1)
    } else if (press.name === "k" || press.name === "up") {
      deps.movePluginManager?.(-1)
    }
    event.preventDefault()
    return true
  }
  if (
    state.overlay === null &&
    state.mode === "normal" &&
    (state.pane === "models" || state.pane === "providers")
  ) {
    return deps.models.input(state.pane as "providers" | "models", press, event)
  }
  if (state.overlay === null && state.mode === "normal" && state.pane === "agent-settings") {
    const field = AGENT_FIELDS[deps.agentSettings().cursor] ?? "name"
    if (press.name === "return") {
      const agent = deps.currentAgent()
      if (agent) deps.openAgentField(field, agent)
      event.preventDefault()
      return true
    }
    if (press.name === "escape") {
      deps.update({ ...state, pane: "agents", mode: "normal" })
      event.preventDefault()
      return true
    }
  }

  if (state.overlay === null && state.mode === "normal" && state.pane === "settings") {
    const editing = deps.settingsState().editing
    if (editing) {
      if (press.name === "escape") {
        deps.setSettingsState((current) => cancelEdit(current))
      } else if (press.name === "return") {
        void commitEdit(deps.settingsState(), async (patch) => {
          const saved = await deps.onConfigPatch?.(nestedPatch(patch))
          if (
            saved !== null &&
            typeof saved === "object" &&
            "ok" in saved &&
            (saved as { ok: boolean }).ok === false
          ) {
            const error = (saved as { error?: { message?: string } }).error
            throw new Error(error?.message ?? "the config could not be saved")
          }
          deps.setSettingsView((view) => (view ? applyViewPatch(view, patch) : view))
          return deps.settingsView() ?? emptySettingsView()
        })
          .then((result) => {
            deps.setSettingsState(result.state)
            if ("refused" in result) deps.notify(result.refused, "warn")
          })
          .catch((error) => deps.notify(String(error instanceof Error ? error.message : error), "error"))
      } else if (press.name === "backspace" || press.name === "delete") {
        deps.setSettingsState((current) =>
          typeEdit(current, Array.from(current.editing?.draft ?? "").slice(0, -1).join("")),
        )
      } else {
        const character = typedCharacter(press)
        if (character !== null) {
          deps.setSettingsState((current) => typeEdit(current, (current.editing?.draft ?? "") + character))
        }
      }
      event.preventDefault()
      return true
    }
    if (press.name === "return") {
      const groups = settingsGroups(deps.settingsView() ?? emptySettingsView())
      const row = selectedRow(groups, deps.settingsState().cursor)
      if (row?.row.id === "theme") {
        deps.update({ ...state, pane: "themes", mode: "normal" })
        event.preventDefault()
        return true
      }
      if (row?.row.id === "chat-settings") {
        deps.openChatSettings()
        event.preventDefault()
        return true
      }
      if (row?.row.id === "providers") {
        deps.models.openProviders()
        event.preventDefault()
        return true
      }
      if (row?.row.id === "chatModel") {
        deps.models.openPicker()
        event.preventDefault()
        return true
      }
      if (row?.row.id === "baseUrl") {
        deps.models.openProviders("custom")
        event.preventDefault()
        return true
      }
      if (row?.row.id === "manage-plugins") {
        deps.openPluginManager?.()
        event.preventDefault()
        return true
      }
      deps.setSettingsState((current) => beginEdit(current, groups))
      event.preventDefault()
      return true
    }
  }

  if (state.overlay === null && state.mode === "normal" && state.pane === "themes") {
    if (press.name === "return") {
      const entry = deps.themeEntries()[deps.themesState().cursor]
      if (entry) {
        deps.setTheme(entry.id)
        deps.setCustomTheme(null)
        deps.setSettingsView((view) => (view ? { ...view, theme: entry.id } : view))
        void Promise.resolve(deps.onThemeChange?.(entry.id))
          .then((saved) => {
            if (saved && typeof saved === "object" && "ok" in saved && saved.ok === false) {
              deps.notify("theme applies now, but could not be saved", "warn")
            }
          })
          .catch((error) =>
            deps.notify(`theme applies now, but could not be saved: ${String(error).slice(0, 80)}`, "warn"),
          )
        deps.notify(`theme: ${entry.label}`)
      }
      event.preventDefault()
      return true
    }
  }

  if (state.overlay === "leader") {
    if (press.name === "escape") deps.update(reduce(state, { type: "leader-cancel" }))
    else {
      const hit = deps.resolveLeader(press)
      if (hit.kind === "action") {
        if (deps.leaderAllows(hit.action.id)) deps.dispatch(hit.action.id)
        else {
          deps.notify(`${hit.action.label} is not available here`, "warn")
          deps.update({ ...state, overlay: null, leaderPending: false, mode: "normal" })
        }
      } else deps.update({ ...state, overlay: null, leaderPending: false, mode: "normal" })
    }
    event.preventDefault()
    return true
  }
  return false
}

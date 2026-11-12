/** The Explorer is a menu over the chat. */
import type { ShellState } from "../../ui/shell/state"
import type { ShellPress } from "../keys/press"
import type { WorkBuffer } from "../buffers"

export type ExplorerKeyDeps = {
  selection: () => { label: string; pane: ShellState["pane"]; agentId?: string } | undefined
  setEditingAgent: (id: string) => void
  setAgentSettings: (value: { cursor: number }) => void
  update: (next: ShellState) => void
  projects: () => Array<{ id: string }>
  activeProject: () => string | null
  openBuffer: (buffer: WorkBuffer) => void
  /** Achievements live in a buffer, so Enter goes through the same opener. */
  openAchievements: () => void
}

export function handleExplorerKeys(
  state: ShellState,
  press: ShellPress,
  event: { preventDefault: () => void },
  deps: ExplorerKeyDeps,
): boolean {
  if (state.overlay !== null || state.mode !== "normal" || state.focus !== "explorer") return false

  if (press.name === "e") {
    const item = deps.selection()
    if (item?.agentId) {
      deps.setEditingAgent(item.agentId)
      deps.setAgentSettings({ cursor: 0 })
      deps.update({ ...state, pane: "agent-settings", explorer: false, focus: "chat", mode: "normal", overlay: null })
      event.preventDefault()
      return true
    }
  }
  if (press.name === "return") {
    const item = deps.selection()
    if (item) {
      if (item.agentId) {
        const project = deps.projects().find((entry) => entry.id === deps.activeProject())
        deps.openBuffer({
          id: `agent:${project?.id ?? "project"}:${item.agentId}`,
          label: item.label,
          kind: "agent",
          ...(project ? { projectId: project.id } : {}),
          agentId: item.agentId,
        })
      } else if (item.pane === "achievements") {
        // Opening the buffer already updates the shell; a second update would
        // restore the pre-open pane.
        deps.openAchievements()
      } else {
        deps.update({ ...state, pane: item.pane, explorer: false, focus: "chat", mode: "normal", overlay: null })
      }
    }
    event.preventDefault()
    return true
  }
  if (press.name === "escape") {
    deps.update({ ...state, explorer: false, focus: "chat", overlay: null, leaderPending: false })
    event.preventDefault()
    return true
  }
  return false
}

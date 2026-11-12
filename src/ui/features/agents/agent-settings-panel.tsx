/**
 * One agent's settings.
 *
 * A swarm agent is a role: a task, a model and the permissions it may use.
 * Editing happens here, in a window of its own, rather than in the list: `j`/`k`
 * move between fields, `Enter` edits the selected one (a text prompt for the
 * name and task, a highlighted choice for model and permissions), `Esc` closes.
 */
import type { ThemePalette } from "../../theme"
import type { AgentSummary } from "../../shell/explorer"
import { WindowBody } from "../../panels/floating-window"
import { PanelWindow } from "../../panels/panel-window"
import { SelectableRow, selectionMark } from "../../panels/select-list"

export type AgentField = "name" | "task" | "model" | "permissions"

export type AgentSettingsState = { cursor: number }

export const initialAgentSettings: AgentSettingsState = { cursor: 0 }

export const AGENT_FIELDS: AgentField[] = ["name", "task", "model", "permissions"]

/** The models an agent can be pointed at; `inherit` follows the project's. */
export const AGENT_MODELS = [
  "inherit",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "anthropic/claude-sonnet-4-5",
  "google/gemini-2.5-pro",
] as const

export const AGENT_PERMISSIONS: Array<AgentSummary["permissions"]> = ["read-only", "write", "commands"]

export function fieldLabel(field: AgentField): string {
  return field === "name" ? "Name" : field === "task" ? "Task" : field === "model" ? "Model" : "Permissions"
}

export function fieldValue(agent: AgentSummary, field: AgentField): string {
  if (field === "name") return agent.name
  if (field === "task") return agent.task || "no task yet"
  if (field === "model") return agent.model || "inherit"
  return agent.permissions
}

export function describe(field: AgentField): string {
  if (field === "name") return "What this agent is called in the swarm."
  if (field === "task") return "One sentence: what is this agent responsible for?"
  if (field === "model") return "Which model answers for this agent. Inherit follows the project's."
  return "read-only reads, write edits files, commands may run them."
}

/** The named middle region of the Agent settings window. */
export function AgentSettingsForm(props: {
  theme: ThemePalette
  agent: AgentSummary
  state: AgentSettingsState
}) {
  const palette = () => props.theme
  return (
    <WindowBody>
      {AGENT_FIELDS.map((entry, index) => {
        const selected = index === props.state.cursor
        const mark = selectionMark(palette(), selected)
        return (
          <SelectableRow theme={palette()} selected={selected}>
            <text fg={palette().primary} wrapMode="none">
              {mark.bar}
            </text>
            <text fg={palette().foreground} wrapMode="none" width={14}>
              {fieldLabel(entry)}
            </text>
            <text fg={selected ? palette().foreground : palette().secondary} wrapMode="none">
              {fieldValue(props.agent, entry)}
            </text>
          </SelectableRow>
        )
      })}
    </WindowBody>
  )
}

export function AgentSettingsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  agent: AgentSummary
  state: AgentSettingsState
}) {
  const palette = () => props.theme
  const field = () => AGENT_FIELDS[props.state.cursor] ?? "name"
  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title={`Agent · ${props.agent.name}`}
      meta={props.agent.permissions}
      detail={describe(field())}
      hints={["j/k move", "Enter edit", "Esc close"]}
    >
      <AgentSettingsForm theme={palette()} agent={props.agent} state={props.state} />
    </PanelWindow>
  )
}

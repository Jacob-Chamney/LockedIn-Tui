/**
 * The open project's agent roster, docked on the right.
 *
 * The Explorer is a menu of places; the agents of the project you are already
 * in are context, so they live beside the chat instead. Tab moves focus here
 * from NORMAL chat, j/k picks an agent, Enter opens its settings, and `c`
 * opens that agent's own chat.
 */
import { stringWidth } from "bun"

import type { ThemePalette } from "../theme"
import type { AgentSummary } from "./explorer"
import { avatarLayout, type AvatarLayout } from "../avatar"
import { AvatarGroup } from "./avatar-group"

export type AgentsSidebarProps = {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  project: string
  agents: AgentSummary[]
  cursor: number
  /** The project's default agent, marked with `●`. */
  defaultAgentId?: string
  /** The agent whose buffer is open, if any. */
  activeAgentId?: string | null
}

/** Keep the cursor row visible when the roster is taller than the pane. */
export function visibleAgentRange(
  count: number,
  cursor: number,
  rows: number,
): { start: number; end: number } {
  if (count <= rows) return { start: 0, end: count }
  const half = Math.floor(rows / 2)
  const start = Math.max(0, Math.min(count - rows, cursor - half))
  return { start, end: start + rows }
}

export function permissionMark(agent: AgentSummary): string {
  if (agent.permissions === "commands") return "!"
  if (agent.permissions === "write") return "✎"
  return "·"
}

/** One line of user data, with terminal control characters made inert. */
function inline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ")
}

/** Clip to terminal cells, not JavaScript characters. */
function clipDisplay(value: string, max: number): string {
  if (max <= 0) return ""
  if (stringWidth(value) <= max) return value
  const budget = Math.max(0, max - 1)
  let out = ""
  let width = 0
  for (const character of value) {
    const cw = stringWidth(character)
    if (width + cw > budget) break
    out += character
    width += cw
  }
  return `${out}…`
}

function padDisplay(value: string, width: number): string {
  const clipped = clipDisplay(value, width)
  return `${clipped}${" ".repeat(Math.max(0, width - stringWidth(clipped)))}`
}

export type RosterRow = {
  id: string
  agent: AgentSummary
  selected: boolean
  avatar: AvatarLayout
  name: string
  permission: string
  isActive: boolean
}

/** Visible roster rows, each with a monogram and a clipped name. */
export function rosterRows(
  agents: readonly AgentSummary[],
  cursor: number,
  options: { width: number; rows: number; defaultAgentId?: string; activeAgentId?: string | null },
): RosterRow[] {
  const range = visibleAgentRange(agents.length, cursor, options.rows)
  const avatarWidth = 4
  const nameWidth = Math.max(4, options.width - 10)
  return agents.slice(range.start, range.end).map((agent, offset) => {
    const at = range.start + offset
    const isDefault = agent.id === options.defaultAgentId
    const isActive = agent.id === options.activeAgentId
    return {
      id: agent.id,
      agent,
      selected: at === cursor,
      avatar: avatarLayout({ name: agent.name, width: avatarWidth }),
      name: padDisplay(inline(agent.name), nameWidth),
      permission: isDefault ? "●" : permissionMark(agent),
      isActive,
    }
  })
}

/** One line per visible agent, already clipped to the sidebar width. */
export function rosterLines(
  agents: readonly AgentSummary[],
  cursor: number,
  options: { width: number; rows: number; defaultAgentId?: string; activeAgentId?: string | null },
): string[] {
  return rosterRows(agents, cursor, options).map(
    (row) =>
      `${row.selected ? "▌" : " "}${row.avatar.text} ${row.name} ${row.permission}${row.isActive ? "›" : " "}`,
  )
}

export function AgentsSidebar(props: AgentsSidebarProps) {
  const palette = () => props.theme
  // Header, optional group, footer and a blank row leave the rest for the roster.
  const rows = () => Math.max(1, props.height - (props.agents.length > 0 ? 4 : 3))
  const body = () =>
    props.agents.length === 0
      ? [" no agents yet", " n adds the first one"].map((line) => (
          <text fg={props.focused ? palette().foreground : palette().muted} wrapMode="none">
            {line}
          </text>
        ))
      : rosterRows(props.agents, props.cursor, {
          width: props.width,
          rows: rows(),
          defaultAgentId: props.defaultAgentId,
          activeAgentId: props.activeAgentId,
        }).map((row) => (
          <text fg={props.focused ? palette().foreground : palette().muted} wrapMode="none">
            <span style={{ fg: palette().primary }}>{row.selected ? "▌" : " "}</span>
            <span style={{ fg: palette().background, bg: palette()[row.avatar.tone] }}>
              {row.avatar.text}
            </span>
            {` ${row.name} ${row.permission}${row.isActive ? "›" : " "}`}
          </text>
        ))
  const footer = () =>
    props.focused
      ? " j/k · Enter settings · c chat"
      : " Tab agents · ↑↓ or j/k"

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().surface}
      border={["left"]}
      borderColor={palette().line}
    >
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {clipDisplay(`${props.focused ? "▸" : " "} AGENTS · ${inline(props.project)}`, props.width)}
      </text>
      {props.agents.length > 0 ? (
        <AvatarGroup
          theme={palette()}
          items={props.agents.map((agent) => ({ id: agent.id, name: agent.name }))}
          width={Math.max(4, props.width - 2)}
          avatarWidth={4}
          overlap={0}
        />
      ) : null}
      {body()}
      <box flexGrow={1} minHeight={0} />
      <text fg={palette().muted} wrapMode="none">
        {footer()}
      </text>
    </box>
  )
}

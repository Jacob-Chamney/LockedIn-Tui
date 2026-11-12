/**
 * The Explorer: a menu of places, not a data dump.
 *
 * The previous LockedIn's sidebar (`lockedin-sidebar.png`) is the reference: a
 * surface header, red uppercase sections, items with a label and a one-line
 * detail, a `▌` bar plus fill plus bold on the selected row, and a divider before
 * the tools. Selecting an item shows its detail card over the main pane; Enter
 * opens it.
 *
 * The rows are built from the workspace: sessions and goals are the user's, not
 * a fixture. A section header is never a cursor stop.
 */
import type { ThemePalette } from "../theme"
import type { PaneId } from "./state"

export type ExplorerItem = {
  kind: "item"
  key: string
  label: string
  detail: string
  /** The surface it opens. */
  pane: PaneId
  /** Set for an agent row: opening it selects that agent's chat. */
  agentId?: string
}

export type ExplorerSection = { kind: "section"; key: string; label: string }
export type ExplorerDivider = { kind: "divider"; key: string }
export type ExplorerRow = ExplorerItem | ExplorerSection | ExplorerDivider

export type AgentSummary = {
  id: string
  name: string
  /** What the agent is for. */
  task: string
  /** Model id, or "" to inherit the project's. */
  model: string
  permissions: "read-only" | "write" | "commands"
}

export type SwarmSummary = {
  id: string
  name: string
  /** The project this swarm belongs to. */
  projectId: string
  agents: AgentSummary[]
}

export type ExplorerInput = {
  /** The open lock-in session, so the Explorer names the buffer in force. */
  session?: { name: string } | null
  /** The open skill session, so the Explorer names the buffer in force. */
  skill?: { name: string } | null
}

export function explorerRows(input: ExplorerInput = {}): ExplorerRow[] {
  const rows: ExplorerRow[] = [
    { kind: "section", key: "sec:chill", label: "CHILL" },
    { kind: "item", key: "chat", label: "Chill chat", detail: "Tool-free conversation · local history only", pane: "chat" },
    { kind: "section", key: "sec:learn", label: "LEARN" },
  ]

  // The open session is context, not another saved-session row: it sits under
  // LEARN and updates when its buffer opens.
  if (input.session) {
    rows.push({ kind: "section", key: "sec:lockin", label: `LOCK-IN · ${input.session.name}` })
    rows.push({
      kind: "item",
      key: "lockin:chat",
      label: "Chat",
      detail: "Session-scoped chat · only the selected sources count as facts",
      pane: "chat",
    })
    rows.push({
      kind: "item",
      key: "lockin:settings",
      label: "Session settings",
      detail: "Assignment instructions · load a PDF, DOCX or text file",
      pane: "session-settings",
    })
  } else if (input.skill) {
    rows.push({ kind: "section", key: "sec:skill", label: `SKILL SESSION · ${input.skill.name}` })
    rows.push({
      kind: "item",
      key: "skill:chat",
      label: "Chat",
      detail: "Chat scoped to this skill session and its gathered material",
      pane: "chat",
    })
  }

  if (input.session || input.skill) {
    // The active session is context, not another library row. A divider and a
    // section header keep the global managers visually separate from it.
    rows.push({ kind: "divider", key: "div:active-session" })
    rows.push({ kind: "section", key: "sec:sessions", label: "SESSIONS" })
  }

  rows.push(
    { kind: "item", key: "sessions", label: "Lock-in sessions", detail: "Source-bound study sessions", pane: "manager" },
    { kind: "item", key: "goals", label: "Skill sessions", detail: "Goals, curricula and lessons", pane: "skills" },
  )

  rows.push(
    { kind: "section", key: "sec:productivity", label: "PRODUCTIVITY" },
    { kind: "item", key: "projects", label: "Projects", detail: "A folder with one agent or a swarm", pane: "projects" },
  )
  rows.push(
    { kind: "divider", key: "div:tools" },
    { kind: "item", key: "recent", label: "Recent", detail: "Previous lock-in, skill and project sessions", pane: "recent" },
    { kind: "item", key: "stats", label: "Stats", detail: "Usage, cost and learning counters", pane: "stats" },
    { kind: "item", key: "achievements", label: "Achievements", detail: "Unlocked milestones and share cards", pane: "achievements" },
    { kind: "item", key: "archive", label: "Archive", detail: "Archive and restore sessions", pane: "archive" },
    { kind: "item", key: "knowledge", label: "Knowledge", detail: "Reference notes, grouped by section and topic", pane: "knowledge" },
    { kind: "item", key: "settings", label: "Settings", detail: "Chat, models, themes and storage", pane: "settings" },
  )

  return rows
}

/** Item rows are the only cursor stops. */
export function itemIndices(rows: ExplorerRow[]): number[] {
  return rows.map((row, index) => (row.kind === "item" ? index : -1)).filter((index) => index >= 0)
}

/** Move the cursor by `delta` items, skipping headers and dividers. */
export function moveExplorer(rows: ExplorerRow[], cursor: number, delta: number): number {
  const stops = itemIndices(rows)
  if (stops.length === 0) return cursor
  const at = stops.indexOf(cursor)
  const next = at === -1 ? 0 : Math.max(0, Math.min(stops.length - 1, at + delta))
  return stops[next]!
}

export function firstItem(rows: ExplorerRow[]): number {
  return itemIndices(rows)[0] ?? 0
}

export function selectedItem(rows: ExplorerRow[], cursor: number): ExplorerItem | undefined {
  const row = rows[cursor]
  return row && row.kind === "item" ? row : undefined
}

export function Explorer(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  rows: ExplorerRow[]
  cursor: number
}) {
  const palette = () => props.theme
  const size = () => Math.max(1, props.height - 1)
  /** Keep the cursor row inside the pane instead of slicing from row zero. */
  const start = () =>
    Math.max(0, Math.min(Math.max(0, props.rows.length - size()), props.cursor - Math.floor(size() / 2)))
  const visible = () => props.rows.slice(start(), start() + size())

  return (
    <box
      width={props.width}
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={palette().surface}
      border={["right"]}
      borderColor={palette().line}
    >
      <box paddingX={1} height={1} flexShrink={0}>
        <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
          <b>{props.focused ? "▸ EXPLORER" : "  EXPLORER"}</b>
        </text>
      </box>
      {visible().map((row, index) => {
        if (row.kind === "divider") {
          return (
            <box paddingX={1} height={1}>
              <text fg={palette().line} wrapMode="none">
                {"─".repeat(Math.max(0, props.width - 4))}
              </text>
            </box>
          )
        }
        if (row.kind === "section") {
          return (
            <box paddingX={1} height={1} marginTop={1}>
              <text fg={palette().primary} wrapMode="none">
                {row.label}
              </text>
            </box>
          )
        }
        const selected = start() + index === props.cursor
        return (
          <box
            flexDirection="row"
            backgroundColor={selected ? palette().panel : palette().surface}
            height={1}
          >
            <text fg={palette().primary} wrapMode="none">
              {selected ? "▌" : " "}
            </text>
            <text
              fg={selected ? palette().foreground : palette().muted}
              wrapMode="none"
            >
              {selected ? <b>{` ${row.label}`}</b> : ` ${row.label}`}
            </text>
          </box>
        )
      })}
    </box>
  )
}

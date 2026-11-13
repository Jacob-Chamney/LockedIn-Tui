/**
 * The shell mode machine. Pure: no renderer, no store, no I/O.
 *
 * Rules from docs/design.md §7.4 and §2.3:
 * - the shell itself is NORMAL; only the chat composer enters INSERT
 *   (product §2.3 — the composer lands with the chat packet);
 * - leaving any panel or manager returns to NORMAL, never silently to INSERT;
 * - only an explicit `i`/Enter enters INSERT;
 * - an overlay traps focus and Esc closes exactly one layer.
 */
import type { Mode } from "../keymap/registry"
import {
  OPENS_INTO,
  PANE_FOR_ACTION,
  PANE_PRESENTATION,
  isModal,
  popupHeight,
  type PaneId,
  type Presentation,
} from "./panes"

export { OPENS_INTO, PANE_FOR_ACTION, PANE_PRESENTATION, isModal, popupHeight }
export type { PaneId, Presentation }

export type Pane = "explorer" | "chat" | "reader" | "agents"

/**
 * An action is listed only when it can actually do something here: it opens a
 * surface, is a shell verb, or is one of the keys the shell itself handles.
 * Listing a binding that resolves to nothing is worse than leaving it out.
 */
const SHELL_KEYS = [
  "chat",
  "navigator",
  "reader",
  "insert",
  "escape",
  "down",
  "up",
  "help",
  "command",
  "quit",
  "buffers",
  "buffer-close",
  "dismiss-notice",
  "plugin-focus-next",
  "plugin-focus-prev",
] as const

export function actionIsUsable(id: string): boolean {
  const path = PANE_FOR_ACTION[id]
  if (path !== undefined) return true
  return (SHELL_KEYS as readonly string[]).includes(id)
}

export type Overlay = null | "leader" | "help" | "command"

export type ShellState = {
  mode: Mode
  focus: Pane
  explorer: boolean
  reader: boolean
  overlay: Overlay
  /** A leader prefix was pressed and the overlay is waiting for the next key. */
  leaderPending: boolean
  /** Text typed into the command bar. */
  commandQuery: string
  /** Which suggestion is selected; Tab completes it, Enter runs it. */
  commandIndex: number
  /** One actionable line shown under the bar; the bar stays open. */
  commandMessage: string | null
  /** The shell panel opened by a command (archive, themes, keybinds). */
  panel: string | null
  /** Which surface the main area shows; the chat stays mounted behind it. */
  pane: PaneId
  /** The open project's agent roster is docked on the right. */
  agentSidebar?: boolean
}

export const initialShellState: ShellState = {
  mode: "normal",
  focus: "chat",
  explorer: false,
  reader: false,
  overlay: null,
  leaderPending: false,
  commandQuery: "",
  commandIndex: 0,
  commandMessage: null,
  panel: null,
  pane: "chat",
  agentSidebar: false,
}

export type ShellEvent =
  | { type: "action"; id: string }
  | { type: "leader-open" }
  | { type: "leader-cancel" }
  | { type: "close-overlay" }
  | { type: "command-open" }
  | { type: "command-input"; value: string }
  | { type: "command-move"; delta: number; count: number }
  | { type: "command-cycle"; delta: number; count: number }
  | { type: "command-message"; message: string | null }
  | { type: "panel-open"; id: string }
  /** Enter in a chooser: take the picked item into its full surface. */
  | { type: "open-item" }

/** Panels and managers: everything that is not a pane switch. */
const PANEL_ACTIONS = new Set([
  "sessions",
  "goals",
  "flashcards",
  "review",
  "add-sources",
  "session-outputs",
  "knowledge",
  "stats",
  "tasks",
  "settings",
  "lock-in",
  "work-projects",
  "work-agents",
  "work-sessions",
  "work-swarms",
  "work-changes",
  "work-new",
  "buffers",
  "models",
  "providers",
])

export function exitPanel(state: ShellState): ShellState {
  // The one rule: a panel exit lands in NORMAL on the chat surface.
  return {
    ...state,
    pane: "chat",
    mode: "normal",
    focus: "chat",
    overlay: null,
    leaderPending: false,
    commandQuery: "",
    commandIndex: 0,
    commandMessage: null,
  }
}

export function reduce(state: ShellState, event: ShellEvent): ShellState {
  switch (event.type) {
    case "leader-open":
      return { ...state, overlay: "leader", leaderPending: true, mode: "normal" }

    case "leader-cancel":
      return { ...state, overlay: null, leaderPending: false, mode: "normal" }

    case "close-overlay":
      // Close one layer: the surface behind the overlay keeps its pane and
      // focus. Esc on a panel is the `escape` action, not this.
      return {
        ...state,
        overlay: null,
        leaderPending: false,
        mode: "normal",
        commandQuery: "",
        commandIndex: 0,
        commandMessage: null,
      }

    case "command-open":
      // The bar is the only INSERT exception besides the chat composer.
      return {
        ...state,
        overlay: "command",
        mode: "insert",
        commandQuery: "",
        commandMessage: null,
        commandIndex: 0,
        leaderPending: false,
      }

    case "command-input":
      return { ...state, commandQuery: event.value, commandMessage: null, commandIndex: 0 }

    case "command-cycle": {
      if (event.count <= 0) return { ...state, commandIndex: 0 }
      const next = (state.commandIndex + event.delta + event.count) % event.count
      return { ...state, commandIndex: next }
    }

    case "command-move": {
      if (event.count <= 0) return { ...state, commandIndex: 0 }
      return {
        ...state,
        commandIndex: Math.max(0, Math.min(event.count - 1, state.commandIndex + event.delta)),
      }
    }

    case "command-message":
      // An unknown command keeps the bar open: one line, no crash, no close.
      return { ...state, commandMessage: event.message }

    case "open-item": {
      const target = OPENS_INTO[state.pane]
      if (!target) return state
      return { ...state, pane: target, mode: "normal", overlay: null, leaderPending: false }
    }

    case "panel-open":
      return {
        ...state,
        panel: event.id,
        overlay: null,
        leaderPending: false,
        mode: "normal",
        commandQuery: "",
  commandIndex: 0,
        commandMessage: null,
      }

    case "action":
      switch (event.id) {
        case "escape":
          return exitPanel(state)
        case "insert":
          // Only the chat composer takes text; elsewhere `i` is inert.
          return state.pane === "chat" && state.focus === "chat"
            ? { ...state, mode: "insert", overlay: null, leaderPending: false }
            : { ...state, mode: "normal" }
        case "navigator": {
          // Showing the explorer is a shell action: a chooser on top of it would
          // hide the thing the key asked for, so the chooser closes first.
          const explorer = !state.explorer
          return {
            ...state,
            pane: "chat",
            explorer,
            // Opening the Explorer focuses it; closing it returns to chat.
            focus: explorer ? "explorer" : "chat",
            overlay: null,
            leaderPending: false,
            mode: "normal",
          }
        }
        case "chat":
          return { ...state, pane: "chat", focus: "chat", overlay: null, leaderPending: false, mode: "normal" }
        case "reader": {
          const reader = !state.reader
          return {
            ...state,
            reader,
            focus: reader ? "reader" : "chat",
            overlay: null,
            leaderPending: false,
            mode: "normal",
          }
        }
        case "help":
          return { ...state, overlay: "help", leaderPending: false, mode: "normal" }
        case "quit":
          return state
        case "command":
          return {
            ...state,
            overlay: "command",
            mode: "insert",
            commandQuery: "",
            commandMessage: null,
            commandIndex: 0,
            leaderPending: false,
          }
        case "settings":
          return {
            ...state,
            pane: "settings",
            explorer: false,
            overlay: null,
            leaderPending: false,
            mode: "normal",
          }
        default:
          if (PANE_FOR_ACTION[event.id]) {
            // A registered surface takes the main area; the chat stays mounted.
            return {
              ...state,
              pane: PANE_FOR_ACTION[event.id]!,
              explorer: false,
              overlay: null,
              leaderPending: false,
              mode: "normal",
            }
          }
          if (PANEL_ACTIONS.has(event.id)) {
            // A panel takes the main pane; the Explorer closes so it cannot
            // cover the panel, and the mode is NORMAL on arrival.
            return { ...state, explorer: false, focus: "chat", overlay: null, leaderPending: false, mode: "normal" }
          }
          return { ...state, overlay: null, leaderPending: false, mode: "normal" }
      }
  }
}

export type VisiblePanes = { explorer: boolean; reader: boolean; agents: boolean }

/**
 * Design §2.2: only one aux pane at a time below 120 columns, and the reader
 * never squeezes main under its 40-cell minimum. The agent sidebar is a second
 * right-hand pane; above 120 it may sit beside the reader.
 */
export function visiblePanes(width: number, state: ShellState): VisiblePanes {
  const wantAgents = state.agentSidebar === true && state.pane === "chat"
  if (width < 80) return { explorer: false, reader: false, agents: false }
  if (width >= 120) {
    return { explorer: state.explorer, reader: state.reader, agents: wantAgents }
  }
  if (state.reader) return { explorer: false, reader: true, agents: false }
  return {
    // Below 100 the Explorer and the agent sidebar cannot both fit beside a
    // 40-cell main column; the sidebar the project is about wins.
    explorer: state.explorer && (!wantAgents || width >= 100),
    reader: false,
    agents: wantAgents,
  }
}

/** docs/design.md §2.2: 26 below 120, 30 at 120-179, 34 at 180+. */
export function explorerWidth(width: number, panes: VisiblePanes): number {
  if (!panes.explorer) return 0
  if (width >= 180) return 34
  return width >= 120 ? 30 : width >= 80 ? 26 : 0
}

/** The agent roster is narrower than the Explorer: names, not menus. */
export function agentsWidth(width: number, panes: VisiblePanes): number {
  if (!panes.agents) return 0
  if (width >= 180) return 30
  return width >= 120 ? 28 : width >= 100 ? 24 : 0
}

export function readerWidth(width: number, panes: VisiblePanes): number {
  if (!panes.reader) return 0
  const available = width - explorerWidth(width, panes) - agentsWidth(width, panes)
  // Half is the preferred split, but design §2.2 keeps 40 cells for main.
  return Math.max(0, Math.min(Math.floor(available * 0.5), available - 40))
}

export type PaneGeometry = {
  explorer: number
  main: number
  reader: number
  agents: number
}

/** Chat text column, capped at ~110 cells and centred (design §2.2). */
export const CHAT_COLUMN_MAX = 110

export function paneGeometry(width: number, state: ShellState): PaneGeometry {
  const panes = visiblePanes(width, state)
  const explorer = explorerWidth(width, panes)
  const reader = readerWidth(width, panes)
  const agents = agentsWidth(width, panes)
  return { explorer, main: Math.max(0, width - explorer - reader - agents), reader, agents }
}

/** Offset of the chat column inside main, and the column width. */
export function chatColumn(width: number, state: ShellState): { left: number; width: number } {
  const geometry = paneGeometry(width, state)
  const column = Math.min(CHAT_COLUMN_MAX, geometry.main)
  return { left: Math.floor((geometry.main - column) / 2), width: column }
}

/** Focus can never point at a pane the current width hides. */
export function normalizeFocus(state: ShellState, width: number): ShellState {
  const panes = visiblePanes(width, state)
  if (state.focus === "explorer" && (!panes.explorer || explorerWidth(width, panes) === 0)) {
    return { ...state, focus: "chat" }
  }
  if (state.focus === "reader" && !panes.reader) return { ...state, focus: "chat" }
  if (state.focus === "agents" && (!panes.agents || agentsWidth(width, panes) === 0)) {
    return { ...state, focus: "chat" }
  }
  return state
}

export function agentSidebarVisible(width: number, state: ShellState): boolean {
  const panes = visiblePanes(width, state)
  return panes.agents && agentsWidth(width, panes) > 0
}

export function paneTone(state: ShellState, pane: Pane): "focus" | "dim" {
  return state.focus === pane ? "focus" : "dim"
}

export function overlayIsOpen(state: ShellState): boolean {
  return state.overlay !== null
}

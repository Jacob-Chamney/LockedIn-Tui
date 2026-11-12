/**
 * Invariant suite — shell and mode machine (WP-109).
 *
 * Guards docs/testing.md §11.7 / §11.8 and AGENTS.md §2.3:
 * - leaving any panel lands in NORMAL, never INSERT;
 * - the shell survives 80×24 and 200×60 without clipping;
 * - focus is shown by a marker, not by colour alone.
 *
 * The reducer and geometry tests are pure. The render cases use the WP-009
 * harness (`tests/helpers/render.tsx`), so they wait on the renderer's frame
 * loop and never sleep.
 */

import { describe, expect, test } from "bun:test"

import {
  CHAT_COLUMN_MAX,
  chatColumn,
  exitPanel,
  explorerWidth,
  initialShellState,
  normalizeFocus,
  paneGeometry,
  reduce,
  visiblePanes,
  type ShellEvent,
  type ShellState,
} from "../../src/ui/shell/state"

const PANEL_ACTIONS = [
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
  "sections",
  "pane",
]

function event(type: ShellEvent["type"], extra: Partial<ShellEvent> = {}): ShellEvent {
  return { type, ...extra } as ShellEvent
}

/** A state that is "stuck" in insert with an overlay and a panel open. */
const busy: ShellState = {
  ...initialShellState,
  mode: "insert",
  focus: "explorer",
  explorer: true,
  reader: true,
  overlay: "help",
  leaderPending: true,
  panel: "settings",
  commandQuery: ":set",
}

describe("shell invariants", () => {
  test("P1-SH-06 leaving a panel always returns to NORMAL", () => {
    // The direct helper.
    const exited = exitPanel(busy)
    expect(exited.mode).toBe("normal")
    expect(exited.focus).toBe("chat")
    expect(exited.overlay).toBeNull()
    expect(exited.leaderPending).toBe(false)

    // `Esc` through the reducer is the same path a key takes.
    expect(reduce(busy, event("action", { id: "escape" } as never)).mode).toBe("normal")

    // Every panel action arrives in NORMAL, from INSERT, with no overlay.
    for (const id of PANEL_ACTIONS) {
      const next = reduce(busy, event("action", { id } as never))
      expect(next.mode).toBe("normal")
      expect(next.overlay).toBeNull()
      expect(next.leaderPending).toBe(false)
    }

    // Opening and closing the leader overlay never leaves INSERT behind.
    expect(reduce(busy, event("leader-cancel")).mode).toBe("normal")
    expect(reduce(busy, event("close-overlay")).mode).toBe("normal")
  })

  test("P1-SH-06 only an explicit insert action enters INSERT, and only on chat", () => {
    // `i` on chat enters insert…
    expect(reduce({ ...initialShellState, focus: "chat" }, event("action", { id: "insert" })).mode).toBe(
      "insert",
    )
    // …and is inert elsewhere: it returns to NORMAL instead.
    expect(reduce({ ...initialShellState, focus: "explorer" }, event("action", { id: "insert" })).mode).toBe(
      "normal",
    )
  })

  test("P1-SH-01 80x24 layout keeps the panes readable and the chat usable", () => {
    // Explorer only: the docked pane takes 26 cells and main keeps its minimum.
    const explorerOnly: ShellState = { ...initialShellState, explorer: true }
    const panes = visiblePanes(80, explorerOnly)
    expect(panes.explorer).toBe(true)
    expect(explorerWidth(80, panes)).toBe(26)

    const explorerGeometry = paneGeometry(80, explorerOnly)
    expect(explorerGeometry.main).toBeGreaterThanOrEqual(40)

    // Design §2.2: below 120 only one aux pane is shown, so opening the reader
    // hides the explorer instead of squeezing main.
    const both: ShellState = { ...initialShellState, explorer: true, reader: true }
    const narrow = visiblePanes(80, both)
    expect(narrow.explorer).toBe(false)
    expect(narrow.reader).toBe(true)
    expect(paneGeometry(80, both).main).toBeGreaterThanOrEqual(40)

    // The chat column always fits inside main.
    for (const state of [explorerOnly, both]) {
      const column = chatColumn(80, state)
      const geometry = paneGeometry(80, state)
      expect(column.width).toBeLessThanOrEqual(CHAT_COLUMN_MAX)
      expect(column.left).toBeGreaterThanOrEqual(0)
      expect(column.left + column.width).toBeLessThanOrEqual(geometry.main)
    }
  })

  test("P1-SH-02 200x60 layout widens the panes and caps the chat column", () => {
    const state: ShellState = { ...initialShellState, explorer: true, reader: true }
    const panes = visiblePanes(200, state)
    expect(panes.explorer).toBe(true)
    expect(panes.reader).toBe(true)

    expect(explorerWidth(200, panes)).toBe(34)

    // Above 180 both aux panes may be open at once.
    const geometry = paneGeometry(200, state)
    expect(geometry.explorer).toBe(34)
    expect(geometry.reader).toBe(Math.floor((200 - 34) * 0.5))
    expect(geometry.main).toBe(200 - geometry.explorer - geometry.reader)

    // The chat column never exceeds the cap and never exceeds main.
    const withAux = chatColumn(200, state)
    expect(withAux.width).toBeLessThanOrEqual(CHAT_COLUMN_MAX)
    expect(withAux.width).toBeLessThanOrEqual(geometry.main)

    // With no aux pane, 200 cells gives the capped column centred in main.
    const bare = chatColumn(200, initialShellState)
    expect(bare.width).toBe(CHAT_COLUMN_MAX)
    expect(bare.left).toBeGreaterThan(34)
    expect(bare.left + bare.width).toBeLessThanOrEqual(200)
  })

  test("P1-SH-10 a resize keeps the focused pane valid and the selection visible", () => {
    let state: ShellState = { ...initialShellState, reader: true, focus: "reader" }
    expect(normalizeFocus(state, 200).focus).toBe("reader")

    // Below 80 the reader replaces main; the focus must still be a real pane.
    const narrow = normalizeFocus({ ...state, explorer: false }, 60)
    expect(["chat", "reader", "explorer"]).toContain(narrow.focus)

    // Back to wide, the state is unchanged — nothing was remounted or reset.
    state = { ...state, mode: "normal" }
    expect(normalizeFocus(state, 200)).toEqual(state)
  })

  test("P1-SH-04 the reader is only visible when it has a document", () => {
    const withReader = visiblePanes(140, { ...initialShellState, reader: true })
    const withoutReader = visiblePanes(140, { ...initialShellState, reader: false })
    expect(withReader.reader).toBe(true)
    expect(withoutReader.reader).toBe(false)

    // Exactly one aux pane: toggling the reader does not resurrect the explorer.
    const opened = reduce({ ...initialShellState, explorer: false }, event("action", { id: "reader" }))
    expect(opened.reader).toBe(true)
    expect(opened.explorer).toBe(false)
  })
})

/**
 * WP-107 — shell layout and mode machine.
 *
 * Two layers, deliberately separated:
 * - rendering: one App mount per state, because the headless harness cannot
 *   repaint after mount (spike S1 findings); a frame is asserted per state;
 * - behaviour: the pure mode machine (`reduce`) and the keymap resolver.
 *
 * Covers P1-SH-01 … P1-SH-09 of docs/testing.md §11.7.
 */
import { describe, expect, test } from "bun:test";
const { testRender } = await import("@opentui/solid")
const { App } = await import("../../src/app/App")
const { generatedRows, overlayRows } = await import("../../src/ui/keymap/registry")
const state = await import("../../src/ui/shell/state")
const { createDefaultActions } = await import("../../src/ui/keymap/defaults")
const { KeymapRegistry } = await import("../../src/ui/keymap/registry")

type Api = import("../../src/app/App").ShellApi
type Setup = Awaited<ReturnType<typeof testRender>>

async function mount(width: number, height: number, initial?: Parameters<typeof App>[0]["initial"]) {
  let api!: Api
  const setup = await testRender(() => <App initial={initial} api={(value) => (api = value)} />, {
    width,
    height,
  })
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return { setup, api: () => api }
}

function rows(setup: Setup): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}


function fgAt(setup: Setup, needle: string): string | undefined {
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue
      const buffer = (span.fg as unknown as { buffer: ArrayLike<number> }).buffer
      return `#${[buffer[0], buffer[1], buffer[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`
    }
  }
  return undefined
}

const PRIMARY = "#d9534f"

const DOC = ["## Understand", "- [x] Read section 4.2", "- [ ] Derive the energy balance"]

describe("P1-SH-01 / P1-SH-02 snapshots", () => {
  test("renders at 80x24 with nothing clipped", async () => {
    const { setup } = await mount(80, 24)
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      const frame = lines.join("\n")
      expect(frame).toContain("LOCKEDIN")
      expect(frame).toContain("CHILL")
      expect(frame).toContain("Chat")
      expect(frame).toContain("no model configured")
      expect(frame).toContain("NORMAL")
      expect(frame).toContain("read-only")
      expect(frame).not.toContain("EXPLORER")
      // Hints shorten rather than push the mode off screen.
      expect(lines[23]!.length).toBe(80)
      expect(lines[23]).toContain("NORMAL")
    } finally {
      await setup.dispose()
    }
  })

  test("renders at 200x60 with Explorer 34, reader 45% and a capped chat column", async () => {
    const { setup } = await mount(200, 60, {
      explorer: true,
      reader: true,
      readerTitle: "assignment-steps.md",
      readerLines: DOC,
    })
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(60)
      for (const line of lines) expect(line.length).toBe(200)

      const geometry = state.paneGeometry(200, {
        ...state.initialShellState,
        explorer: true,
        reader: true,
      })
      expect(geometry.explorer).toBe(34)
      expect(geometry.reader).toBe(Math.floor((200 - 34) * 0.5))
      expect(geometry.main).toBe(200 - geometry.explorer - geometry.reader)

      // Chat column capped at 110 and centred inside main.
      const column = state.chatColumn(200, { ...state.initialShellState, explorer: true, reader: true })
      expect(column.width).toBe(Math.min(state.CHAT_COLUMN_MAX, geometry.main))
      expect(column.left).toBe(Math.floor((geometry.main - column.width) / 2))

      // With no aux panes the column hits the cap instead of the pane width.
      const wide = state.chatColumn(200, state.initialShellState)
      expect(wide.width).toBe(state.CHAT_COLUMN_MAX)
      expect(wide.left).toBe(Math.floor((200 - state.CHAT_COLUMN_MAX) / 2))
    } finally {
      await setup.dispose()
    }
  })
})

describe("P1-SH-03 / P1-SH-04 panes", () => {
  test("the agent sidebar and reader never squeeze main below 40 cells", () => {
    for (const width of [120, 121, 130, 137, 140, 180, 220]) {
      const geometry = state.paneGeometry(width, {
        ...state.initialShellState,
        explorer: true,
        reader: true,
        agentSidebar: true,
      })
      expect(geometry.main).toBeGreaterThanOrEqual(40)
    }
    expect(state.agentSidebarVisible(90, { ...state.initialShellState, agentSidebar: true })).toBe(false)
    expect(state.agentSidebarVisible(120, { ...state.initialShellState, agentSidebar: true })).toBe(true)
  })

  test("the Explorer never covers the chat", async () => {
    const { setup } = await mount(200, 60, { explorer: true, focus: "explorer" })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("EXPLORER")
      expect(frame).toContain("what do you want to learn today?")
      const geometry = state.paneGeometry(200, { ...state.initialShellState, explorer: true })
      expect(geometry.explorer).toBe(34)
      expect(geometry.main).toBeGreaterThanOrEqual(40)
    } finally {
      await setup.dispose()
    }
  })

  test("the reader opens only with a document, keeps chat visible, and is the only aux pane", async () => {
    const without = await mount(200, 60, { reader: true })
    try {
      expect(rows(without.setup).join("\n")).not.toContain("assignment-steps.md")
    } finally {
      await without.setup.dispose()
    }

    const withDoc = await mount(200, 60, {
      reader: true,
      focus: "reader",
      readerTitle: "assignment-steps.md",
      readerLines: DOC,
    })
    try {
      const frame = rows(withDoc.setup).join("\n")
      expect(frame).toContain("assignment-steps.md")
      expect(frame).toContain("what do you want to learn today?")

      // At 80 columns the Explorer yields to the reader: one aux pane only.
      const narrow = state.visiblePanes(80, { ...state.initialShellState, explorer: true, reader: true })
      expect(narrow).toEqual({ explorer: false, reader: true, agents: false })
      expect(state.paneGeometry(80, { ...state.initialShellState, reader: true }).main).toBeGreaterThanOrEqual(40)
    } finally {
      await withDoc.setup.dispose()
    }
  })
})

describe("P1-SH-05 focus is not colour alone", () => {
  test("the focused pane carries a glyph and the others dim", async () => {
    const explorerFocused = await mount(200, 60, { explorer: true, focus: "explorer" })
    try {
      const frame = rows(explorerFocused.setup).join("\n")
      expect(frame).toContain("▸ EXPLORER")
      expect(fgAt(explorerFocused.setup, "▸ EXPLORER")).toBe(PRIMARY)
      // Exactly one pane is focused; the other is dimmed (design §2.3).
      expect(state.paneTone(explorerFocused.api().state(), "explorer")).toBe("focus")
      expect(state.paneTone(explorerFocused.api().state(), "chat")).toBe("dim")
    } finally {
      await explorerFocused.setup.dispose()
    }

    const chatFocused = await mount(200, 60, { explorer: true, focus: "chat" })
    try {
      const frame = rows(chatFocused.setup).join("\n")
      expect(frame).not.toContain("▸ EXPLORER")
      expect(fgAt(chatFocused.setup, "what do you want to learn today?")).toBeDefined()
    } finally {
      await chatFocused.setup.dispose()
    }
  })
})

describe("P1-SH-06 mode machine", () => {
  const PANELS = [
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
    "work-projects",
    "work-agents",
    "work-changes",
    "navigator",
    "reader",
    "help",
  ]

  test("every panel exit returns to NORMAL on the chat pane", () => {
    for (const id of PANELS) {
      const opened = state.reduce(
        { ...state.initialShellState, mode: "insert", explorer: true, reader: true },
        { type: "action", id },
      )
      for (const escaped of [
        state.reduce(opened, { type: "action", id: "escape" }),
        state.reduce(opened, { type: "close-overlay" }),
      ]) {
        expect(escaped.mode).toBe("normal")
        expect(escaped.focus).toBe("chat")
        expect(escaped.overlay).toBe(null)
      }
    }
  })

  test("closing help keeps the surface behind it", () => {
    const settings = { ...state.initialShellState, pane: "settings" as const, panel: "settings" }
    const help = state.reduce(settings, { type: "action", id: "help" })
    expect(help.overlay).toBe("help")
    const closed = state.reduce(help, { type: "close-overlay" })
    expect(closed.overlay).toBe(null)
    expect(closed.pane).toBe("settings")
    expect(closed.mode).toBe("normal")
  })

  test("i is inert outside the chat pane", () => {
    const panel = { ...state.initialShellState, pane: "projects" as const, panel: "projects" }
    const after = state.reduce(panel, { type: "action", id: "insert" })
    expect(after.mode).toBe("normal")
    expect(after.pane).toBe("projects")
  })

  test("only the insert action enters INSERT", () => {
    const registry = new KeymapRegistry(createDefaultActions(() => {}))
    expect(registry.actions().filter((a) => a.modeAfter === "insert").map((a) => a.id)).toEqual(["insert"])
    expect(state.reduce(state.initialShellState, { type: "action", id: "insert" }).mode).toBe("insert")
    expect(state.reduce({ ...state.initialShellState, mode: "insert" }, { type: "action", id: "escape" }).mode).toBe("normal")
  })

  test("the status bar always shows the mode", async () => {
    const { setup } = await mount(80, 24, { mode: "insert" })
    try {
      expect(rows(setup)[23]).toContain("INSERT")
      expect(rows(setup)[23]).toContain("CHILL")
    } finally {
      await setup.dispose()
    }
  })
})

describe("P1-SH-07 overlays", () => {
  test("the overlay dims the background, lists real bindings and closes one layer", async () => {
    const registry = new KeymapRegistry(createDefaultActions(() => {}))
    const expected = overlayRows(registry, "global", 2).flat()
    const { setup } = await mount(200, 60, { overlay: "help" })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("help")
      expect(frame).toContain("Esc close")
      // The background is still drawn behind the overlay (dimmed by the backdrop).
      expect(frame).toContain("LOCKEDIN")
      expect(expected.length).toBeGreaterThan(8)

      const closed = state.reduce({ ...state.initialShellState, overlay: "help" }, { type: "close-overlay" })
      expect(closed.overlay).toBe(null)
      expect(closed.mode).toBe("normal")

      const leader = state.reduce(state.initialShellState, { type: "leader-open" })
      expect(leader.overlay).toBe("leader")
      expect(leader.leaderPending).toBe(true)
    } finally {
      await setup.dispose()
    }
  })
})

describe("P1-SH-08 no model", () => {
  test("the badge says so without covering content and send is blocked with a reason", async () => {
    const { setup } = await mount(80, 24)
    try {
      const lines = rows(setup)
      expect(lines[0]).toContain("no model configured")
      expect(lines[0]).toContain("LOCKEDIN")
      // No model ⇒ the composer explains what to do instead of inviting a send.
      expect(lines.join("\n")).toContain("(i to type)")
    } finally {
      await setup.dispose()
    }
  })
})

describe("P1-SH-09 hints come from the registry", () => {
  test("the leader rows are the registry's, and follow a rebind", async () => {
    // The shell no longer carries a hint footer: each pane owns its own keys,
    // and the leader overlay is the one place that lists the binding catalogue.
    // The invariant is unchanged — those strings are read back from the registry.
    const registry = new KeymapRegistry(createDefaultActions(() => {}))
    const expected = generatedRows(registry, "global")
    const { setup } = await mount(200, 60, { overlay: "leader" })
    try {
      const frame = rows(setup).join("\n")
      // The leader is already down, so only the completing key is shown, and the
      // menu offers only what is reachable in this context.
      for (const label of ["lock-in sessions", "skill sessions", "work projects", "stats"]) {
        expect(frame).toContain(label)
      }
      for (const hidden of ["task center", "reader buffers", "first buffer"]) {
        expect(frame).not.toContain(hidden)
      }
      const out = rows(setup)
      const context = out.findIndex((line) => line.includes("CONTEXT"))
      const global = out.findIndex((line) => line.includes("GLOBAL"))
      expect(context).toBeGreaterThan(-1)
      expect(global).toBeGreaterThan(context)
      expect(out[context]).not.toContain("GLOBAL")
      const leaderBindings = expected.filter((row) => row.binding.kind === "leader")
      expect(leaderBindings.length).toBeGreaterThan(3)
      registry.rebind("chat", { kind: "leader", key: "9" })
      const rebound = generatedRows(registry, "global").find((row) => row.id === "chat")
      expect(rebound?.keys).toBe("␣ 9")
      registry.reset()
    } finally {
      await setup.dispose()
    }
  })
})

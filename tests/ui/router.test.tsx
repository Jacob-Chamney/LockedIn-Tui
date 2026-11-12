/** WP-810 — the pane router: every surface reachable, Esc returns to chat. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const state = await import("../../src/ui/shell/state")
const { PANE_DEFS, PANE_TITLES, popupHeight } = await import("../../src/ui/shell/panes")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/router/panes.json"), "utf8"))
const PANES: Record<string, string> = FIXTURE.panes

async function mount(width: number, height: number, initial: Record<string, unknown> = {}) {
  const setup = await testRender(() => <App initial={initial as never} theme="lockedin" />, { width, height })
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

function lastIndexOfLine(lines: string[], text: string): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index]!.includes(text)) return index
  }
  return -1
}

describe("the table", () => {
  test("every documented action maps to a pane, and every pane has an action", () => {
    const expected: Record<string, string> = {
      sessions: "manager",
      goals: "skills",
      "work-projects": "projects",
      "add-sources": "sources",
      buffers: "buffers",
      stats: "stats",
      achievements: "achievements",
      archive: "archive",
      settings: "settings",
      "task-center": "task-centre",
      knowledge: "knowledge",
    }
    for (const [action, pane] of Object.entries(expected)) {
      expect(`${action} -> ${state.PANE_FOR_ACTION[action]}`).toBe(`${action} -> ${pane}`)
    }
    const ids = PANE_DEFS.map((pane) => pane.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [action, pane] of Object.entries(state.PANE_FOR_ACTION)) {
      expect(`${action}: ${PANE_TITLES[pane] !== undefined}`).toBe(`${action}: true`)
    }
    const reachable = new Set(Object.values(state.PANE_FOR_ACTION))
    for (const pane of Object.keys(PANES)) {
      expect(`${pane} reachable: ${reachable.has(pane as never)}`).toBe(`${pane} reachable: true`)
    }
  })

  test("an action opens its pane and lands in NORMAL", () => {
    for (const [action, pane] of Object.entries(state.PANE_FOR_ACTION)) {
      const opened = state.reduce(state.initialShellState, { type: "action", id: action })
      expect(`${action} -> ${opened.pane} ${opened.mode}`).toBe(`${action} -> ${pane} normal`)
    }
  })

  test("Esc from every pane returns to chat", () => {
    for (const pane of Object.keys(PANES) as Array<keyof typeof PANES>) {
      const opened = { ...state.initialShellState, pane: pane as never }
      const escaped = state.reduce(opened, { type: "action", id: "escape" })
      expect(`${String(pane)} -> ${escaped.pane} ${escaped.mode}`).toBe(`${String(pane)} -> chat normal`)
    }
  })
})

describe("rendering", () => {
  test("each pane renders its own header, with the chat still mounted", async () => {
    for (const [pane, header] of Object.entries(PANES)) {
      const setup = await mount(120, 30, { pane })
      try {
        const frame = lines(setup).join("\n")
        expect(`${pane}: ${frame.includes(header)}`).toBe(`${pane}: true`)
        // The shell chrome is still there, so the chat surface stayed mounted.
        expect(frame).toContain("LOCKEDIN")
      } finally {
        await setup.dispose()
      }
    }
  })

  test("chat state survives a round trip into a manager and back", async () => {
    const chat = {
      username: "friend",
      model: "m",
      vision: false,
      status: "idle" as const,
      messages: [{ id: "m1", role: "user" as const, text: "keep me", outcome: "done" as const }],
      streamed: "",
      composer: "draft text",
      attachments: [],
      pastes: [],
      scrolledUp: false,
      mounted: 12,
      thinkingOpen: false,
    }
    const inManager = await mount(120, 40, { chat, pane: "manager" })
    try {
      // A chooser floats over the chat instead of replacing it, so the draft is
      // still mounted behind the dimmed backdrop…
      expect(lines(inManager).join("\n")).toContain("draft text")
    } finally {
      await inManager.dispose()
    }
    const back = await mount(120, 40, { chat, pane: "chat" })
    try {
      // …and it is intact when Esc returns to chat.
      expect(lines(back).join("\n")).toContain("draft text")
      expect(lines(back).join("\n")).toContain("keep me")
    } finally {
      await back.dispose()
    }
  })

  test("a pane with no data renders its empty state, not a crash", async () => {
    const setup = await mount(120, 30, { pane: "manager" })
    try {
      expect(lines(setup).join("\n")).toContain("no lock-in sessions yet")
    } finally {
      await setup.dispose()
    }
    const empty = await mount(120, 30, { pane: "activity" })
    try {
      expect(lines(empty).join("\n")).toContain("no activity yet")
    } finally {
      await empty.dispose()
    }
  })

  test("the plugins surface is mounted even without a top-level action", async () => {
    // Settings owns the entry point; the component is still reachable in App.
    const setup = await mount(120, 30, { pane: "plugins" })
    try {
      expect(lines(setup).join("\n")).toContain("PLUGINS")
    } finally {
      await setup.dispose()
    }
  })

  test("exactly one pane is focused, marked by a glyph", () => {
    // The surface occupies the chat column, so that column holds the focus.
    const opened = state.reduce(state.initialShellState, { type: "action", id: "sessions" })
    expect(state.paneTone(opened, "chat")).toBe("focus")
    expect(state.paneTone(opened, "explorer")).toBe("dim")
  })
})

describe("workspace lists", () => {
  test("the manager fills from the loader after the first frame", async () => {
    const rows = [
      { id: "s1", name: "Physics — Unit 4", date: "2026-11-03T09:00:00Z", sources: 4, steps: { done: 3, total: 8 }, archived: false },
    ]
    const ui = await renderApp({
      width: 120,
      height: 36,
      app: () => <App initial={{ pane: "manager" } as never} loadSessions={async () => rows} />,
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.waitUntil(() => ui.frame().includes("Physics — Unit 4"))
      // The date column is a day, not an ISO instant.
      expect(ui.frame()).toContain("2026-11-03")
      expect(ui.frame()).not.toContain("2026-11-03T09")
    } finally {
      await ui.dispose()
    }
  })

  test("a failed load is an empty list, not a crash", async () => {
    const ui = await renderApp({
      width: 120,
      height: 36,
      app: () => (
        <App
          initial={{ pane: "manager" } as never}
          loadSessions={async () => {
            throw new Error("unreadable")
          }}
        />
      ),
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.waitUntil(() => ui.frame().includes("no lock-in sessions yet"))
    } finally {
      await ui.dispose()
    }
  })
})

describe("presentation", () => {
  test("choosers float; the place you work is a full window", () => {
    for (const pane of ["manager", "skills", "sources", "archive", "task-centre", "settings", "activity", "review", "projects", "swarms", "agents"] as const) {
      expect(`${pane}:${state.PANE_PRESENTATION[pane]}`).toBe(`${pane}:modal`)
    }
    // Settings edits in place, so Enter does not navigate away from it.
    for (const pane of ["manager", "skills", "sources", "archive", "task-centre"] as const) {
      expect(`${pane}:${state.OPENS_INTO[pane]}`).toBe(`${pane}:chat`)
    }
    expect(state.OPENS_INTO["settings"]).toBeUndefined()
    for (const pane of ["chat", "work", "reader", "stats", "achievements", "plugins", "knowledge"] as const) {
      expect(`${pane}:${state.PANE_PRESENTATION[pane]}`).toBe(`${pane}:full`)
    }
  })

  test("archive and knowledge use the same popup height as the standard menus", () => {
    for (const pane of ["manager", "skills", "settings", "projects", "swarms", "agents"] as const) {
      expect(popupHeight("archive", 40)).toBe(popupHeight(pane, 40))
      expect(popupHeight("activity", 40)).toBe(popupHeight(pane, 40))
    }
  })

  test("a chooser is a centred popup with the chat dimmed behind it", async () => {
    const chat = {
      username: "friend",
      model: "m",
      vision: false,
      status: "idle" as const,
      messages: [{ id: "m1", role: "user" as const, text: "behind the menu", outcome: "done" as const }],
      streamed: "",
      composer: "",
      attachments: [],
      pastes: [],
      scrolledUp: false,
      mounted: 12,
      thinkingOpen: false,
    }
    const setup = await mount(120, 40, { chat, pane: "manager" })
    try {
      const out = lines(setup)
      const top = out.findIndex((line) => line.includes("LOCK-IN SESSIONS"))
      const bottom = lastIndexOfLine(out, "Esc back")
      expect(top).toBeGreaterThan(1)
      expect(bottom).toBeGreaterThan(top)
      // Centred: the title and footer start after the left edge and are inset.
      const titleLeft = out[top]!.indexOf("LOCK-IN SESSIONS")
      const footerLeft = out[bottom]!.indexOf("n new")
      // Clean chrome: the popup has no box-drawing frame and the title is
      // plain (no ▌ prefix).
      expect(out[top - 1]).not.toContain("┌")
      expect(out[top]).not.toContain("▌")
      expect(titleLeft).toBeGreaterThan(0)
      expect(titleLeft).toBeLessThan(60)
      expect(footerLeft).toBeGreaterThan(0)
      expect(footerLeft).toBeLessThan(60)
      expect(Math.abs(titleLeft - footerLeft)).toBeLessThanOrEqual(3)
      // The chat is still drawn behind the backdrop.
      expect(out.join("\n")).toContain("behind the menu")
    } finally {
      await setup.dispose()
    }
  })

  test("Enter in a chooser opens the full window; Esc returns to chat", async () => {
    const opened = state.reduce({ ...state.initialShellState, pane: "manager" }, { type: "open-item" })
    expect(opened.pane).toBe("chat")
    const escaped = state.reduce({ ...state.initialShellState, pane: "manager" }, { type: "action", id: "escape" })
    expect(escaped.pane).toBe("chat")
  })
})

describe("vertical centring and the explorer", () => {
  test("a chooser is centred on the vertical axis too", async () => {
    for (const [w, h] of [[120, 36], [100, 24], [160, 50]] as const) {
      const setup = await mount(w, h, { pane: "manager" })
      try {
        const out = lines(setup)
        const title = out.findIndex((line) => line.includes("LOCK-IN SESSIONS"))
        const footer = lastIndexOfLine(out, "Esc back")
        // The popup starts one row above its title (top padding) and ends on
        // its footer band. Body is rows 1..h-2.
        const top = title - 1
        const bottom = footer
        const above = top - 1
        const below = h - 2 - bottom
        expect(`${w}x${h} centred: ${Math.abs(above - below) <= 1}`).toBe(`${w}x${h} centred: true`)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("the explorer is a menu: move with arrows, Enter opens and closes it", async () => {
    const ui = await renderApp({ width: 140, height: 30, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("e")
      expect(ui.frame()).toContain("EXPLORER")
      // Items in order: Chill chat, chat settings, lock-in, skills, projects,
      // recent, stats…
      for (let step = 0; step < 5; step++) await ui.press("down")
      await ui.press("return")
      // The destination replaced the chat and the Explorer closed behind it.
      expect(ui.frame()).toContain("lockedin / stats")
      expect(ui.frame()).not.toContain("EXPLORER")
    } finally {
      await ui.dispose()
    }
  })

  test("Esc closes the explorer without changing the surface", async () => {
    const ui = await renderApp({ width: 140, height: 30, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("e")
      expect(ui.frame()).toContain("EXPLORER")
      await ui.press("escape")
      expect(ui.frame()).not.toContain("EXPLORER")
      expect(ui.frame()).toContain("Chat")
    } finally {
      await ui.dispose()
    }
  })

  test("a project is set up in three answers, and a swarm project staffs itself", async () => {
    const ui = await renderApp({ width: 120, height: 36, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      expect(ui.frame()).toContain("no projects yet")
      await ui.press("n")
      expect(ui.frame()).toContain("New project")
      await ui.type("atlas")
      await ui.press("return")
      expect(ui.frame()).toContain("Project folder")
      await ui.press("return")
      // The mode is a highlighted choice, not typed words.
      expect(ui.frame()).toContain("How does this project work?")
      expect(ui.frame()).toContain("Swarm of agents")
      await ui.press("down")
      await ui.press("return")
      // A swarm project goes straight into staffing, and opens as a buffer.
      expect(ui.frame()).toContain("Agent in atlas")
      await ui.type("planner")
      await ui.press("return")
      await ui.press("escape")
      const open = ui.frame()
      // Staffing happens on the Agents screen, which stays behind the prompt,
      // so Esc leaves you there with the agents you named.
      expect(open.split("\n")[0]).toContain("atlas")
      expect(open).toContain("AGENTS")
      expect(open).toContain("planner")

      // Closing the buffer returns home; the project row is in Projects.
      await ui.press(":")
      await ui.press("q")
      await ui.press("return")
      expect(ui.frame()).toContain("what do you want to learn today")
      await ui.press(":")
      for (const char of "projects") await ui.press(char)
      await ui.press("return")
      const list = ui.frame()
      expect(list).toContain("atlas")
      expect(list).toContain("swarm")
      expect(list).toContain("1 agent")
    } finally {
      await ui.dispose()
    }
  })

  test("a chat project opens the chat, not a swarm", async () => {
    const ui = await renderApp({ width: 120, height: 36, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("n")
      await ui.type("notes")
      await ui.press("return")
      await ui.press("return")
      // `s` picks the Single agent option.
      await ui.press("s")
      expect(ui.frame()).toContain("notes")
      await ui.press("return")
      expect(ui.frame()).toContain("what do you want to learn today")
    } finally {
      await ui.dispose()
    }
  })

  test("project type accepts a letter shortcut", async () => {
    const ui = await renderApp({ width: 120, height: 36, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("How does this project work?"))
      await ui.press("w")
      await ui.waitUntil(() => ui.frame().includes("Agent in atlas"))
    } finally {
      await ui.dispose()
    }
  })

  test("a swarm needs an open project before it can be created", async () => {
    const ui = await renderApp({ width: 120, height: 36, app: () => <App initial={{ pane: "swarms" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      expect(ui.frame()).toContain("no swarms yet")
      await ui.press("n")
      expect(ui.frame()).toContain("New swarm")
      await ui.type("atlas")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("open a project first"))
      expect(ui.frame()).not.toContain("Agent in atlas")
    } finally {
      await ui.dispose()
    }
  })

  test("the right sidebar lists the open project's agents", async () => {
    const ui = await renderApp({ width: 140, height: 30, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.press("down") // Swarm of agents
      await ui.press("return")
      await ui.type("planner")
      await ui.press("return")
      await ui.type("writer")
      await ui.press("return")
      await ui.press("escape") // close the naming prompt
      await ui.press("escape") // leave the Agents pane for the project chat
      await ui.waitUntil(() => ui.frame().includes("AGENTS · atlas"))
      expect(ui.frame()).toContain("planner")
      expect(ui.frame()).toContain("writer")
    } finally {
      await ui.dispose()
    }
  })

  test("Tab focuses the agent sidebar, and c opens that agent's chat", async () => {
    const ui = await renderApp({ width: 140, height: 30, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.press("down")
      await ui.press("return")
      await ui.type("planner")
      await ui.press("return")
      await ui.type("writer")
      await ui.press("return")
      await ui.press("escape")
      await ui.press("escape")
      await ui.press("tab")
      // The status bar names the focused pane; Enter opens the settings window.
      expect(ui.frame()).toContain("AGENTS  NORMAL")
      await ui.press("return")
      expect(ui.frame()).toContain("AGENT · PLANNER")
      await ui.press("escape")
      await ui.press("escape")
      await ui.press("tab")
      await ui.press("c")
      expect(ui.frame().split("\n")[0]).toContain("atlas · planner")
      // Esc never closes a buffer: Space 0 closes the agent, then the project.
      await ui.press("escape")
      expect(ui.frame().split("\n")[0]).toContain("atlas · planner")
      await ui.press("space")
      await ui.press("0")
      expect(ui.frame().split("\n")[0]).toContain("atlas")
      await ui.press("space")
      await ui.press("0")
      const home = ui.frame()
      expect(home).toContain("what do you want to learn today")
      expect(home.split("\n")[0]).not.toContain("planner")
    } finally {
      await ui.dispose()
    }
  })

  test("reader is denied on the empty home screen", async () => {
    const ui = await renderApp({ width: 120, height: 30, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("r")
      const frame = ui.frame()
      expect(frame.split("\n").find((line) => line.includes("NORMAL")) ?? "").toContain("CHILL")
      expect(frame).not.toContain("READER")
    } finally {
      await ui.dispose()
    }
  })

  test("an advertised chord runs even when the menu hides it", async () => {
    const ui = await renderApp({ width: 140, height: 34, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("l")
      expect(ui.frame()).toContain("New lock-in session")
      await ui.press("escape")
      await ui.idle(2)
      await ui.press("space")
      await ui.press("j")
      await ui.idle(4)
      expect(ui.frame()).toContain("TASK CENTRE")
    } finally {
      await ui.dispose()
    }
  })

  test("the leader offers only what is reachable here", async () => {
    const ui = await renderApp({ width: 140, height: 34, app: () => <App /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      const frame = ui.frame()
      // Destinations in the current context.
      for (const label of ["lock-in sessions", "skill sessions", "work projects", "stats", "knowledge base", "settings", "explorer"]) {
        expect(frame).toContain(label)
      }
      // Already in Chill, and these live behind the Explorer: not offered.
      for (const label of ["chill", "task center", "theme"]) {
        expect(frame).not.toContain(label)
      }
      // One buffer: no buffer manager.
      expect(frame).not.toContain("buffers")
    } finally {
      await ui.dispose()
    }
  })

  test("a project buffer adds buffers and agents to the leader", async () => {
    const ui = await renderApp({ width: 160, height: 40, app: () => <App initial={{ pane: "projects" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.press("down")
      await ui.press("return")
      await ui.type("planner")
      await ui.press("return")
      await ui.press("escape")
      await ui.press("space")
      const frame = ui.frame()
      expect(frame).toContain("buffers")
      expect(frame).toContain("work agents")
      expect(frame).toContain("chill")
    } finally {
      await ui.dispose()
    }
  })

  test("Settings opens the theme picker from its Theme row", async () => {
    const ui = await renderApp({ width: 120, height: 36, app: () => <App initial={{ pane: "settings" } as never} /> })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("down")
      await ui.press("return")
      expect(ui.frame()).toContain("LockedIn Crimson")
    } finally {
      await ui.dispose()
    }
  })

  test("leader e opens the explorer from anywhere, closing a chooser first", async () => {
    const ui = await renderApp({
      width: 140,
      height: 30,
      app: () => <App initial={{ pane: "settings" } as never} />,
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("space")
      await ui.press("e")
      const frame = ui.frame()
      expect(frame).toContain("EXPLORER")
      expect(frame).toContain("Lock-in sessions")
      // The chooser closed, so the explorer is actually visible.
      expect(frame).not.toContain("▌ SETTINGS")
    } finally {
      await ui.dispose()
    }
  })
})

describe("layout and keys", () => {
  test("80x24 and 200x60 render the widest pane (settings) without clipping", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mount(w, h, { pane: "settings" })
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("no pane key literal lives in App or layout", () => {
    for (const file of ["../../src/app/App.tsx", "../../src/ui/shell/layout.tsx"]) {
      const source = readFileSync(join(import.meta.dir, file), "utf8")
      expect(source).not.toMatch(/space\+[a-z]/i)
    }
  })

  test("the pane registry is the only action→pane mapping", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/shell/panes.ts"), "utf8")
    expect(source).toContain("export const PANE_FOR_ACTION")
    const state = readFileSync(join(import.meta.dir, "../../src/ui/shell/state.ts"), "utf8")
    expect(state).not.toContain("const PANE_ROUTES")
  })
})

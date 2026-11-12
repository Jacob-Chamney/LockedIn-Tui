/** The Explorer and Review queue read the lists loaded after the first frame. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")

const SESSIONS = [
  {
    id: "s1",
    name: "Physics unit 4",
    date: "2026-11-01T09:00:00Z",
    sources: 2,
    steps: { done: 1, total: 4 },
    archived: false,
  },
]
const GOALS = [
  {
    id: "g1",
    name: "learn cpp",
    stage: { done: 0, total: 3 },
    lastOpened: "",
    chats: 0,
    archived: false,
  },
]

describe("loaded lists reach the menus", () => {
  test("the Explorer has Recent, not individual sessions", async () => {
    const ui = await renderApp({
      width: 140,
      height: 34,
      app: () => (
        <App
          initial={{ explorer: true, focus: "explorer" } as never}
          loadSessions={async () => SESSIONS as never}
          loadGoals={async () => GOALS as never}
        />
      ),
    })
    try {
      await ui.waitFor("Recent")
      expect(ui.frame()).toContain("Recent")
      expect(ui.frame()).not.toContain("Physics unit 4")
    } finally {
      await ui.dispose()
    }
  })

  test("Recent lists session type and name for lock-in and skill sessions", async () => {
    const ui = await renderApp({
      width: 120,
      height: 30,
      app: () => (
        <App
          initial={{ pane: "recent" } as never}
          loadSessions={async () => SESSIONS as never}
          loadGoals={async () => GOALS as never}
        />
      ),
    })
    try {
      await ui.waitFor("lock-in · Physics unit 4")
      expect(ui.frame()).toContain("skill · learn cpp")
    } finally {
      await ui.dispose()
    }
  })

  test("the Review queue reads the loaded sessions", async () => {
    const ui = await renderApp({
      width: 120,
      height: 30,
      app: () => (
        <App
          initial={{ pane: "review" } as never}
          loadSessions={async () => SESSIONS as never}
          loadGoals={async () => [] as never}
        />
      ),
    })
    try {
      await ui.waitFor("Physics unit 4")
      expect(ui.frame()).toContain("3 of 4 steps to review")
    } finally {
      await ui.dispose()
    }
  })
})

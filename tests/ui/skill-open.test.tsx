/** Opening a skill session from the list puts its course in the reader. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")

const ROWS = [
  { id: "learn-cpp", name: "learn cpp", stage: { done: 0, total: 1 }, lastOpened: "", chats: 0, archived: false },
]

const COURSE = {
  schema: 1 as const,
  id: "learn-cpp",
  name: "learn cpp",
  goal: "learn cpp",
  prior: "",
  created: "",
  chapters: [
    { id: "ch-1", title: "Getting started", guide: "01-getting-started.md", practical: "01-getting-started-practical.md", done: false },
  ],
}

const WORKSPACE = { root: "/tmp/x", schema: 1, paths: { goals: "/tmp/x/goals" }, data: {} } as never

async function open(options: { course?: typeof COURSE | null; lesson?: string } = {}) {
  const course = options.course === undefined ? COURSE : options.course
  const lesson = options.lesson ?? "# Lesson: Getting started\n\nbody"
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={WORKSPACE}
        initial={{ pane: "skills" } as never}
        loadGoals={async () => ROWS as never}
        loadCourse={async () => course as never}
        readChapterText={async (_course, _id, practical) => ({
          ok: true,
          text: options.lesson === undefined && practical ? "# Practical: Getting started\n\nbody" : lesson,
        })}
      />
    ),
  })
  await ui.waitFor("LOCKEDIN")
  // Goals load after the first frame; wait for the row, not for a frame count.
  await ui.waitUntil(() => ui.frame().includes("learn cpp"))
  return ui
}

describe("opening a skill session", () => {
  test("Enter puts the course in the reader beside the chat", async () => {
    const ui = await open()
    try {
      expect(ui.frame()).toContain("learn cpp")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      const frame = ui.frame()
      expect(frame).toContain("Chapters")
      expect(frame).toContain("Getting started")
      // The chat stayed on the left.
      expect(frame).toContain("what do you want to learn today")
    } finally {
      await ui.dispose()
    }
  })

  test("the session is a buffer, and ␣ b switches it while staying open", async () => {
    const ui = await open()
    try {
      await ui.press("return")
      // Home plus the skill session: the manager exists now.
      await ui.waitUntil(() => ui.frame().split("\n")[0]!.includes("2/2"))
      await ui.press("space")
      await ui.press("b")
      await ui.idle(4)
      const menu = ui.frame()
      expect(menu).toContain("BUFFERS")
      expect(menu).toContain("Chill")
      expect(menu).toContain("learn cpp")
      expect(menu).toContain("current")

      // Enter on home switches behind the menu; the menu stays.
      await ui.press("return")
      await ui.idle(4)
      expect(ui.frame()).toContain("BUFFERS")

      // Back to the session, still in the menu, then Esc lands in its reader.
      await ui.press("j")
      await ui.press("return")
      await ui.idle(4)
      expect(ui.frame()).toContain("BUFFERS")
      await ui.press("escape")
      await ui.idle(4)
      const frame = ui.frame()
      expect(frame).not.toContain("BUFFERS")
      expect(frame).toContain("Chapters")
      expect(frame.split("\n")[0]).toContain("learn cpp")
    } finally {
      await ui.dispose()
    }
  })

  test("Esc backs out of a chapter and the reader, but never the buffer", async () => {
    const ui = await open()
    try {
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Lesson: Getting started"))
      const chapter = ui.frame()
      expect(chapter.split("\n")[0]).toContain("2/2")

      // 1: back to the chapter list.
      await ui.press("escape")
      await ui.idle(4)
      expect(ui.frame()).toContain("Chapters")
      expect(ui.frame().split("\n")[0]).toContain("learn cpp")

      // 2: the reader closes; the session's buffer is still current.
      await ui.press("escape")
      await ui.idle(4)
      expect(ui.frame()).not.toContain("Chapters")
      expect(ui.frame().split("\n")[0]).toContain("learn cpp")

      // 3: Esc does not close the buffer; Space 0 does.
      await ui.press("escape")
      await ui.idle(4)
      expect(ui.frame().split("\n")[0]).toContain("learn cpp")
      await ui.press("space")
      await ui.press("0")
      await ui.idle(4)
      const home = ui.frame()
      expect(home.split("\n")[0]).not.toContain("learn cpp")
      expect(home).toContain("what do you want to learn today")
    } finally {
      await ui.dispose()
    }
  })

  test("Tab swaps focus; j scrolls the reader while it has the keyboard", async () => {
    const long = ["# Lesson: Getting started", "", ...Array.from({ length: 60 }, (_, index) => `line ${index}`)].join("\n")
    const ui = await open({ lesson: long })
    try {
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Lesson: Getting started"))
      const status = () => ui.frame().split("\n").find((line) => line.includes("NORMAL")) ?? ""
      expect(ui.frame()).toContain("Getting started")
      expect(status()).toContain("READER")
      for (let step = 0; step < 20; step++) await ui.press("j")
      await ui.idle(4)
      expect(ui.frame()).not.toContain("Getting started")
      // Focus moves to the chat; the reader stays where it was.
      await ui.press("tab")
      await ui.idle(4)
      expect(status()).toContain("SKILLS")
      expect(ui.frame()).not.toContain("Getting started")
    } finally {
      await ui.dispose()
    }
  })

  test("Space r opens and closes the reader; Tab moves focus between it and chat", async () => {
    const ui = await open()
    try {
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      const status = () => ui.frame().split("\n").find((line) => line.includes("NORMAL")) ?? ""
      expect(ui.frame()).toContain("Chapters")
      expect(status()).toContain("READER")

      // Tab hands the keyboard to the chat; the reader stays visible.
      await ui.press("tab")
      await ui.idle(4)
      expect(ui.frame()).toContain("Chapters")
      expect(status()).toContain("SKILLS")
      await ui.press("tab")
      await ui.idle(4)
      expect(status()).toContain("READER")

      // The leader chord closes and reopens it, like the Explorer key.
      await ui.press("space")
      await ui.press("r")
      await ui.idle(4)
      expect(ui.frame()).not.toContain("Chapters")
      expect(status()).toContain("SKILLS")
      await ui.press("space")
      await ui.press("r")
      await ui.idle(4)
      expect(ui.frame()).toContain("Chapters")
      expect(status()).toContain("READER")
    } finally {
      await ui.dispose()
    }
  })

  test("the buffer menu owns j/k while a skill reader is behind it", async () => {
    const ui = await open()
    try {
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      await ui.press("space")
      await ui.press("b")
      await ui.idle(4)
      // Home is first; j must move the buffer cursor, not the chapter cursor.
      expect(ui.frame()).toContain("▌ Chill")
      await ui.press("j")
      await ui.idle(4)
      expect(ui.frame()).toContain("▌ learn cpp")
      await ui.press("return")
      await ui.idle(4)
      expect(ui.frame()).toContain("BUFFERS")
      await ui.press("escape")
      await ui.idle(4)
      expect(ui.frame()).toContain("Chapters")
    } finally {
      await ui.dispose()
    }
  })

  test("a goal with no course says so instead of opening an empty reader", async () => {
    const ui = await open({ course: null })
    try {
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("has no course yet"))
      const frame = ui.frame()
      expect(frame).toContain("has no course yet")
      expect(frame).toContain("Skill sessions")
    } finally {
      await ui.dispose()
    }
  })
})

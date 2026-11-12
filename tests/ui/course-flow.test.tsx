/** The skill-session flow: goal, optional prior knowledge, chapters. */
import { describe, expect, test } from "bun:test";
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")

async function open() {
  const base = await mkdtemp(join(tmpdir(), "course-ui-"))
  const made = await createWorkspace(join(base, "ws"))
  if (!made.ok) throw new Error("workspace")
  const ui = await renderApp({
    width: 200,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "skills" } as never}
        readChapterText={async (course, _id, practical) => ({
          ok: true,
          text: `# ${practical ? "Practical" : "Lesson"}: Getting started\n\n${course.goal}\n\n- [ ] a check`,
        })}
        saveChapterDone={async (course, id, done) => ({
          ok: true,
          course: {
            ...course,
            chapters: course.chapters.map((chapter) => (chapter.id === id ? { ...chapter, done } : chapter)),
          },
        })}
      />
    ),
  })
  await ui.waitFor("LOCKEDIN")
  return ui
}

describe("creating a skill session", () => {
  test("asks for the goal and an optional prior, then shows the chapters", async () => {
    const ui = await open()
    try {
      await ui.press("n")
      expect(ui.frame()).toContain("New skill session")
      await ui.type("learn cpp")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("What do you already know?"))
      // Skipping the prior knowledge is allowed: Enter with nothing.
      await ui.press("return")
      // The course opens in the reader pane beside the chat. (The creation
      // notice floats over the reader for its first seconds, so the chapter
      // title is asserted after it opens rather than here.)
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      expect(ui.frame()).toContain("learn cpp")
      expect(ui.frame()).toContain("what do you want to learn today")
    } finally {
      await ui.dispose()
    }
  })

  test("a chapter opens as a lesson, reads as markdown, and marks complete", async () => {
    const ui = await open()
    try {
      await ui.press("n")
      await ui.type("learn cpp")
      await ui.press("return")
      await ui.type("basic python")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Lesson: Getting started"))
      // The document carries its own kind in the H1; the pane does not label it.
      expect(ui.frame()).not.toContain("Lesson ·")
      await ui.press("c")
      await ui.waitUntil(() => ui.frame().includes("Getting started: complete"))
      await ui.press("p")
      await ui.waitUntil(() => ui.frame().includes("Practical: Getting started"))
      expect(ui.frame()).not.toContain("Practical ·")
      await ui.press("b")
      await ui.waitUntil(() => ui.frame().includes("Chapters"))
    } finally {
      await ui.dispose()
    }
  })
})

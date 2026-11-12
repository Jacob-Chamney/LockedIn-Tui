/** `:add-sources` gathers into a skill goal, not a new lock-in session. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createCourse } = await import("../../src/services/skills/course")

test("marking a file in the picker gathers it into the goal", async () => {
  const base = await mkdtemp(join(tmpdir(), "skills-gather-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const course = await createCourse({
    workspace: made.value,
    goal: "learn cpp",
    created: "2026-11-01T09:00:00Z",
  })
  if (!course.ok) throw new Error(course.error.message)
  await mkdir(made.value.paths.input, { recursive: true })
  await writeFile(join(made.value.paths.input, "notes.md"), "# Notes\n\nRegisters hold state.\n")

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} initial={{ pane: "skills" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("learn cpp"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Chapters"))
    await ui.press(":")
    for (const char of "add-sources") await ui.press(char)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SOURCES"))
    await ui.press("space")
    await ui.press("r")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("gathered 1 source"))

    const files = await readdir(join(made.value.paths.goals, course.value.id, "sources"))
    expect(files).toHaveLength(1)
    expect(ui.frame()).toContain("gathered 1 source")
  } finally {
    await ui.dispose()
  }
}, 30_000)

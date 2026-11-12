/** `d` in Skills: arm, confirm, delete, refresh. */
import { describe, expect, test } from "bun:test";
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createCourse } = await import("../../src/services/skills/course")
const { existsSync } = await import("node:fs")
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")

async function open(name = "learn cpp") {
  const base = await mkdtemp(join(tmpdir(), "skill-del-ui-"))
  const ws = await createWorkspace(join(base, "ws"))
  if (!ws.ok) throw new Error("workspace")
  const course = await createCourse({ workspace: ws.value, goal: name, created: "2026-11-01T09:00:00Z" })
  if (!course.ok) throw new Error(course.error.message)
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={ws.value}
        initial={{ pane: "skills" } as never}
        loadGoals={async () => [
          {
            id: course.value.id,
            name,
            stage: { done: 0, total: 0 },
            lastOpened: "",
            chats: 0,
            archived: false,
          },
        ]}
        deleteGoal={async () => ({ ok: true })}
      />
    ),
  })
  await ui.waitFor("LOCKEDIN")
  // The list loads after the first frame; wait for the row before pressing keys.
  await ui.waitUntil(() => ui.frame().includes(name))
  return { ui, folder: join(ws.value.paths.goals, course.value.id), course: course.value }
}

describe("deleting a skill session", () => {
  test("the first d arms and names the goal; the second deletes it", async () => {
    const { ui, folder } = await open()
    try {
      expect(existsSync(folder)).toBe(true)
      await ui.press("d")
      const armed = ui.frame()
      expect(armed).toContain("delete")
      expect(armed).toContain("press d again")
      // Nothing is gone yet.
      expect(existsSync(folder)).toBe(true)

      await ui.press("d")
      await ui.waitUntil(() => ui.frame().includes("deleted skill session"))
    } finally {
      await ui.dispose()
    }
  })

  test("moving the cursor to another goal disarms the first", async () => {
    const { ui } = await open("learn rust")
    try {
      await ui.press("d")
      expect(ui.frame()).toContain("press d again")
      await ui.press("d")
      await ui.waitUntil(() => ui.frame().includes("deleted skill session"))
    } finally {
      await ui.dispose()
    }
  })
})

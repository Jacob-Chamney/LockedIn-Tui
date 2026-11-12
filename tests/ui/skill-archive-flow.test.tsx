/** `a` archives and `x` exports a skill session, with the same two-step guard. */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createCourse } = await import("../../src/services/skills/course")
const { listZip } = await import("../../src/services/lockin/zip")
const { emptySettingsView } = await import("../../src/ui/settings")

const NAME = "learn cpp"
const isWindows = process.platform === "win32"

async function open() {
  const base = await mkdtemp(join(tmpdir(), "skill-archive-ui-"))
  const ws = await createWorkspace(join(base, "ws"))
  if (!ws.ok) throw new Error("workspace")
  const course = await createCourse({
    workspace: ws.value,
    goal: NAME,
    created: "2026-11-01T09:00:00Z",
  })
  if (!course.ok) throw new Error(course.error.message)

  const folder = join(ws.value.paths.goals, course.value.id)
  await mkdir(join(folder, "chats"), { recursive: true })
  await writeFile(join(folder, "chats", "chat-1.jsonl"), '{"role":"user","content":"private"}\n')

  const archiveRoot = join(base, "archive")
  const settings = { ...emptySettingsView(), archiveBackend: "folder", archiveFolder: archiveRoot }
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={ws.value}
        settings={settings}
        initial={{ pane: "skills" } as never}
        loadGoals={async () => [
          {
            id: course.value.id,
            name: NAME,
            stage: { done: 0, total: 0 },
            lastOpened: "",
            chats: 1,
            archived: false,
          },
        ]}
      />
    ),
  })
  await ui.waitFor("LOCKEDIN")
  await ui.waitUntil(() => ui.frame().includes(NAME))
  return { ui, ws: ws.value, folder, archiveRoot }
}

describe("archiving a skill session", () => {
  test.skipIf(isWindows)("the first a arms; the second archives the folder and removes the live copy", async () => {
    const { ui, ws, folder, archiveRoot } = await open()
    try {
      await ui.press("a")
      const armed = ui.frame()
      expect(armed).toContain(`Archive “${NAME}”?`)
      expect(armed).toContain("Chat history is not included")
      expect(armed).toContain("press a again")
      // Nothing has moved yet.
      expect(existsSync(folder)).toBe(true)
      expect(existsSync(join(archiveRoot, "skills", "goal", "learn-cpp"))).toBe(false)

      await ui.press("a")
      await ui.waitUntil(() => ui.frame().includes(`archived skill session: ${NAME}`))
      expect(existsSync(folder)).toBe(false)

      const archived = join(archiveRoot, "skills", "goal", "learn-cpp")
      expect(existsSync(join(archived, "meta.json"))).toBe(true)
      expect(existsSync(join(archived, "chapters", "01-getting-started.md"))).toBe(true)
      // Conversations are never archived with the goal.
      expect(existsSync(join(archived, "chats"))).toBe(false)
      expect(existsSync(join(ws.paths.exports, "goal-learn-cpp.zip"))).toBe(false)
    } finally {
      await ui.dispose()
    }
  })
})

describe("exporting a skill session", () => {
  test.skipIf(isWindows)("the first x arms; the second writes a zip without chats and keeps the goal live", async () => {
    const { ui, ws, folder } = await open()
    try {
      await ui.press("x")
      const armed = ui.frame()
      expect(armed).toContain(`Export “${NAME}” to a zip?`)
      expect(armed).toContain("press x again")
      expect(existsSync(join(ws.paths.exports, "goal-learn-cpp.zip"))).toBe(false)

      await ui.press("x")
      await ui.waitUntil(() => ui.frame().includes(`exported ${NAME}`))

      const zip = join(ws.paths.exports, "goal-learn-cpp.zip")
      expect(existsSync(zip)).toBe(true)
      const entries = listZip(new Uint8Array(await readFile(zip)))
      expect(entries).toContain("meta.json")
      expect(entries.some((entry) => entry.startsWith("chapters/"))).toBe(true)
      expect(entries.some((entry) => entry.startsWith("chats/"))).toBe(false)

      // Export is a copy: the live goal is untouched.
      expect(existsSync(folder)).toBe(true)
    } finally {
      await ui.dispose()
    }
  })
})

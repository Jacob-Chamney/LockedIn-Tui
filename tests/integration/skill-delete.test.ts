/** Deleting a skill session: confined, explicit, and honest about what goes. */
import { afterAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../../src/storage/workspace";
import { createCourse } from "../../src/services/skills/course";
import { deleteGoal, goalFolderFor } from "../../src/services/skills/delete";
const base = await mkdtemp(join(tmpdir(), "skill-delete-"))
afterAll(async () => {
  await removeTemp(base)
})

async function workspace(name: string) {
  const made = await createWorkspace(join(base, name))
  if (!made.ok) throw new Error("workspace")
  return made.value
}

describe("confine", () => {
  test("a goal id resolves inside the goals root", async () => {
    const ws = await workspace("ws1")
    const folder = goalFolderFor(ws, "learn-cpp")
    expect(folder.ok && folder.value).toBe(join(ws.paths.goals, "learn-cpp"))
  })

  test("an escaping id is refused", async () => {
    const ws = await workspace("ws2")
    for (const id of ["../secrets", "a/../../b", "", "."]) {
      const folder = goalFolderFor(ws, id)
      expect(`${id}:${folder.ok}`).toBe(`${id}:false`)
    }
    // An absolute-looking id is joined *under* the root, not taken literally.
    const rooted = goalFolderFor(ws, "/etc")
    expect(rooted.ok && rooted.value.startsWith(ws.paths.goals)).toBe(true)
  })
})

describe("delete", () => {
  test("an unconfirmed delete reports what would go and changes nothing", async () => {
    const ws = await workspace("ws3")
    const made = await createCourse({ workspace: ws, goal: "learn cpp", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const folder = join(ws.paths.goals, made.value.id)
    const probe = await deleteGoal({ workspace: ws, id: made.value.id, confirmed: false })
    expect(probe.ok && probe.value.deleted).toBe(false)
    expect(probe.ok && probe.value.entries).toContain("meta.json")
    expect(existsSync(folder)).toBe(true)
  })

  test("a confirmed delete removes the folder and the course inside it", async () => {
    const ws = await workspace("ws4")
    const made = await createCourse({ workspace: ws, goal: "learn rust", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const folder = join(ws.paths.goals, made.value.id)
    expect(existsSync(folder)).toBe(true)

    const done = await deleteGoal({ workspace: ws, id: made.value.id, confirmed: true })
    expect(done.ok && done.value.deleted).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  test("deleting something that is not there is a typed error", async () => {
    const ws = await workspace("ws5")
    await mkdir(ws.paths.goals, { recursive: true })
    await writeFile(join(ws.paths.goals, "keep.md"), "x")
    const missing = await deleteGoal({ workspace: ws, id: "nope", confirmed: true })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.kind).toBe("missing")
    // The probe file is untouched.
    expect(existsSync(join(ws.paths.goals, "keep.md"))).toBe(true)
  })
})

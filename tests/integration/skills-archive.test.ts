/**
 * Skill goals archive and export like lock-in sessions: a complete upload is
 * followed by removing the live folder; an incomplete one keeps it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFolderArchive } from "../../src/archive";
import type { ArchiveBackend, ArchiveRef } from "../../src/archive/types";
import { exportGoal, archiveGoal } from "../../src/services/skills/archive";
import { createCourse } from "../../src/services/skills/course";
import { listZip, readZip } from "../../src/services/lockin/zip";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

type Harness = {
  workspace: Workspace
  id: string
  folder: string
  archiveRoot: string
}

async function harness(label: string): Promise<Harness> {
  const base = await mkdtemp(join(TEMP_BASE, `lockedin-skill-${label}-`))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace could not be created")
  const workspace = made.value
  const course = await createCourse({
    workspace,
    goal: "Assembly basics",
    created: "2026-11-01T09:00:00Z",
  })
  if (!course.ok) throw new Error(course.error.message)
  const folder = join(workspace.paths.goals, course.value.id)

  // A conversation is the one thing an archive never carries.
  await mkdir(join(folder, "chats"), { recursive: true })
  await writeFile(join(folder, "chats", "chat-1.jsonl"), '{"role":"user","content":"private"}\n')
  await writeFile(join(folder, ".scratch"), "not part of the export\n")

  return { workspace, id: course.value.id, folder, archiveRoot: join(base, "archive") }
}

function fakeBackend(id: string, warnings: number): ArchiveBackend {
  return {
    id,
    ensureReady: async () => ({ ok: true, value: { root: "/archive", created: [] } }),
    put: async (ref: ArchiveRef) => ({
      ok: true,
      value: {
        ref,
        path: `/archive/${ref.side}/${ref.kind}/${ref.id}`,
        files: 3,
        bytes: 100,
        warnings: Array.from({ length: warnings }, (_, index) => ({
          code: "large-file",
          path: `big-${index}.pdf`,
          message: "skipped",
        })),
      },
    }),
  } as never
}

describe("exporting a skill goal", () => {
  test("writes a zip of the goal without chats or dotfiles, and leaves the goal live", async () => {
    const { workspace, id, folder } = await harness("export")
    const result = await exportGoal({ workspace, id })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toBe(join(workspace.paths.exports, `goal-${id}.zip`))

    const entries = listZip(new Uint8Array(await readFile(result.value)))
    expect(entries).toContain("meta.json")
    expect(entries.some((entry) => entry.startsWith("chapters/"))).toBe(true)
    expect(entries.some((entry) => entry.startsWith("chats/"))).toBe(false)
    expect(entries.some((entry) => entry.startsWith("."))).toBe(false)

    expect(existsSync(folder)).toBe(true)
    expect(existsSync(join(folder, "chats", "chat-1.jsonl"))).toBe(true)
  })

  test("a symlink in the goal is never followed into the export", async () => {
    if (process.platform === "win32") return // creating symlinks needs a privilege Windows may not grant
    const { workspace, id, folder } = await harness("export-symlink")
    const outside = join(folder, "..", "outside.txt")
    await writeFile(outside, "SECRET-OUTSIDE-GOAL\n")
    await symlink(outside, join(folder, "leak.txt"))

    const result = await exportGoal({ workspace, id })
    if (!result.ok) throw new Error(result.error.message)
    const entries = readZip(new Uint8Array(await readFile(result.value)))
    expect(Object.keys(entries)).not.toContain("leak.txt")
    const text = Object.values(entries)
      .map((bytes) => new TextDecoder().decode(bytes))
      .join("\n")
    expect(text).not.toContain("SECRET-OUTSIDE-GOAL")
  })

  test("a missing goal is a typed error", async () => {
    const { workspace } = await harness("export-missing")
    const result = await exportGoal({ workspace, id: "absent" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected an error")
    expect(result.error.message.length).toBeGreaterThan(0)
  })
})

describe("archiving a skill goal", () => {
  test("a folder upload removes the live goal once every file was archived", async () => {
    const { workspace, id, folder, archiveRoot } = await harness("folder")
    const opened = openFolderArchive({ archiveRoot, workspaceRoot: workspace.root })
    if (!opened.ok) throw new Error(opened.error.message)

    const result = await archiveGoal({ workspace, id, backend: opened.value })
    if (!result.ok) throw new Error(result.error.message)

    const archived = join(archiveRoot, "skills", "goal", id)
    expect(result.value).toBe(archived)
    expect(existsSync(folder)).toBe(false)
    expect(existsSync(join(archived, "meta.json"))).toBe(true)
    expect(existsSync(join(archived, "chats"))).toBe(false)
    expect(existsSync(join(archived, ".scratch"))).toBe(false)
  })

  test("a GitHub-style backend is backend-agnostic and also removes the live goal", async () => {
    const { workspace, id, folder } = await harness("github")
    const result = await archiveGoal({ workspace, id, backend: fakeBackend("github", 0) })
    expect(result.ok).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  test("a partial upload keeps the live goal and reports why", async () => {
    const { workspace, id, folder } = await harness("partial")
    const result = await archiveGoal({ workspace, id, backend: fakeBackend("folder", 2) })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected an error")
    expect(result.error.kind).toBe("archive")
    expect(result.error.message).toContain("incomplete")
    expect(existsSync(folder)).toBe(true)
    expect(await readdir(folder)).toContain("chats")
  })
})

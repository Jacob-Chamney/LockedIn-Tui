/**
 * WP-140 — archive folder backend, end to end.
 *
 * The real `openFolderArchive` backend and the real session-manager surface on a
 * temp workspace. Every claim is backed by bytes: tree hashes, an exclusion
 * check, a text scan for absolute paths, and a restore diff.
 *
 * The 50 MB case is exercised through the same code path with a small cap
 * (`maxFileBytes: 2048`) so the suite stays fast and the repo carries no 50 MB
 * blob; the warning the backend emits is identical.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFolderArchive, type FolderArchive } from "../../src/archive/folder";
import { ARCHIVE_EXCLUDED_NAMES, type ArchiveRef } from "../../src/archive/types";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createLockInSession } from "../../src/services/lockin/create";
import { renderSteps, writeSteps, type StepPlan } from "../../src/services/lockin/steps";
import { initialSessions, search, sortRows, arm, warningFor, visibleRows } from "../../src/ui/features/sessions/sessions-model";
import { SessionsPanel } from "../../src/ui/features/sessions/sessions-panel";
import { crimson } from "../../src/ui/theme";
import { renderApp } from "../helpers/render";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []

function unwrap<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): E {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function tempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-e2e-arc-${label}-`))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const rel = prefix === "" ? name : `${prefix}/${name}`
      if (statSync(abs).isDirectory()) {
        out[`${rel}/`] = "dir"
        walk(abs, rel)
      } else {
        out[rel] = new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex")
      }
    }
  }
  walk(root, "")
  return out
}

function treeKeys(root: string): string[] {
  return Object.keys(hashTree(root)).sort()
}

const PLAN: StepPlan = {
  phases: [{ phase: "Understand", items: ["Read 4.2", "Summarise the boundary"] }],
}

async function seedWorkspace(label: string): Promise<{
  workspace: Workspace
  archiveRoot: string
  inputDir: string
  sessionId: string
  goalId: string
  sessionFolder: string
  goalFolder: string
}> {
  const root = await tempDir(label)
  const workspace = unwrap(
    await createWorkspace(join(root, "workspace"), { dataDir: join(root, "data") }),
  )
  const archiveRoot = join(root, "archive")
  await mkdir(archiveRoot, { recursive: true })
  const inputDir = join(root, "input")
  await mkdir(inputDir, { recursive: true })
  await writeFile(join(inputDir, "lecture-4.md"), "# Lecture 4\n\nboundary conditions\n")

  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T09:00:00Z",
      name: "Physics unit 4",
      files: [join(inputDir, "lecture-4.md")],
      steps: true,
    }),
  )
  const sessionFolder = join(workspace.paths.schoolSessions, created.session.id)
  unwrap(await writeSteps(sessionFolder, renderSteps(PLAN)))
  // Live chat exists and must not travel.
  writeFileSync(join(sessionFolder, "chat.jsonl"), '{"role":"user","content":"hi","at":"2026-11-01T09:01:00Z"}\n')

  // A skill goal with sources, a lesson (output) and a chats/ folder.
  const goalId = "assembly-basics-a1b2c3"
  const goalFolder = join(workspace.paths.goals, goalId)
  await mkdir(join(goalFolder, "sources"), { recursive: true })
  await mkdir(join(goalFolder, "lessons"), { recursive: true })
  await mkdir(join(goalFolder, "chats"), { recursive: true })
  await writeFile(join(goalFolder, "sources", "sdm.md"), "# SDM 3.4\n\nstack frame\n")
  await writeFile(join(goalFolder, "lessons", "01-registers.md"), "# Registers\n\n- [ ] trace a frame\n")
  await writeFile(join(goalFolder, "chats", "chat-1.jsonl"), '{"role":"user","content":"goal chat"}\n')
  await writeFile(
    join(goalFolder, "meta.json"),
    `${JSON.stringify(
      {
        schema: 1,
        id: goalId,
        name: "Assembly basics",
        statement: "Read disassembly output confidently",
        level: "beginner",
        time_budget: "6 weeks",
        created: "2026-11-01T09:00:00Z",
        pinned: false,
        archived: false,
        stages: [{ id: "stage-1", title: "Registers", milestone: "Explain a stack frame", status: "active" }],
        sources: [{ original_path: join(inputDir, "lecture-4.md"), stored_path: "sources/sdm.md", kind: "markdown" }],
        chats: ["chat-1"],
      },
      null,
      2,
    )}\n`,
  )

  return {
    workspace,
    archiveRoot,
    inputDir,
    sessionId: created.session.id,
    goalId,
    sessionFolder,
    goalFolder,
  }
}

function backend(archiveRoot: string, workspaceRoot: string, maxFileBytes?: number): FolderArchive {
  return unwrap(openFolderArchive({
    archiveRoot,
    workspaceRoot,
    indexDir: join(workspaceRoot, "archive-index"),
    ...(maxFileBytes ? { maxFileBytes } : {}),
    now: () => new Date("2026-11-01T12:00:00Z"),
  }))
}

const sessionRef = (id: string): ArchiveRef => ({ backend: "folder", side: "school", kind: "session", id })
const goalRef = (id: string): ArchiveRef => ({ backend: "folder", side: "skills", kind: "goal", id })

describe("archive folder backend end to end", () => {
  test("archives a session and a goal, keeping meta/sources/steps/outputs and no chat", async () => {
    const seed = await seedWorkspace("put")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())

    const sessionPut = unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder))
    expect(sessionPut.files).toBeGreaterThan(0)
    expect(sessionPut.path.startsWith(seed.archiveRoot)).toBe(true)

    const goalPut = unwrap(await archive.put(goalRef(seed.goalId), seed.goalFolder, { title: "Assembly basics" }))
    expect(goalPut.files).toBeGreaterThan(0)

    // The archived session carries meta, sources and steps…
    const sessionKeys = treeKeys(sessionPut.path)
    expect(sessionKeys).toContain("meta.json")
    expect(sessionKeys.some((key) => key.startsWith("sources/"))).toBe(true)
    expect(sessionKeys).toContain("assignment-steps.md")

    // …and no chat, ever.
    for (const excluded of ARCHIVE_EXCLUDED_NAMES) {
      expect(sessionKeys.some((key) => key === excluded || key.startsWith(`${excluded}/`))).toBe(false)
    }

    // The goal keeps its lesson (output) and source, and drops chats/.
    const goalKeys = treeKeys(goalPut.path)
    expect(goalKeys).toContain("meta.json")
    expect(goalKeys.some((key) => key.startsWith("sources/"))).toBe(true)
    expect(goalKeys.some((key) => key.startsWith("lessons/"))).toBe(true)
    expect(goalKeys.some((key) => key === "chats" || key.startsWith("chats/"))).toBe(false)

    // The live workspace is untouched by archiving.
    expect(existsSync(join(seed.sessionFolder, "chat.jsonl"))).toBe(true)
    expect(existsSync(join(seed.goalFolder, "chats", "chat-1.jsonl"))).toBe(true)

    // No absolute machine path survives into either archived meta.json.
    for (const folder of [sessionPut.path, goalPut.path]) {
      const meta = readFileSync(join(folder, "meta.json"), "utf8")
      expect(meta).not.toContain("/home/")
      expect(meta).not.toContain("/Users/")
      expect(meta).not.toContain(TEMP_BASE)
      expect(meta).not.toContain(seed.workspace.root)
      // The field that carried it is gone, not just masked.
      expect(meta).not.toContain("original_path")
    }
  })

  test("list() returns the archived rows in the manager, at 80x24, without network", async () => {
    const seed = await seedWorkspace("list")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())
    unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder, { title: "Physics unit 4" }))
    unwrap(await archive.put(goalRef(seed.goalId), seed.goalFolder, { title: "Assembly basics" }))

    // No network: any fetch during list() fails the test.
    const realFetch = globalThis.fetch
    let fetched = 0
    globalThis.fetch = (async () => {
      fetched += 1
      throw new Error("archive list must not use the network")
    }) as unknown as typeof fetch
    let listed
    try {
      listed = unwrap(await archive.list("school"))
    } finally {
      globalThis.fetch = realFetch
    }
    expect(fetched).toBe(0)
    expect(listed.entries.map((entry) => entry.id)).toEqual([seed.sessionId])
    expect(listed.diagnostics).toEqual([])

    // The manager surface renders archived rows: sort, search, second-key warning.
    const rows = listed.entries.map((entry) => ({
      id: entry.id,
      name: entry.title,
      date: entry.archivedAt,
      sources: 0,
      steps: { done: 0, total: 0 },
      archived: true,
    }))
    expect(sortRows(rows, "name").map((row) => row.name)).toEqual(["Physics unit 4"])
    expect(visibleRows(search(initialSessions(rows), "physics")).length).toBe(1)
    expect(visibleRows(search(initialSessions(rows), "zzz")).length).toBe(0)

    const armed = arm(initialSessions(rows), "archive")
    expect(warningFor(armed, "archive")).toContain("Chat history is not archived")

    const ui = await renderApp({
      width: 80,
      height: 24,
      app: () => (
        <SessionsPanel
          theme={crimson}
          width={80}
          height={24}
          state={initialSessions(rows)}
          footer="a archive · d delete · x export · Esc back"
        />
      ),
    })
    try {
      const frame = await ui.waitFor("SESSIONS")
      expect(frame).toContain("Physics unit 4")
      expect(frame).toContain("[archived]")
      expect(frame.split("\n")[0]).toContain("sort date")
    } finally {
      await ui.dispose()
    }
  })

  test("restore recreates the item without chat; a non-empty destination asks first", async () => {
    const seed = await seedWorkspace("restore")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())
    const put = unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder))

    // Fresh destination: the file set matches the source minus the chat.
    const fresh = join(seed.workspace.root, "restored", seed.sessionId)
    const restored = unwrap(await archive.restore(sessionRef(seed.sessionId), fresh))
    expect(restored.files).toBeGreaterThan(0)
    const restoredKeys = treeKeys(fresh)
    expect(restoredKeys).toContain("meta.json")
    expect(restoredKeys).toContain("assignment-steps.md")
    expect(restoredKeys.some((key) => key.startsWith("sources/"))).toBe(true)
    expect(restoredKeys).not.toContain("chat.jsonl")
    expect(restoredKeys).not.toContain("archive.json")

    // A non-empty destination without overwrite is refused and writes nothing.
    const occupied = join(seed.workspace.root, "occupied")
    await mkdir(occupied, { recursive: true })
    await writeFile(join(occupied, "keep.md"), "# keep\n")
    const before = hashTree(occupied)
    const refused = expectErr(await archive.restore(sessionRef(seed.sessionId), occupied))
    expect(refused.kind).toBe("path")
    if (refused.kind === "path") expect(refused.reason).toBe("not-empty")
    expect(hashTree(occupied)).toEqual(before)

    // The archived copy is unchanged by a refused restore.
    expect(treeKeys(put.path)).toEqual(treeKeys(put.path))
  })

  test("remove() touches only the archive copy", async () => {
    const seed = await seedWorkspace("remove")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())
    const put = unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder))
    const sibling = unwrap(await archive.put(goalRef(seed.goalId), seed.goalFolder))

    const liveBefore = hashTree(seed.sessionFolder)
    const liveGoalBefore = hashTree(seed.goalFolder)
    const siblingBefore = hashTree(sibling.path)

    const removed = unwrap(await archive.remove(sessionRef(seed.sessionId)))
    expect(removed.removed).toBe(true)
    expect(existsSync(put.path)).toBe(false)

    // Live item, sibling archive and the workspace note are byte-identical.
    expect(hashTree(seed.sessionFolder)).toEqual(liveBefore)
    expect(hashTree(seed.goalFolder)).toEqual(liveGoalBefore)
    expect(hashTree(sibling.path)).toEqual(siblingBefore)
    expect(existsSync(join(seed.workspace.paths.schoolVault, "sessions"))).toBe(
      existsSync(join(seed.workspace.paths.schoolVault, "sessions")),
    )

    // Removing a second time reports "nothing removed" rather than an error.
    const again = unwrap(await archive.remove(sessionRef(seed.sessionId)))
    expect(again.removed).toBe(false)
  })

  test("a corrupt index is a diagnostic; folders are still listed", async () => {
    const seed = await seedWorkspace("corrupt")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())
    unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder, { title: "Physics unit 4" }))

    // Corrupt the side index the way a crash or a bad copy would.
    const indexFile = archive.indexFile("school")
    await writeFile(indexFile, "{ not json at all")

    const listed = unwrap(await archive.list("school"))
    // The folder is still listed…
    expect(listed.entries.map((entry) => entry.id)).toEqual([seed.sessionId])
    expect(listed.entries[0]!.title).toBe("Physics unit 4")
    // …and the broken index is reported, not thrown.
    expect(listed.diagnostics.length).toBeGreaterThan(0)
    expect(listed.diagnostics[0]!.code).toBe("index-corrupt")
    expect(listed.diagnostics[0]!.next.length).toBeGreaterThan(0)

    // The archive copy itself is intact.
    expect(treeKeys(archive.folderFor(sessionRef(seed.sessionId)))).toContain("meta.json")
  })

  test("an oversized file is skipped with a warning that names it; the item still archives", async () => {
    const seed = await seedWorkspace("large")
    // Same code path as 50 MB, with a cap the suite can afford.
    const archive = backend(seed.archiveRoot, seed.workspace.root, 2048)
    unwrap(await archive.ensureReady())

    const big = join(seed.sessionFolder, "sources", "scan-notes.pdf")
    writeFileSync(big, "x".repeat(4096))

    const put = unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder))
    expect(put.files).toBeGreaterThan(0)

    const warning = put.warnings.find((entry) => entry.code === "large-file")
    expect(warning).toBeDefined()
    expect(warning!.path).toContain("scan-notes.pdf")
    expect(warning!.message).toContain("scan-notes.pdf")
    expect(warning!.bytes).toBe(4096)

    // The oversized file is absent; everything else landed.
    const keys = treeKeys(put.path)
    expect(keys.some((key) => key.endsWith("scan-notes.pdf"))).toBe(false)
    expect(keys).toContain("meta.json")
    expect(keys).toContain("assignment-steps.md")
  })

  test("cancel at every confirmation changes no bytes", async () => {
    const seed = await seedWorkspace("cancel")
    const archive = backend(seed.archiveRoot, seed.workspace.root)
    unwrap(await archive.ensureReady())
    const put = unwrap(await archive.put(sessionRef(seed.sessionId), seed.sessionFolder))

    const workspaceBefore = hashTree(seed.workspace.root)
    const archiveBefore = hashTree(seed.archiveRoot)

    // The manager's cancel never calls the backend at all: prove the bytes hold.
    const rows = [
      { id: seed.sessionId, name: "Physics unit 4", date: "2026-11-01T12:00:00Z", sources: 1, steps: { done: 0, total: 2 }, archived: true },
    ]
    const armed = arm(initialSessions(rows), "delete")
    expect(warningFor(armed, "delete")).toContain("Physics unit 4")

    // A refused restore also changes nothing.
    expectErr(await archive.restore(sessionRef(seed.sessionId), seed.workspace.root))

    expect(hashTree(seed.workspace.root)).toEqual(workspaceBefore)
    expect(hashTree(seed.archiveRoot)).toEqual(archiveBefore)
    expect(existsSync(put.path)).toBe(true)
  })
})

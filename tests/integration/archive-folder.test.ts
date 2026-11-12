/**
 * WP-128 — folder archive backend.
 *
 * Acceptance from `swarm/packets/WP-128.md`: put/list/restore/remove
 * round-trip, the source folder is byte-identical afterwards, a corrupt index
 * still lists folders, cross-side paths are refused, an overwrite needs an
 * explicit flag, and an oversized file is never copied without a warning.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFolderArchive, type ArchiveError, type ArchiveRef, type FolderArchive } from "../../src/archive";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const FIXTURES = join(import.meta.dir, "..", "fixtures", "archive")
const SESSION_ID = "2026-11-01-1430-physics-unit-4"
const GOAL_ID = "assembly-basics-a1b2c3"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, ArchiveError>): ArchiveError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

type Harness = {
  workspace: Workspace
  archive: FolderArchive
  archiveRoot: string
  sessionSource: string
  goalSource: string
}

async function harness(label: string, maxFileBytes?: number): Promise<Harness> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-arch-${label}-`))
  cleanup.push(parent)
  const workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  const archiveRoot = join(parent, "archive")
  const sessionSource = join(workspace.paths.schoolSessions, SESSION_ID)
  await cp(join(FIXTURES, "session"), sessionSource, { recursive: true })
  const goalSource = join(workspace.paths.goals, GOAL_ID)
  await cp(join(FIXTURES, "goal"), goalSource, { recursive: true })

  const archive = unwrap(
    openFolderArchive({
      archiveRoot,
      workspaceRoot: workspace.paths.root,
      maxFileBytes,
      now: () => new Date("2026-12-01T00:00:00Z"),
    }),
  )
  unwrap(await archive.ensureReady())
  return { workspace, archive, archiveRoot, sessionSource, goalSource }
}

function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = join(current, entry.name)
      if (entry.isDirectory()) walk(abs, rel)
      else out.set(rel, new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex"))
    }
  }
  walk(dir, "")
  return out
}

function tree(dir: string): string[] {
  return [...hashTree(dir).keys()].sort()
}

const sessionRef = (extra: Partial<ArchiveRef> = {}): ArchiveRef => ({
  side: "school",
  id: SESSION_ID,
  backend: "folder",
  ...extra,
})

const goalRef = (extra: Partial<ArchiveRef> = {}): ArchiveRef => ({
  side: "skills",
  id: GOAL_ID,
  backend: "folder",
  kind: "goal",
  ...extra,
})

/* -------------------------------------------------------------------------- */

describe("archive folder backend", () => {
  test("put, list, restore and remove round-trip", async () => {
    const { archive, archiveRoot, sessionSource } = await harness("roundtrip")
    const before = hashTree(sessionSource)

    const put = unwrap(await archive.put(sessionRef(), sessionSource))
    expect(put.path).toBe(join(archiveRoot, "school", "session", SESSION_ID))
    expect(put.files).toBeGreaterThan(0)

    // layout + manifest + index
    expect(tree(put.path)).toContain("meta.json")
    expect(existsSync(join(put.path, "archive.json"))).toBe(true)
    expect(existsSync(join(archiveRoot, "..", "workspace", "archive-index", "school.json"))).toBe(true)

    const listed = unwrap(await archive.list("school"))
    expect(listed.diagnostics).toEqual([])
    expect(listed.entries.map((entry) => entry.id)).toEqual([SESSION_ID])
    const entry = listed.entries[0]!
    expect(entry.kind).toBe("session")
    expect(entry.title).toBe("Physics — Unit 4")
    expect(entry.archivedAt).toBe("2026-12-01T00:00:00.000Z")
    expect(entry.sizeBytes).toBe(put.bytes)

    // the source is byte-identical: archiving copies, it never moves
    expect(hashTree(sessionSource)).toEqual(before)

    // restore into a fresh folder
    const destination = join(archiveRoot, "..", "restored", SESSION_ID)
    const restored = unwrap(await archive.restore(sessionRef(), destination))
    expect(restored.files).toBe(put.files)
    // the manifest describes the archived copy; a restored item is just payload
    const payload = tree(put.path).filter((entry) => entry !== "archive.json")
    expect(tree(destination)).toEqual(payload)

    // remove deletes the archived copy only
    const removed = unwrap(await archive.remove(sessionRef()))
    expect(removed.removed).toBe(true)
    expect(existsSync(put.path)).toBe(false)
    expect(hashTree(sessionSource)).toEqual(before)
    expect(unwrap(await archive.list("school")).entries).toEqual([])

    // removing again is a no-op, not an error
    expect(unwrap(await archive.remove(sessionRef())).removed).toBe(false)
  })

  test("chat history, config and absolute paths never reach the archive", async () => {
    const { archive, sessionSource, goalSource } = await harness("excludes")

    const session = unwrap(await archive.put(sessionRef(), sessionSource))
    const archivedFiles = tree(session.path)
    expect(archivedFiles).not.toContain("chat.jsonl")
    expect(archivedFiles).toContain("prompt.md")
    expect(archivedFiles).toContain("sources/lecture-4.md")

    const archivedMeta = JSON.parse(readFileSync(join(session.path, "meta.json"), "utf8"))
    expect(JSON.stringify(archivedMeta)).not.toContain("/fixture/input/lecture-4.md")
    expect(archivedMeta.sources[0].stored_path).toBe("sources/lecture-4.md")
    expect(archivedMeta.sources[0].original_path).toBeUndefined()

    // the live meta.json still has its informational path
    expect(readFileSync(join(sessionSource, "meta.json"), "utf8")).toContain("/fixture/input/lecture-4.md")

    // goals keep their chats out too
    const goal = unwrap(await archive.put(goalRef(), goalSource))
    const goalFiles = tree(goal.path)
    expect(goalFiles).not.toContain("chats/chat-1.jsonl")
    expect(goalFiles).toContain("curriculum.md")

    // config and data-dir counters are never copied
    writeFileSync(join(sessionSource, "config.toml"), "[ui]\nusername = \"x\"\n", "utf8")
    unwrap(await archive.put(sessionRef(), sessionSource))
    expect(tree(join(session.path))).not.toContain("config.toml")
  })

  test("put replaces an existing archive atomically", async () => {
    const { archive, archiveRoot, sessionSource } = await harness("replace")

    unwrap(await archive.put(sessionRef(), sessionSource))
    writeFileSync(join(sessionSource, "prompt.md"), "Second prompt.\n", "utf8")
    const second = unwrap(await archive.put(sessionRef(), sessionSource))

    expect(readFileSync(join(second.path, "prompt.md"), "utf8")).toBe("Second prompt.\n")
    // only the two item folders may exist: no temp or backup folders left behind
    const kinds = readdirSync(join(archiveRoot, "school", "session")).sort()
    expect(kinds).toEqual([SESSION_ID])
    expect(readdirSync(join(archiveRoot, "school"))).not.toContain("session.tmp")
  })

  test("a corrupt index shows a diagnostic and still lists folders", async () => {
    const { archive, workspace, sessionSource } = await harness("corrupt-index")
    unwrap(await archive.put(sessionRef(), sessionSource))

    const indexPath = join(workspace.paths.root, "archive-index", "school.json")
    writeFileSync(indexPath, "{ this is not json", "utf8")

    const listed = unwrap(await archive.list("school"))
    expect(listed.entries.map((entry) => entry.id)).toEqual([SESSION_ID])
    expect(listed.diagnostics.map((d) => d.code)).toEqual(["index-corrupt"])
    expect(listed.diagnostics[0]?.next.length).toBeGreaterThan(0)

    // a missing index is normal, not a diagnostic
    await rm(indexPath, { force: true })
    const again = unwrap(await archive.list("school"))
    expect(again.entries).toHaveLength(1)
    expect(again.diagnostics).toEqual([])
  })

  test("restore refuses a non-empty destination unless explicit", async () => {
    const { archive, archiveRoot, sessionSource } = await harness("overwrite")
    unwrap(await archive.put(sessionRef(), sessionSource))

    const destination = join(archiveRoot, "..", "restore-target")
    mkdirSync(destination, { recursive: true })
    writeFileSync(join(destination, "keep.txt"), "user file\n", "utf8")

    const refused = expectErr(await archive.restore(sessionRef(), destination))
    expect(refused.kind).toBe("path")
    if (refused.kind === "path") expect(refused.reason).toBe("not-empty")
    expect(readFileSync(join(destination, "keep.txt"), "utf8")).toBe("user file\n")

    const allowed = unwrap(await archive.restore(sessionRef(), destination, { overwrite: true }))
    expect(allowed.path).toBe(destination)
    expect(existsSync(join(destination, "prompt.md"))).toBe(true)
    expect(existsSync(join(destination, "keep.txt"))).toBe(false)
  })

  test("cross-side, escaping and inside-archive refs are refused", async () => {
    const { archive, archiveRoot, sessionSource, workspace } = await harness("refuse")
    unwrap(await archive.put(sessionRef(), sessionSource))

    const badSide = expectErr(
      await archive.put({ ...sessionRef(), side: "other" as "school" }, sessionSource),
    )
    expect(badSide.kind).toBe("path")

    for (const id of ["../escape", "a/b", "..", ".", ""]) {
      const error = expectErr(await archive.put(sessionRef({ id }), sessionSource))
      expect(error.kind).toBe("path")
      if (error.kind === "path") expect(error.reason).toBe("invalid-id")
    }

    // the source must be inside the workspace
    const outside = join(archiveRoot, "..", "outside-source")
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, "x.md"), "x\n", "utf8")
    const escape = expectErr(await archive.put(sessionRef(), outside))
    expect(escape.kind).toBe("path")
    if (escape.kind === "path") expect(escape.reason).toBe("escape")

    // restoring into the archive folder itself is refused
    const inside = expectErr(
      await archive.restore(sessionRef(), join(archiveRoot, "school", "session", "copy"), {
        overwrite: true,
      }),
    )
    if (inside.kind === "path") expect(inside.reason).toBe("inside-archive")

    // a missing archived item is a typed error, not a crash
    const missing = expectErr(await archive.restore(sessionRef({ id: "nope" }), join(workspace.root, "x")))
    if (missing.kind === "path") expect(missing.reason).toBe("missing")
  })

  test("side folders stay separate", async () => {
    const { archive, archiveRoot, sessionSource, goalSource } = await harness("sides")

    unwrap(await archive.put(sessionRef(), sessionSource))
    unwrap(await archive.put(goalRef(), goalSource))

    expect(existsSync(join(archiveRoot, "school", "session", SESSION_ID))).toBe(true)
    expect(existsSync(join(archiveRoot, "skills", "goal", GOAL_ID))).toBe(true)

    const school = unwrap(await archive.list("school"))
    const skills = unwrap(await archive.list("skills"))
    expect(school.entries.map((entry) => entry.id)).toEqual([SESSION_ID])
    expect(skills.entries.map((entry) => entry.id)).toEqual([GOAL_ID])
    expect(skills.entries[0]?.tags).toEqual(["assembly", "systems"])
  })

  test("a file over the size cap is skipped with a warning", async () => {
    const { archive, sessionSource } = await harness("large", 64)
    writeFileSync(join(sessionSource, "huge.bin"), "x".repeat(200), "utf8")

    const put = unwrap(await archive.put(sessionRef(), sessionSource))
    expect(put.warnings.map((warning) => warning.code)).toContain("large-file")
    // The fixture's steps file may also exceed this deliberately tiny cap, and
    // directory order differs by platform, so name the warning we mean.
    const warning = put.warnings.find(
      (entry) => entry.code === "large-file" && entry.path === "huge.bin",
    )
    expect(warning?.bytes).toBe(200)
    expect(warning?.message).toContain("skipped")

    // skipped, not silently copied
    expect(tree(put.path)).not.toContain("huge.bin")
    // and the source keeps it
    expect(existsSync(join(sessionSource, "huge.bin"))).toBe(true)
  })

  test.skipIf(isWindows)("a special file is skipped instead of blocking the archive", async () => {
    const { archive, sessionSource } = await harness("special")
    const pipe = join(sessionSource, "pipe")
    const made = Bun.spawnSync({ cmd: ["mkfifo", pipe], stdout: "pipe", stderr: "pipe" })
    expect(made.exitCode).toBe(0)

    const put = unwrap(await archive.put(sessionRef(), sessionSource))

    expect(put.warnings.map((warning) => warning.code)).toContain("special-file")
    expect(tree(put.path)).not.toContain("pipe")
  })

  test.skipIf(isWindows)("a symlink inside the source is skipped, never followed", async () => {
    const { archive, sessionSource, archiveRoot } = await harness("symlink")
    const outside = join(archiveRoot, "..", "secret.md")
    writeFileSync(outside, "secret\n", "utf8")
    const { symlinkSync } = await import("node:fs")
    symlinkSync(outside, join(sessionSource, "linked.md"))

    const put = unwrap(await archive.put(sessionRef(), sessionSource))
    expect(put.warnings.map((warning) => warning.code)).toContain("symlink")
    expect(tree(put.path)).not.toContain("linked.md")
  })
})

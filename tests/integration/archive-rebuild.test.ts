/**
 * WP-152 — archive index rebuild.
 *
 * The index is a cache: these tests delete or corrupt it and prove the repair
 * path the diagnostics promise, without ever reading or writing the live vault.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { removeTemp } from "../helpers/cleanup"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { chmod, cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { rebuildIndex } from "../../src/archive/index-rebuild"
import { openFolderArchive } from "../../src/archive"
import type { ArchiveError } from "../../src/archive"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import type { Result } from "../../src/domain/markdown"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE_ARCHIVE = join(import.meta.dir, "..", "fixtures", "archive-rebuild", "archive")
const SESSION_FIXTURE = join(import.meta.dir, "..", "fixtures", "archive-github", "session")
const ID = "2026-11-02-0900-chem-bonding"
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    try {
      chmodSync(dir, 0o700)
    } catch {
      // already gone
    }
    await removeTemp(dir)
  }
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

async function harness(label: string) {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-rebuild-${label}-`))
  cleanup.push(parent)
  const workspace: Workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  const archiveRoot = join(parent, "archive")
  await cp(FIXTURE_ARCHIVE, archiveRoot, { recursive: true })
  const source = join(workspace.paths.schoolSessions, ID)
  await cp(SESSION_FIXTURE, source, { recursive: true })
  const folder = unwrap(
    openFolderArchive({ archiveRoot, workspaceRoot: workspace.paths.root }),
  )
  const options = { archiveRoot, indexDir: join(workspace.paths.root, "archive-index") }
  return { workspace, folder, source, options, archiveRoot }
}

function indexPath(workspace: Workspace): string {
  return join(workspace.paths.root, "archive-index", "school.json")
}

function treeHash(dir: string): string {
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true })
      .flatMap((entry) => {
        const abs = join(current, entry.name)
        if (entry.name.startsWith(".")) return []
        return entry.isDirectory()
          ? walk(abs)
          : [`${abs}:${new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex")}`]
      })
      .sort()
  return new Bun.CryptoHasher("sha256").update(walk(dir).join("\n")).digest("hex")
}

describe("archive index rebuild", () => {
  test("a deleted index is rebuilt from folders alone", async () => {
    const { folder, source, options } = await harness("deleted")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))
    // remove the index file entirely
    await rm(join(options.indexDir, "school.json"), { force: true })

    const rebuilt = unwrap(await rebuildIndex(options, "school"))
    expect(rebuilt.entries).toBe(2) // the fixture item + the pushed one
    expect(rebuilt.diagnostics).toEqual([])
    expect(existsSync(rebuilt.path)).toBe(true)

    const listed = unwrap(await folder.list("school"))
    expect(listed.entries.map((entry) => entry.id).sort()).toEqual([ID, "2026-09-01-0800-fixture"].sort())
    expect(listed.diagnostics).toEqual([])
  })

  test("a corrupt index is rebuilt and the result lists", async () => {
    const { folder, source, workspace, options } = await harness("corrupt")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))
    mkdirSync(options.indexDir, { recursive: true })
    writeFileSync(indexPath(workspace), "{ not json at all", "utf8")

    const rebuilt = unwrap(await rebuildIndex(options, "school"))
    expect(rebuilt.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["index-corrupt"])
    expect(JSON.parse(readFileSync(indexPath(workspace), "utf8")).entries.length).toBe(2)

    // and the list() contract holds after a rebuild
    expect(unwrap(await folder.list("school")).diagnostics).toEqual([])
  })

  test("an unidentified folder is reported and not indexed", async () => {
    const { folder, options, archiveRoot } = await harness("unidentified")
    const junk = join(archiveRoot, "school", "session", "junk-item")
    mkdirSync(junk, { recursive: true })
    writeFileSync(join(junk, "random.txt"), "no metadata here\n", "utf8")

    const rebuilt = unwrap(await rebuildIndex(options, "school"))
    expect(rebuilt.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unreadable-folder"])
    expect(rebuilt.diagnostics[0]?.message).toContain("junk-item")

    const index = JSON.parse(readFileSync(rebuilt.path, "utf8"))
    expect(index.entries.map((entry: { id: string }) => entry.id)).not.toContain("junk-item")
    // the folder itself is untouched
    expect(readFileSync(join(junk, "random.txt"), "utf8")).toBe("no metadata here\n")
    void folder
  })

  test("two rebuilds are byte-identical", async () => {
    const { folder, source, workspace, options } = await harness("stable")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))

    unwrap(await rebuildIndex(options, "school"))
    const first = readFileSync(indexPath(workspace), "utf8")
    unwrap(await rebuildIndex(options, "school"))
    const second = readFileSync(indexPath(workspace), "utf8")

    expect(second).toBe(first)
    expect(first).toContain('"backend": "folder"')
    expect(readdirSync(options.indexDir).filter((name) => name.includes(".tmp-"))).toEqual([])
  })

  test("the live workspace is untouched", async () => {
    const { folder, source, workspace, options } = await harness("live")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))
    const before = treeHash(workspace.paths.schoolSessions)

    unwrap(await rebuildIndex(options, "school"))
    expect(treeHash(workspace.paths.schoolSessions)).toBe(before)
  })

  test("a github entry is preserved, never guessed", async () => {
    const { options, workspace } = await harness("preserve")
    mkdirSync(options.indexDir, { recursive: true })
    writeFileSync(
      indexPath(workspace),
      `${JSON.stringify(
        {
          backends: ["github"],
          entries: [
            {
              id: "remote-only",
              kind: "session",
              title: "Remote only",
              tags: [],
              archivedAt: "2026-10-10T00:00:00.000Z",
              sizeBytes: 10,
              backend: "github",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const rebuilt = unwrap(await rebuildIndex(options, "school"))
    expect(rebuilt.preserved).toBe(1)
    const index = JSON.parse(readFileSync(indexPath(workspace), "utf8"))
    const remote = index.entries.find((entry: { id: string }) => entry.id === "remote-only")
    expect(remote.backend).toBe("github")
    expect(index.backends).toContain("github")
  })

  test("a failed write leaves the previous index in place", async () => {
    if (isRoot || isWindows) return
    const { folder, source, options, workspace } = await harness("atomic")
    unwrap(await folder.put({ side: "school", id: ID, backend: "folder" }, source))
    const before = readFileSync(indexPath(workspace), "utf8")

    await chmod(options.indexDir, 0o500)
    const failed = await rebuildIndex(options, "school")
    await chmod(options.indexDir, 0o700)

    expect(failed.ok).toBe(false)
    if (!failed.ok) expect((failed.error as ArchiveError).kind).toBe("index")
    expect(readFileSync(indexPath(workspace), "utf8")).toBe(before)
    expect(readdirSync(options.indexDir).filter((name) => name.includes(".tmp-"))).toEqual([])
  })
})

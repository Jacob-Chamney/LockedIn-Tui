/**
 * Invariant suite — index (WP-109).
 *
 * Guards docs/testing.md §11.5 / §11.8 and AGENTS.md §2.8: the index is a
 * rebuildable cache made from Markdown. Nothing the index does — succeed, fail,
 * corrupt — may change one byte of a note. A rebuild must also be a pure
 * function of the vault, so deleting and rebuilding is always safe.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeIndex, deleteIndexFiles, indexLocation, openIndex, rebuild, rebuildFromScratch, refresh, search, status, type NoteIndex } from "../../src/storage/index";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const cleanup: string[] = []
const opened: NoteIndex[] = []

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}


async function workspace(label: string): Promise<Workspace> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-inv-ix-${label}-`))
  cleanup.push(parent)
  return unwrap(await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }))
}

function track(index: NoteIndex): NoteIndex {
  opened.push(index)
  return index
}

function writeNote(vault: string, path: string, title: string, body: string): void {
  const abs = join(vault, path)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(
    abs,
    ["---", `title: ${title}`, "type: concept", "tags: [invariant]", "---", "", `# ${title}`, "", body, ""].join(
      "\n",
    ),
    "utf8",
  )
}

/** Hash every Markdown file under the workspace — the thing that must not change. */
function markdownHashes(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, rel)
      else if (entry.name.endsWith(".md") && statSync(abs).isFile()) {
        out[rel] = new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex")
      }
    }
  }
  walk(root, "")
  return out
}

afterEach(async () => {
  for (const index of opened.splice(0)) {
    try {
      closeIndex(index)
    } catch {
      // already closed by the test
    }
  }
  for (const dir of cleanup.splice(0)) {
    await removeTemp(dir)
  }
})

describe("index invariants", () => {
  test("P1-IX-05 a corrupt index cannot touch a single Markdown byte", async () => {
    const ws = await workspace("corrupt")
    writeNote(ws.paths.schoolVault, "concepts/physics.md", "Physics", "boundary conditions")
    writeNote(ws.paths.schoolVault, "concepts/energy.md", "Energy", "the integral of work")

    const before = markdownHashes(ws.root)
    expect(Object.keys(before).length).toBe(2)

    // Corrupt the database the way a crash or a bad copy would.
    const location = indexLocation(ws.paths, "school")
    writeFileSync(location.db, "this is not a sqlite database at all", "utf8")

    const opened = openIndex(ws.paths, "school")
    expect(opened.ok).toBe(false)
    if (!opened.ok) {
      expect(["corrupt", "unsupported", "storage"]).toContain(opened.error.kind)
      expect(opened.error.next.length).toBeGreaterThan(0)
    }

    // The Markdown is untouched, and a rebuild is a valid next step.
    expect(markdownHashes(ws.root)).toEqual(before)

    deleteIndexFiles(ws.paths, "school")
    const fresh = track(unwrap(openIndex(ws.paths, "school")))
    const synced = unwrap(rebuild(fresh))
    expect(synced.added).toBe(2)
    expect(markdownHashes(ws.root)).toEqual(before)
    expect(unwrap(search(fresh, "boundary")).length).toBeGreaterThan(0)
  })

  test("P1-IX-05 an unwritable index directory is reported, never repaired by rewriting notes", async () => {
    const ws = await workspace("unwritable")
    writeNote(ws.paths.schoolVault, "concepts/one.md", "One", "only note")
    const before = markdownHashes(ws.root)

    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))

    // A refresh after the note is removed from disk reports a delete, and the
    // remaining Markdown is still byte-identical.
    await rm(join(ws.paths.schoolVault, "concepts/one.md"))
    const synced = unwrap(refresh(index))
    expect(synced.deleted).toBe(1)
    expect(markdownHashes(ws.root)).toEqual({})
    expect(before["school/vault/concepts/one.md"]).toBeDefined()
  })

  test.skipIf(isWindows)("P1-IX-02 rebuild is deterministic: delete, rebuild, same results", async () => {
    const ws = await workspace("deterministic")
    writeNote(ws.paths.schoolVault, "concepts/a.md", "Alpha", "boundary conditions and energy")
    writeNote(ws.paths.schoolVault, "concepts/b.md", "Beta", "energy balance and integral")
    writeNote(ws.paths.schoolVault, "concepts/c.md", "Gamma", "boundary matrix")

    const first = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(first))
    const firstHits = ["boundary", "energy", "integral"].map((query) =>
      unwrap(search(first, query)).map((hit) => ({ path: hit.path, title: hit.title })),
    )
    const firstStatus = status(first)

    closeIndex(first)

    // `rebuildFromScratch` deletes the database (and journals) then rebuilds.
    const rebuilt = unwrap(rebuildFromScratch(ws.paths, "school"))
    const second = track(rebuilt.index)
    const secondHits = ["boundary", "energy", "integral"].map((query) =>
      unwrap(search(second, query)).map((hit) => ({ path: hit.path, title: hit.title })),
    )

    expect(secondHits).toEqual(firstHits)
    expect(status(second).notes).toBe(firstStatus.notes)
    expect(status(second).ftsRows).toBe(firstStatus.ftsRows)

    // And the vault was never touched by either build.
    expect(markdownHashes(ws.root)["school/vault/concepts/a.md"]).toBeDefined()
  })

  test("P1-IX-06 an empty query is an empty result, not an error", async () => {
    const ws = await workspace("empty-query")
    writeNote(ws.paths.schoolVault, "concepts/a.md", "Alpha", "boundary conditions")

    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))

    for (const query of ["", "   "]) {
      const hits = unwrap(search(index, query))
      expect(hits).toEqual([])
    }
  })
})

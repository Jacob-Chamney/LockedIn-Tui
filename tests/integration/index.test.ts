/**
 * WP-105 — note index (SQLite FTS5).
 *
 * One named test per row of `docs/testing.md` §11.5 (P1-IX-01 … P1-IX-06).
 * Every test builds its own vault in a temp workspace; nothing touches the real
 * home directory and no fixture can drift.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { utimesSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeIndex, deleteIndexFiles, dump, indexLocation, migrationVersion, needsRebuild, openIndex, rebuild, rebuildFromScratch, refresh, refreshAsync, search, snapshot, sqliteVersion, status, toFtsQuery, type Hit, type IndexError, type NoteIndex } from "../../src/storage/index";
import { INDEX_SCHEMA_VERSION } from "../../src/storage/migrations/index-schema";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const QUERIES = ["boundary", "energy", '"boundary energy"', "integr*", "u0012", "zzz-no-such-term"]

const cleanup: string[] = []
const open: NoteIndex[] = []

afterEach(async () => {
  for (const index of open.splice(0)) {
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

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, IndexError>): IndexError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function workspace(label: string): Promise<Workspace> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-ix-${label}-`))
  cleanup.push(parent)
  return unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
}

function track(index: NoteIndex): NoteIndex {
  open.push(index)
  return index
}

const TERMS = ["boundary", "energy", "integral", "matrix", "entropy", "voltage"] as const

type NoteInput = {
  path: string
  title: string
  term: string
  token: string
  extra?: string
  mtime?: number
}

/** Deterministic note body: shared vocabulary plus one unique token. */
function writeNote(vault: string, note: NoteInput): { path: string; mtime: number; size: number } {
  const abs = join(vault, note.path)
  mkdirSync(join(abs, ".."), { recursive: true })
  const body = [
    "---",
    `title: ${note.title}`,
    `type: ${note.path.startsWith("goals/") ? "goal" : "concept"}`,
    "tags: [fixture]",
    "---",
    "",
    `# ${note.title}`,
    "",
    "## Summary",
    "",
    `The ${note.term} interacts with the $\{note.term\} boundary under study.`,
    "",
    `Reference code ${note.token} identifies this note.`,
    note.extra ?? "",
    "",
  ].join("\n")
  writeFileSync(abs, body, "utf8")
  const seconds = note.mtime ?? 1_735_689_600
  utimesSync(abs, seconds, seconds)
  return { path: note.path, mtime: seconds * 1000, size: Buffer.byteLength(body, "utf8") }
}

function seed(vault: string, count: number): void {
  for (let i = 0; i < count; i++) {
    writeNote(vault, {
      path: `concepts/note-${String(i).padStart(4, "0")}.md`,
      title: `${TERMS[i % TERMS.length]} ${String(i).padStart(4, "0")}`,
      term: TERMS[i % TERMS.length] as string,
      token: `u${String(i).padStart(4, "0")}`,
      mtime: 1_735_689_600 + i * 60,
    })
  }
}

function hitsFor(index: NoteIndex, queries: string[] = QUERIES): Hit[][] {
  return queries.map((query) => unwrap(search(index, query, 5)))
}

function markdownHashes(workspace: Workspace): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, rel)
      else if (entry.name.endsWith(".md")) {
        out.set(rel, new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex"))
      }
    }
  }
  for (const side of [workspace.paths.schoolVault, workspace.paths.skillVault]) walk(side, side)
  return out
}

/* -------------------------------------------------------------------------- */
/* P1-IX-01                                                                    */
/* -------------------------------------------------------------------------- */

describe("note index", () => {
  test("FTS5 is available", async () => {
    const ws = await workspace("fts5")
    const index = track(unwrap(openIndex(ws.paths, "school")))

    const version = sqliteVersion(index.db)
    console.log(`  FTS5 index: SQLite ${version}, schema ${INDEX_SCHEMA_VERSION}`)
    expect(version).toMatch(/^\d+\.\d+/)
    expect(status(index).schemaVersion).toBe(INDEX_SCHEMA_VERSION)

    // the version table records the migration, and reopening does not reapply it
    expect(migrationVersion(index)).toBe(INDEX_SCHEMA_VERSION)
    const firstDump = dump(index)
    closeIndex(index)
    open.pop()

    const reopened = track(unwrap(openIndex(ws.paths, "school")))
    expect(migrationVersion(reopened)).toBe(INDEX_SCHEMA_VERSION)
    expect(dump(reopened)).toBe(firstDump)

    // one database per side, each in its own folder
    expect(indexLocation(ws.paths, "school").db).toBe(join(ws.paths.root, "school", "index.db"))
    expect(indexLocation(ws.paths, "skills").db).toBe(join(ws.paths.root, "skills", "index.db"))
  })

  /* ------------------------------------------------------------------------ */
  /* P1-IX-02                                                                 */
  /* ------------------------------------------------------------------------ */

  test.skipIf(isWindows)("rebuild is deterministic", async () => {
    const ws = await workspace("deterministic")
    seed(ws.paths.schoolVault, 40)

    const first = unwrap(rebuildFromScratch(ws.paths, "school"))
    track(first.index)
    expect(first.result.added).toBe(40)
    const firstHits = hitsFor(first.index)
    const firstDump = dump(first.index)

    // delete the database, rebuild, compare ordered results exactly
    closeIndex(first.index)
    open.pop()
    deleteIndexFiles(ws.paths, "school")
    expect(existsSync(indexLocation(ws.paths, "school").db)).toBe(false)

    const second = unwrap(rebuildFromScratch(ws.paths, "school"))
    track(second.index)

    expect(hitsFor(second.index)).toEqual(firstHits)
    expect(dump(second.index)).toBe(firstDump)

    // and a third rebuild with `rebuild()` on an existing file agrees too
    unwrap(rebuild(second.index))
    expect(hitsFor(second.index)).toEqual(firstHits)
    expect(dump(second.index)).toBe(firstDump)

    // every query returned something sensible, and ordering is score then path
    for (const hits of firstHits) {
      for (let i = 1; i < hits.length; i++) {
        const previous = hits[i - 1] as Hit
        const current = hits[i] as Hit
        const ordered = previous.score < current.score || (previous.score === current.score && previous.path <= current.path)
        expect(ordered).toBe(true)
      }
    }
  })

  /* ------------------------------------------------------------------------ */
  /* P1-IX-03                                                                 */
  /* ------------------------------------------------------------------------ */

  test("refreshAsync processes small batches and reports the same result", async () => {
    const ws = await workspace("async-refresh")
    writeNote(ws.paths.schoolVault, {
      path: "concepts/a.md",
      title: "First",
      term: "energy",
      token: "onlyone",
    })
    const index = track(unwrap(openIndex(ws.paths, "school")))
    expect(unwrap(refresh(index)).added).toBe(1)
    writeNote(ws.paths.schoolVault, {
      path: "concepts/b.md",
      title: "Second",
      term: "entropy",
      token: "onlytwo",
    })
    const result = await refreshAsync(index, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.added).toBe(1)
    expect(result.value.scanned).toBe(2)
    expect(status(index).notes).toBe(2)
  })

  test("incremental refresh touches only changed rows", async () => {
    const ws = await workspace("incremental")
    seed(ws.paths.schoolVault, 40)

    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))
    const before = snapshot(index)

    // 10 edited, 2 added, 1 deleted
    const changedIndexes = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]
    for (const i of changedIndexes) {
      writeNote(ws.paths.schoolVault, {
        path: `concepts/note-${String(i).padStart(4, "0")}.md`,
        title: `${TERMS[i % TERMS.length]} ${String(i).padStart(4, "0")}`,
        term: TERMS[i % TERMS.length] as string,
        token: `u${String(i).padStart(4, "0")}`,
        extra: `Revision amendmentmarker${i}.`,
        mtime: 1_800_000_000 + i,
      })
    }
    for (const i of [900, 901]) {
      writeNote(ws.paths.schoolVault, {
        path: `concepts/note-${String(i).padStart(4, "0")}.md`,
        title: `added ${i}`,
        term: "boundary",
        token: `u${String(i).padStart(4, "0")}`,
        mtime: 1_800_000_500,
      })
    }
    unlinkSync(join(ws.paths.schoolVault, "concepts/note-0033.md"))

    const result = unwrap(refresh(index))
    const after = snapshot(index)

    expect(result.scanned).toBe(41)
    expect(result.updated).toBe(10)
    expect(result.added).toBe(2)
    expect(result.deleted).toBe(1)
    expect(result.unchanged).toBe(29)
    expect(result.parsed).toBe(12)
    expect(result.ftsDeletes).toBe(11)
    expect(result.ftsInserts).toBe(12)

    // the exact rows that changed, proven by rowid + content digest
    const changedRows: string[] = []
    let untouched = 0
    for (const [path, previous] of before) {
      const current = after.get(path)
      if (!current) continue
      if (current.digest !== previous.digest) changedRows.push(path)
      if (current.rowid === previous.rowid && current.digest === previous.digest && current.mtime === previous.mtime) {
        untouched += 1
      }
    }
    const expected = changedIndexes.map((i) => `concepts/note-${String(i).padStart(4, "0")}.md`)
    expect(changedRows.sort()).toEqual(expected.sort())
    expect(untouched).toBe(29)

    // untouched rows keep their rowid, and the deleted note is gone
    for (const i of [0, 2, 3, 5]) {
      const path = `concepts/note-${String(i).padStart(4, "0")}.md`
      expect(after.get(path)?.rowid).toBe(before.get(path)?.rowid)
    }
    expect(after.has("concepts/note-0033.md")).toBe(false)
    expect(after.has("concepts/note-0900.md")).toBe(true)

    // and search reflects exactly that
    expect(unwrap(search(index, "u0033"))).toEqual([])
    expect(unwrap(search(index, "u0900")).map((hit) => hit.path)).toEqual(["concepts/note-0900.md"])
    expect(unwrap(search(index, "amendmentmarker*", 20))).toHaveLength(10)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-IX-04                                                                 */
  /* ------------------------------------------------------------------------ */

  test("cross-side link is recorded broken", async () => {
    const ws = await workspace("wall")
    writeNote(ws.paths.skillVault, {
      path: "goals/skills-only-note.md",
      title: "skills-only-note",
      term: "matrix",
      token: "skillstoken",
    })
    writeNote(ws.paths.schoolVault, {
      path: "concepts/bridge.md",
      title: "Bridge",
      term: "boundary",
      token: "schooltoken",
      extra: "See [[skills-only-note]] and [[sibling]] for more.",
    })
    writeNote(ws.paths.schoolVault, {
      path: "concepts/sibling.md",
      title: "Sibling",
      term: "entropy",
      token: "siblingtoken",
    })

    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))

    const links = index.db
      .query("SELECT to_path, broken FROM links WHERE from_path = ? ORDER BY to_path")
      .all("concepts/bridge.md") as Array<{ to_path: string; broken: number }>

    expect(links).toEqual([
      { to_path: "concepts/sibling.md", broken: 0 },
      { to_path: "skills-only-note", broken: 1 },
    ])
    expect(status(index).brokenLinks).toBe(1)

    // never followed: the other side's content is absent from this index
    expect(unwrap(search(index, "skillstoken"))).toEqual([])
    expect(
      index.db.query("SELECT count(*) AS c FROM notes WHERE body LIKE '%skillstoken%'").get(),
    ).toEqual({ c: 0 })

    // the skills index resolves its own note and knows nothing about school text
    const skillIndex = track(unwrap(openIndex(ws.paths, "skills")))
    unwrap(rebuild(skillIndex))
    expect(unwrap(search(skillIndex, "skillstoken")).map((hit) => hit.path)).toEqual([
      "goals/skills-only-note.md",
    ])
    expect(unwrap(search(skillIndex, "schooltoken"))).toEqual([])
  })

  /* ------------------------------------------------------------------------ */
  /* P1-IX-05                                                                 */
  /* ------------------------------------------------------------------------ */

  test.skipIf(isWindows)("index failure cannot touch Markdown", async () => {
    const ws = await workspace("failure")
    seed(ws.paths.schoolVault, 12)
    const before = markdownHashes(ws)

    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))
    closeIndex(index)
    open.pop()

    // corrupt the database file with garbage
    writeFileSync(indexLocation(ws.paths, "school").db, "not a database at all")
    const corrupt = expectErr(openIndex(ws.paths, "school"))
    expect(corrupt.kind).toBe("corrupt")
    expect(corrupt.next).toContain("Rebuild")
    expect(markdownHashes(ws)).toEqual(before)

    // a missing database is not an error: it opens empty and asks to be built
    deleteIndexFiles(ws.paths, "school")
    const fresh = track(unwrap(openIndex(ws.paths, "school")))
    expect(status(fresh).notes).toBe(0)
    expect(needsRebuild(fresh)).toBe(true)
    expect(unwrap(search(fresh, "boundary"))).toEqual([])
    expect(markdownHashes(ws)).toEqual(before)

    // recovering is one call, and Markdown is still untouched
    closeIndex(fresh)
    open.pop()
    const recovered = unwrap(rebuildFromScratch(ws.paths, "school"))
    track(recovered.index)
    expect(status(recovered.index).notes).toBe(12)
    expect(needsRebuild(recovered.index)).toBe(false)
    expect(markdownHashes(ws)).toEqual(before)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-IX-06                                                                 */
  /* ------------------------------------------------------------------------ */

  test("empty query is an empty result", async () => {
    const ws = await workspace("search")
    seed(ws.paths.schoolVault, 8)
    const index = track(unwrap(openIndex(ws.paths, "school")))
    unwrap(rebuild(index))

    expect(unwrap(search(index, ""))).toEqual([])
    expect(unwrap(search(index, "   "))).toEqual([])
    expect(unwrap(search(index, "zzz-no-such-term"))).toEqual([])
    expect(unwrap(search(index, "!!! ???"))).toEqual([])
    expect(unwrap(search(index, "boundary", 0))).toEqual([])

    const hits = unwrap(search(index, "u0003"))
    expect(hits).toHaveLength(1)
    const hit = hits[0] as Hit
    expect(hit.path).toBe("concepts/note-0003.md")
    expect(hit.title.length).toBeGreaterThan(0)
    expect(hit.snippet).toContain("[u0003]")
    expect(typeof hit.score).toBe("number")

    // equal scores order by path, so results are stable
    const tied = unwrap(search(index, "reference", 10))
    for (let i = 1; i < tied.length; i++) {
      const previous = tied[i - 1] as Hit
      const current = tied[i] as Hit
      if (previous.score === current.score) expect(previous.path <= current.path).toBe(true)
    }

    // the query sanitiser never emits bare FTS5 operators
    expect(toFtsQuery("boundary energy")).toBe('"boundary" "energy"')
    expect(toFtsQuery("integr*")).toBe('"integr"*')
    expect(toFtsQuery("zzz-no-such-term")).toBe('"zzz" "no" "such" "term"')
    expect(toFtsQuery('"boundary energy"')).toBe('"boundary energy"')
    expect(toFtsQuery("AND OR NOT")).toBe('"AND" "OR" "NOT"')
    // A quote at both ends with a stray quote inside is text, not syntax.
    expect(toFtsQuery('"a" xyz"')).toBe('"a" "xyz"')
    expect(unwrap(search(index, '"a" xyz"'))).toEqual([])
  })
})

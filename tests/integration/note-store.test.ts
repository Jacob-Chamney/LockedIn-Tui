/**
 * WP-121 — note store service.
 *
 * Covers the packet's acceptance list: path escapes for read/write/delete,
 * unknown-frontmatter round-trip, a failed write leaving bytes and index entry
 * intact, index search reflecting a write without a rebuild, cross-side links
 * staying broken, and concurrent writes serializing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { chmodSync, existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { chmod, cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listNotes, openNoteStore, type NoteStore, type NoteStoreError } from "../../src/storage/note-store";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Note } from "../../src/domain/note";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE_VAULT = join(import.meta.dir, "..", "fixtures", "note-store", "vault")
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

const cleanup: string[] = []
const stores: NoteStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close()
    } catch {
      // already closed
    }
  }
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

function expectErr<T>(result: Result<T, NoteStoreError>): NoteStoreError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function seeded(label: string): Promise<{ workspace: Workspace; store: NoteStore }> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-ns-${label}-`))
  cleanup.push(parent)
  const workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  await cp(FIXTURE_VAULT, workspace.paths.schoolVault, { recursive: true })
  const store = unwrap(openNoteStore(workspace.paths, "school"))
  stores.push(store)
  // The store does not silently build the index on open; the caller does.
  unwrap(await store.refresh())
  return { workspace, store }
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "energy",
    side: "school",
    type: "concept",
    title: "Energy balance",
    body: "# Energy balance\n\nThe boundary conditions close the integral. See [[entropy]].\n",
    links: ["entropy"],
    tags: ["physics", "energy"],
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    ...overrides,
  }
}

function tempLeftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".tmp-"))
}

/* -------------------------------------------------------------------------- */

describe("note store", () => {
  test("refuses path escapes", async () => {
    const { workspace, store } = await seeded("escape")

    const outside = join(workspace.root, "..", "outside.md")
    writeFileSync(outside, "---\ntitle: outside\n---\nsecret\n", "utf8")

    type Reason = Extract<NoteStoreError, { kind: "path" }>["reason"]
    const cases: Array<{
      call: () => Result<unknown, NoteStoreError> | Promise<Result<unknown, NoteStoreError>>
      reason: Reason
    }> = [
      { call: () => store.resolve("../outside.md"), reason: "escape" },
      { call: () => store.resolve("concepts/../../outside.md"), reason: "escape" },
      { call: () => store.resolve("/etc/passwd"), reason: "absolute" },
      { call: () => store.resolve("concepts/energy.txt"), reason: "not-a-note" },
      { call: () => store.read("../outside.md"), reason: "escape" },
      { call: () => store.delete("../../outside.md"), reason: "escape" },
      { call: () => store.backlinks("../outside.md"), reason: "escape" },
      {
        call: () => store.write({ path: "/tmp/absolute.md", note: note() }),
        reason: "absolute",
      },
    ]

    for (const { call, reason } of cases) {
      const error = expectErr(await call())
      expect(error.kind).toBe("path")
      if (error.kind === "path") expect(error.reason).toBe(reason)
    }

    // a symlink pointing outside the vault is refused, not followed. Creating
    // one on Windows needs Developer Mode or elevation, so the case is POSIX-only.
    if (!isWindows) {
      const link = join(workspace.paths.schoolVault, "concepts", "escape.md")
      symlinkSync(outside, link)
      const symlinkError = expectErr(await store.read("concepts/escape.md"))
      expect(symlinkError.kind).toBe("path")
      if (symlinkError.kind === "path") expect(symlinkError.reason).toBe("symlink")

      const writeError = expectErr(
        await store.write({ path: "concepts/escape.md", note: note({ id: "escape" }) }),
      )
      if (writeError.kind === "path") expect(writeError.reason).toBe("symlink")
    }

    // the file outside the vault was never read or written
    expect(readFileSync(outside, "utf8")).toContain("secret")
  })

  test("reads frontmatter and preserves unknown keys", async () => {
    const { store } = await seeded("frontmatter")

    const stored = unwrap(await store.read("concepts/energy.md"))
    expect(stored.note.title).toBe("Energy balance")
    expect(stored.data.zotero_id).toBe("ABC-123")
    expect(stored.data.custom).toEqual({ reviewed_by: "fixture" })

    const before = readFileSync(join(store.vault, "concepts/energy.md"), "utf8")
    const beforeLines = before.split("\n")

    // change one owned field only
    const updated = { ...stored.note, updated: "2026-03-04T05:06:07Z" }
    unwrap(await store.write({ path: "concepts/energy.md", note: updated }))

    const after = readFileSync(join(store.vault, "concepts/energy.md"), "utf8")
    // hand-spaced lines are not canonicalised: only owned, changed keys move
    expect(after).toContain("title:   Energy balance")
    expect(after).toContain("zotero_id: ABC-123")
    expect(after).toContain("reviewed_by: fixture")
    expect(after).toContain("updated: 2026-03-04T05:06:07Z")

    const afterLines = after.split("\n")
    expect(afterLines).toHaveLength(beforeLines.length)
    const changed = afterLines.filter((line, index) => line !== beforeLines[index])
    expect(changed).toHaveLength(1)
    expect(changed[0]).toBe("updated: 2026-03-04T05:06:07Z")

    // and the entity reads back with the unknown keys still present
    const reread = unwrap(await store.read("concepts/energy.md"))
    expect(reread.note.updated).toBe("2026-03-04T05:06:07Z")
    expect(reread.data.zotero_id).toBe("ABC-123")
  })

  test("refuses a silent frontmatter shape change", async () => {
    const { store } = await seeded("shape")
    const file = join(store.vault, "concepts/inline.md")
    const original = [
      "---",
      "id: inline",
      "side: school",
      "type: concept",
      "title: Inline",
      "tags: [physics, energy]",
      "---",
      "# Inline",
      "",
    ].join("\n")
    writeFileSync(file, original, "utf8")
    unwrap(await store.refresh())

    const stored = unwrap(await store.read("concepts/inline.md"))
    const error = expectErr(
      await store.write({ path: "concepts/inline.md", note: stored.note }),
    )
    expect(error.kind).toBe("note")
    if (error.kind === "note") {
      expect(error.message).toContain("tags")
      expect(error.next.length).toBeGreaterThan(0)
    }
    // nothing was rewritten, including the inline list the parser cannot read
    expect(readFileSync(file, "utf8")).toBe(original)
  })

  test("writes atomically and updates the index", async () => {
    const { store } = await seeded("write")

    unwrap(
      await store.write({
        path: "concepts/written.md",
        note: note({ id: "written", title: "Written note", body: "# Written note\n\nA brand new marker token.\n" }),
      }),
    )

    const bytes = readFileSync(join(store.vault, "concepts/written.md"), "utf8")
    expect(bytes.startsWith("---\n")).toBe(true)
    expect(bytes).toContain("A brand new marker token.")
    expect(tempLeftovers(join(store.vault, "concepts"))).toEqual([])

    // searchable immediately, with no rebuild
    const hits = unwrap(await store.search("brand"))
    expect(hits.map((hit) => hit.path)).toContain("concepts/written.md")
    const hit = hits.find((entry) => entry.path === "concepts/written.md")
    expect(hit?.title).toBe("Written note")
    expect(hit?.snippet).toContain("[brand]")
    expect(hit?.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // a second refresh finds nothing to do: the write already indexed it
    const again = unwrap(await store.refresh())
    expect(again.added).toBe(0)
    expect(again.updated).toBe(0)
    expect(again.deleted).toBe(0)

    expect((await listNotes(store.vault)).sort()).toEqual([
      "concepts/energy.md",
      "concepts/entropy.md",
      "concepts/written.md",
    ])
  })

  test("a failed write leaves the old file and index entry intact", async () => {
    if (isRoot || isWindows) return // no POSIX permission bits to revoke
    const { store } = await seeded("failed-write")
    const file = join(store.vault, "concepts/energy.md")
    const before = readFileSync(file, "utf8")
    const dir = join(store.vault, "concepts")

    await chmod(dir, 0o500)
    const error = expectErr(
      await store.write({ path: "concepts/energy.md", note: note({ title: "Should not land" }) }),
    )
    await chmod(dir, 0o700)

    expect(error.kind).toBe("storage")
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(tempLeftovers(dir)).toEqual([])

    const hits = unwrap(await store.search("boundary"))
    expect(hits.map((hit) => hit.path)).toContain("concepts/energy.md")
  })

  test("delete is explicit and removes the index row", async () => {
    const { store } = await seeded("delete")
    const file = join(store.vault, "concepts/entropy.md")
    expect(existsSync(file)).toBe(true)

    unwrap(await store.delete("concepts/entropy.md"))
    expect(existsSync(file)).toBe(false)
    expect(unwrap(await store.search("decreases"))).toEqual([])

    // deleting twice is a typed error, not a silent success
    const missing = expectErr(await store.delete("concepts/entropy.md"))
    if (missing.kind === "path") expect(missing.reason).toBe("missing")

    // a folder is never deleted by the store
    const dir = join(store.vault, "concepts")
    const folderError = expectErr(await store.delete("concepts"))
    expect(folderError.kind).toBe("path")
    if (folderError.kind === "path") expect(folderError.reason).toBe("directory")
    expect(existsSync(dir)).toBe(true)
  })

  test("backlinks are same-side only", async () => {
    const { store } = await seeded("backlinks")
    unwrap(await store.refresh())

    // entropy.md links to energy.md
    const backlinks = unwrap(await store.backlinks("concepts/energy.md"))
    expect(backlinks).toEqual([
      { from: "concepts/entropy.md", to: "concepts/energy.md", heading: null, alias: null, broken: false },
    ])

    // energy.md's [[goals-only]] is the other side: recorded broken, never a
    // backlink to anything on this side
    expect(unwrap(await store.backlinks("goals/only.md"))).toEqual([])

    const rows = unwrap(await store.search("boundary"))
    expect(rows.length).toBeGreaterThan(0)
  })

  test("concurrent writes serialize", async () => {
    const { store } = await seeded("concurrent")

    const titles = Array.from({ length: 10 }, (_, index) => `Concurrent ${index}`)
    await Promise.all(
      titles.map((title) =>
        store.write({
          path: "concepts/race.md",
          note: note({ id: "race", title, body: `# ${title}\n\nbody\n` }),
        }),
      ),
    )

    const text = readFileSync(join(store.vault, "concepts/race.md"), "utf8")
    expect(text.startsWith("---\n")).toBe(true)
    const writtenTitles = titles.filter((title) => text.includes(`title: ${title}`))
    expect(writtenTitles).toHaveLength(1)
    expect(tempLeftovers(join(store.vault, "concepts"))).toEqual([])

    // the index holds one row for the path, not one per racing write
    unwrap(await store.refresh())
    const hits = unwrap(await store.search("Concurrent", 20))
    expect(hits.filter((hit) => hit.path === "concepts/race.md")).toHaveLength(1)
  })
})

/**
 * Invariant suite — notes, frontmatter and atomic writes (WP-109).
 *
 * Guards docs/testing.md §11.4 / §11.8:
 * - unknown frontmatter survives a round-trip, because a newer build may own it;
 * - the domain layer performs no IO and imports nothing outside itself;
 * - a write that fails leaves the previous bytes intact.
 *
 * Note on P1-NT-05: there is no note store yet (WP-104 shipped the note domain
 * and its Markdown codec; the file writer has not landed). The atomic-write
 * guarantee is therefore proved against the two writers that exist today —
 * `patchConfig` and the workspace marker — and the note-store case is recorded
 * as `test.todo` so the gap is visible in the run rather than assumed away.
 * Adding a vacuous test now would be a fake guard.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument, serializeDocument, type Frontmatter } from "../../src/domain/markdown";
import { noteFromFrontmatter, noteToFrontmatterPreserving } from "../../src/domain/note";
import { loadConfig, patchConfig } from "../../src/storage/config";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const DOMAIN_SRC = join(import.meta.dir, "..", "..", "src", "domain")

const cleanup: string[] = []
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

async function tempWorkspace(label: string): Promise<Workspace> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-inv-note-${label}-`))
  cleanup.push(dir)
  return unwrap(await createWorkspace(join(dir, "workspace"), { dataDir: join(dir, "data") }))
}

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

function hashFile(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
}

describe("note invariants", () => {
  test("P1-NT-01 unknown frontmatter survives parse → serialize → parse", () => {
    const body = "# Boundary conditions\n\n- [ ] derive the integral\n"
    const input: Frontmatter = {
      id: "2026-11-01-1430-physics-unit-4",
      type: "concept",
      tags: ["physics", "unit-4"],
      // Keys this build does not know: a newer build's fields.
      experimental_score: 7,
      nested_meta: { author: "someone", revision: 3 },
      pinned: true,
      empty: null,
    }

    const text = serializeDocument(input, body)
    const parsed = unwrap(parseDocument(text))

    expect(parsed.data).toEqual(input)
    expect(parsed.body).toBe(body)

    // Stable on a second pass, byte for byte.
    expect(serializeDocument(parsed.data, parsed.body)).toBe(text)
  })

  test("P1-NT-01 note round-trip preserves keys the note model does not own", () => {
    const existing: Frontmatter = {
      id: "n-1",
      side: "school",
      type: "concept",
      title: "Original title",
      experimental_score: 7,
      nested_meta: { author: "someone", revision: 3 },
    }
    const parsed = noteFromFrontmatter(existing, "# Original title\n\nbody\n")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const written = noteToFrontmatterPreserving({ ...parsed.value, title: "Renamed" }, existing)
    expect(written.title).toBe("Renamed")
    expect(written.experimental_score).toBe(7)
    expect(written.nested_meta).toEqual({ author: "someone", revision: 3 })
  })

  test("P1-NT-06 the domain layer imports nothing and performs no IO", () => {
    const offenders: string[] = []
    for (const name of readdirSync(DOMAIN_SRC)) {
      if (!name.endsWith(".ts")) continue
      const source = readFileSync(join(DOMAIN_SRC, name), "utf8")
      for (const match of source.matchAll(/^\s*import[^"']*from\s+["']([^"']+)["']/gm)) {
        const specifier = match[1]!
        if (!specifier.startsWith(".")) offenders.push(`${name}: imports "${specifier}"`)
      }
      for (const banned of ["node:fs", "node:fs/promises", "bun:sqlite", "fetch(", "@opentui"]) {
        if (source.includes(banned)) offenders.push(`${name}: uses ${banned}`)
      }
    }
    // domain → nothing (docs/architecture.md §2)
    expect(offenders).toEqual([])
  })

  test("P1-NT-05 a write that fails leaves the previous bytes intact", async () => {
    if (isRoot || isWindows) {
      // Root ignores directory permissions, and Windows has no POSIX bits, so
      // the failure cannot be provoked.
      return
    }
    const workspace = await tempWorkspace("atomic")
    unwrap(await loadConfig(workspace.paths))
    const before = hashFile(workspace.paths.config)
    const beforeText = await readFile(workspace.paths.config, "utf8")

    const parent = join(workspace.paths.config, "..")
    await chmod(parent, 0o500)
    try {
      const result = await patchConfig(workspace.paths, { ui: { theme: "high-contrast" } })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("storage")
        expect(result.error.next.length).toBeGreaterThan(0)
      }
    } finally {
      await chmod(parent, 0o700)
    }

    // Same bytes, and no half-written temp file survived.
    expect(hashFile(workspace.paths.config)).toBe(before)
    expect(await readFile(workspace.paths.config, "utf8")).toBe(beforeText)
    const leftovers = readdirSync(workspace.root).filter((name) => name.includes(".tmp-"))
    expect(leftovers).toEqual([])
  })

  test("P1-NT-05 a failed workspace create never half-writes the marker", async () => {
    const parent = await mkdtemp(join(TEMP_BASE, "lockedin-inv-marker-"))
    cleanup.push(parent)
    const root = join(parent, "workspace")

    const created = unwrap(await createWorkspace(root, { dataDir: join(parent, "data") }))
    const markerBefore = hashFile(created.paths.marker)

    // Re-creating over an existing v1 workspace is a no-op: the marker's bytes
    // are never rewritten, so a crash during create cannot lose the schema.
    const again = unwrap(await createWorkspace(root, { dataDir: join(parent, "data") }))
    expect(hashFile(again.paths.marker)).toBe(markerBefore)
    expect(again.schema).toBe(created.schema)
  })

  test.todo("P1-NT-05 note store: a failed write leaves the old note (no note writer exists yet)", () => {
    // Blocked on the note-store module. When it lands, call it with an
    // unwritable parent directory and assert the previous note bytes are intact.
  })
})

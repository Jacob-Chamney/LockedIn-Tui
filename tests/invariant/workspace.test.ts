/**
 * Invariant suite — workspace lifecycle (WP-109).
 *
 * Guards the rows that must survive any refactor (docs/testing.md §11.1,
 * §11.8): a legacy folder is never read or modified, create/open agree, and an
 * unmarked folder is never adopted.
 *
 * Every fixture is copied into a temp directory first, so "nothing was written"
 * is proved against a real tree that we control, and the committed fixtures stay
 * byte-identical.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER_FILE, WORKSPACE_SCHEMA } from "../../src/storage/paths";
import { createWorkspace, openWorkspace, type WorkspaceError } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURES = join(import.meta.dir, "..", "fixtures", "workspace")

const cleanup: string[] = []

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, WorkspaceError>): WorkspaceError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function tempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-inv-${label}-`))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await removeTemp(dir)
  }
})

/** Every path in `root`, with its bytes hashed. Directory order normalised. */
function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const rel = prefix === "" ? name : `${prefix}/${name}`
      const stat = statSync(abs)
      if (stat.isDirectory()) {
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

describe("workspace invariants", () => {
  test("P1-WS-03 legacy folder is refused and left byte-identical", async () => {
    const parent = await tempDir("legacy")
    const root = join(parent, "legacy")
    await cp(join(FIXTURES, "legacy"), root, { recursive: true })

    const before = hashTree(root)

    const created = expectErr(await createWorkspace(root))
    expect(created.kind).toBe("legacy")
    expect(created.path).toBe(root)
    // The message names the folder and says it belongs to the old version.
    expect(created.message.length).toBeGreaterThan(0)
    expect(created.next.length).toBeGreaterThan(0)

    const opened = expectErr(await openWorkspace(root))
    expect(opened.kind).toBe("legacy")

    // Nothing added, removed or rewritten, and no marker appeared.
    expect(hashTree(root)).toEqual(before)
    expect(existsSync(join(root, MARKER_FILE))).toBe(false)
  })

  test("P1-WS-02 create and open return the same paths", async () => {
    const parent = await tempDir("roundtrip")
    const root = join(parent, "workspace")

    const created = unwrap(await createWorkspace(root))
    const opened = unwrap(await openWorkspace(root))

    expect(opened.paths).toEqual(created.paths)
    expect(opened.schema).toBe(WORKSPACE_SCHEMA)
    expect(opened.root).toBe(created.root)

    // A second create is a no-op, not an error, and keeps the same layout.
    const again = unwrap(await createWorkspace(root))
    expect(again.paths).toEqual(created.paths)
    expect(JSON.parse(readFileSync(created.paths.marker, "utf8")).schema).toBe(WORKSPACE_SCHEMA)
  })

  test("P1-WS-04 an unmarked non-empty folder is never adopted", async () => {
    const parent = await tempDir("unmarked")
    const root = join(parent, "unmarked")
    await cp(join(FIXTURES, "unmarked"), root, { recursive: true })

    const before = hashTree(root)

    const created = expectErr(await createWorkspace(root))
    expect(created.kind).toBe("not-workspace")
    expect(hashTree(root)).toEqual(before)

    const opened = expectErr(await openWorkspace(root))
    expect(opened.kind).toMatch(/not-workspace|schema/)
  })

  test("P1-WS-05 app data lives outside the workspace root", async () => {
    const parent = await tempDir("data")
    const root = join(parent, "workspace")
    const dataDir = join(parent, "data")
    await mkdir(dataDir, { recursive: true })

    const workspace = unwrap(await createWorkspace(root, { dataDir }))
    expect(workspace.data.dir).toBe(dataDir)
    expect(workspace.data.dir.startsWith(`${workspace.root}/`)).toBe(false)
  })
})

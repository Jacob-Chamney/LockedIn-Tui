/**
 * WP-101 — workspace paths and lifecycle.
 *
 * Every row of `docs/testing.md` §11.1 is covered by a named test:
 * P1-WS-01 … P1-WS-08. Fixtures are copied into a temp directory first, so the
 * committed fixtures stay byte-identical and "nothing was written" is provable.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { removeTemp } from "../helpers/cleanup"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs"
import { chmod, cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  CONFIG_FILE,
  LAYOUT_DIRS,
  MARKER_FILE,
  WORKSPACE_SCHEMA,
  defaultDataDir,
  defaultWorkspaceRoot,
  isPathInside,
  markerContents,
  workspacePaths,
} from "../../src/storage/paths"
import {
  createWorkspace,
  doctor,
  inspectWorkspace,
  openWorkspace,
  readWorkspaceMarker,
  type Diagnostic,
  type Workspace,
  type WorkspaceError,
} from "../../src/storage/workspace"
import type { Result } from "../../src/domain/markdown"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURES = join(import.meta.dir, "..", "fixtures", "workspace")
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

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
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-ws-${label}-`))
  cleanup.push(dir)
  return dir
}

/** A root that does not exist yet, inside a temp parent we can clean up. */
async function tempRoot(label: string): Promise<string> {
  const parent = await tempDir(label)
  return join(parent, "workspace")
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    // Restore permissions first so a deliberately unwritable folder can go.
    try {
      chmodSync(dir, 0o700)
    } catch {
      // best effort; the directory may already be gone
    }
    await removeTemp(dir)
  }
})

function hashFile(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
}

/** Relative path → sha256 for every file under `dir`. */
function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = join(current, entry.name)
      if (entry.isDirectory()) walk(abs, rel)
      else out.set(rel, hashFile(abs))
    }
  }
  walk(dir, "")
  return out
}

function listTree(dir: string): string[] {
  return [...snapshotTree(dir).keys()].sort()
}

async function copyFixture(name: string, destination: string): Promise<string> {
  await cp(join(FIXTURES, name), destination, { recursive: true })
  cleanup.push(destination)
  return destination
}

function readMarkerJson(root: string): unknown {
  return JSON.parse(readFileSync(join(root, MARKER_FILE), "utf8"))
}

function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code).sort()
}

/* -------------------------------------------------------------------------- */
/* P1-WS-01                                                                    */
/* -------------------------------------------------------------------------- */

describe("workspace lifecycle", () => {
  test("creates the v1 layout", async () => {
    const root = await tempRoot("create")
    const dataDir = join(root, "..", "data")

    const workspace = unwrap(await createWorkspace(root, { dataDir }))

    // marker: exactly {"schema":1}
    expect(existsSync(join(root, MARKER_FILE))).toBe(true)
    expect(readFileSync(join(root, MARKER_FILE), "utf8")).toBe(markerContents())
    expect(readMarkerJson(root)).toEqual({ schema: WORKSPACE_SCHEMA })
    expect(workspace.schema).toBe(WORKSPACE_SCHEMA)

    // layout from docs/data-model.md §1, each a real directory
    for (const rel of LAYOUT_DIRS) {
      const dir = join(root, ...rel.split("/"))
      expect(statSync(dir).isDirectory()).toBe(true)
    }

    // the contract type resolves to real paths
    for (const key of [
      "marker",
      "config",
      "schoolVault",
      "schoolSessions",
      "skillVault",
      "goals",
      "workProjects",
      "archiveIndex",
      "attachments",
      "exports",
    ] as const) {
      expect(isPathInside(root, workspace.paths[key])).toBe(true)
    }
    expect(workspace.paths.root).toBe(resolve(root))
    expect(existsSync(workspace.paths.dataDir)).toBe(true)

    // the "empty" state: creation from a folder that did not exist
    expect(await inspectWorkspace(root)).toEqual({ ok: true, value: "v1" })
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-02                                                                 */
  /* ------------------------------------------------------------------------ */

  test("open round-trips paths", async () => {
    const root = await tempRoot("open")
    const dataDir = join(root, "..", "data")

    const created = unwrap(await createWorkspace(root, { dataDir }))
    const markerStat = statSync(created.paths.marker)

    const opened = unwrap(await openWorkspace(root, { dataDir }))
    expect(opened.paths).toEqual(created.paths)
    expect(opened.data).toEqual(created.data)
    expect(opened.schema).toBe(WORKSPACE_SCHEMA)
    expect(opened.root).toBe(created.root)

    // create() twice is a no-op, not an error, and does not rewrite the marker
    const again = unwrap(await createWorkspace(root, { dataDir }))
    expect(again.paths).toEqual(created.paths)
    expect(statSync(created.paths.marker).mtimeMs).toBe(markerStat.mtimeMs)

    // opening a folder that was never created is a typed refusal, not a guess
    const emptyRoot = await tempRoot("open-empty")
    mkdirSync(emptyRoot, { recursive: true })
    const refused = expectErr(await openWorkspace(emptyRoot, { dataDir }))
    expect(refused.kind).toBe("not-workspace")
    expect(refused.next.length).toBeGreaterThan(0)
    expect(existsSync(join(emptyRoot, MARKER_FILE))).toBe(false)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-03                                                                 */
  /* ------------------------------------------------------------------------ */

  test("refuses a legacy folder without writing", async () => {
    const legacy = await copyFixture("legacy", join(await tempDir("legacy"), "old-workspace"))
    const before = snapshotTree(legacy)
    const dataDir = join(legacy, "..", "data")

    const created = expectErr(await createWorkspace(legacy, { dataDir }))
    const opened = expectErr(await openWorkspace(legacy, { dataDir }))

    for (const error of [created, opened]) {
      expect(error.kind).toBe("legacy")
      expect(error.path).toBe(resolve(legacy))
      expect(error.message).toContain("old-workspace")
      expect(error.message).toContain("v0.7")
      expect(error.next.length).toBeGreaterThan(0)
    }

    // blocked state: bytes, hashes and the file list are untouched
    expect(snapshotTree(legacy)).toEqual(before)
    expect(listTree(legacy)).toEqual([...before.keys()].sort())
    expect(existsSync(join(legacy, MARKER_FILE))).toBe(false)
    expect(await inspectWorkspace(legacy)).toEqual({ ok: true, value: "legacy" })
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-04                                                                 */
  /* ------------------------------------------------------------------------ */

  test("does not adopt an unmarked folder", async () => {
    const unmarked = await copyFixture(
      "unmarked",
      join(await tempDir("unmarked"), "my-notes"),
    )
    const before = snapshotTree(unmarked)
    const dataDir = join(unmarked, "..", "data")

    const created = expectErr(await createWorkspace(unmarked, { dataDir }))
    const opened = expectErr(await openWorkspace(unmarked, { dataDir }))

    for (const error of [created, opened]) {
      expect(error.kind).toBe("not-workspace")
      expect(error.path).toBe(resolve(unmarked))
      expect(error.next.length).toBeGreaterThan(0)
    }

    expect(snapshotTree(unmarked)).toEqual(before)
    expect(existsSync(join(unmarked, MARKER_FILE))).toBe(false)

    // contrast: an empty folder is created instead of refused
    const empty = await tempRoot("adopt-empty")
    mkdirSync(empty, { recursive: true })
    expect(unwrap(await createWorkspace(empty, { dataDir })).schema).toBe(WORKSPACE_SCHEMA)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-05                                                                 */
  /* ------------------------------------------------------------------------ */

  test("keeps app data outside the workspace", async () => {
    const root = await tempRoot("data")
    const dataDir = join(root, "..", "app-data")
    const workspace = unwrap(await createWorkspace(root, { dataDir }))

    const dataFiles: string[] = [
      workspace.data.chill,
      workspace.data.usage,
      workspace.data.stats,
      workspace.data.activity,
      workspace.data.logs,
    ]

    for (const path of dataFiles) {
      expect(isPathInside(workspace.data.dir, path)).toBe(true)
      expect(isPathInside(workspace.root, path)).toBe(false)
      expect(path.startsWith(workspace.root)).toBe(false)
    }

    // nothing that belongs to the data dir exists inside the workspace
    for (const name of ["chill.json", "usage.json", "stats.json", "activity.jsonl"]) {
      expect(existsSync(join(root, name))).toBe(false)
    }
    expect(existsSync(join(root, "logs"))).toBe(false)
    expect(workspace.data.dir).toBe(resolve(dataDir))

    // platform defaults are derived, not hard-coded
    expect(defaultDataDir({ XDG_DATA_HOME: "/tmp/xdg" }, "linux")).toBe(join("/tmp/xdg", "lockedin"))
    expect(defaultDataDir({ LOCKEDIN_DATA_DIR: "/tmp/override" }, "linux")).toBe(resolve("/tmp/override"))
    expect(defaultDataDir({ XDG_DATA_HOME: "" }, "darwin")).toContain(
      join("Library", "Application Support", "lockedin"),
    )
    expect(defaultDataDir({ LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" }, "win32")).toContain(
      "lockedin",
    )
    expect(defaultWorkspaceRoot({ LOCKEDIN_WORKSPACE: "/tmp/ws-override" })).toBe(resolve("/tmp/ws-override"))
    expect(
      defaultWorkspaceRoot(
        { HOME: "/c/Users/friend", USERPROFILE: "C:\\Users\\friend" },
        "win32",
      ),
    ).toBe(join("C:\\Users\\friend", "LockedIn"))
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-06                                                                 */
  /* ------------------------------------------------------------------------ */

  test.skipIf(isWindows)("unwritable root is a typed error", async () => {
    if (isRoot) return // root bypasses the permission bits; nothing to assert
    const root = await tempRoot("unwritable")
    mkdirSync(root, { recursive: true })
    const dataDir = join(root, "..", "data")
    await chmod(root, 0o500)

    const error = expectErr(await createWorkspace(root, { dataDir }))

    expect(error.kind).toBe("storage")
    expect(error.path.startsWith(root)).toBe(true)
    expect(error.message).toMatch(/EACCES|EPERM/)
    expect(error.next.length).toBeGreaterThan(0)

    // failed state: no marker, and no temp file left half-written
    expect(existsSync(join(root, MARKER_FILE))).toBe(false)
    const leftovers = readdirSync(root).filter((name) => name.startsWith(`.${MARKER_FILE}.tmp-`))
    expect(leftovers).toEqual([])

    // a retry after fixing permissions succeeds, proving the failure was clean
    await chmod(root, 0o700)
    expect(unwrap(await createWorkspace(root, { dataDir })).schema).toBe(WORKSPACE_SCHEMA)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-07                                                                 */
  /* ------------------------------------------------------------------------ */

  test("doctor lists every problem", async () => {
    const root = await tempRoot("doctor")
    const dataDir = join(root, "..", "data")
    const workspace: Workspace = unwrap(await createWorkspace(root, { dataDir }))

    // doctor must not invent work: a complete workspace is silent
    await writeFile(workspace.paths.config, "[ui]\nusername = \"fixture\"\n", "utf8")
    expect(await doctor(workspace)).toEqual([])

    // break it in three ways the user can see and fix
    await rm(join(root, "school", "vault", "concepts"), { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
    await rm(workspace.paths.config, { force: true })
    await rm(workspace.data.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })

    const diagnostics = await doctor(workspace)

    // one entry per problem: removing the data dir reports the dir, not its
    // logs as well (a second symptom of the same cause is noise)
    expect(codes(diagnostics)).toEqual([
      "config-missing",
      "data-dir-missing",
      "missing-dir",
    ])

    for (const diagnostic of diagnostics) {
      expect(diagnostic.message.length).toBeGreaterThan(0)
      expect(diagnostic.next.length).toBeGreaterThan(0)
      expect(diagnostic.path).toBeDefined()
    }

    const missingDir = diagnostics.find((d) => d.code === "missing-dir")
    expect(missingDir?.severity).toBe("error")
    expect(missingDir?.path).toBe(join(root, "school", "vault", "concepts"))
    expect(diagnostics.find((d) => d.code === "config-missing")?.severity).toBe("warning")

    // a missing log directory alone is a warning with a next step
    mkdirSync(workspace.data.dir, { recursive: true })
    await writeFile(workspace.paths.config, "[ui]\nusername = \"fixture\"\n", "utf8")
    const logsOnly = await doctor(workspace)
    expect(codes(logsOnly)).toEqual(["logs-missing", "missing-dir"])
    const logs = logsOnly.find((d) => d.code === "logs-missing")
    expect(logs?.severity).toBe("warning")
    expect(logs?.next.length).toBeGreaterThan(0)

    // unwritable folders are reported too (root only bypasses the bits, and
    // Windows has no POSIX permission bits to revoke)
    if (!isRoot && !isWindows) {
      await chmod(join(root, "attachments"), 0o500)
      const after = await doctor(workspace)
      const unwritable = after.find((d) => d.code === "unwritable-dir")
      expect(unwritable?.path).toBe(join(root, "attachments"))
      expect(unwritable?.next.length).toBeGreaterThan(0)
    }
  })

  /* ------------------------------------------------------------------------ */
  /* P1-WS-08                                                                 */
  /* ------------------------------------------------------------------------ */

  test("create is retry-safe", async () => {
    const root = await tempRoot("retry")
    const dataDir = join(root, "..", "data")

    // Simulate a create that died after making folders: partial layout, no
    // marker, plus a user file already dropped into input/.
    mkdirSync(join(root, "school", "vault", "concepts"), { recursive: true })
    mkdirSync(join(root, "input"), { recursive: true })
    const userFile = join(root, "input", "lecture.md")
    await writeFile(userFile, "# Lecture\n\nUser content that must survive.\n", "utf8")
    const userHash = hashFile(userFile)
    // and a temp marker from a crashed write
    await writeFile(join(root, `.${MARKER_FILE}.tmp-crashed`), "{\"schema\":", "utf8")

    expect(await inspectWorkspace(root)).toEqual({ ok: true, value: "partial" })

    const workspace = unwrap(await createWorkspace(root, { dataDir }))

    // the layout is complete and the marker landed
    for (const rel of LAYOUT_DIRS) {
      expect(statSync(join(root, ...rel.split("/"))).isDirectory()).toBe(true)
    }
    expect(workspace.schema).toBe(WORKSPACE_SCHEMA)
    expect(readMarkerJson(root)).toEqual({ schema: WORKSPACE_SCHEMA })

    // nothing the user put there was deleted or duplicated, and the stale temp
    // marker is gone
    expect(hashFile(userFile)).toBe(userHash)
    expect(readdirSync(root).filter((n) => n.startsWith(`.${MARKER_FILE}.tmp-`))).toEqual([])
    expect(listTree(root).filter((p) => p === "input/lecture.md")).toHaveLength(1)

    // a second interrupted-then-completed run is still a no-op
    const again = unwrap(await createWorkspace(root, { dataDir }))
    expect(again.paths).toEqual(workspace.paths)
    expect(hashFile(userFile)).toBe(userHash)
  })

  /* ------------------------------------------------------------------------ */
  /* fixtures stay portable                                                  */
  /* ------------------------------------------------------------------------ */

  test("fixtures contain no absolute machine paths", () => {
    const files = listTree(FIXTURES)
    expect(files.length).toBeGreaterThan(0)
    for (const rel of files) {
      const contents = readFileSync(join(FIXTURES, rel), "utf8")
      expect(contents).not.toContain("/home/")
      expect(contents).not.toContain("/Users/")
      expect(contents).not.toContain("C:\\Users\\")
    }
  })

  /* ------------------------------------------------------------------------ */
  /* marker validation                                                       */
  /* ------------------------------------------------------------------------ */

  test("a workspace from another schema is refused", async () => {
    const root = await tempRoot("schema")
    const dataDir = join(root, "..", "data")
    const workspace = unwrap(await createWorkspace(root, { dataDir }))
    await writeFile(workspace.paths.marker, "{\"schema\":99}\n", "utf8")

    const error = expectErr(await openWorkspace(root, { dataDir }))
    if (error.kind !== "schema") throw new Error(`expected schema, got ${error.kind}`)
    expect(error.found).toBe("99")
    expect(error.expected).toBe(WORKSPACE_SCHEMA)

    // invalid JSON is a schema error too, not a crash
    await writeFile(workspace.paths.marker, "not json\n", "utf8")
    const invalid = expectErr(await readWorkspaceMarker(workspacePaths(root, dataDir)))
    if (invalid.kind !== "schema") throw new Error(`expected schema, got ${invalid.kind}`)
    expect(invalid.found).toBe("invalid JSON")
  })

  test("the marker contents are the documented one-liner", () => {
    expect(markerContents()).toBe("{\"schema\":1}\n")
    expect(CONFIG_FILE).toBe("config.toml")
  })
})

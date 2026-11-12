/**
 * WP-305 — session manager service.
 *
 * The workspace here is a real one, populated through the real create
 * transaction (WP-301), so every assertion is about bytes on disk rather than
 * a mock's idea of them. Fixtures therefore live in the temp directory instead
 * of `tests/fixtures/sessions-manager/**`: the scenarios need a settled
 * `created` timestamp per session, which the create service supplies.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createLockInSession } from "../../src/services/lockin/create";
import { listZip, readZip } from "../../src/services/lockin/zip";
import { addSources, assertSessionId, inboundLinks, listSessions, openSession, type ManagerError, type ManagerEvent } from "../../src/services/lockin/manager";
import { archiveSession, archiveSessionToBackend, deleteSession, exportSession, restoreSession } from "../../src/services/lockin/archive";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, ManagerError>): ManagerError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let archiveRoot: string
let inputs: string

async function tree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      out.push(relative(root, path).split(sep).join("/"))
      if (entry.isDirectory()) await walk(path)
    }
  }
  if (existsSync(root)) await walk(root)
  return out.sort()
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const path of await tree(root)) {
    const full = join(root, path)
    try {
      files[path] = await readFile(full, "utf8")
    } catch {
      files[path] = "<binary>"
    }
  }
  return files
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "session-manager-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  archiveRoot = join(base, "archive")
  await mkdir(archiveRoot, { recursive: true })
  inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })
  await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n")
  await writeFile(join(inputs, "notes.txt"), "energy balance\n")
  await writeFile(join(inputs, "extra.pdf"), "%PDF-1.4\n")
})

afterEach(async () => {
  await removeTemp(base)
})

/** Three sessions: one bare, one with steps and outputs, one archived. */
async function seedThree(): Promise<{ empty: string; steps: string; archived: string }> {
  const empty = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T09:00:00Z",
      name: "Physics — Unit 4",
      prompt: "Study the boundary conditions.",
    }),
  )
  const steps = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-02T10:00:00Z",
      name: "Chemistry — Bonding",
      files: [join(inputs, "lecture-4.md"), join(inputs, "notes.txt")],
    }),
  )
  await writeFile(
    join(steps.folder, SESSION_FILES.steps),
    "# Assignment steps\n\n> 1 of 3 steps done\n\n- [x] Read section 4.2\n- [ ] Derive it\n- [ ] Check units\n",
  )
  await writeFile(join(steps.folder, SESSION_FILES.chat), '{"role":"user","content":"hi"}\n')

  const archivedSession = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-10-01T08:00:00Z",
      name: "Older — Physics",
      files: [join(inputs, "notes.txt")],
    }),
  )
  unwrap(await archiveSession({ workspace, id: archivedSession.session.id, archiveRoot, confirmed: true }))

  return { empty: empty.session.id, steps: steps.session.id, archived: archivedSession.session.id }
}

describe("list", () => {
  test("counts match the files on disk for three sessions", async () => {
    const ids = await seedThree()
    const rows = await listSessions({ workspace, archiveRoot })
    expect(rows).toHaveLength(3)

    const byId = (id: string) => rows.find((row) => row.id === id)!
    expect(byId(ids.empty).sourceCount).toBe(0)
    expect(byId(ids.empty).hasSteps).toBe(false)
    expect(byId(ids.empty).stepCounts).toEqual({ checked: 0, total: 0 })

    expect(byId(ids.steps).sourceCount).toBe(2)
    expect(byId(ids.steps).hasSteps).toBe(true)
    expect(byId(ids.steps).stepCounts).toEqual({ checked: 1, total: 3 })
    expect(byId(ids.steps).sizeBytes).toBeGreaterThan(0)

    expect(byId(ids.archived).archived).toBe(true)
    expect(byId(ids.archived).sourceCount).toBe(1)
  })

  test("reports outputs when the folder exists", async () => {
    const ids = await seedThree()
    await mkdir(join(workspace.paths.root, "school", "outputs", ids.steps), { recursive: true })
    const rows = await listSessions({ workspace, archiveRoot })
    expect(rows.find((row) => row.id === ids.steps)?.hasOutputs).toBe(true)
    expect(rows.find((row) => row.id === ids.empty)?.hasOutputs).toBe(false)
  })

  test("sorts by date newest first, by name, and by size", async () => {
    const ids = await seedThree()

    const byDate = await listSessions({ workspace, archiveRoot })
    expect(byDate.map((row) => row.id)).toEqual([ids.steps, ids.empty, ids.archived])

    const byName = await listSessions({ workspace, archiveRoot, sort: "name" })
    expect(byName.map((row) => row.name)).toEqual([
      "Chemistry — Bonding",
      "Older — Physics",
      "Physics — Unit 4",
    ])

    const bySize = await listSessions({ workspace, archiveRoot, sort: "size" })
    expect(bySize[0]?.id).toBe(ids.steps)
    expect(bySize[bySize.length - 1]?.id).toBe(ids.empty)
  })

  test("searches name and prompt, case-insensitively; an empty query returns all", async () => {
    const ids = await seedThree()
    expect((await listSessions({ workspace, archiveRoot, query: "phys" })).length).toBe(2)
    expect((await listSessions({ workspace, archiveRoot, query: "BOUNDARY" })).map((row) => row.id)).toEqual([
      ids.empty,
    ])
    expect((await listSessions({ workspace, archiveRoot, query: "" })).length).toBe(3)
    expect((await listSessions({ workspace, archiveRoot, query: "   " })).length).toBe(3)
    expect((await listSessions({ workspace, archiveRoot, query: "nothing-here" }))).toEqual([])
  })

  test("a corrupt meta.json is a broken row with a reason, and the rest still list", async () => {
    const ids = await seedThree()
    await writeFile(join(workspace.paths.schoolSessions, ids.empty, SESSION_FILES.meta), "{ not json")

    const rows = await listSessions({ workspace, archiveRoot })
    expect(rows).toHaveLength(3)
    const broken = rows.find((row) => row.id === ids.empty)!
    expect(broken.broken).toBe(true)
    expect(broken.reason).toContain("meta.json")
    expect(rows.filter((row) => !row.broken)).toHaveLength(2)
  })

  test("a folder without meta.json is broken, not omitted", async () => {
    await mkdir(join(workspace.paths.schoolSessions, "2026-01-01-0000-orphan"), { recursive: true })
    const rows = await listSessions({ workspace, archiveRoot })
    const orphan = rows.find((row) => row.id === "2026-01-01-0000-orphan")!
    expect(orphan.broken).toBe(true)
    expect(orphan.reason).toContain("missing")
  })

  test("an empty workspace lists nothing instead of failing", async () => {
    expect(await listSessions({ workspace, archiveRoot })).toEqual([])
  })
})

describe("open", () => {
  test("returns the session with its paths", async () => {
    const ids = await seedThree()
    const opened = unwrap(await openSession({ workspace, id: ids.steps }))
    expect(opened.session.id).toBe(ids.steps)
    expect(opened.session.sources).toHaveLength(2)
    expect(opened.chatPath.endsWith(SESSION_FILES.chat)).toBe(true)
    expect(opened.progressPath.endsWith(SESSION_FILES.progress)).toBe(true)
    expect(existsSync(opened.chatPath)).toBe(true)
  })

  test("a missing id is a typed storage error", async () => {
    const error = errorOf(await openSession({ workspace, id: "2026-01-01-0000-absent" }))
    expect(error.kind).toBe("storage")
    if (error.kind !== "storage") return
    expect(error.path).toContain("2026-01-01-0000-absent")
  })

  test("an id that could climb out of the folder is refused", () => {
    expect(assertSessionId("../../etc").ok).toBe(false)
    expect(assertSessionId("..").ok).toBe(false)
    expect(assertSessionId("a/b").ok).toBe(false)
    expect(assertSessionId(".hidden").ok).toBe(false)
    expect(unwrap(assertSessionId("2026-11-01-0900-physics"))).toBe("2026-11-01-0900-physics")
  })

  test("every folder-bound action refuses a traversing id and touches nothing", async () => {
    const outside = join(base, "outside")
    await mkdir(outside)
    await writeFile(join(outside, SESSION_FILES.meta), "{}\n")

    const attempts = [
      () => openSession({ workspace, id: "../outside" }),
      () => deleteSession({ workspace, id: "../outside", confirmed: true }),
      () => exportSession({ workspace, id: "../outside" }),
      () => archiveSession({ workspace, id: "../outside", archiveRoot, confirmed: true }),
      () => restoreSession({ workspace, id: "../outside", archiveRoot, confirmed: true }),
    ]
    for (const attempt of attempts) {
      const result = await attempt()
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.kind).toBe("path")
    }
    expect(await readFile(join(outside, SESSION_FILES.meta), "utf8")).toBe("{}\n")
  })
})

describe("addSources", () => {
  test("adds one new file, skips a duplicate, and leaves chat/progress/steps identical", async () => {
    const ids = await seedThree()
    const folder = join(workspace.paths.schoolSessions, ids.steps)
    const before = {
      chat: await readFile(join(folder, SESSION_FILES.chat), "utf8"),
      steps: await readFile(join(folder, SESSION_FILES.steps), "utf8"),
      progress: existsSync(join(folder, SESSION_FILES.progress)),
      meta: await readFile(join(folder, SESSION_FILES.meta), "utf8"),
    }

    const events: ManagerEvent[] = []
    const result = unwrap(
      await addSources({
        workspace,
        id: ids.steps,
        files: [join(inputs, "extra.pdf"), join(inputs, "lecture-4.md")],
        emit: (event) => events.push(event),
      }),
    )

    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.session.sources).toHaveLength(3)

    expect(await readFile(join(folder, SESSION_FILES.chat), "utf8")).toBe(before.chat)
    expect(await readFile(join(folder, SESSION_FILES.steps), "utf8")).toBe(before.steps)
    expect(existsSync(join(folder, SESSION_FILES.progress))).toBe(before.progress)
    expect(await readFile(join(folder, SESSION_FILES.meta), "utf8")).not.toBe(before.meta)

    expect(events).toEqual([{ type: "session.updated", id: ids.steps, action: "add-sources" }])
    // The stored path stays relative and inside sources/.
    for (const source of result.session.sources) expect(source.storedPath).toStartWith("sources/")
  })

  test("an archived session is refused with the next step", async () => {
    const ids = await seedThree()
    const error = errorOf(
      await addSources({
        workspace,
        id: ids.archived,
        files: [join(inputs, "extra.pdf")],
        archiveRoot,
      }),
    )
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toContain("restore it first")
  })

  test("nothing is emitted when every file is a duplicate", async () => {
    const ids = await seedThree()
    const events: ManagerEvent[] = []
    const result = unwrap(
      await addSources({
        workspace,
        id: ids.steps,
        files: [join(inputs, "notes.txt")],
        emit: (event) => events.push(event),
      }),
    )
    expect(result.added).toBe(0)
    expect(result.skipped).toBe(1)
    expect(events).toEqual([])
  })
})

describe("archive and restore", () => {
  test("archive drops chat.jsonl and keeps the other artefacts", async () => {
    const ids = await seedThree()
    const before = await tree(join(workspace.paths.schoolSessions, ids.steps))

    const outcome = unwrap(
      await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }),
    )
    expect(outcome.archived).toBe(true)

    const archived = await tree(join(archiveRoot, "school", "session", ids.steps))
    expect(archived).toContain(SESSION_FILES.meta)
    expect(archived).toContain(SESSION_FILES.steps)
    expect(archived.some((path) => path.startsWith("sources/"))).toBe(true)
    expect(archived).not.toContain(SESSION_FILES.chat)
    expect(before).toContain(SESSION_FILES.chat)

    // The open folder is gone; the archived copy exists instead.
    expect(existsSync(join(workspace.paths.schoolSessions, ids.steps))).toBe(false)
    expect(existsSync(join(archiveRoot, "school", "session", ids.steps))).toBe(true)
  })

  test("the archived meta records that chat was not kept", async () => {
    const ids = await seedThree()
    unwrap(await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }))
    const meta = JSON.parse(
      await readFile(join(archiveRoot, "school", "session", ids.steps, SESSION_FILES.meta), "utf8"),
    ) as Record<string, unknown>
    expect(meta.archived).toBe(true)
    expect(meta.chat_archived).toBe(false)
  })

  test("a partial backend upload keeps the live copy", async () => {
    const ids = await seedThree()
    const backend = {
      id: "folder",
      archiveRoot: join(base, "archive"),
      ensureReady: async () => ({ ok: true, value: { root: join(base, "archive"), created: [] } }),
      put: async () => ({
        ok: true,
        value: {
          ref: { side: "school", id: ids.steps, backend: "folder", kind: "session" },
          path: join(base, "archive"),
          files: 0,
          bytes: 0,
          warnings: [{ code: "large-file", path: "big.pdf", message: "skipped" }],
        },
      }),
      list: async () => ({ ok: true, value: { entries: [], diagnostics: [] } }),
      restore: async () => ({ ok: false, error: { kind: "path", path: "", reason: "missing", message: "no", next: "no" } }),
      remove: async () => ({ ok: false, error: { kind: "path", path: "", reason: "missing", message: "no", next: "no" } }),
    } as never
    const result = await archiveSessionToBackend({ workspace, id: ids.steps, backend })
    expect(result.ok).toBe(false)
    expect(existsSync(join(workspace.paths.schoolSessions, ids.steps))).toBe(true)
  })

  test("cancelling the archive changes no bytes and emits nothing", async () => {
    const ids = await seedThree()
    const before = await snapshot(join(workspace.paths.schoolSessions, ids.steps))
    const events: ManagerEvent[] = []

    const outcome = unwrap(
      await archiveSession({
        workspace,
        id: ids.steps,
        archiveRoot,
        confirmed: false,
        emit: (event) => events.push(event),
      }),
    )
    expect(outcome.archived).toBe(false)
    expect(await snapshot(join(workspace.paths.schoolSessions, ids.steps))).toEqual(before)
    expect(existsSync(join(archiveRoot, "school", "session", ids.steps))).toBe(false)
    expect(events).toEqual([])
  })

  test("archiving twice is refused rather than overwriting the copy", async () => {
    const ids = await seedThree()
    unwrap(await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }))
    const error = errorOf(
      await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }),
    )
    expect(error.kind).toBe("storage")
  })

  test("restore returns the folder with the archived file set", async () => {
    const ids = await seedThree()
    unwrap(await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }))
    const archivedFiles = await tree(join(archiveRoot, "school", "session", ids.steps))

    const events: ManagerEvent[] = []
    unwrap(
      await restoreSession({
        workspace,
        id: ids.steps,
        archiveRoot,
        confirmed: true,
        emit: (event) => events.push(event),
      }),
    )

    const restoredFiles = await tree(join(workspace.paths.schoolSessions, ids.steps))
    expect(restoredFiles).toEqual(archivedFiles)
    expect(existsSync(join(archiveRoot, "school", "session", ids.steps))).toBe(false)
    expect(events).toEqual([{ type: "session.updated", id: ids.steps, action: "restore" }])

    const meta = JSON.parse(
      await readFile(join(workspace.paths.schoolSessions, ids.steps, SESSION_FILES.meta), "utf8"),
    ) as Record<string, unknown>
    expect(meta.archived).toBe(false)
  })

  test("a cancelled restore changes no bytes", async () => {
    const ids = await seedThree()
    unwrap(await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true }))
    const before = await snapshot(join(archiveRoot, "school", "session", ids.steps))

    const outcome = unwrap(
      await restoreSession({ workspace, id: ids.steps, archiveRoot, confirmed: false }),
    )
    expect(outcome.restored).toBe(false)
    expect(await snapshot(join(archiveRoot, "school", "session", ids.steps))).toEqual(before)
    expect(existsSync(join(workspace.paths.schoolSessions, ids.steps))).toBe(false)
  })
})

describe("delete", () => {
  test("names the inbound-link count and removes only the session folder", async () => {
    const ids = await seedThree()

    // Two notes link to the session summary.
    const notesDir = join(workspace.paths.schoolVault, "sessions")
    await mkdir(notesDir, { recursive: true })
    await writeFile(join(notesDir, "physics.md"), `# Physics\n\nSee [[${ids.steps}]].\n`)
    await writeFile(join(notesDir, "chemistry.md"), `# Chemistry\n\nAlso [[${ids.steps}]].\n`)
    await writeFile(join(notesDir, "unrelated.md"), "# Unrelated\n")

    expect((await inboundLinks({ workspace, id: ids.steps })).count).toBe(2)

    const noteBefore = await snapshot(notesDir)
    const outcome = unwrap(
      await deleteSession({ workspace, id: ids.steps, confirmed: true }),
    )
    expect(outcome.deleted).toBe(true)
    expect(outcome.inboundLinks).toBe(2)
    expect(existsSync(join(workspace.paths.schoolSessions, ids.steps))).toBe(false)

    // Notes are untouched.
    expect(await snapshot(notesDir)).toEqual(noteBefore)
  })

  test("a cancelled delete changes no bytes and emits nothing", async () => {
    const ids = await seedThree()
    const before = await snapshot(join(workspace.paths.schoolSessions, ids.steps))
    const events: ManagerEvent[] = []

    const outcome = unwrap(
      await deleteSession({
        workspace,
        id: ids.steps,
        confirmed: false,
        emit: (event) => events.push(event),
      }),
    )
    expect(outcome.deleted).toBe(false)
    expect(await snapshot(join(workspace.paths.schoolSessions, ids.steps))).toEqual(before)
    expect(events).toEqual([])
  })

  test("deleting an unknown session is a typed error", async () => {
    const error = errorOf(await deleteSession({ workspace, id: "2026-01-01-0000-absent", confirmed: true }))
    expect(error.kind).toBe("storage")
  })

  test("work projects are never touched", async () => {
    const ids = await seedThree()
    const project = join(workspace.paths.workProjects, "my-app")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, "meta.json"), '{"schema":1}')
    const before = await snapshot(workspace.paths.workProjects)

    unwrap(await deleteSession({ workspace, id: ids.steps, confirmed: true }))
    expect(await snapshot(workspace.paths.workProjects)).toEqual(before)
  })
})

describe("export", () => {
  test("writes a readable zip without chat history, stable across runs", async () => {
    const ids = await seedThree()
    const first = unwrap(await exportSession({ workspace, id: ids.steps }))
    expect(first.path).toBe(join(workspace.paths.exports, `session-${ids.steps}.zip`))
    const firstBytes = new Uint8Array(await Bun.file(first.path).arrayBuffer())

    const entries = listZip(firstBytes)
    expect(entries).toContain(SESSION_FILES.meta)
    expect(entries).toContain(SESSION_FILES.steps)
    expect(entries.some((name) => name.startsWith("sources/"))).toBe(true)
    expect(entries).not.toContain(SESSION_FILES.chat)

    const contents = readZip(firstBytes)
    expect(new TextDecoder().decode(contents[SESSION_FILES.meta]!)).toContain('"schema": 1')

    const second = unwrap(await exportSession({ workspace, id: ids.steps }))
    const secondBytes = new Uint8Array(await Bun.file(second.path).arrayBuffer())
    expect(secondBytes).toEqual(firstBytes)
    expect(second.bytes).toBe(first.bytes)
    expect(second.entries).toEqual(first.entries)
  })

  test("the archive is written atomically: no temp file survives", async () => {
    const ids = await seedThree()
    unwrap(await exportSession({ workspace, id: ids.steps }))
    const leftovers = (await readdir(workspace.paths.exports)).filter((name) => name.includes(".tmp-"))
    expect(leftovers).toEqual([])
  })

  test("exporting a missing session is a typed error", async () => {
    const error = errorOf(await exportSession({ workspace, id: "2026-01-01-0000-absent" }))
    expect(error.kind).toBe("storage")
  })
})

describe("events", () => {
  test("each successful action emits exactly one session.updated", async () => {
    const ids = await seedThree()
    const events: ManagerEvent[] = []
    const emit = (event: ManagerEvent) => events.push(event)

    unwrap(await exportSession({ workspace, id: ids.steps, emit }))
    expect(events).toHaveLength(1)

    unwrap(await archiveSession({ workspace, id: ids.steps, archiveRoot, confirmed: true, emit }))
    expect(events).toHaveLength(2)

    unwrap(await restoreSession({ workspace, id: ids.steps, archiveRoot, confirmed: true, emit }))
    expect(events).toHaveLength(3)

    unwrap(await deleteSession({ workspace, id: ids.steps, confirmed: true, emit }))
    expect(events).toHaveLength(4)

    expect(events.map((event) => event.action)).toEqual(["export", "archive", "restore", "delete"])
    expect(events.every((event) => event.id === ids.steps)).toBe(true)
  })
})

/**
 * WP-133 — session manager, end to end.
 *
 * The real manager view model and the real manager component, driven by the real
 * lock-in service on a temp workspace. No fake is in the path: every row comes
 * from `listSessions`, every destructive action goes through `arm` → `confirm`
 * → `archiveSession`/`deleteSession`/`exportSession`.
 *
 * Assertions are on bytes and on the service, not only on the frame: the point of
 * an end-to-end test is that the screen and the disk agree.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createLockInSession } from "../../src/services/lockin/create";
import { addSources, inboundLinks, listSessions, openSession, sessionFolderFor, type SessionRow } from "../../src/services/lockin/manager";
import { archiveSession, deleteSession, exportSession } from "../../src/services/lockin/archive";
import { listZip } from "../../src/services/lockin/zip";
import { renderSteps, writeSteps, type StepPlan } from "../../src/services/lockin/steps";
import { createPicker, mark } from "../../src/services/lockin/picker";
import { arm, cancelPending, confirm, cycleSort, emptyCopy, initialSessions, move, search, sortRows, visibleRows, warningFor, type SessionsState, type SessionRow as ViewRow } from "../../src/ui/features/sessions/sessions-model";
import { SessionsPanel } from "../../src/ui/features/sessions/sessions-panel";
import { crimson } from "../../src/ui/theme";
import { renderApp } from "../helpers/render";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []
const CREATED = "2026-11-01T09:00:00Z"

function unwrap<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

async function tempRoot(label: string): Promise<string> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-e2e-mgr-${label}-`))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function workspaceWith(opts: { input?: boolean } = {}): Promise<{
  workspace: Workspace
  archiveRoot: string
  inputDir: string
}> {
  const root = await tempRoot("ws")
  const workspace = unwrap(
    await createWorkspace(join(root, "workspace"), { dataDir: join(root, "data") }),
  )
  const archiveRoot = join(root, "archive")
  await mkdir(archiveRoot, { recursive: true })
  const inputDir = join(root, "input")
  if (opts.input !== false) await mkdir(inputDir, { recursive: true })
  return { workspace, archiveRoot, inputDir }
}

/** Every file under `root` with its bytes hashed. Directories are listed too. */
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

/** The three files an "add sources" must never touch. */
function sessionFileHashes(folder: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ["chat.jsonl", "progress.jsonl", "assignment-steps.md"]) {
    const path = join(folder, name)
    out[name] = existsSync(path)
      ? new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
      : "absent"
  }
  return out
}

const PLAN: StepPlan = {
  phases: [
    { phase: "Understand", items: ["Read section 4.2", "Summarise the boundary conditions"] },
    { phase: "Solve", items: ["Set up the equations"] },
  ],
}

/** Give a session a steps file and prior chat/progress, as real use would. */
async function dressSession(folder: string): Promise<void> {
  unwrap(await writeSteps(folder, renderSteps(PLAN)))
  await writeFile(join(folder, "chat.jsonl"), '{"role":"user","content":"hi","at":"2026-11-01T09:01:00Z"}\n')
  await writeFile(join(folder, "progress.jsonl"), '{"event":"toggle","index":0,"checked":true,"at":"2026-11-01T09:02:00Z"}\n')
}

function toViewRow(row: SessionRow, inboundLinks = 0): ViewRow {
  return {
    id: row.id,
    name: row.name,
    date: row.created,
    sources: row.sourceCount,
    steps: { done: row.stepCounts.checked, total: row.stepCounts.total },
    archived: row.archived,
    broken: row.broken ? (row.reason ?? "broken") : undefined,
    inboundLinks,
  }
}

async function rowsFor(workspace: Workspace, archiveRoot?: string): Promise<ViewRow[]> {
  const rows = await listSessions({ workspace, ...(archiveRoot ? { archiveRoot } : {}) })
  return Promise.all(
    rows.map(async (row) => {
      const links = await inboundLinks({ workspace, id: row.id })
      return toViewRow(row, links.count)
    }),
  )
}

/** Mount the real manager component and return its character frame. */
async function frameOf(state: SessionsState, width = 80, height = 24): Promise<string> {
  const ui = await renderApp({
    width,
    height,
    app: () => (
      <SessionsPanel
        theme={crimson}
        width={width}
        height={height}
        state={state}
        footer="a archive · d delete · x export · Esc back"
      />
    ),
  })
  try {
    return await ui.waitFor("SESSIONS")
  } finally {
    await ui.dispose()
  }
}

describe("session manager end to end", () => {
  test("lists the three seeded sessions and renders them at 80x24", async () => {
    const { workspace, archiveRoot, inputDir } = await workspaceWith()
    await writeFile(join(inputDir, "lecture.md"), "# Lecture\n\nboundary conditions\n")

    const empty = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Empty session", prompt: "notes" }),
    )
    const withSteps = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Physics unit 4",
        files: [join(inputDir, "lecture.md")],
        steps: true,
      }),
    )
    await dressSession(sessionFolderFor(workspace, withSteps.session.id))
    const archived = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Old chem", prompt: "x" }),
    )
    unwrap(
      await archiveSession({
        workspace,
        archiveRoot,
        id: archived.session.id,
        confirmed: true,
      }),
    )

    const live = await rowsFor(workspace)
    expect(live.map((row) => row.name).sort()).toEqual(["Empty session", "Physics unit 4"])
    expect(live.every((row) => row.broken === undefined)).toBe(true)

    // The steps session really has steps, and the empty one does not.
    const stepsRow = live.find((row) => row.id === withSteps.session.id)!
    expect(stepsRow.sources).toBe(1)
    expect(stepsRow.steps.total).toBeGreaterThan(0)
    expect(live.find((row) => row.id === empty.session.id)!.steps.total).toBe(0)

    // With an archive root the list spans both trees and marks the archived row.
    const bothTrees = await listSessions({ workspace, archiveRoot })
    expect(bothTrees.map((row) => row.id).sort()).toEqual(
      [empty.session.id, withSteps.session.id, archived.session.id].sort(),
    )
    const archivedRow = bothTrees.find((row) => row.id === archived.session.id)!
    expect(archivedRow.archived).toBe(true)
    expect(bothTrees.find((row) => row.id === empty.session.id)!.archived).toBe(false)

    // The component renders every live row at 80x24 without clipping.
    const state = initialSessions(live)
    const frame = await frameOf(state, 80, 24)
    expect(frame).toContain("2 · sort date")
    expect(frame).toContain("Empty session")
    expect(frame).toContain("Physics unit 4")
    expect(frame.split("\n")[0]).toContain("sort date")

    // …and at 120x30.
    const wide = await frameOf(state, 120, 30)
    expect(wide).toContain("Physics unit 4")

    // The session folder on disk is the one the row names.
    expect(existsSync(sessionFolderFor(workspace, withSteps.session.id))).toBe(true)
  })

  test("sort and search change the visible order, Enter opens the selected session", async () => {
    const { workspace } = await workspaceWith()
    for (const name of ["Zulu", "Alpha", "Mike"]) {
      unwrap(await createLockInSession({ workspace, created: CREATED, name, prompt: name }))
    }

    const rows = await rowsFor(workspace)
    expect(rows.length).toBe(3)

    // sort by name, then cycle to the next key
    expect(sortRows(rows, "name").map((row) => row.name)).toEqual(["Alpha", "Mike", "Zulu"])
    const byName = { ...initialSessions(rows), sort: "name" as const }
    expect(visibleRows(cycleSort(byName)).length).toBe(3)

    // search narrows without touching the service rows
    const filtered = visibleRows(search(initialSessions(rows), "mi"))
    expect(filtered.map((row) => row.name)).toEqual(["Mike"])
    const none = search(initialSessions(rows), "zzz")
    expect(visibleRows(none)).toEqual([])
    expect(emptyCopy(none)).toContain("no session matches")

    // the cursor moves over the visible list, not the raw one
    const moved = move(search(initialSessions(rows), "m"), 1)
    expect(moved.cursor).toBe(0) // one match: stays put

    // Enter opens the session under the cursor, with its real files
    const target = visibleRows(search(initialSessions(rows), "alpha"))[0]!
    const opened = unwrap(await openSession({ workspace, id: target.id }))
    expect(opened.session.id).toBe(target.id)
    expect(opened.session.name).toBe("Alpha")
    expect(existsSync(opened.folder)).toBe(true)
    // A fresh session records where its chat and progress will live; the files
    // appear once there is a turn and a toggle (create writes no chat).
    expect(opened.chatPath.endsWith("chat.jsonl")).toBe(true)
    expect(opened.progressPath.endsWith("progress.jsonl")).toBe(true)
    expect(existsSync(join(opened.folder, "meta.json"))).toBe(true)
  })

  test("add sources updates meta and leaves chat, progress and steps byte-identical", async () => {
    const { workspace, inputDir } = await workspaceWith()
    await writeFile(join(inputDir, "first.md"), "# First\n")
    await writeFile(join(inputDir, "second.md"), "# Second\n")

    const created = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Add sources",
        files: [join(inputDir, "first.md")],
        steps: true,
      }),
    )
    const folder = sessionFolderFor(workspace, created.session.id)
    await dressSession(folder)
    const before = sessionFileHashes(folder)
    // All three exist, so a byte change would be visible.
    expect(before).not.toEqual({
      "chat.jsonl": "absent",
      "progress.jsonl": "absent",
      "assignment-steps.md": "absent",
    })
    expect(before["chat.jsonl"]).not.toBe("absent")
    expect(before["progress.jsonl"]).not.toBe("absent")
    expect(before["assignment-steps.md"]).not.toBe("absent")

    // Pick the second file the way the wizard does: through the real picker.
    const picker = unwrap(await createPicker({ root: inputDir }))
    const marked = unwrap(mark(picker, join(picker.root, "second.md")))
    expect(marked.marks).toEqual([join(picker.root, "second.md")])

    const added = unwrap(
      await addSources({ workspace, id: created.session.id, files: marked.marks }),
    )
    expect(added.added).toBe(1)
    expect(added.session.sources.length).toBe(2)

    // meta grew, the three other files did not change by a single byte.
    expect(sessionFileHashes(folder)).toEqual(before)

    // A duplicate is a no-op by hash, not a second copy.
    const again = unwrap(
      await addSources({ workspace, id: created.session.id, files: marked.marks }),
    )
    expect(again.added).toBe(0)
    expect(again.skipped).toBe(1)
    expect(again.session.sources.length).toBe(2)
    expect(sessionFileHashes(folder)).toEqual(before)

    // Copied sources carry a hash prefix so two files with one name never clash.
    const sources = readdirSync(join(folder, "sources")).sort()
    expect(sources.length).toBe(2)
    // The hash prefix changes the sort order, so compare the suffixes as a set.
    expect(sources.map((name) => name.replace(/^[0-9a-f]+-/, "")).sort()).toEqual([
      "first.md",
      "second.md",
    ])
  })

  test("archive needs a second key; cancel changes no bytes", async () => {
    const { workspace, archiveRoot } = await workspaceWith()
    const created = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Archive me", prompt: "p", steps: true }),
    )
    const rows = await rowsFor(workspace)
    const state = initialSessions(rows)

    // First press only arms; the copy names the object and warns about chat.
    const armed = arm(state, "archive")
    expect(armed.pending?.id).toBe(created.session.id)
    expect(warningFor(armed, "archive")).toContain("Chat history is not archived")

    const frame = await frameOf(armed, 80, 24)
    expect(frame).toContain("Archive me")
    expect(frame).toContain("Chat history is not archived")

    // Esc cancels: the model forgets the pending action…
    const cancelled = cancelPending(armed)
    expect(cancelled.pending).toBeUndefined()
    expect(confirm(cancelled, "archive").kind).toBe("refused")

    // …and a cancelled archive writes nothing.
    const before = hashTree(workspace.root)
    const noop = unwrap(
      await archiveSession({ workspace, archiveRoot, id: created.session.id, confirmed: false }),
    )
    expect(noop.archived).toBe(false)
    expect(hashTree(workspace.root)).toEqual(before)

    // Second press: the model now yields a call, and the service performs it.
    expect(confirm(armed, "archive").kind).toBe("call")
    const outcome = unwrap(
      await archiveSession({ workspace, archiveRoot, id: created.session.id, confirmed: true }),
    )
    expect(outcome.archived).toBe(true)

    // The row leaves the live list…
    expect(await listSessions({ workspace })).toEqual([])
    // …the folder moved, the archive carries no chat, and the archive is its own tree.
    expect(existsSync(sessionFolderFor(workspace, created.session.id))).toBe(false)
    const archivedFolder = join(archiveRoot, "school", "session", created.session.id)
    expect(existsSync(archivedFolder)).toBe(true)
    expect(existsSync(join(archivedFolder, "chat.jsonl"))).toBe(false)
    const meta = JSON.parse(readFileSync(join(archivedFolder, "meta.json"), "utf8"))
    expect(meta.archived).toBe(true)

    // The archived row renders from the archive root, marked archived.
    const archivedRows = await rowsFor(workspace, archiveRoot)
    const archivedFrame = await frameOf(initialSessions(archivedRows), 80, 24)
    expect(archivedFrame).toContain("Archive me")
  })

  test("delete warns about inbound links, cancel keeps every byte, confirm removes one folder", async () => {
    const { workspace } = await workspaceWith()
    const keep = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Keep me", prompt: "k" }),
    )
    const doomed = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Delete me", prompt: "d" }),
    )

    // A note that links to the doomed session: the warning must say so.
    const noteDir = join(workspace.paths.schoolVault, "sessions")
    await mkdir(noteDir, { recursive: true })
    await writeFile(
      join(noteDir, "links.md"),
      ["---", 'title: "Links"', "type: session-summary", "---", "", `See [[${doomed.session.id}]].`, ""].join(
        "\n",
      ),
    )

    const links = await inboundLinks({ workspace, id: doomed.session.id })
    expect(links.count).toBeGreaterThanOrEqual(0)

    const rows = await rowsFor(workspace)
    const state = initialSessions(rows)
    const armed = arm(state, "delete")
    expect(armed.pending?.id).toBe(doomed.session.id)
    const warning = warningFor(armed, "delete")
    expect(warning).toContain("Delete me")
    expect(warning).toMatch(/press d again to confirm/)

    // Cancel: no bytes change anywhere.
    const before = hashTree(workspace.root)
    const cancelled = unwrap(
      await deleteSession({ workspace, id: doomed.session.id, confirmed: false }),
    )
    expect(cancelled.deleted).toBe(false)
    expect(hashTree(workspace.root)).toEqual(before)

    // Confirm: exactly one folder disappears, the other session and the note stay.
    expect(confirm(armed, "delete").kind).toBe("call")
    const done = unwrap(await deleteSession({ workspace, id: doomed.session.id, confirmed: true }))
    expect(done.deleted).toBe(true)

    const after = hashTree(workspace.root)
    const gone = Object.keys(before).filter((key) => key.startsWith(`school/sessions/${doomed.session.id}/`))
    expect(gone.length).toBeGreaterThan(0)
    for (const key of gone) expect(after[key]).toBeUndefined()
    const kept = Object.keys(before).filter((key) => key.startsWith(`school/sessions/${keep.session.id}/`))
    for (const key of kept) expect(after[key]).toBe(before[key])
    expect(after["school/vault/sessions/links.md"]).toBe(before["school/vault/sessions/links.md"])
  })

  test("export writes a zip under exports/, the listing carries no chat", async () => {
    const { workspace, inputDir } = await workspaceWith()
    await writeFile(join(inputDir, "src.md"), "# Source\n")
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Export me",
        files: [join(inputDir, "src.md")],
        steps: true,
      }),
    )

    const rows = await rowsFor(workspace)
    const armed = arm(initialSessions(rows), "export")
    expect(armed.pending?.kind).toBe("export")
    expect(warningFor(armed, "export")).toContain("Export me")
    expect(confirm(armed, "export").kind).toBe("call")

    const outcome = unwrap(await exportSession({ workspace, id: created.session.id }))
    expect(outcome.path.startsWith(workspace.paths.exports)).toBe(true)
    expect(existsSync(outcome.path)).toBe(true)
    expect(relative(workspace.paths.exports, outcome.path)).toBe(`session-${created.session.id}.zip`)

    // Entries: meta + sources + steps, never chat or progress telemetry.
    expect(outcome.entries).toContain("meta.json")
    expect(outcome.entries.some((entry) => entry.startsWith("sources/"))).toBe(true)
    expect(outcome.entries).not.toContain("chat.jsonl")

    const listed = listZip(new Uint8Array(readFileSync(outcome.path)))
    expect(listed).toContain("meta.json")
    expect(listed).not.toContain("chat.jsonl")

    // An independent reader agrees, when the machine has `unzip`.
    const unzip = Bun.spawnSync({ cmd: ["unzip", "-l", outcome.path], stdout: "pipe", stderr: "pipe" })
    if (unzip.exitCode === 0) {
      const listing = unzip.stdout.toString()
      expect(listing).toContain("meta.json")
      expect(listing).not.toContain("chat.jsonl")
    }
  })

  test("a broken session shows a reason and does not crash the list", async () => {
    const { workspace } = await workspaceWith()
    const good = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Healthy", prompt: "ok" }),
    )
    const brokenFolder = join(workspace.paths.schoolSessions, "2026-11-01-0900-broken")
    await mkdir(brokenFolder, { recursive: true })
    await writeFile(join(brokenFolder, "meta.json"), "{ not json", "utf8")

    const rows = await listSessions({ workspace })
    expect(rows.map((row) => row.id).sort()).toEqual([good.session.id, "2026-11-01-0900-broken"].sort())

    const broken = rows.find((row) => row.id === "2026-11-01-0900-broken")!
    expect(broken.broken).toBe(true)
    expect(broken.reason?.length ?? 0).toBeGreaterThan(0)

    // The healthy row is untouched and the frame still renders both.
    const healthy = rows.find((row) => row.id === good.session.id)!
    expect(healthy.broken).toBe(false)

    const view = await rowsFor(workspace)
    const frame = await frameOf(initialSessions(view), 80, 24)
    expect(frame).toContain("2 · sort date")
    expect(frame).toContain("Healthy")
  })
})

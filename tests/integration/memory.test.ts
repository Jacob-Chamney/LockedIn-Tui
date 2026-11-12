/**
 * WP-304 — memory alongside a real session folder.
 *
 * The unit suite covers the rules; this proves the file lives where the session
 * model says it does, survives a real workspace, and stays out of the source
 * list that coverage and the toolbox read.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createLockInSession } from "../../src/services/lockin/create";
import { listSessions, openSession } from "../../src/services/lockin/manager";
import { createToolbox } from "../../src/services/lockin/toolbox";
import { memoryFor, memoryPath, readMemory, recordTurn } from "../../src/services/lockin/memory";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

let base: string
let workspace: Workspace
let folder: string
let sessionId: string
let inputFile: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "memory-integration-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  await import("node:fs/promises").then((fs) => fs.mkdir(join(base, "input"), { recursive: true }))
  inputFile = join(base, "input", "lecture-4.md")
  await writeFile(inputFile, "# Unit 4\n\nBoundary conditions.\n")

  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T14:30:00Z",
      name: "Physics — Unit 4",
      files: [inputFile],
    }),
  )
  folder = created.folder
  sessionId = created.session.id
})

afterEach(async () => {
  await removeTemp(base)
})

describe("memory in a real session", () => {
  test("writes memory.md inside the session folder", async () => {
    const outcome = unwrap(
      await recordTurn({
        folder,
        sessionId,
        outcome: "done",
        points: ["Boundary conditions decide the integral limits."],
        now: "2026-11-01T15:00:00.000Z",
      }),
    )
    expect(outcome.written).toBe(true)
    expect(memoryPath(folder)).toBe(join(folder, SESSION_FILES.memory))
    expect(existsSync(memoryPath(folder))).toBe(true)

    const text = await readFile(memoryPath(folder), "utf8")
    expect(text).toContain(`session: ${sessionId}`)
    expect(text).toContain("- Boundary conditions decide the integral limits.")
  })

  test("the session reports a memory path only after the first write", async () => {
    const before = unwrap(await openSession({ workspace, id: sessionId }))
    expect(before.session.memoryPath).toBeNull()

    unwrap(
      await recordTurn({
        folder,
        sessionId,
        outcome: "done",
        points: ["A point."],
        now: "2026-11-01T15:00:00.000Z",
      }),
    )

    const after = unwrap(await openSession({ workspace, id: sessionId }))
    expect(after.session.memoryPath).toBe(SESSION_FILES.memory)
  })

  test("memory never appears as a source, in the list or in the toolbox", async () => {
    unwrap(
      await recordTurn({
        folder,
        sessionId,
        outcome: "done",
        points: ["Boundary conditions decide the limits."],
        now: "2026-11-01T15:00:00.000Z",
      }),
    )

    const opened = unwrap(await openSession({ workspace, id: sessionId }))
    expect(opened.session.sources.map((source) => source.storedPath)).not.toContain(
      SESSION_FILES.memory,
    )
    expect(opened.session.sources).toHaveLength(1)

    const rows = await listSessions({ workspace })
    expect(rows[0]?.sourceCount).toBe(1)

    const listed = unwrap(await createToolbox({ workspace, sessionId }).tools.listSources())
    expect(listed.map((entry) => entry.name)).not.toContain(SESSION_FILES.memory)
  })

  test("a memory file whose session id does not match is still not a source", async () => {
    await writeFile(join(folder, SESSION_FILES.memory), "---\ntype: session-summary\n---\n\n- stray\n")
    const opened = unwrap(await openSession({ workspace, id: sessionId }))
    expect(opened.session.sources).toHaveLength(1)
    // Memory presence is read from the file, not from the source list.
    expect(opened.session.memoryPath).toBe(SESSION_FILES.memory)
  })

  test("two sessions keep separate memories", async () => {
    const other = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-02T09:00:00Z",
        name: "Chemistry",
        files: [inputFile],
      }),
    )

    unwrap(
      await recordTurn({ folder, sessionId, outcome: "done", points: ["Physics point."], now: "2026-11-01T15:00:00.000Z" }),
    )
    unwrap(
      await recordTurn({
        folder: other.folder,
        sessionId: other.session.id,
        outcome: "done",
        points: ["Chemistry point."],
        now: "2026-11-01T15:00:00.000Z",
      }),
    )

    expect((await memoryFor(folder, sessionId))?.points).toEqual(["Physics point."])
    expect((await memoryFor(other.folder, other.session.id))?.points).toEqual(["Chemistry point."])
    expect(unwrap(await readMemory(folder, sessionId))!.points).toEqual(["Physics point."])
  })

  test("a cancelled turn leaves no memory file behind", async () => {
    const outcome = unwrap(
      await recordTurn({
        folder,
        sessionId,
        outcome: "cancelled",
        points: ["never written"],
        now: "2026-11-01T15:00:00.000Z",
      }),
    )
    expect(outcome.written).toBe(false)
    expect(existsSync(memoryPath(folder))).toBe(false)
  })
})

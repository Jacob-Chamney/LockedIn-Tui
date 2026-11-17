/**
 * `activity.list` over a real data directory.
 *
 * These cases exercise the transport's read half and the service it delegates
 * to: a fake decision appends a record through the same log the write, command
 * and swarm paths use, then the method reads it back. The real decision paths
 * (propose → decide → run one swarm) are covered by
 * `tests/integration/server-data.test.ts`; nothing here boots a workspace or
 * contacts a provider.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { appendFile, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import type { BootFailure } from "../../src/app/boot"
import type { Result } from "../../src/domain/markdown"
import {
  ACTIVITY_KINDS,
  createActivityLog,
  type ActivityRecord,
} from "../../src/services/work/activity"
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol"
import type { Workspace } from "../../src/storage/workspace"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

let base: string
let workspaceRoot: string
let dataDir: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-activity-"))
  workspaceRoot = join(base, "workspace")
  dataDir = join(base, "data")
})

afterEach(async () => {
  await removeTemp(base)
})

/** The smallest workspace the activity log reads: a root outside the data dir. */
function fakeWorkspace(): Workspace {
  return { root: workspaceRoot, paths: { root: workspaceRoot } } as unknown as Workspace
}

/** A core whose boot resolves to a fake workspace and a real data directory. */
function core(): ReturnType<typeof createCoreServer> {
  const services = {
    workspace: fakeWorkspace(),
    settings: { dataDir },
  } as unknown as CoreServices
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  })
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line)
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`)
  return parsed
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(
    request(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
    ),
  )
  if (response === null) throw new Error("expected a response")
  return response
}

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params)
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`)
  return response.result
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params)
  if (!("error" in response)) throw new Error(`${method} should have failed`)
  return response.error
}

/** Append one record through the log the decision paths write to. */
async function append(record: ActivityRecord): Promise<void> {
  const log = createActivityLog(fakeWorkspace(), { dataDir })
  if (!log.ok) throw new Error(log.error.message)
  const written = await log.value.append(record)
  if (!written.ok) throw new Error(written.error.message)
}

const writeEvent: ActivityRecord = {
  kind: "write-decision",
  project: "activity-app-1a2b3c",
  path: "notes.md",
  decision: "approve",
  hunks: [0],
  at: "2026-11-01T10:01:00.000Z",
}

const commandEvent: ActivityRecord = {
  kind: "command-decision",
  project: "activity-app-1a2b3c",
  argv: ["printf", "ok"],
  cwd: ".",
  decision: "approve",
  exitCode: 0,
  durationMs: 12,
  timedOut: false,
  at: "2026-11-01T10:02:00.000Z",
}

const swarmEvent: ActivityRecord = {
  kind: "swarm",
  project: "other-app-4d5e6f",
  run: "2026-11-01T10-00-00Z",
  event: "started",
  status: "running",
  at: "2026-11-01T10:00:00.000Z",
}

describe("activity.list", () => {
  test("an absent log is an empty state, not an error", async () => {
    const listed = await resultOf(core(), "activity.list")
    expect(listed).toEqual({ records: [], skipped: 0, empty: true })
    expect(existsSync(join(dataDir, "activity.jsonl"))).toBe(false)
  })

  test("a fake decision appends a record the method reads back, newest first", async () => {
    await append(swarmEvent)
    await append(writeEvent)
    await append(commandEvent)

    const listed = await resultOf(core(), "activity.list")
    expect(listed.empty).toBe(false)
    expect(listed.skipped).toBe(0)
    const records = listed.records as ActivityRecord[]
    expect(records.map((record) => record.kind)).toEqual([
      "command-decision",
      "write-decision",
      "swarm",
    ])
    expect(records[1]).toEqual(writeEvent)
    expect(records[0]).toEqual(commandEvent)
  })

  test("kind filters to one record kind", async () => {
    await append(swarmEvent)
    await append(writeEvent)
    await append(commandEvent)

    const listed = await resultOf(core(), "activity.list", { kind: "swarm" })
    const records = listed.records as ActivityRecord[]
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(swarmEvent)
  })

  test("project filters to one project's history", async () => {
    await append(swarmEvent)
    await append(writeEvent)

    const listed = await resultOf(core(), "activity.list", { project: "activity-app-1a2b3c" })
    const records = listed.records as ActivityRecord[]
    expect(records).toHaveLength(1)
    expect(records[0]?.project).toBe("activity-app-1a2b3c")
  })

  test("limit caps the newest records", async () => {
    await append(swarmEvent)
    await append(writeEvent)
    await append(commandEvent)

    const listed = await resultOf(core(), "activity.list", { limit: 2 })
    const records = listed.records as ActivityRecord[]
    expect(records.map((record) => record.kind)).toEqual(["command-decision", "write-decision"])
  })

  test("a corrupt line is skipped and counted; the readable records still return", async () => {
    await append(writeEvent)
    await appendFile(join(dataDir, "activity.jsonl"), "this is not json\n", "utf8")

    const listed = await resultOf(core(), "activity.list")
    expect(listed.skipped).toBe(1)
    const records = listed.records as ActivityRecord[]
    expect(records).toEqual([writeEvent])
  })

  test("bad kind and limit are -32602 and name the accepted set", async () => {
    const server = core()

    const kind = await errorOf(server, "activity.list", { kind: "bogus" })
    expect(kind.code).toBe(-32602)
    for (const accepted of ACTIVITY_KINDS) expect(kind.message).toContain(accepted)

    for (const limit of [0, -1, 1.5, 501, "5"]) {
      const response = await errorOf(server, "activity.list", { limit })
      expect(response.code).toBe(-32602)
      expect(response.message).toContain("1 to 500")
    }

    const project = await errorOf(server, "activity.list", { project: "  " })
    expect(project.code).toBe(-32602)
  })

  test("the reply never carries the log's absolute path or the data directory", async () => {
    await append(writeEvent)
    await append(commandEvent)
    await append(swarmEvent)

    const listed = await resultOf(core(), "activity.list")
    expect((listed.records as ActivityRecord[]).length).toBe(3)
    const text = JSON.stringify(listed)
    expect(text).not.toContain(dataDir)
    expect(text).not.toContain(workspaceRoot)
    expect(text).not.toContain("activity.jsonl")
    expect(listed).not.toHaveProperty("path")
  })

  test("a log that cannot be opened is one retryable:false activity error", async () => {
    // A data dir *inside* the workspace is refused by `createActivityLog`, which
    // is the one deterministic construction failure the transport can report.
    const services = {
      workspace: { root: workspaceRoot, paths: { root: workspaceRoot } },
      settings: { dataDir: join(workspaceRoot, "data") },
    } as unknown as CoreServices
    const server = createCoreServer({
      boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    })

    const response = await errorOf(server, "activity.list")
    expect(response.code).toBe(BOOT_FAILED)
    expect(response.retryable).toBe(false)
    expect(response.data).toMatchObject({ kind: "activity" })
  })
})

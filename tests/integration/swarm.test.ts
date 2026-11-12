/**
 * WP-506 — swarms and the task board, against real metadata and real reports.
 *
 * The packet's acceptance rows are the outline. Each test names the behaviour it
 * protects, and the report on disk is read back as bytes — "wrote a report"
 * means a file exists with the documented frontmatter, not that a writer was
 * called.
 *
 * The worker runner is a deterministic fake, so nothing here touches a model.
 * The fake records a start/end trace, which is how "sequential" and "four at
 * once" are observable rather than assumed from the scheduler's internals.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { READ_ONLY_TOOL_NAMES } from "../../src/services/work/scope";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createAgent, type AgentProfile } from "../../src/services/work/agents";
import { register } from "../../src/services/work/register";
import { MAX_PARALLEL, createSwarmService, reportPath, reportsDir, type SwarmDeps, type WorkerRequest, type WorkerResult } from "../../src/services/work/swarm";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function refusal<T>(result: { ok: boolean; value?: T; error?: unknown }): { kind: string; message?: string } {
  if (result.ok) throw new Error("expected a refusal, got a value")
  return result.error as { kind: string; message?: string }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function assertOrder(trace: string[], expected: string[]): void {
  const filtered = trace.filter((line) => !line.startsWith("result"))
  expect(filtered).toEqual(expected)
}

let base: string
let workspace: Workspace
let projectId: string
let reader: AgentProfile
let implementer: AgentProfile

/** A runner that returns immediately and records the call order. */
function ordered(outcomes: Record<string, WorkerResult> = {}) {
  const trace: string[] = []
  const runner: SwarmDeps["runner"] = async (request) => {
    trace.push(`start ${request.taskId}`)
    const result = outcomes[request.taskId] ?? { status: "done", summary: `finished ${request.taskId}` }
    trace.push(`end ${request.taskId}`)
    return result
  }
  return { trace, runner }
}

function service(runner: SwarmDeps["runner"], fixed = new Date("2026-11-01T16:00:00.000Z")) {
  const events: string[] = []
  const created = createSwarmService({
    workspace,
    runner,
    now: () => new Date(fixed),
    onActivity: (event) => {
      events.push(`${event.event}:${event.status ?? ""}`)
    },
  })
  return { service: created, events }
}

function planFrom(ids: readonly string[], agentId?: string) {
  return ids.map((id) => ({
    title: `Task ${id}`,
    agentId: agentId ?? reader.id,
    assignment: `do the work for ${id}`,
  }))
}

async function runReport(project: string, runId: string): Promise<string> {
  return readFile(reportPath(workspace, project, runId), "utf8")
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "swarm-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  const root = join(base, "project")
  await mkdir(join(root, "src"), { recursive: true })
  projectId = unwrap(await register({ workspace, root, name: "My app" })).meta.id
  reader = unwrap(await createAgent({ workspace, projectId, name: "Reader" }))
  implementer = unwrap(
    await createAgent({
      workspace,
      projectId,
      name: "Implementer",
      allowWrite: true,
      allowCommand: true,
    }),
  )
})

afterEach(async () => {
  await removeTemp(base)
})

describe("plan and workers", () => {
  test("a 3-task plan produces three rows and one report listing all three", async () => {
    const { trace, runner } = ordered()
    const { service: swarm } = service(runner)

    const outcome = unwrap(
      await swarm.run({
        projectId,
        objective: "Add pagination",
        plan: planFrom(["1", "2", "3"]),
      }),
    )

    expect(outcome.run.tasks.map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"])
    expect(outcome.run.tasks.every((task) => task.status === "done")).toBe(true)
    expect(outcome.run.status).toBe("done")
    expect(trace.length).toBe(6)

    const report = await runReport(projectId, outcome.run.id)
    expect(report.startsWith("---\n")).toBe(true)
    expect(report).toContain(`run: ${outcome.run.id}`)
    expect(report).toContain('objective: "Add pagination"')
    expect(report).toContain("status: done")
    expect(report).toContain("agents: 3")
    expect(report).toContain("## Task results")
    expect(report).toContain("- [done] Reader — finished task-1")
    expect(report).toContain("- [done] Reader — finished task-3")
  })

  test("every worker is read-only even when its stored profile allows writes and commands", async () => {
    const seen: WorkerRequest[] = []
    const { service: swarm } = service(async (request) => {
      seen.push(request)
      return { status: "done", summary: "looked" }
    })

    unwrap(
      await swarm.run({
        projectId,
        objective: "Review only",
        plan: planFrom(["1"], implementer.id),
      }),
    )

    expect(seen).toHaveLength(1)
    const worker = seen[0]!
    expect(worker.agent.allowWrite).toBe(false)
    expect(worker.agent.allowCommand).toBe(false)
    expect(worker.agent.allowedTools).toEqual([...READ_ONLY_TOOL_NAMES])
    expect(worker.tools).toEqual([...READ_ONLY_TOOL_NAMES])
    expect(worker.tools).not.toContain("write_file")
    expect(worker.tools).not.toContain("run_command")
  })

  test("a parallel request for 5 is refused before any worker starts and writes no report", async () => {
    let calls = 0
    const { service: swarm } = service(async () => {
      calls++
      return { status: "done", summary: "should not run" }
    })

    const error = refusal(
      await swarm.run({
        projectId,
        objective: "Too wide",
        plan: planFrom(["1", "2", "3", "4", "5"]),
        parallel: 5,
      }),
    )

    expect(error.kind).toBe("cap")
    expect(error.message).toContain(String(MAX_PARALLEL))
    expect(calls).toBe(0)
    expect(swarm.runs(projectId)).toEqual([])
    // No run record means no report directory is created either.
    expect(existsSync(reportsDir(workspace, projectId))).toBe(false)
  })

  test("a parallel run of 4 actually overlaps", async () => {
    const release = deferred()
    const fourth = deferred()
    let started = 0
    let active = 0
    let maxActive = 0
    const { service: swarm } = service(async () => {
      started++
      active++
      maxActive = Math.max(maxActive, active)
      if (started === 4) fourth.resolve()
      await release.promise
      active--
      return { status: "done", summary: "read" }
    })

    const pending = swarm.run({
      projectId,
      objective: "Read four areas",
      plan: planFrom(["1", "2", "3", "4"]),
      parallel: 4,
    })

    await fourth.promise
    expect(started).toBe(4)
    release.resolve()

    const outcome = unwrap(await pending)
    expect(maxActive).toBe(4)
    expect(outcome.run.parallel).toBe(4)
    expect(outcome.run.tasks.every((task) => task.status === "done")).toBe(true)
  })

  test("sequential mode cannot start a task before the previous one finishes", async () => {
    const { trace, runner } = ordered({ "task-2": { status: "done", summary: "second" } })
    const { service: swarm } = service(runner)

    unwrap(
      await swarm.run({
        projectId,
        objective: "One at a time",
        plan: planFrom(["1", "2", "3"]),
      }),
    )

    assertOrder(trace, [
      "start task-1",
      "end task-1",
      "start task-2",
      "end task-2",
      "start task-3",
      "end task-3",
    ])
  })

  test("an unknown agent is refused before any worker runs", async () => {
    let calls = 0
    const { service: swarm } = service(async () => {
      calls++
      return { status: "done" }
    })

    const error = refusal(
      await swarm.run({
        projectId,
        objective: "Missing",
        plan: [{ title: "Task", agentId: "ghost-000000", assignment: "x" }],
      }),
    )

    expect(error.kind).toBe("not-found")
    expect(calls).toBe(0)
  })
})

describe("lifecycle", () => {
  test("cancelling mid-run cancels the running and pending tasks and writes a cancelled report", async () => {
    const firstStarted = deferred()
    const release = deferred()
    let calls = 0
    const { service: swarm } = service(async (request) => {
      calls++
      if (calls === 1) firstStarted.resolve()
      await release.promise
      return { status: "done", summary: `late ${request.taskId}` }
    })

    const pending = swarm.run({
      projectId,
      objective: "Stop me",
      plan: planFrom(["1", "2", "3"]),
    })

    await firstStarted.promise
    const run = serviceRun(swarm, projectId)
    const cancelled = unwrap(swarm.cancel(projectId, run))
    expect(cancelled.status).toBe("cancelled")
    release.resolve()

    const outcome = unwrap(await pending)
    expect(outcome.run.status).toBe("cancelled")
    expect(outcome.run.tasks.map((task) => task.status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ])
    expect(outcome.run.reportPath).not.toBeNull()

    const report = await runReport(projectId, outcome.run.id)
    expect(report).toContain("status: cancelled")
    expect(report).toContain("- [cancelled] Reader")
    // The late worker summary is discarded, not recorded.
    expect(report).not.toContain("late task-1")
  })

  test("a failed task fails the run, writes the report and starts no retry", async () => {
    const { service: swarm } = service(
      ordered({ "task-2": { status: "failed", summary: "could not read the folder" } }).runner,
    )

    const outcome = unwrap(
      await swarm.run({
        projectId,
        objective: "Fix things",
        plan: planFrom(["1", "2", "3"]),
      }),
    )

    expect(outcome.run.status).toBe("failed")
    expect(outcome.run.tasks[1]!.status).toBe("failed")
    // No automatic retry: exactly the run the user asked for exists.
    expect(swarm.runs(projectId)).toHaveLength(1)

    const report = await runReport(projectId, outcome.run.id)
    expect(report).toContain("status: failed")
    expect(report).toContain("- [failed] Reader — could not read the folder")
  })

  test("retry creates a new single-agent read-only run and leaves the original report byte-identical", async () => {
    let attempts = 0
    const { service: swarm } = service(async (request) => {
      attempts++
      expect(request.agent.allowWrite).toBe(false)
      expect(request.agent.allowCommand).toBe(false)
      return attempts === 1
        ? { status: "failed", summary: "first attempt" }
        : { status: "done", summary: "second attempt worked" }
    })

    const first = unwrap(
      await swarm.run({
        projectId,
        objective: "Fix things",
        plan: [{ title: "Investigate", agentId: implementer.id, assignment: "look closely" }],
      }),
    )
    expect(first.run.status).toBe("failed")
    const before = await readFile(reportPath(workspace, projectId, first.run.id))

    // The retry runs inside the service that owns the original record.
    const retried = unwrap(
      await swarm.retry({ projectId, runId: first.run.id, taskId: "task-1" }),
    )

    expect(retried.run.id).not.toBe(first.run.id)
    expect(retried.run.tasks).toHaveLength(1)
    expect(retried.run.retryOf).toEqual({ runId: first.run.id, taskId: "task-1" })
    expect(retried.run.tasks[0]!.agentId).toBe(implementer.id)
    expect(retried.run.status).toBe("done")

    const after = await readFile(reportPath(workspace, projectId, first.run.id))
    expect(after.equals(before)).toBe(true)

    // The original run record is untouched too.
    const original = unwrap(swarm.reopen(projectId, first.run.id))
    expect(original.status).toBe("failed")
    expect(original.tasks[0]!.status).toBe("failed")
  })

  test("retry refuses a task that did not fail", async () => {
    const { service: swarm } = service(ordered().runner)
    const outcome = unwrap(
      await swarm.run({ projectId, objective: "Done", plan: planFrom(["1"]) }),
    )

    const error = refusal(
      await swarm.retry({ projectId, runId: outcome.run.id, taskId: "task-1" }),
    )
    expect(error.kind).toBe("invalid-input")
    expect(String(error.message)).toContain("done")
  })

  test("reopen shows the finished board read-only and remove keeps the report", async () => {
    const { service: swarm } = service(ordered().runner)
    const outcome = unwrap(
      await swarm.run({ projectId, objective: "Read only", plan: planFrom(["1", "2"]) }),
    )

    const board = unwrap(swarm.reopen(projectId, outcome.run.id))
    expect(board.live).toBe(false)
    expect(board.tasks.map((task) => task.status)).toEqual(["done", "done"])

    // A caller cannot mutate the stored board through the snapshot.
    board.tasks[0]!.status = "failed"
    const again = unwrap(swarm.reopen(projectId, outcome.run.id))
    expect(again.tasks[0]!.status).toBe("done")

    const reportBefore = await readFile(reportPath(workspace, projectId, outcome.run.id))
    const removed = unwrap(swarm.remove(projectId, outcome.run.id))
    expect(removed.removed).toBe(true)
    expect(swarm.runs(projectId)).toEqual([])
    const reportAfter = await readFile(reportPath(workspace, projectId, outcome.run.id))
    expect(reportAfter.equals(reportBefore)).toBe(true)
  })
})

describe("report contents", () => {
  test("the report excludes assignments, prompts, keys and file bodies", async () => {
    const { service: swarm } = service(async () => ({
      status: "done",
      summary: "read src/a.ts and summarised it",
    }))

    const outcome = unwrap(
      await swarm.run({
        projectId,
        objective: "SECRET-OBJECTIVE-BODY should not appear in the body",
        plan: [
          {
            title: "Read the module",
            agentId: reader.id,
            assignment: "SECRET-PROMPT assignment text with sk-live-1234567890",
          },
        ],
      }),
    )

    const report = await runReport(projectId, outcome.run.id)
    expect(report).not.toContain("SECRET-PROMPT")
    expect(report).not.toContain("sk-live-1234567890")
    expect(report).not.toContain("export function")
    // The objective is documented frontmatter; it must not be echoed in the
    // body, where task text and file content would otherwise leak.
    const body = report.split("---").slice(2).join("---")
    expect(body).not.toContain("SECRET-OBJECTIVE-BODY")
  })

  test("a summary is flattened to one line and capped", async () => {
    const long = `first line\nsecond line ${"x".repeat(2_000)}`
    const { service: swarm } = service(async () => ({ status: "done", summary: long }))
    const outcome = unwrap(
      await swarm.run({ projectId, objective: "Long", plan: planFrom(["1"]) }),
    )

    const report = await runReport(projectId, outcome.run.id)
    const line = report.split("\n").find((entry) => entry.startsWith("- [done]")) ?? ""
    expect(line).not.toContain("\n")
    expect(line.length).toBeLessThan(600)
    expect(line.endsWith("…")).toBe(true)
  })
})

/** The first (only) run id the service knows about, for `cancel()` before the promise resolves. */
function serviceRun(swarm: ReturnType<typeof createSwarmService>, project: string): string {
  const runs = swarm.runs(project)
  expect(runs.length).toBe(1)
  return runs[0]!.runId
}

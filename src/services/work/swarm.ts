/**
 * Swarms and the task board for a Work project (WP-506).
 *
 * A swarm is one objective plus a coordinator's plan of independent tasks. The
 * coordinator never edits anything itself: every task becomes a `WorkTask` that
 * is handed to a fresh worker profile produced by `forSwarm()` (WP-503). That
 * copy is forced read-only and command-free, so no worker — and no code path
 * here — can enable a write or a shell command.
 *
 * The rules that are easiest to get wrong, and where they are enforced:
 *
 * - **The cap is checked before the first worker.** A request for five parallel
 *   workers returns `cap` and writes no report, because no run started.
 * - **Sequential means sequential.** With `parallel: 1` the next runner is not
 *   called until the previous promise settled, so a coordinator cannot start a
 *   task early.
 * - **No retry happens by itself.** A failed task ends the task and the run;
 *   `retry()` is an explicit call that creates a *new* run id and leaves the
 *   original report byte-identical.
 * - **Cancellation is cooperative.** `cancel()` aborts the run's signal, marks
 *   the running and pending tasks `cancelled`, and the coordinator writes the
 *   report with `status: cancelled` when the workers have settled.
 * - **The report is assembled once.** No task can rewrite it; it is written
 *   after every task reaches a terminal state, with metadata and one-line
 *   summaries only — never an assignment, a prompt, a key or a file body.
 *
 * Run records live in this service instance (the board is process state, per
 * `docs/architecture.md` §6.2); the durable artefact is `reports/<run-id>.md`
 * plus the run's task ids. `remove()` drops the record and deliberately leaves
 * the report on disk.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../domain/markdown";
import type { Workspace } from "../../storage/workspace";
import { forSwarm, listAgents, loadProjectMeta, type AgentError, type AgentProfile } from "./agents";
import { assertProjectId, projectFolder, type WorkError } from "./register";
import { writeFileAtomic } from "./writes";
/* -------------------------------------------------------------------------- */
/* limits and constants                                                        */
/* -------------------------------------------------------------------------- */

/** Hard cap from `docs/product.md` §8.4: parallel runs never exceed four. */
export const MAX_PARALLEL = 4

/** A plan has to fit a terminal board; more than this is a different feature. */
export const MAX_TASKS = 24

export const MAX_OBJECTIVE_CHARS = 500
export const MAX_TITLE_CHARS = 120
export const MAX_ASSIGNMENT_CHARS = 4_000
export const MAX_SUMMARY_CHARS = 500

/** Reports live beside chats, under the project's metadata folder. */
export const REPORTS_DIR = "reports"

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

export type SwarmTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "blocked"
  | "cancelled"

export type SwarmRunStatus = "running" | "done" | "failed" | "cancelled"

/** One row on the board and in the report (`docs/architecture.md` §3.2). */
export type SwarmTask = {
  /** Stable for the life of the run: `task-1`, `task-2`, … */
  id: string
  title: string
  agentId: string
  /** Kept for the worker only; never written to the report. */
  assignment: string
  status: SwarmTaskStatus
  /** One line, already truncated and stripped of newlines. */
  summary?: string
  /** A failure reason, metadata only. */
  error?: string
}

/** One entry of the coordinator's plan. `agentId: ""` means the default agent. */
export type SwarmPlanTask = {
  title: string
  agentId?: string
  assignment: string
}

export type SwarmRun = {
  id: string
  projectId: string
  objective: string
  status: SwarmRunStatus
  parallel: number
  tasks: SwarmTask[]
  startedAt: string
  finishedAt?: string
  /** Absolute path once the report has been written. */
  reportPath: string | null
  /** Set only on a run created by `retry()`. */
  retryOf?: { runId: string; taskId: string }
}

/** A read-only view of a run, safe to hand to the UI. */
export type SwarmBoard = {
  runId: string
  projectId: string
  objective: string
  status: SwarmRunStatus
  parallel: number
  startedAt: string
  finishedAt?: string
  reportPath: string | null
  retryOf?: { runId: string; taskId: string }
  /** True while workers may still change the rows. */
  live: boolean
  tasks: SwarmTask[]
}

export type SwarmActivityEvent = {
  kind: "swarm"
  project: string
  run: string
  event: "started" | "task" | "finished" | "cancelled" | "failed"
  task?: string
  status?: string
  at: string
}

export type SwarmError =
  | WorkError
  | AgentError
  | {
      /** More workers than the hard cap; refused before anything starts. */
      kind: "cap"
      cap: "parallel"
      value: number
      max: number
      message: string
    }
  | { kind: "not-found"; id: string; message: string }
  | { kind: "invalid-input"; field: string; message: string }

/**
 * What a worker runner is given. `agent` is already the `forSwarm()` copy, and
 * `tools` is the exact read-only list it may call — a runner cannot widen it.
 */
export type WorkerRequest = {
  runId: string
  taskId: string
  projectId: string
  objective: string
  assignment: string
  agent: AgentProfile
  tools: string[]
  /** Aborted by `cancel()`; a runner should stop at its next delta. */
  signal: AbortSignal
}

export type WorkerResult = {
  status: "done" | "failed" | "blocked"
  summary?: string
}

/** The model loop, injected. Tests pass a deterministic fake. */
export type WorkerRunner = (request: WorkerRequest) => Promise<WorkerResult>

export type SwarmDeps = {
  workspace: Workspace
  runner: WorkerRunner
  /** Deterministic ids and timestamps in tests. */
  now?: () => Date
  /** WP-507's activity sink. Metadata only; a failing sink is not fatal. */
  onActivity?: (event: SwarmActivityEvent) => void | Promise<void>
  /** Board updates, keyed to `AppState.tasks` in production. */
  onTaskUpdated?: (task: SwarmTask, runId: string) => void
}

export type RunInput = {
  projectId: string
  objective: string
  plan: readonly SwarmPlanTask[]
  /** Defaults to 1; values above `MAX_PARALLEL` are refused. */
  parallel?: number
}

export type RunOutcome = {
  run: SwarmRun
  board: SwarmBoard
}

export type RetryInput = {
  projectId: string
  runId: string
  taskId: string
}

export type SwarmService = {
  run(input: RunInput): Promise<Result<RunOutcome, SwarmError>>
  /** Cooperative: aborts running workers and cancels the rest. */
  cancel(projectId: string, runId: string): Result<SwarmRun, SwarmError>
  /** Drops the run record; the report file stays. */
  remove(projectId: string, runId: string): Result<{ removed: boolean; reportPath: string | null }, SwarmError>
  /** A finished run's board, read-only: no status changes. */
  reopen(projectId: string, runId: string): Result<SwarmBoard, SwarmError>
  /** Explicit retry as a new, single-agent read-only run. */
  retry(input: RetryInput): Promise<Result<RunOutcome, SwarmError>>
  /** Every known run for a project, newest last. */
  runs(projectId: string): SwarmBoard[]
  /** Live board rows, or `null` for an unknown run. */
  board(projectId: string, runId: string): SwarmBoard | null
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function inputError(field: string, message: string): SwarmError {
  return { kind: "invalid-input", field, message }
}


/**
 * Report-safe summary: one line, no control characters, capped. The report is
 * an index of what happened, not a transcript.
 */
export function sanitizeSummary(text: string): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return flat.length > MAX_SUMMARY_CHARS ? `${flat.slice(0, MAX_SUMMARY_CHARS - 1)}…` : flat
}


/** `reports/` for one project. */
export function reportsDir(workspace: Workspace, projectId: string): string {
  return join(projectFolder(workspace, projectId), REPORTS_DIR)
}

export function reportPath(workspace: Workspace, projectId: string, runId: string): string {
  return join(reportsDir(workspace, projectId), `${runId}.md`)
}

/** Filesystem-safe run id from an instant: `2026-11-01T16-00-00Z`. */
function runIdFor(date: Date, taken: (candidate: string) => boolean): string {
  const base = date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")
  if (!taken(base)) return base
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!taken(candidate)) return candidate
  }
}

const TASK_STATUS_LABEL: Record<SwarmTaskStatus, string> = {
  pending: "pending",
  running: "running",
  done: "done",
  failed: "failed",
  blocked: "blocked",
  cancelled: "cancelled",
}

/**
 * The report (`docs/data-model.md` §6.2).
 *
 * The frontmatter carries the four documented keys. The body carries task
 * titles and one-line results — no assignment text, no objective body, no file
 * content, no error payloads beyond a short reason.
 */
export function renderReport(run: SwarmRun, agents: ReadonlyMap<string, AgentProfile>): string {
  const lines: string[] = [
    "---",
    `run: ${run.id}`,
    `objective: ${JSON.stringify(run.objective)}`,
    `status: ${run.status}`,
    `agents: ${run.tasks.length}`,
    "---",
    "",
    "## Plan",
    "",
  ]

  for (const task of run.tasks) {
    const name = agents.get(task.agentId)?.name ?? task.agentId
    lines.push(`- ${task.title} — ${name}`)
  }

  lines.push("", "## Task results", "")

  for (const task of run.tasks) {
    const name = agents.get(task.agentId)?.name ?? task.agentId
    const label = TASK_STATUS_LABEL[task.status]
    const detail = task.summary || task.error || ""
    lines.push(detail ? `- [${label}] ${name} — ${detail}` : `- [${label}] ${name}`)
  }

  lines.push("")
  return lines.join("\n")
}

function cloneTask(task: SwarmTask): SwarmTask {
  return { ...task }
}

function toBoard(run: SwarmRun): SwarmBoard {
  return {
    runId: run.id,
    projectId: run.projectId,
    objective: run.objective,
    status: run.status,
    parallel: run.parallel,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    reportPath: run.reportPath,
    ...(run.retryOf ? { retryOf: { ...run.retryOf } } : {}),
    live: run.status === "running",
    tasks: run.tasks.map(cloneTask),
  }
}

function isTerminal(status: SwarmTaskStatus): boolean {
  return status !== "pending" && status !== "running"
}

/**
 * A mutable check the compiler cannot narrow away.
 *
 * `runTask` observes `cancel()` between awaits, so reading the run's status
 * through this helper is deliberate: the guard at the top of the function is
 * not a proof about the state after an await.
 */
function isCancelled(run: SwarmRun): boolean {
  return run.status === "cancelled"
}

/* -------------------------------------------------------------------------- */
/* service                                                                     */
/* -------------------------------------------------------------------------- */

export function createSwarmService(deps: SwarmDeps): SwarmService {
  const { workspace } = deps
  const now = deps.now ?? (() => new Date())
  const runs = new Map<string, SwarmRun>()
  const controllers = new Map<string, AbortController>()

  const keyOf = (projectId: string, runId: string): string => `${projectId}\u0000${runId}`

  function emit(event: SwarmActivityEvent): void {
    try {
      const result = deps.onActivity?.(event)
      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch(() => {
          // The activity log is documentation; it never fails a run.
        })
      }
    } catch {
      // Same rule as a rejected sink.
    }
  }

  function touch(task: SwarmTask, runId: string): void {
    try {
      deps.onTaskUpdated?.(cloneTask(task), runId)
    } catch {
      // A board repaint failure cannot change the run.
    }
  }

  /** Validate everything before a run record exists, so a refusal writes nothing. */
  async function prepare(input: RunInput): Promise<
    Result<
      {
        objective: string
        parallel: number
        tasks: SwarmTask[]
        agents: Map<string, AgentProfile>
      },
      SwarmError
    >
  > {
    const project = assertProjectId(input.projectId)
    if (!project.ok) return project

    const objective = input.objective.trim()
    if (objective === "") return err(inputError("objective", "a swarm needs an objective"))
    if (objective.length > MAX_OBJECTIVE_CHARS) {
      return err(
        inputError(
          "objective",
          `an objective is at most ${MAX_OBJECTIVE_CHARS} characters`,
        ),
      )
    }

    const parallel = input.parallel ?? 1
    if (!Number.isInteger(parallel) || parallel < 1) {
      return err(inputError("parallel", "parallel must be a whole number of at least 1"))
    }
    if (parallel > MAX_PARALLEL) {
      return err({
        kind: "cap",
        cap: "parallel",
        value: parallel,
        max: MAX_PARALLEL,
        message: `parallel ${parallel} exceeds the cap of ${MAX_PARALLEL} workers`,
      })
    }

    if (input.plan.length === 0) {
      return err(inputError("plan", "a swarm needs at least one task"))
    }
    if (input.plan.length > MAX_TASKS) {
      return err(inputError("plan", `a plan has at most ${MAX_TASKS} tasks`))
    }

    const meta = await loadProjectMeta(workspace, project.value)
    if (!meta.ok) return meta

    const listed = await listAgents(workspace, project.value)
    if (!listed.ok) return listed
    const byId = new Map(listed.value.agents.map((agent) => [agent.id, agent]))

    const agents = new Map<string, AgentProfile>()
    const tasks: SwarmTask[] = []

    for (const [index, entry] of input.plan.entries()) {
      const title = entry.title.trim()
      if (title === "") {
        return err(inputError("plan", `task ${index + 1} needs a title`))
      }
      if (title.length > MAX_TITLE_CHARS) {
        return err(
          inputError("plan", `task ${index + 1} title is longer than ${MAX_TITLE_CHARS} characters`),
        )
      }
      if (entry.assignment.length > MAX_ASSIGNMENT_CHARS) {
        return err(
          inputError(
            "plan",
            `task ${index + 1} assignment is longer than ${MAX_ASSIGNMENT_CHARS} characters`,
          ),
        )
      }

      const wanted = entry.agentId?.trim() || meta.value.default_agent
      if (wanted === "") {
        return err(
          inputError(
            "plan",
            `task ${index + 1} has no agent and the project has no default agent`,
          ),
        )
      }

      const stored = byId.get(wanted)
      if (!stored) {
        return err({
          kind: "not-found",
          id: wanted,
          message: `task ${index + 1} names an agent that does not exist: ${wanted}`,
        })
      }

      // The only profile that crosses the swarm boundary.
      const worker = forSwarm(stored)
      agents.set(worker.id, stored)

      tasks.push({
        id: `task-${index + 1}`,
        title,
        agentId: worker.id,
        assignment: entry.assignment,
        status: "pending",
      })
    }

    return ok({ objective, parallel, tasks, agents })
  }

  /**
   * Run one task. A worker can never change a result that already exists: the
   * row is only written from inside this function, and only while the run is
   * not cancelled.
   */
  async function runTask(
    run: SwarmRun,
    task: SwarmTask,
    agents: Map<string, AgentProfile>,
    signal: AbortSignal,
  ): Promise<void> {
    if (isCancelled(run) || task.status !== "pending") return

    const stored = agents.get(task.agentId)
    if (!stored) {
      task.status = "failed"
      task.error = "the agent profile disappeared"
      touch(task, run.id)
      return
    }

    // `forSwarm` again, defensively: the copy is a value, not a view.
    const worker = forSwarm(stored)
    task.status = "running"
    touch(task, run.id)
    emit({
      kind: "swarm",
      project: run.projectId,
      run: run.id,
      event: "task",
      task: task.id,
      status: "running",
      at: now().toISOString(),
    })

    let outcome: WorkerResult
    try {
      outcome = await deps.runner({
        runId: run.id,
        taskId: task.id,
        projectId: run.projectId,
        objective: run.objective,
        assignment: task.assignment,
        agent: worker,
        tools: [...worker.allowedTools],
        signal,
      })
    } catch (error) {
      outcome = { status: "failed", summary: describe(error) }
    }

    if (isCancelled(run)) {
      // The worker may have finished after the abort; its output is discarded.
      task.status = "cancelled"
      delete task.summary
      delete task.error
      touch(task, run.id)
      return
    }

    task.status = outcome.status
    if (outcome.summary) task.summary = sanitizeSummary(outcome.summary)
    if (outcome.status === "done") delete task.error
    else if (!task.summary) task.error = "the worker reported no result"
    touch(task, run.id)
    emit({
      kind: "swarm",
      project: run.projectId,
      run: run.id,
      event: "task",
      task: task.id,
      status: task.status,
      at: now().toISOString(),
    })
  }

  /** Sequential at width 1; at most `MAX_PARALLEL` lanes otherwise. */
  async function schedule(
    run: SwarmRun,
    agents: Map<string, AgentProfile>,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor = 0
    const width = Math.min(run.parallel, run.tasks.length)

    const lane = async (): Promise<void> => {
      for (;;) {
        if (run.status === "cancelled") return
        const index = cursor++
        const task = run.tasks[index]
        if (!task) return
        if (task.status === "pending") await runTask(run, task, agents, signal)
      }
    }

    await Promise.all(Array.from({ length: width }, () => lane()))
  }

  async function finish(run: SwarmRun, agents: Map<string, AgentProfile>): Promise<void> {
    if (run.status !== "cancelled") {
      const failed = run.tasks.some(
        (task) => task.status === "failed" || task.status === "blocked",
      )
      run.status = failed ? "failed" : "done"
    }
    for (const task of run.tasks) {
      if (!isTerminal(task.status)) task.status = "cancelled"
    }

    run.finishedAt = now().toISOString()

    const destination = reportPath(workspace, run.projectId, run.id)
    try {
      await mkdir(reportsDir(workspace, run.projectId), { recursive: true })
      const written = await writeFileAtomic(
        destination,
        renderReport(run, agents),
      )
      run.reportPath = written.ok ? destination : null
    } catch {
      run.reportPath = null
    }

    emit({
      kind: "swarm",
      project: run.projectId,
      run: run.id,
      event: run.status === "cancelled" ? "cancelled" : run.status === "failed" ? "failed" : "finished",
      status: run.status,
      at: run.finishedAt,
    })
  }

  function startController(runId: string): AbortController {
    const controller = new AbortController()
    controllers.set(runId, controller)
    return controller
  }

  async function execute(
    prepared: {
      objective: string
      parallel: number
      tasks: SwarmTask[]
      agents: Map<string, AgentProfile>
    },
    projectId: string,
    retryOf?: { runId: string; taskId: string },
  ): Promise<RunOutcome> {
    const id = runIdFor(now(), (candidate) => runs.has(keyOf(projectId, candidate)))
    const run: SwarmRun = {
      id,
      projectId,
      objective: prepared.objective,
      status: "running",
      parallel: prepared.parallel,
      tasks: prepared.tasks,
      startedAt: now().toISOString(),
      reportPath: null,
      ...(retryOf ? { retryOf } : {}),
    }
    runs.set(keyOf(projectId, id), run)

    const controller = startController(keyOf(projectId, id))
    emit({
      kind: "swarm",
      project: projectId,
      run: id,
      event: "started",
      status: "running",
      at: run.startedAt,
    })

    try {
      await schedule(run, prepared.agents, controller.signal)
    } finally {
      controllers.delete(keyOf(projectId, id))
      await finish(run, prepared.agents)
    }

    return { run, board: toBoard(run) }
  }

  return {
    async run(input) {
      const prepared = await prepare(input)
      if (!prepared.ok) return prepared
      return ok(await execute(prepared.value, input.projectId))
    },

    cancel(projectId, runId) {
      const project = assertProjectId(projectId)
      if (!project.ok) return project
      const run = runs.get(keyOf(project.value, runId))
      if (!run) {
        return err({
          kind: "not-found",
          id: runId,
          message: `no swarm run ${runId} in this project`,
        })
      }
      if (run.status !== "running") return ok(run)

      run.status = "cancelled"
      controllers.get(keyOf(project.value, runId))?.abort()
      for (const task of run.tasks) {
        if (!isTerminal(task.status)) {
          task.status = "cancelled"
          delete task.summary
          delete task.error
          touch(task, run.id)
        }
      }
      emit({
        kind: "swarm",
        project: run.projectId,
        run: run.id,
        event: "cancelled",
        status: "cancelled",
        at: now().toISOString(),
      })
      return ok(run)
    },

    remove(projectId, runId) {
      const project = assertProjectId(projectId)
      if (!project.ok) return project
      const key = keyOf(project.value, runId)
      const run = runs.get(key)
      if (!run) return ok({ removed: false, reportPath: null })
      if (run.status === "running") {
        return err(
          inputError("run", "cancel the swarm before removing its record"),
        )
      }
      runs.delete(key)
      // The report is durable and is never part of the run record.
      return ok({ removed: true, reportPath: run.reportPath })
    },

    reopen(projectId, runId) {
      const project = assertProjectId(projectId)
      if (!project.ok) return project
      const run = runs.get(keyOf(project.value, runId))
      if (!run) {
        return err({
          kind: "not-found",
          id: runId,
          message: `no swarm run ${runId} in this project`,
        })
      }
      if (run.status === "running") {
        return err(inputError("run", "the swarm is still running; open the live board"))
      }
      return ok(toBoard(run))
    },

    async retry(input) {
      const project = assertProjectId(input.projectId)
      if (!project.ok) return project
      const original = runs.get(keyOf(project.value, input.runId))
      if (!original) {
        return err({
          kind: "not-found",
          id: input.runId,
          message: `no swarm run ${input.runId} in this project`,
        })
      }
      const task = original.tasks.find((entry) => entry.id === input.taskId)
      if (!task) {
        return err({
          kind: "not-found",
          id: input.taskId,
          message: `no task ${input.taskId} in run ${input.runId}`,
        })
      }
      if (task.status !== "failed" && task.status !== "blocked") {
        return err(
          inputError(
            "task",
            `only a failed or blocked task can be retried; ${task.id} is ${task.status}`,
          ),
        )
      }

      // A new run, one worker, the same read-only boundary. The original run
      // and its report are never touched.
      const prepared = await prepare({
        projectId: project.value,
        objective: original.objective,
        plan: [{ title: task.title, agentId: task.agentId, assignment: task.assignment }],
        parallel: 1,
      })
      if (!prepared.ok) return prepared

      return ok(
        await execute(prepared.value, project.value, {
          runId: original.id,
          taskId: task.id,
        }),
      )
    },

    runs(projectId) {
      const result: SwarmBoard[] = []
      for (const run of runs.values()) {
        if (run.projectId === projectId) result.push(toBoard(run))
      }
      return result
    },

    board(projectId, runId) {
      const run = runs.get(keyOf(projectId, runId))
      return run ? toBoard(run) : null
    },
  }
}

/** Report bodies are plain Markdown with no secrets; exported for the tests. */
export const REPORT_BOUNDED_CHARS = MAX_SUMMARY_CHARS

/** A short reminder for the UI when a retry is offered. */
export const RETRY_HINT = "retry starts a new read-only run; the original report is kept"

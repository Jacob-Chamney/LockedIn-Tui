import { loadProjects, projectTools, type ChatToolSource, type LoadedProject } from "../app/actions/projects";
import {
  MAX_PARALLEL,
  createSwarmService,
  sanitizeSummary,
  type SwarmBoard,
  type SwarmError,
  type SwarmPlanTask,
  type SwarmService,
  type WorkerRequest,
  type WorkerResult,
  type WorkerRunner,
} from "../services/work/swarm";
import type { ActivityRecord } from "../services/work/activity";
import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SessionServices } from "./session-context";
import {
  LINK_MODEL_COPY,
  swarmChatId,
  swarmHistory,
  swarmWorkerPrompt,
  swarmWorkerResult,
} from "./swarm-workers";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  isRecord,
  messageOf,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What a swarm handler needs from the core. */
export type WorkSwarmContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
  activitySink: (current: C) => ((record: ActivityRecord) => Promise<void>) | undefined;
  resolveLoadedProject: (
    id: RpcId,
    current: C,
    raw: unknown,
  ) => Promise<{ error: JsonRpcFailure } | { project: LoadedProject }>;
};

/**
 * Project swarms (`docs/product.md` §8.4).
 *
 * A coordinator plan of independent tasks, each run by **one read-only worker**.
 * The worker is the `forSwarm` copy of a project agent, so nothing on this path
 * can write a file, start a process or widen a profile. The board is process
 * state; the Markdown report under the project's metadata folder is the only
 * artefact a run leaves behind, and it is what survives a restart.
 */
export function createWorkSwarmHandlers<C extends SessionServices>(
  ctx: WorkSwarmContext<C>,
): {
  handlers: {
    workSwarmRun: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmBoard: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmRuns: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmCancel: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmRemove: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmVerify: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    workSwarmRetry: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  /** The one swarm service this process owns, created on first use. */
  swarmServiceFor: (current: C) => SwarmService;
} {
  const { services, notify, activitySink, resolveLoadedProject } = ctx;

  const swarmWorkerRunner = (current: C): WorkerRunner => {
    const createChat = current.createChat;
    return async (request: WorkerRequest): Promise<WorkerResult> => {
      if (!createChat) return { status: "blocked", summary: LINK_MODEL_COPY };
      const rows = await loadProjects(current.workspace);
      const project = rows.find((row) => row.id === request.projectId);
      if (!project) {
        return { status: "failed", summary: "this project is no longer registered in this workspace" };
      }
      const base = projectTools({
        workspace: current.workspace,
        id: project.id,
        name: project.name,
        folder: project.folder,
      });
      if (base === null) return { status: "failed", summary: "this project has no folder to read" };

      const allowed = new Set(request.tools);
      const specs = base.specs.filter(
        (spec) =>
          spec.write !== true &&
          spec.command !== true &&
          (allowed.size === 0 || allowed.has(spec.name)),
      );
      const tools: ChatToolSource = {
        specs,
        resolveTool: async (name, input, context) => {
          if (!specs.some((spec) => spec.name === name)) {
            return JSON.stringify({
              ok: false,
              error: { kind: "unavailable", message: `a swarm worker may not call "${name}"` },
            });
          }
          return base.resolveTool(name, input, context);
        },
        context: (context) => base.context(context),
      };

      const history = swarmHistory(swarmChatId(request));
      const controller = createChat(history, "work", "work", tools.context, tools);
      const stop = (): void => controller.cancel();
      if (request.signal.aborted) stop();
      else request.signal.addEventListener("abort", stop, { once: true });
      try {
        const outcome = await controller.send(swarmWorkerPrompt(request));
        return swarmWorkerResult(outcome, controller.state());
      } catch (error) {
        return { status: "failed", summary: sanitizeSummary(oneLine(messageOf(error))) };
      } finally {
        request.signal.removeEventListener("abort", stop);
        controller.dispose();
      }
    };
  };

  /**
   * One swarm service per process, created on first use.
   *
   * A run record is process state (`docs/architecture.md` §6.2): the durable
   * artefact is `reports/<run-id>.md` under the project's metadata folder. A
   * core restart therefore forgets the board, exactly as it forgets a pending
   * write proposal, and the report is what survives.
   *
   * The service is the only place a worker is admitted, and it admits every
   * worker through `forSwarm` (read-only, command-free). Nothing in this
   * transport can widen a profile, write a file or start a process.
   */
  let swarmService: SwarmService | null = null;
  /**
   * Which project a live run belongs to.
   *
   * Learned from the worker entry, which is the first point that carries both
   * ids. Two projects starting a run in the same second would share a run id;
   * that is the one case where a board update could name the wrong project, and
   * it changes no state — a notification carries a read-only board.
   */
  const swarmRunProjects = new Map<string, string>();
  /** One queue of run-id waiters per project, resolved by the worker entry. */
  const swarmWaiters = new Map<string, Array<(runId: string) => void>>();
  /** Boards that changed since the last flush, coalesced like `chat.state`. */
  const swarmDirty = new Set<string>();
  let swarmTimer: ReturnType<typeof setTimeout> | null = null;

  const swarmDirtyKey = (projectId: string, runId: string): string =>
    `${projectId}\u0000${runId}`;

  const flushSwarms = (): void => {
    swarmTimer = null;
    const dirty = [...swarmDirty];
    swarmDirty.clear();
    if (swarmService === null) return;
    for (const key of dirty) {
      const separator = key.indexOf("\u0000");
      const projectId = key.slice(0, separator);
      const runId = key.slice(separator + 1);
      const board = swarmService.board(projectId, runId);
      // A removed run has no board; its removal was reported by the response.
      if (board === null) continue;
      notify({
        jsonrpc: "2.0",
        method: "work.swarm.updated",
        params: { projectId, runId, board },
      });
    }
  };

  /** Coalesce board changes at ~33 ms, so four lanes cannot flood the shell. */
  const scheduleSwarm = (projectId: string, runId: string): void => {
    swarmDirty.add(swarmDirtyKey(projectId, runId));
    if (swarmTimer !== null) return;
    swarmTimer = setTimeout(flushSwarms, 33);
  };

  /** The first worker call for a run tells the transport both ids. */
  const noteSwarmRun = (projectId: string, runId: string): void => {
    swarmRunProjects.set(runId, projectId);
    const queue = swarmWaiters.get(projectId);
    if (queue === undefined || queue.length === 0) return;
    const waiter = queue.shift();
    if (queue.length === 0) swarmWaiters.delete(projectId);
    waiter?.(runId);
  };

  const dropSwarmWaiter = (projectId: string, waiter: (runId: string) => void): void => {
    const queue = swarmWaiters.get(projectId);
    if (queue === undefined) return;
    const index = queue.indexOf(waiter);
    if (index !== -1) queue.splice(index, 1);
    if (queue.length === 0) swarmWaiters.delete(projectId);
  };

  /**
   * The real worker loop: one controller per task, read-only.
   *
   * The toolbox is `projectTools` — never `buildProjectChatTools` — so no
   * proposal tool exists on this path. The list is then narrowed to what
   * `forSwarm` allowed, and the resolver refuses every other name, so a worker
   * cannot be talked into a tool by the model. The transcript is an in-memory
   * port: nothing is written for a worker but the report the service owns.
   */

  const ensureSwarm = (current: C): SwarmService => {
    if (swarmService !== null) return swarmService;
    const runner = current.swarmRunner ?? swarmWorkerRunner(current);
    const sink = activitySink(current);
    swarmService = createSwarmService({
      workspace: current.workspace,
      // Every worker entry passes through here, so the transport learns the run
      // id before the first task settles and can answer `{runId, board}` while
      // the run is still live.
      runner: async (request) => {
        noteSwarmRun(request.projectId, request.runId);
        return runner(request);
      },
      ...(sink === undefined ? {} : { onActivity: sink }),
      onTaskUpdated: (_task, runId) => {
        const projectId = swarmRunProjects.get(runId);
        if (projectId !== undefined) scheduleSwarm(projectId, runId);
      },
    });
    return swarmService;
  };

  /** One typed swarm refusal; the message is already one line. */
  const swarmFailure = (
    id: RpcId,
    projectId: string,
    error: SwarmError,
    runId?: string,
  ): JsonRpcFailure => {
    const message = oneLine(error.message);
    return failure(
      id,
      BOOT_FAILED,
      message,
      {
        kind: "swarm",
        projectId,
        ...(runId === undefined ? {} : { runId }),
        message,
      },
      false,
    );
  };

  /**
   * Start one run and answer as soon as the service has registered it.
   *
   * The reply names the run while its workers are still going, which is what
   * makes `work.swarm.cancel` usable; the board is authoritative from
   * `work.swarm.updated` and the final `work.swarm.board`. A refusal happens
   * before any run exists, so the waiter is dropped and the typed error is the
   * whole answer.
   */
  const startSwarm = async (
    id: RpcId,
    service: SwarmService,
    projectId: string,
    start: () => ReturnType<SwarmService["run"]>,
    runIdForError?: string,
  ): Promise<{ error: JsonRpcFailure } | { runId: string; board: SwarmBoard }> => {
    let waiter!: (runId: string) => void;
    const started = new Promise<string>((resolve) => {
      waiter = resolve;
      const queue = swarmWaiters.get(projectId) ?? [];
      queue.push(resolve);
      swarmWaiters.set(projectId, queue);
    });

    const running = start();
    const first = await Promise.race([
      started.then((runId) => ({ kind: "started" as const, runId })),
      running.then((result) => ({ kind: "finished" as const, result })),
    ]);

    if (first.kind === "finished") {
      dropSwarmWaiter(projectId, waiter);
      if (!first.result.ok) {
        return { error: swarmFailure(id, projectId, first.result.error, runIdForError) };
      }
      scheduleSwarm(projectId, first.result.value.run.id);
      return { runId: first.result.value.run.id, board: first.result.value.board };
    }

    // The run is live: announce its final board when the workers settle.
    void running.then(
      (result) => {
        if (result.ok) scheduleSwarm(projectId, result.value.run.id);
      },
      () => {},
    );
    const board = service.board(projectId, first.runId);
    if (board === null) {
      return {
        error: swarmFailure(
          id,
          projectId,
          {
            kind: "not-found",
            id: first.runId,
            message: `no swarm run ${first.runId} in this project`,
          },
          first.runId,
        ),
      };
    }
    return { runId: first.runId, board };
  };

  /** A non-empty string parameter, or `null` — every swarm id is one. */
  const swarmId = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

  /** The wire plan, or `null` when a task is not `{title, agentId?, assignment, requires?}`. */
  const parseSwarmPlan = (raw: unknown): SwarmPlanTask[] | null => {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const plan: SwarmPlanTask[] = [];
    for (const entry of raw) {
      if (!isRecord(entry)) return null;
      if (typeof entry.title !== "string" || entry.title.trim() === "") return null;
      if (typeof entry.assignment !== "string") return null;
      const agentId = entry.agentId;
      if (agentId !== undefined && (typeof agentId !== "string" || agentId.trim() === "")) {
        return null;
      }
      const requires = entry.requires;
      if (
        requires !== undefined &&
        (!Array.isArray(requires) ||
          requires.some(
            (value) => typeof value !== "number" || !Number.isInteger(value) || value < 1,
          ))
      ) {
        return null;
      }
      plan.push({
        title: entry.title.trim(),
        assignment: entry.assignment,
        ...(typeof agentId === "string" ? { agentId: agentId.trim() } : {}),
        ...(Array.isArray(requires) ? { requires: [...requires] } : {}),
      });
    }
    return plan;
  };

  /**
   * The five reads and writes of the swarm board.
   *
   * `run` is the only method that starts workers. Every method validates its
   * parameter shapes before the app boots, and every refusal after boot is one
   * `-32000` with `data: {kind: "swarm", projectId, runId?, message}`; an
   * unknown project keeps the shared `project` shape.
   */
  const workSwarmRun = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.run requires a project id");
    if (typeof params.objective !== "string" || params.objective.trim() === "") {
      return invalid(id, "work.swarm.run requires a non-empty objective");
    }
    const plan = parseSwarmPlan(params.plan);
    if (plan === null) {
      return invalid(
        id,
        "work.swarm.run requires a non-empty plan of {title, agentId?, assignment, requires?} tasks",
      );
    }
    const rawParallel = params.parallel;
    if (rawParallel !== undefined) {
      if (
        typeof rawParallel !== "number" ||
        !Number.isInteger(rawParallel) ||
        rawParallel < 1 ||
        rawParallel > MAX_PARALLEL
      ) {
        return invalid(
          id,
          `work.swarm.run parallel must be a whole number from 1 to ${MAX_PARALLEL}`,
        );
      }
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;
    if (!current.value.createChat && !current.value.swarmRunner) {
      return failure(
        id,
        BOOT_FAILED,
        LINK_MODEL_COPY,
        { kind: "generation", projectId: resolved.project.id, message: LINK_MODEL_COPY },
        false,
      );
    }

    const service = ensureSwarm(current.value);
    const started = await startSwarm(id, service, resolved.project.id, () =>
      service.run({
        projectId: resolved.project.id,
        objective: (params.objective as string).trim(),
        plan,
        ...(typeof rawParallel === "number" ? { parallel: rawParallel } : {}),
      }),
    );
    if ("error" in started) return started.error;
    return success(id, { runId: started.runId, board: started.board });
  };

  const workSwarmBoard = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.board requires a project id");
    const runId = swarmId(params.runId);
    if (runId === null) return invalid(id, "work.swarm.board requires a run id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;

    const board = ensureSwarm(current.value).board(resolved.project.id, runId);
    if (board === null) {
      return swarmFailure(
        id,
        resolved.project.id,
        { kind: "not-found", id: runId, message: `no swarm run ${runId} in this project` },
        runId,
      );
    }
    return success(id, { board });
  };

  const workSwarmRuns = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.runs requires a project id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;

    return success(id, { runs: ensureSwarm(current.value).runs(resolved.project.id) });
  };

  const workSwarmCancel = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.cancel requires a project id");
    const runId = swarmId(params.runId);
    if (runId === null) return invalid(id, "work.swarm.cancel requires a run id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;

    const service = ensureSwarm(current.value);
    const cancelled = service.cancel(resolved.project.id, runId);
    if (!cancelled.ok) return swarmFailure(id, resolved.project.id, cancelled.error, runId);

    const board = service.board(resolved.project.id, runId);
    if (board === null) {
      return swarmFailure(
        id,
        resolved.project.id,
        { kind: "not-found", id: runId, message: `no swarm run ${runId} in this project` },
        runId,
      );
    }
    return success(id, { board });
  };

  const workSwarmRemove = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.remove requires a project id");
    const runId = swarmId(params.runId);
    if (runId === null) return invalid(id, "work.swarm.remove requires a run id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;

    const service = ensureSwarm(current.value);
    const removed = service.remove(resolved.project.id, runId);
    if (!removed.ok) return swarmFailure(id, resolved.project.id, removed.error, runId);

    // The record is gone, so a queued update has nothing left to describe. The
    // report file is untouched: removing a run never deletes its report.
    swarmRunProjects.delete(runId);
    swarmDirty.delete(swarmDirtyKey(resolved.project.id, runId));
    return success(id, {
      removed: removed.value.removed,
      reportPath: removed.value.reportPath,
    });
  };

  /**
   * Mark one completed task verified, or clear it.
   *
   * `done` means a worker answered; `verified` means a person reviewed it. Only
   * a `done` task can be verified. The report is rewritten when it exists, and
   * the decision is recorded in the activity log. This is process state, like
   * the rest of the board: a core restart forgets it.
   */
  const workSwarmVerify = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.verify requires a project id");
    const runId = swarmId(params.runId);
    if (runId === null) return invalid(id, "work.swarm.verify requires a run id");
    const taskId = swarmId(params.taskId);
    if (taskId === null) return invalid(id, "work.swarm.verify requires a task id");
    if (params.verified !== undefined && typeof params.verified !== "boolean") {
      return invalid(id, "work.swarm.verify: verified must be a boolean");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;

    const service = ensureSwarm(current.value);
    const result = await service.verify({
      projectId: resolved.project.id,
      runId,
      taskId,
      ...(params.verified === undefined ? {} : { verified: params.verified }),
    });
    if (!result.ok) return swarmFailure(id, resolved.project.id, result.error, runId);
    return success(id, { task: result.value.task, board: result.value.board });
  };

  const workSwarmRetry = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const projectId = swarmId(params.projectId);
    if (projectId === null) return invalid(id, "work.swarm.retry requires a project id");
    const runId = swarmId(params.runId);
    if (runId === null) return invalid(id, "work.swarm.retry requires a run id");
    const taskId = swarmId(params.taskId);
    if (taskId === null) return invalid(id, "work.swarm.retry requires a task id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveLoadedProject(id, current.value, projectId);
    if ("error" in resolved) return resolved.error;
    if (!current.value.createChat && !current.value.swarmRunner) {
      return failure(
        id,
        BOOT_FAILED,
        LINK_MODEL_COPY,
        { kind: "generation", projectId: resolved.project.id, message: LINK_MODEL_COPY },
        false,
      );
    }

    const service = ensureSwarm(current.value);
    const started = await startSwarm(
      id,
      service,
      resolved.project.id,
      () => service.retry({ projectId: resolved.project.id, runId, taskId }),
      runId,
    );
    if ("error" in started) return started.error;
    return success(id, { runId: started.runId, board: started.board });
  };


  return {
    handlers: {
      workSwarmRun,
      workSwarmBoard,
      workSwarmRuns,
      workSwarmCancel,
      workSwarmRemove,
      workSwarmVerify,
      workSwarmRetry,
    },
    swarmServiceFor: ensureSwarm,
  };
}

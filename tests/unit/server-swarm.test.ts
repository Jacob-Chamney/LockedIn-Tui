/**
 * `work.swarm.*` — the project swarm board over JSON-RPC.
 *
 * The real workspace, registry and metadata are used (a swarm writes a report
 * and reads real agent profiles), but the model loop is a seam: either the
 * `swarmRunner` field or a fake `createChat` factory. Nothing here contacts a
 * provider, and the only files written are the reports the service owns.
 *
 * The security assertion is the point of several cases: a worker is always the
 * `forSwarm` copy, so a project default agent that allows writes and commands
 * still hands a worker three read-only tools.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import type { ChatController, HistoryPort } from "../../src/app/chat-controller";
import type { Result } from "../../src/domain/markdown";
import {
  createAgent,
  listAgents,
  setDefaultAgent,
  type AgentProfile,
} from "../../src/services/work/agents";
import { register, setMode } from "../../src/services/work/register";
import { READ_ONLY_TOOL_NAMES } from "../../src/services/work/scope";
import {
  MAX_PARALLEL,
  reportPath,
  type SwarmBoard,
  type WorkerRequest,
  type WorkerResult,
  type WorkerRunner,
} from "../../src/services/work/swarm";
import type { ChatToolSource } from "../../src/app/actions/projects";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { ChatState } from "../../src/app/chat-model";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreNotification,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

const MODEL_COPY = "link a model in Settings → Providers";

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;
let projectRoot: string;
let projectId: string;
let defaultAgent: AgentProfile;

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-swarm-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));

  projectRoot = join(base, "project");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  projectId = unwrap(await register({ workspace, root: projectRoot, name: "Atlas" })).meta.id;
  unwrap(await setMode({ workspace, id: projectId, mode: "swarm", swarmName: "Review crew" }));

  // The default agent may write and run commands; a worker never inherits that.
  defaultAgent = unwrap(
    await createAgent({
      workspace,
      projectId,
      name: "Lead",
      allowWrite: true,
      allowCommand: true,
    }),
  );
  unwrap(await setDefaultAgent({ workspace, projectId, id: defaultAgent.id }));
});

afterEach(async () => {
  await removeTemp(base);
});

/**
 * The booted slice the protocol needs.
 *
 * Only `workspace` and `settings` are required by the swarm path; `createChat`
 * and `swarmRunner` are the two model seams a case may supply.
 */
function fakeServices(overrides: Partial<CoreServices> = {}): CoreServices {
  return {
    workspace,
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16_000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir,
      archiveBackend: "folder",
      archiveFolder: "",
      archiveGithubRepo: "",
      archiveGithubBranch: "main",
      archiveGithubConsent: false,
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    } as unknown as CoreServices["settings"],
    ...overrides,
  } as CoreServices;
}

type BootCounter = { calls: number };

function coreWith(
  services: CoreServices,
  notifications: CoreNotification[] = [],
  bootCount: BootCounter = { calls: 0 },
): CoreServer {
  return createCoreServer({
    boot: async () => {
      bootCount.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
    notify: (notification) => notifications.push(notification),
  });
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(
    request(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
    ),
  );
  if (response === null) throw new Error("expected a response");
  return response;
}

async function resultOf(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result;
}

/** Poll until a condition holds; never a fixed sleep. */
async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  ms = 2_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

/** The board once the run has left `running` and its report has been written. */
async function settledBoard(
  server: CoreServer,
  project: string,
  runId: string,
): Promise<SwarmBoard> {
  let latest: SwarmBoard | undefined;
  await until(async () => {
    const result = await resultOf(server, "work.swarm.board", { projectId: project, runId });
    latest = result.board as SwarmBoard;
    // A cancelled run leaves `running` in `cancel()` but only gets its report
    // once the workers have settled, so the report is the real finish line.
    return latest.status !== "running" && latest.reportPath !== null;
  }, "the swarm to settle");
  if (latest === undefined) throw new Error("the swarm produced no board");
  return latest;
}

async function runSwarm(
  server: CoreServer,
  params: Record<string, unknown>,
): Promise<{ runId: string; board: SwarmBoard }> {
  const result = await resultOf(server, "work.swarm.run", params);
  return { runId: result.runId as string, board: result.board as SwarmBoard };
}

function twoTaskPlan() {
  return [
    { title: "Map the modules", assignment: "list the source tree and describe each folder" },
    { title: "Trace the entry point", assignment: "read main and say where the process starts" },
  ];
}

/* -------------------------------------------------------------------------- */
/* Fake model loops                                                           */
/* -------------------------------------------------------------------------- */

type FakeTurn =
  | { kind: "done"; text: string }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

type CapturedChat = {
  scope: string | undefined;
  mode: string | undefined;
  tools: ChatToolSource | undefined;
  prompts: string[];
  history: HistoryPort;
};

/**
 * A chat factory that answers with the queued turns and records exactly what
 * the worker handed it: the mode, the toolbox and the prompt.
 */
function fakeChats(turns: FakeTurn[]): {
  captured: CapturedChat[];
  createChat: NonNullable<CoreServices["createChat"]>;
} {
  const captured: CapturedChat[] = [];
  const createChat = ((
    history: HistoryPort,
    scope?: string,
    mode?: string,
    _context?: unknown,
    tools?: ChatToolSource,
  ) => {
    const entry: CapturedChat = { scope, mode, tools, prompts: [], history };
    captured.push(entry);
    const state = { messages: [], error: undefined } as unknown as ChatState;
    const turn = turns.shift() ?? { kind: "done", text: "" };
    return {
      send: async (text?: string) => {
        entry.prompts.push(text ?? "");
        if (turn.kind === "done") {
          (state as unknown as { messages: unknown[] }).messages = [
            { id: "worker-0", role: "user", text: text ?? "", outcome: "done" },
            { id: "worker-1", role: "assistant", text: turn.text, outcome: "done" },
          ];
          return { kind: "sent", requestId: "chat-1", outcome: "done" };
        }
        if (turn.kind === "blocked") {
          return {
            kind: "no-model",
            reason: "no model configured",
            fix: "link a key in Settings → Providers",
          };
        }
        (state as unknown as { error: unknown }).error = {
          failed: turn.message,
          kept: "Nothing was saved.",
          next: "Relink the key.",
        };
        return { kind: "sent", requestId: "chat-1", outcome: "error" };
      },
      state: () => state,
      cancel: () => {},
      dispose: () => {},
    } as unknown as ChatController;
  }) as NonNullable<CoreServices["createChat"]>;
  return { captured, createChat };
}

/** A runner that records the request and returns a table-driven result. */
function fakeRunner(outcomes: Record<string, WorkerResult> = {}): {
  requests: WorkerRequest[];
  runner: WorkerRunner;
} {
  const requests: WorkerRequest[] = [];
  const runner: WorkerRunner = async (request) => {
    requests.push(request);
    return outcomes[request.taskId] ?? { status: "done", summary: `finished ${request.taskId}` };
  };
  return { requests, runner };
}

/** A runner that only finishes when the run is cancelled. */
function blockedRunner(): { requests: WorkerRequest[]; runner: WorkerRunner } {
  const requests: WorkerRequest[] = [];
  const runner: WorkerRunner = async (request) => {
    requests.push(request);
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) {
        resolve();
        return;
      }
      request.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return { status: "done", summary: "this answer must be discarded" };
  };
  return { requests, runner };
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

describe("capabilities", () => {
  test("the handshake advertises the six swarm methods", async () => {
    const response = await ask(coreWith(fakeServices()), "initialize", {
      protocol: 1,
      client: "flutter",
    });
    if ("error" in response) throw new Error("initialize must succeed");
    const capabilities = response.result.capabilities as string[];
    for (const method of [
      "work.swarm.run",
      "work.swarm.board",
      "work.swarm.runs",
      "work.swarm.cancel",
      "work.swarm.remove",
      "work.swarm.retry",
    ]) {
      expect(capabilities).toContain(method);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A run over the real board                                                  */
/* -------------------------------------------------------------------------- */

describe("work.swarm.run", () => {
  test("a plan's requires reach the board", async () => {
    const server = coreWith(
      fakeServices({
        swarmRunner: async () => ({ status: "done" as const, summary: "read" }),
      }),
    );
    const started = await runSwarm(server, {
      projectId,
      objective: "Dependent work",
      plan: [
        { title: "One", assignment: "read one" },
        { title: "Two", assignment: "read two", requires: [1] },
      ],
      parallel: 2,
    });
    const board = await settledBoard(server, projectId, started.runId);
    expect(board.tasks[1]?.requires).toEqual(["task-1"]);
  });

  test("a done task is verified by a separate call", async () => {
    const server = coreWith(
      fakeServices({
        swarmRunner: async () => ({ status: "done" as const, summary: "read" }),
      }),
    );
    const started = await runSwarm(server, {
      projectId,
      objective: "Verify",
      plan: [{ title: "One", assignment: "read one" }],
    });
    await settledBoard(server, projectId, started.runId);

    const verified = await resultOf(server, "work.swarm.verify", {
      projectId,
      runId: started.runId,
      taskId: "task-1",
    });
    expect((verified.task as Record<string, unknown>).verified).toBe(true);
    const board = verified.board as SwarmBoard;
    expect(board.tasks[0]?.verified).toBe(true);

    const cleared = await resultOf(server, "work.swarm.verify", {
      projectId,
      runId: started.runId,
      taskId: "task-1",
      verified: false,
    });
    expect((cleared.task as Record<string, unknown>).verified).toBe(false);
  });

  test("a two-task plan runs each worker read-only and writes one report", async () => {
    const { captured, createChat } = fakeChats([
      { kind: "done", text: "The modules are src/ and docs/.\nSecond line." },
      { kind: "done", text: "The process starts in src/main.ts." },
    ]);
    const notifications: CoreNotification[] = [];
    const server = coreWith(fakeServices({ createChat }), notifications);

    const started = await runSwarm(server, {
      projectId,
      objective: "Understand the project layout",
      plan: twoTaskPlan(),
    });

    // The reply names the run while it is still live, so cancel is usable.
    expect(started.runId).toEqual(expect.any(String));
    expect(started.board.projectId).toBe(projectId);
    expect(started.board.objective).toBe("Understand the project layout");
    expect(started.board.parallel).toBe(1);
    expect(started.board.tasks.map((task) => task.title)).toEqual([
      "Map the modules",
      "Trace the entry point",
    ]);

    const board = await settledBoard(server, projectId, started.runId);
    expect(board).toMatchObject({
      runId: started.runId,
      projectId,
      status: "done",
      live: false,
    });
    expect(board.tasks.map((task) => task.status)).toEqual(["done", "done"]);
    // A summary is one line: the report is an index, not a transcript.
    expect(board.tasks[0]?.summary).toBe("The modules are src/ and docs/. Second line.");
    expect(board.tasks[1]?.summary).toBe("The process starts in src/main.ts.");

    // Every worker got a work-mode controller with the read-only toolbox only.
    expect(captured).toHaveLength(2);
    for (const entry of captured) {
      expect(entry.mode).toBe("work");
      expect(entry.scope).toBe("work");
      const specs = entry.tools?.specs ?? [];
      expect(specs.map((spec) => spec.name)).toEqual([...READ_ONLY_TOOL_NAMES]);
      expect(specs.every((spec) => spec.write === false && spec.command === false)).toBe(true);
    }
    // The prompt carries the objective and that worker's own assignment.
    expect(captured[0]?.prompts[0]).toContain("Objective: Understand the project layout");
    expect(captured[0]?.prompts[0]).toContain(
      "Your task: list the source tree and describe each folder",
    );
    expect(captured[1]?.prompts[0]).toContain("Your task: read main and say where the process starts");

    // A worker's transcript is in-memory only, named by its virtual chat id.
    expect(await captured[0]?.history.load()).toEqual([]);
    expect((captured[0]?.history as { id?: string } | undefined)?.id).toBe(
      `swarm:${started.runId}:task-1`,
    );
    await captured[0]?.history.save([]);

    // The report exists, under this project, with the documented frontmatter.
    expect(board.reportPath).toBe(reportPath(workspace, projectId, started.runId));
    const report = await readFile(board.reportPath ?? "", "utf8");
    expect(report).toContain(`run: ${started.runId}`);
    expect(report).toContain('objective: "Understand the project layout"');
    expect(report).toContain("status: done");
    expect(report).toContain("- [done] task-1 · Lead — The modules are src/ and docs/. Second line.");

    // The board changed and completion announced itself, coalesced.
    await until(
      () =>
        notifications.some(
          (entry) =>
            entry.method === "work.swarm.updated" &&
            entry.params?.runId === started.runId &&
            (entry.params.board as SwarmBoard).status === "done",
        ),
      "a completion notification",
    );
    const update = notifications.find((entry) => entry.method === "work.swarm.updated");
    expect(update?.params).toMatchObject({ projectId, runId: started.runId });

    // Nothing but the report and the project metadata was written for a worker.
    expect((await readdir(join(workspaceRoot, "work", "projects", projectId))).sort()).toEqual([
      "meta.json",
      "reports",
    ]);
    expect(existsSync(join(workspaceRoot, "work", "projects", projectId, "chats"))).toBe(false);
    expect((await readdir(projectRoot)).sort()).toEqual(["src"]);
    expect(existsSync(join(projectRoot, "notes.md"))).toBe(false);
  });

  test("a blocked worker is reported as blocked and fails the run", async () => {
    const { createChat } = fakeChats([{ kind: "blocked" }]);
    const server = coreWith(fakeServices({ createChat }));

    const started = await runSwarm(server, {
      projectId,
      objective: "Look around",
      plan: [{ title: "Survey", assignment: "list the files" }],
    });
    const board = await settledBoard(server, projectId, started.runId);

    expect(board.status).toBe("failed");
    expect(board.tasks[0]?.status).toBe("blocked");
    expect(board.tasks[0]?.summary).toContain("no model configured");
  });

  test("a provider failure is one failed task and one failed run", async () => {
    const { createChat } = fakeChats([{ kind: "error", message: "The provider returned 500." }]);
    const server = coreWith(fakeServices({ createChat }));

    const started = await runSwarm(server, {
      projectId,
      objective: "Look around",
      plan: [{ title: "Survey", assignment: "list the files" }],
    });
    const board = await settledBoard(server, projectId, started.runId);

    expect(board.status).toBe("failed");
    expect(board.tasks[0]).toMatchObject({
      status: "failed",
      summary: "The provider returned 500.",
    });
  });

  test("the cap is four: parallel 4 runs, and each task still uses the seam", async () => {
    const { requests, runner } = fakeRunner();
    const server = coreWith(fakeServices({ swarmRunner: runner }));

    const started = await runSwarm(server, {
      projectId,
      objective: "Four at once",
      parallel: MAX_PARALLEL,
      plan: [1, 2, 3, 4].map((n) => ({ title: `Task ${n}`, assignment: `do ${n}` })),
    });
    expect(started.board.parallel).toBe(MAX_PARALLEL);

    const board = await settledBoard(server, projectId, started.runId);
    expect(board.status).toBe("done");
    expect(board.tasks).toHaveLength(4);
    expect(requests).toHaveLength(4);
  });
});

/* -------------------------------------------------------------------------- */
/* The worker boundary                                                        */
/* -------------------------------------------------------------------------- */

describe("worker boundary", () => {
  test("a write and command capable default agent still yields a read-only worker", async () => {
    // The stored profile is the one that may change things.
    const stored = unwrap(await listAgents(workspace, projectId));
    const profile = stored.agents.find((agent) => agent.id === defaultAgent.id);
    expect(profile).toMatchObject({ allowWrite: true, allowCommand: true });

    const { requests, runner } = fakeRunner();
    const server = coreWith(fakeServices({ swarmRunner: runner }));
    const started = await runSwarm(server, {
      projectId,
      objective: "Read only",
      plan: [{ title: "Survey", assignment: "list the files" }],
    });
    await settledBoard(server, projectId, started.runId);

    expect(requests).toHaveLength(1);
    const worker = requests[0];
    expect(worker?.tools).toEqual([...READ_ONLY_TOOL_NAMES]);
    expect(worker?.agent.allowWrite).toBe(false);
    expect(worker?.agent.allowCommand).toBe(false);
    expect(worker?.agent.allowedTools).toEqual([...READ_ONLY_TOOL_NAMES]);
    // The assignment reaches the worker; the objective is context.
    expect(worker?.objective).toBe("Read only");
    expect(worker?.assignment).toBe("list the files");
  });
});

/* -------------------------------------------------------------------------- */
/* Cancel, remove, retry                                                      */
/* -------------------------------------------------------------------------- */

describe("cancel, remove and retry", () => {
  test("cancel aborts the worker, keeps the report and refuses a live remove", async () => {
    const { requests, runner } = blockedRunner();
    const server = coreWith(fakeServices({ swarmRunner: runner }));

    const started = await runSwarm(server, {
      projectId,
      objective: "A long survey",
      plan: twoTaskPlan(),
    });
    await until(() => requests.length === 1, "the first worker to start");

    // Removing a live run is refused: cancel first.
    const refused = await ask(server, "work.swarm.remove", {
      projectId,
      runId: started.runId,
    });
    if (!("error" in refused)) throw new Error("a live run must not be removed");
    expect(refused.error.code).toBe(BOOT_FAILED);
    expect(refused.error.retryable).toBe(false);
    expect(refused.error.data).toMatchObject({ kind: "swarm", projectId, runId: started.runId });

    const cancelled = (await resultOf(server, "work.swarm.cancel", {
      projectId,
      runId: started.runId,
    })) as { board: SwarmBoard };
    expect(cancelled.board.status).toBe("cancelled");
    expect(cancelled.board.tasks.map((task) => task.status)).toEqual(["cancelled", "cancelled"]);

    const board = await settledBoard(server, projectId, started.runId);
    expect(board.status).toBe("cancelled");
    expect(board.tasks[0]?.summary).toBeUndefined();
    expect(board.reportPath).not.toBeNull();
    const report = await readFile(board.reportPath ?? "", "utf8");
    expect(report).toContain("status: cancelled");

    // The worker's answer arrived after the abort and was discarded.
    expect(requests[0]?.signal.aborted).toBe(true);

    const removed = await resultOf(server, "work.swarm.remove", {
      projectId,
      runId: started.runId,
    });
    expect(removed).toEqual({ removed: true, reportPath: board.reportPath });
    // Removing the record keeps the report.
    expect(existsSync(board.reportPath ?? "")).toBe(true);
    // The record is gone; the board and the list no longer name it.
    expect(await resultOf(server, "work.swarm.runs", { projectId })).toEqual({ runs: [] });
    const gone = await ask(server, "work.swarm.board", { projectId, runId: started.runId });
    if (!("error" in gone)) throw new Error("a removed run must not resolve");
    expect(gone.error.data).toMatchObject({ kind: "swarm", projectId, runId: started.runId });
  });

  test("a retry is a new single-agent run and leaves the original report alone", async () => {
    const outcomes: WorkerResult[] = [
      { status: "failed", summary: "the source tree was unreadable" },
      { status: "done", summary: "the source tree is src/ and docs/" },
    ];
    const runner: WorkerRunner = async () =>
      outcomes.shift() ?? { status: "done", summary: "nothing left to run" };
    const server = coreWith(fakeServices({ swarmRunner: runner }));

    const first = await runSwarm(server, {
      projectId,
      objective: "Understand the project",
      plan: [{ title: "Survey", assignment: "list the files" }],
    });
    const failed = await settledBoard(server, projectId, first.runId);
    expect(failed.status).toBe("failed");
    expect(failed.tasks[0]?.status).toBe("failed");
    const originalReport = await readFile(failed.reportPath ?? "", "utf8");

    const retried = (await resultOf(server, "work.swarm.retry", {
      projectId,
      runId: first.runId,
      taskId: "task-1",
    })) as { runId: string; board: SwarmBoard };
    expect(retried.runId).not.toBe(first.runId);
    expect(retried.board.retryOf).toEqual({ runId: first.runId, taskId: "task-1" });
    expect(retried.board.tasks).toHaveLength(1);

    const retryBoard = await settledBoard(server, projectId, retried.runId);
    expect(retryBoard.status).toBe("done");
    expect(retryBoard.tasks[0]?.status).toBe("done");

    // The original run and its report are untouched.
    const original = (await resultOf(server, "work.swarm.board", {
      projectId,
      runId: first.runId,
    })) as { board: SwarmBoard };
    expect(original.board.status).toBe("failed");
    expect(original.board.tasks[0]?.status).toBe("failed");
    expect(await readFile(failed.reportPath ?? "", "utf8")).toBe(originalReport);

    // Retrying a task that already succeeded is refused.
    const notFailed = await ask(server, "work.swarm.retry", {
      projectId,
      runId: retried.runId,
      taskId: "task-1",
    });
    if (!("error" in notFailed)) throw new Error("a done task must not be retried");
    expect(notFailed.error.code).toBe(BOOT_FAILED);
    expect(notFailed.error.data).toMatchObject({ kind: "swarm", projectId });
  });
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

describe("refusals", () => {
  test("a bad shape is -32602 and never boots the app", async () => {
    const bootCount = { calls: 0 };
    const server = coreWith(fakeServices({ swarmRunner: fakeRunner().runner }), [], bootCount);
    const badCode = async (method: string, params: Record<string, unknown>): Promise<number> => {
      const response = await ask(server, method, params);
      if (!("error" in response)) throw new Error(`${method} should have been refused`);
      return response.error.code;
    };

    expect(await badCode("work.swarm.run", {})).toBe(-32602);
    expect(
      await badCode("work.swarm.run", { projectId, objective: " ", plan: twoTaskPlan() }),
    ).toBe(-32602);
    expect(await badCode("work.swarm.run", { projectId, objective: "x", plan: [] })).toBe(-32602);
    expect(
      await badCode("work.swarm.run", { projectId, objective: "x", plan: [{ title: "", assignment: "" }] }),
    ).toBe(-32602);
    expect(
      await badCode("work.swarm.run", {
        projectId,
        objective: "x",
        plan: [{ title: "t", assignment: "a", agentId: " " }],
      }),
    ).toBe(-32602);
    for (const parallel of [0, MAX_PARALLEL + 1, 2.5, "2"]) {
      expect(
        await badCode("work.swarm.run", {
          projectId,
          objective: "x",
          plan: twoTaskPlan(),
          parallel,
        }),
      ).toBe(-32602);
    }
    expect(await badCode("work.swarm.board", { projectId })).toBe(-32602);
    expect(await badCode("work.swarm.runs", {})).toBe(-32602);
    expect(await badCode("work.swarm.cancel", { projectId })).toBe(-32602);
    expect(await badCode("work.swarm.remove", { projectId })).toBe(-32602);
    expect(await badCode("work.swarm.retry", { projectId, runId: "r1" })).toBe(-32602);

    // None of those shapes reached the runtime.
    expect(bootCount.calls).toBe(0);
  });

  test("an unknown project is the shared project shape for every method", async () => {
    const server = coreWith(fakeServices({ swarmRunner: fakeRunner().runner }));
    const missing = "missing-000000";
    const calls = [
      ["work.swarm.run", { projectId: missing, objective: "x", plan: twoTaskPlan() }],
      ["work.swarm.board", { projectId: missing, runId: "r1" }],
      ["work.swarm.runs", { projectId: missing }],
      ["work.swarm.cancel", { projectId: missing, runId: "r1" }],
      ["work.swarm.remove", { projectId: missing, runId: "r1" }],
      ["work.swarm.retry", { projectId: missing, runId: "r1", taskId: "task-1" }],
    ] as const;

    for (const [method, params] of calls) {
      const response = await ask(server, method, params as unknown as Record<string, unknown>);
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown project`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "project", projectId: missing });
    }
  });

  test("an unknown run is one typed swarm refusal", async () => {
    const server = coreWith(fakeServices({ swarmRunner: fakeRunner().runner }));
    const runId = "2026-11-01T16-00-00Z";
    for (const [method, params] of [
      ["work.swarm.board", { projectId, runId }],
      ["work.swarm.cancel", { projectId, runId }],
      ["work.swarm.retry", { projectId, runId, taskId: "task-1" }],
    ] as const) {
      const response = await ask(server, method, params as unknown as Record<string, unknown>);
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown run`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "swarm", projectId, runId });
    }
    // Removing an unknown run is a no-op, not an error: the record may have
    // been dropped by a restart and there is nothing left to delete.
    expect(await resultOf(server, "work.swarm.remove", { projectId, runId })).toEqual({
      removed: false,
      reportPath: null,
    });
  });

  test("a build with no chat factory and no runner refuses the run as generation", async () => {
    const server = coreWith(fakeServices());
    const response = await ask(server, "work.swarm.run", {
      projectId,
      objective: "Anything",
      plan: [{ title: "Survey", assignment: "list the files" }],
    });
    if (!("error" in response)) throw new Error("a missing model loop must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({ kind: "generation", projectId, message: MODEL_COPY });
  });
});

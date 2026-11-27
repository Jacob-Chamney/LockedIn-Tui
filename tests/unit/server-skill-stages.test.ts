/**
 * `skill.stages.save`: request validation, refusal and the confirmed path.
 *
 * Every case uses an injected boot seam over a throwaway workspace so a stage
 * list can really be read and written. No provider is contacted and no config
 * file is needed: the stage handler never reads settings. The reorder/add/rename
 * walk and the goal manager verbs live in
 * `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { removeTemp } from "../helpers/cleanup";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { applyTransition, readMeta } from "../../src/services/skills/progress";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const CREATED = "2026-11-01T09:00:00.000Z";

const STAGES: StageDraft[] = [
  { title: "Registers", milestone: "explain a stack frame" },
  { title: "Control flow", milestone: "trace a loop" },
  { title: "Conventions", milestone: "read a prologue" },
];

let base: string;
let workspace: Workspace;
let goalId: string;

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/**
 * A `CoreServices` with the real workspace and no completion. The stage handler
 * reads `meta.json` and writes it back; nothing else on `Booted` is touched.
 */
function servicesWith(): CoreServices {
  return {
    workspace,
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: join(base, "data"),
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
    },
  } as unknown as CoreServices;
}

/** A core with an injected boot, counting how often the workspace is opened. */
function fakeCore(services: CoreServices = servicesWith()) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
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
  );
  if (response === null) throw new Error("expected a response");
  return response;
}

/** The successful `result` of one call, or a thrown failure. */
async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method}: ${response.error.message}`);
  return response.result;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

function goalFolder(id: string): string {
  return join(workspace.paths.goals, id);
}

function metaPath(id: string): string {
  return join(goalFolder(id), "meta.json");
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-skill-stages-"));
  workspace = unwrap(await createWorkspace(join(base, "workspace")));
  goalId = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(
        validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" }),
      ),
      stages: STAGES,
      created: CREATED,
    }),
  ).goal.id;
});

afterEach(async () => {
  await removeTemp(base);
});

describe("skill.stages.save validation", () => {
  test("bad shapes are -32602 and never boot", async () => {
    const { server, counter } = fakeCore();

    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, "goal id"],
      [{ goalId: "   ", stages: [] }, "goal id"],
      [{ goalId }, "stages array"],
      [{ goalId, stages: "nope" }, "stages array"],
      [{ goalId, stages: [] }, "1–16"],
      [
        { goalId, stages: Array.from({ length: 17 }, (_, index) => ({ title: `S${index}` })) },
        "1–16",
      ],
      [{ goalId, stages: ["Registers"] }, "not an object"],
      [{ goalId, stages: [{ title: "   " }] }, "needs a title"],
      [{ goalId, stages: [{ title: "x".repeat(121) }] }, "longer than 120"],
      [{ goalId, stages: [{ title: "A" }, { title: "B" }], confirmed: "yes" }, "confirmed must be a boolean"],
      [{ goalId, stages: [{ id: "stage-1", title: "A" }, { id: "stage-1", title: "B" }] }, "share the id"],
      [{ goalId, stages: [{ title: "A", milestone: 4 }] }, "milestone must be a string"],
      [
        { goalId, stages: [{ title: "A", milestone: "m".repeat(201) }] },
        "milestone is longer than 200",
      ],
      [{ goalId, stages: [{ id: "  ", title: "A" }] }, "empty id"],
    ];

    for (const [params, field] of cases) {
      const error = await errorOf(server, "skill.stages.save", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain(field);
    }
    expect(counter.calls).toBe(0);
  });

  test("a stage id the goal does not have is a stale request, not a new stage", async () => {
    const { server } = fakeCore();
    const before = await readFile(metaPath(goalId), "utf8");

    const error = await errorOf(server, "skill.stages.save", {
      goalId,
      stages: [{ id: "stage-9", title: "Registers" }],
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("no stage");
    // An entry **without** an id is the only way to add one.
    await expect(readFile(metaPath(goalId), "utf8")).resolves.toBe(before);
  });

  test("an unknown goal is the shared skill shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "skill.stages.save", {
      goalId: "missing-goal",
      stages: [{ title: "Registers" }],
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });
});

describe("skill.stages.save progress", () => {
  /** The saved goal with `stage-1` done and `stage-2` promoted to active. */
  async function stagedGoal(): Promise<void> {
    unwrap(
      await applyTransition({
        workspace,
        goalId,
        stageId: "stage-1",
        action: "done",
        now: "2026-11-01T10:00:00.000Z",
      }),
    );
  }

  test("removing a done stage is refused until confirmed, and names what is lost", async () => {
    await stagedGoal();
    const { server } = fakeCore();
    const before = await readFile(metaPath(goalId), "utf8");

    const response = await ask(server, "skill.stages.save", {
      goalId,
      stages: [{ id: "stage-2", title: "Control flow" }],
    });
    if (!("error" in response)) throw new Error("an unconfirmed done-stage removal must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "stage", goalId });
    expect(response.error.message).toContain("“Registers”");
    expect(response.error.message).toContain("confirmed: true");

    // A refusal writes nothing.
    await expect(readFile(metaPath(goalId), "utf8")).resolves.toBe(before);
  });

  test("confirmed: true removes the done stage and keeps the statuses of the rest", async () => {
    await stagedGoal();
    const { server } = fakeCore();

    const saved = await resultOf(server, "skill.stages.save", {
      goalId,
      confirmed: true,
      stages: [
        { id: "stage-2", title: "Control flow" },
        { id: "stage-3", title: "Conventions", milestone: "read a prologue" },
        { title: "Calling conventions" },
      ],
    });

    // `stage-1` is gone; the new stage never reuses its id and starts pending.
    expect(saved).toEqual({
      stages: [
        { id: "stage-2", title: "Control flow", status: "active" },
        { id: "stage-3", title: "Conventions", status: "pending", milestone: "read a prologue" },
        { id: "stage-4", title: "Calling conventions", status: "pending" },
      ],
    });

    const loaded = unwrap(await readMeta(goalFolder(goalId)));
    // The readable mirror is part of the contract: a stage edit that leaves it
    // stale makes curriculum.md lie about the curriculum.
    const mirror = await readFile(join(goalFolder(goalId), "curriculum.md"), "utf8");
    expect(mirror).toContain("## 1. Control flow");
    expect(mirror).toContain("## 2. Conventions");
    expect(mirror).toContain("## 3. Calling conventions");
    expect(mirror).toContain("> 0 of 3 stages done");
    expect(loaded.goal.stages.map((stage) => stage.id)).toEqual(["stage-2", "stage-3", "stage-4"]);
    expect(loaded.goal.stages.map((stage) => stage.status)).toEqual([
      "active",
      "pending",
      "pending",
    ]);
    expect(loaded.meta.progress).toEqual({
      "stage-2": false,
      "stage-3": false,
      "stage-4": false,
    });
    expect(loaded.meta.complete).toBe(false);
    // Everything else in `meta.json` is preserved.
    expect(loaded.meta.name).toBe("read disassembly");
  });
});

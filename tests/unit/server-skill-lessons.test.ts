/**
 * `skill.lesson.build` / `skill.lesson.read`: request validation and failures.
 *
 * Every case here uses an injected boot seam. The filesystem cases create a
 * throwaway workspace with the real goal service (so a stage can be resolved),
 * but no provider is contacted: `generate` is either absent or a plain local
 * function. The full build/read cycle over real lesson files lives in
 * `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
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
 * A `CoreServices` with the real workspace and no completion unless one is
 * supplied. The lesson handlers never read `settings`, so a small stub is
 * enough and no config file is touched.
 */
function servicesWith(generate?: (prompt: string) => Promise<string>): CoreServices {
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
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    },
    ...(generate === undefined ? {} : { generate }),
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

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-skill-lessons-"));
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

describe("skill.lesson.build validation", () => {
  test("a missing goal or stage id is -32602 and never boots", async () => {
    const { server, counter } = fakeCore();

    for (const [params, field] of [
      [{ stageId: "stage-1" }, "goal id"],
      [{ goalId }, "stage id"],
      [{ goalId: "   ", stageId: "stage-1" }, "goal id"],
      [{ goalId, stageId: "  " }, "stage id"],
    ] as const) {
      const error = await errorOf(server, "skill.lesson.build", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain(field);
    }
    expect(counter.calls).toBe(0);
  });

  test("includeSolution must be a boolean when supplied", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "skill.lesson.build", {
      goalId,
      stageId: "stage-1",
      includeSolution: "yes",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("includeSolution");
    expect(counter.calls).toBe(0);
  });

  test("skill.lesson.read validates both ids without booting", async () => {
    const { server, counter } = fakeCore();
    expect((await errorOf(server, "skill.lesson.read", {})).code).toBe(-32602);
    expect((await errorOf(server, "skill.lesson.read", { goalId })).code).toBe(-32602);
    expect(counter.calls).toBe(0);
  });
});

describe("skill.lesson.build refusals", () => {
  test("a workspace with no model is the actionable generation error", async () => {
    const { server } = fakeCore(servicesWith());
    const error = await errorOf(server, "skill.lesson.build", { goalId, stageId: "stage-1" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "generation",
      id: goalId,
      message: "link a model in Settings → Providers",
    });
  });

  test("an unknown goal is the shared skill shape", async () => {
    const { server } = fakeCore(
      servicesWith(async () => {
        throw new Error("the model must not be called");
      }),
    );
    const error = await errorOf(server, "skill.lesson.build", {
      goalId: "missing-goal",
      stageId: "stage-1",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });

  test("an unknown stage is the stage shape, before any model call", async () => {
    let calls = 0;
    const { server } = fakeCore(
      servicesWith(async () => {
        calls += 1;
        return "{}";
      }),
    );
    const error = await errorOf(server, "skill.lesson.build", { goalId, stageId: "stage-9" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "stage", goalId, stageId: "stage-9" });
    expect(calls).toBe(0);
  });
});

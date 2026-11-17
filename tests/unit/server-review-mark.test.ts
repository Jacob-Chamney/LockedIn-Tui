/**
 * `review.mark` — id parsing, validation and the refusals that never write.
 *
 * Every case uses an injected boot seam and a workspace path that does not
 * exist, so no test here creates a session, builds a deck or contacts a
 * provider. The three real writes are covered over a real workspace in
 * `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  type CoreServices,
  type JsonRpcResponse,
} from "../../src/server/protocol";

/** A workspace that exists only as paths: every id is therefore unknown. */
function fakeServices(): CoreServices {
  const root = join(tmpdir(), "lockedin-review-mark-workspace");
  return {
    workspace: {
      root,
      paths: {
        root,
        schoolSessions: join(root, "school", "sessions"),
        goals: join(root, "skills", "goals"),
      },
    },
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
      dataDir: join(tmpdir(), "lockedin-review-mark-data"),
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
  } as unknown as CoreServices;
}

/** A core whose boot resolves to `services`, counting how often it is called. */
function fakeCore() {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: fakeServices() } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  });
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  params: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, "review.mark", params);
  if (!("error" in response)) throw new Error("review.mark should have failed");
  return response.error;
}

describe("review.mark capabilities", () => {
  test("is advertised beside review.queue", () => {
    expect(CAPABILITIES).toContain("review.mark");
  });
});

describe("review.mark validation", () => {
  test("requires a non-empty itemId before booting the app", async () => {
    const { server, counter } = fakeCore();
    for (const params of [{ result: "known" }, { itemId: "", result: "known" }, { itemId: 7, result: "known" }]) {
      const error = await errorOf(server, params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("itemId");
    }
    expect(counter.calls).toBe(0);
  });

  test("requires result to be known or missed, naming the accepted set", async () => {
    const { server, counter } = fakeCore();
    for (const result of [undefined, "done", "", 1]) {
      const error = await errorOf(server, { itemId: "step:2026-11-01-0900-x:0", result });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("known, missed");
    }
    expect(counter.calls).toBe(0);
  });

  test("a malformed id is invalid params, not a boot", async () => {
    const { server, counter } = fakeCore();
    for (const itemId of ["not-an-id", "step:only-two", "step::0", "step:2026-11-01-0900-x:"]) {
      const error = await errorOf(server, { itemId, result: "known" });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("review.mark");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown kind names the accepted kinds", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, { itemId: "chore:2026-11-01-0900-x:nope", result: "known" });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("step, card, stage or memory");
  });

  test("a step id must end in an index and a card id in card-<n>", async () => {
    const { server } = fakeCore();
    const step = await errorOf(server, { itemId: "step:2026-11-01-0900-x:one", result: "known" });
    expect(step.code).toBe(-32602);
    expect(step.message).toContain("step index");

    for (const itemId of ["card:2026-11-01-0900-x:1", "card:2026-11-01-0900-x:card-0"]) {
      const card = await errorOf(server, { itemId, result: "known" });
      expect(card.code).toBe(-32602);
      expect(card.message).toContain("card-<n>");
    }
  });
});

describe("review.mark refusals", () => {
  test("session memory is read-only and refused with one typed message", async () => {
    const { server } = fakeCore();
    const itemId = "memory:2026-11-01-0900-physics:2026-11-01-0900-physics-0";
    const error = await errorOf(server, { itemId, result: "known" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("read-only");
    expect(error.data).toMatchObject({ kind: "review", itemId });
  });

  test("an unknown session, deck or goal is a typed review failure", async () => {
    const { server } = fakeCore();
    const session = "2026-12-31-0000-missing";
    const goal = "missing-goal";

    const cases = [`step:${session}:0`, `card:${session}:card-1`, `stage:${goal}:stage-1`];
    for (const itemId of cases) {
      const error = await errorOf(server, { itemId, result: "known" });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "review", itemId });
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

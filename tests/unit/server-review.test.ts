/**
 * `review.queue` — the transport half of the read-only review queue.
 *
 * The protocol owns three things here: the `side` shape, the handshake
 * capability and the empty-workspace shape. The queue itself is built by
 * `src/services/review/queue.ts` from real files, so the seeded cases live in
 * `tests/integration/server-data.test.ts`; nothing in this file creates a
 * session, contacts a provider or touches the network.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/** A workspace whose roots do not exist: the service reads nothing and writes nothing. */
function fakeServices(): CoreServices {
  const root = join(tmpdir(), "lockedin-unit-review-missing");
  return {
    workspace: {
      root,
      paths: {
        config: join(root, "config.toml"),
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
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: join(tmpdir(), "lockedin-unit-review-data"),
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
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  });
  const response = await server.handle(request(line));
  if (response === null) throw new Error("expected a response for a request with an id");
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

describe("review.queue capabilities", () => {
  test("is advertised in the handshake capabilities", () => {
    expect(CAPABILITIES).toContain("review.queue");
    expect([...CAPABILITIES].filter((name) => name === "review.queue")).toHaveLength(1);
  });
});

describe("review.queue request shape", () => {
  test("an unknown side is -32602 before the app boots, naming the accepted set", async () => {
    const { server, counter } = fakeCore();
    for (const side of ["everything", "SCHOOL", "", 3, null, ["school"]]) {
      const error = await errorOf(server, "review.queue", { side });
      expect(error.code).toBe(-32602);
      expect(error.retryable).toBeUndefined();
      expect(error.message).toContain("review.queue");
      expect(error.message).toContain("all, school, skills");
    }
    // Shape failures never reach the workspace.
    expect(counter.calls).toBe(0);
  });

  test("no side defaults to all and returns the whole queue shape", async () => {
    const { server, counter } = fakeCore();
    const response = await ask(server, "review.queue");
    if ("error" in response) throw new Error("review.queue should answer");
    expect(counter.calls).toBe(1);
    expect(response.result).toEqual({
      queue: {
        items: [],
        nudge: { intensity: "balanced", threshold: 3, due: [], suggestions: [] },
        coverage: [],
        counts: {
          total: 0,
          byKind: { step: 0, card: 0, stage: 0, mistake: 0, memory: 0, task: 0 },
        },
        diagnostics: [],
        intensity: "balanced",
      },
    });
  });

  test("school, skills, work and all are accepted and each returns its own empty queue", async () => {
    const { server } = fakeCore();
    for (const side of ["all", "school", "skills", "work"] as const) {
      const response = await ask(server, "review.queue", { side });
      if ("error" in response) throw new Error(`review.queue ${side} should answer`);
      const queue = response.result.queue as {
        items: unknown[];
        counts: { total: number };
        diagnostics: unknown[];
      };
      expect(queue.items).toEqual([]);
      expect(queue.counts.total).toBe(0);
      expect(queue.diagnostics).toEqual([]);
    }
  });
});

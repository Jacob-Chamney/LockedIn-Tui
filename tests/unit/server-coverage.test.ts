/**
 * `session.coverage` — the transport half of source coverage.
 *
 * This file owns the request shape, the handshake capability and the error
 * shapes. The report itself comes from `src/domain/coverage.ts` over files that
 * `loadSessionHome` reads, so the seeded cases (a referenced source, a gap, an
 * empty session) live in `tests/integration/server-data.test.ts`. Nothing here
 * creates a session, contacts a provider or touches the network.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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

/**
 * A workspace whose roots do not exist: opening a session reads nothing and
 * writes nothing, which is exactly the read-only path under test.
 */
const ROOT = join(tmpdir(), "lockedin-unit-coverage-missing");

function fakeServices(): CoreServices {
  return {
    workspace: {
      root: ROOT,
      paths: {
        config: join(ROOT, "config.toml"),
        schoolSessions: join(ROOT, "school", "sessions"),
        goals: join(ROOT, "skills", "goals"),
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
      dataDir: join(tmpdir(), "lockedin-unit-coverage-data"),
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

describe("session.coverage capabilities", () => {
  test("is advertised in the handshake capabilities", () => {
    expect(CAPABILITIES).toContain("session.coverage");
    expect([...CAPABILITIES].filter((name) => name === "session.coverage")).toHaveLength(1);
  });
});

describe("session.coverage request shape", () => {
  test("a missing, blank or non-string id is -32602 naming the field", async () => {
    const { server } = fakeCore();
    for (const params of [
      undefined,
      {},
      { id: "" },
      { id: "   " },
      { id: 7 },
      { id: null },
      { id: ["2026-11-01-0900-physics"] },
    ]) {
      const error = await errorOf(server, "session.coverage", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id is required");
      expect(error.retryable).toBeUndefined();
    }
  });

  test("an unknown session is the shared typed session error", async () => {
    const { server } = fakeCore();
    for (const id of [
      "2026-12-31-0000-missing",
      "not-a-session",
      "../escape",
      "a/b",
    ]) {
      const error = await errorOf(server, "session.coverage", { id });
      expect(error.code).toBe(-32000);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "session" });
    }
  });

  test("a shape failure or an unknown session writes nothing to the workspace", async () => {
    const { server } = fakeCore();
    expect(existsSync(ROOT)).toBe(false);

    await errorOf(server, "session.coverage", { id: "" });
    await errorOf(server, "session.coverage", { id: "2026-12-31-0000-missing" });

    expect(existsSync(ROOT)).toBe(false);
  });
});

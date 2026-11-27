/**
 * `source.list` and `source.add`: parameter validation and typed errors.
 *
 * Every case uses an injected boot seam pointed at a sessions directory that
 * does not exist, so nothing here creates a workspace, copies a file or contacts
 * a provider. The real copy path is covered by
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
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const MISSING = join(tmpdir(), "lockedin-unit-source-sessions-do-not-exist");

function fakeServices(): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-unit-source-workspace"),
      paths: {
        schoolSessions: MISSING,
        schoolVault: join(tmpdir(), "lockedin-unit-source-vault"),
        goals: MISSING,
        skillVault: MISSING,
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
      dataDir: join(tmpdir(), "lockedin-unit-source-data"),
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
  const services = fakeServices();
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
  return { server, services };
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
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

describe("source capabilities", () => {
  test("the handshake advertises both source methods", () => {
    expect([...CAPABILITIES]).toContain("source.list");
    expect([...CAPABILITIES]).toContain("source.add");
  });
});

describe("source.list", () => {
  test("requires a session id", async () => {
    const { server } = fakeCore();
    const missing = await errorOf(server, "source.list");
    expect(missing.code).toBe(-32602);
    expect(missing.message).toContain("session id");

    const wrongType = await errorOf(server, "source.list", { sessionId: 7 });
    expect(wrongType.code).toBe(-32602);
    expect(wrongType.message).toContain("session id");
  });

  test("an unknown session is a typed -32000 error keyed by sessionId", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "source.list", {
      sessionId: "2026-12-31-0000-missing",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "session",
      sessionId: "2026-12-31-0000-missing",
      message: expect.any(String),
    });
    expect(error.message).toContain("2026-12-31-0000-missing");
  });
});

describe("source.add", () => {
  test("requires a session id", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "source.add", { paths: ["/tmp/a.md"] });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("session id");
  });

  test("requires a non-empty paths array", async () => {
    const { server } = fakeCore();
    const missing = await errorOf(server, "source.add", { sessionId: "s" });
    expect(missing.code).toBe(-32602);
    expect(missing.message).toContain("paths");

    const notArray = await errorOf(server, "source.add", { sessionId: "s", paths: "/tmp/a.md" });
    expect(notArray.code).toBe(-32602);
    expect(notArray.message).toContain("paths");

    const empty = await errorOf(server, "source.add", { sessionId: "s", paths: [] });
    expect(empty.code).toBe(-32602);
    expect(empty.message).toContain("non-empty");
  });

  test("rejects a path that is not a non-empty string", async () => {
    const { server } = fakeCore();
    const blank = await errorOf(server, "source.add", { sessionId: "s", paths: ["  "] });
    expect(blank.code).toBe(-32602);
    expect(blank.message).toContain("non-empty");

    const wrongType = await errorOf(server, "source.add", { sessionId: "s", paths: [5] });
    expect(wrongType.code).toBe(-32602);
    expect(wrongType.message).toContain("non-empty");
  });

  test("an unknown session is a session error, not a generic copy failure", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "source.add", {
      sessionId: "2026-12-31-0000-missing",
      paths: ["/tmp/a.md"],
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "session",
      sessionId: "2026-12-31-0000-missing",
      message: expect.any(String),
    });
    expect(error.message).toContain("2026-12-31-0000-missing");
  });
});

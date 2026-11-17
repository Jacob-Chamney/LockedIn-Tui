/**
 * The core <-> shell protocol: framing, validation and the method table.
 *
 * Every case uses an injected boot seam, so no test here creates a workspace or
 * contacts a provider. The real boot path is covered by
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
  SERVER_PROTOCOL_VERSION,
  createCoreServer,
  parseRequest,
  providerOf,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

function fakeServices(
  overrides: { chatModel?: string; dataDir?: string; root?: string; sessionsDir?: string } = {},
): CoreServices {
  return {
    workspace: {
      root: overrides.root ?? join(tmpdir(), "lockedin-unit-workspace"),
      paths: {
        schoolSessions: overrides.sessionsDir ?? join(tmpdir(), "lockedin-unit-no-sessions"),
      },
    },
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: overrides.chatModel ?? "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: overrides.dataDir ?? join(tmpdir(), "lockedin-unit-no-data"),
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
function fakeCore(services: CoreServices = fakeServices()) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, services, counter };
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

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
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

describe("core protocol", () => {
  test("initialize reports the protocol version and capabilities", async () => {
    const { server, counter } = fakeCore();
    const response = await server.handle(request('{"jsonrpc":"2.0","id":1,"method":"initialize"}'));
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocol: SERVER_PROTOCOL_VERSION,
        server: "lockedin-core",
        capabilities: [...CAPABILITIES],
      },
    });
    // The handshake itself never needs the workspace.
    await Promise.resolve();
    expect(counter.calls).toBe(0);
  });

  test("ping answers", async () => {
    const { server } = fakeCore();
    expect(await server.handle(request('{"jsonrpc":"2.0","id":"p","method":"ping"}'))).toMatchObject({
      id: "p",
      result: { pong: true },
    });
  });

  test("an unknown method is a typed error", async () => {
    const { server } = fakeCore();
    expect(await server.handle(request('{"jsonrpc":"2.0","id":2,"method":"nope"}'))).toMatchObject({
      id: 2,
      error: { code: -32601 },
    });
  });

  test("malformed JSON is a parse error with a null id", () => {
    const parsed = parseRequest("{not json");
    expect(parsed).toMatchObject({ id: null, error: { code: -32700 } });
  });

  test("a notification gets no response", async () => {
    const { server, counter } = fakeCore();
    expect(await server.handle(request('{"jsonrpc":"2.0","method":"workspace.info"}'))).toBeNull();
    // A notification is never answered and never boots the app.
    expect(counter.calls).toBe(0);
  });

  test("params must be an object", () => {
    const parsed = parseRequest('{"jsonrpc":"2.0","id":3,"method":"ping","params":[]}');
    expect(parsed).toMatchObject({ id: 3, error: { code: -32602 } });
  });
});

describe("boot", () => {
  test("is attempted once and shared by every data method", async () => {
    const { server, counter } = fakeCore();
    await resultOf(server, "workspace.info");
    await resultOf(server, "session.list");
    await resultOf(server, "settings.get");
    await resultOf(server, "stats.summary", { range: "7d", scope: "all" });
    expect(counter.calls).toBe(1);
  });

  test("a refusal is a -32000 error carrying path, message and next", async () => {
    const failure: BootFailure = {
      kind: "boot",
      path: "/home/me/LockedIn",
      message:
        "“LockedIn” belongs to the old LockedIn (v0.7).\nIt was not opened and nothing in it was read or changed.",
      next: "Start with LOCKEDIN_WORKSPACE=~/LockedIn-Tui bun start.",
    };
    let calls = 0;
    const server = createCoreServer({
      boot: async () => {
        calls += 1;
        return { ok: false, error: failure } as Result<CoreServices, BootFailure>;
      },
    });

    const error = await errorOf(server, "workspace.info");
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    // One sentence on the message: the data carries the original copy.
    expect(error.message).toBe(
      "LockedIn could not start: “LockedIn” belongs to the old LockedIn (v0.7). It was not opened and nothing in it was read or changed.",
    );
    expect(error.data).toEqual({
      kind: "boot",
      path: "/home/me/LockedIn",
      message: failure.message,
      next: failure.next,
    });

    // The shell keeps answering; the refusal is remembered, not retried.
    expect(await errorOf(server, "settings.get")).toMatchObject({ code: BOOT_FAILED });
    expect(calls).toBe(1);
    expect(await server.handle(request('{"jsonrpc":"2.0","id":9,"method":"ping"}'))).toMatchObject({
      id: 9,
      result: { pong: true },
    });
  });
});

describe("workspace.info", () => {
  test("an unconfigured workspace reports empty model and provider", async () => {
    const { server, services } = fakeCore();
    expect(await resultOf(server, "workspace.info")).toEqual({
      path: services.workspace.root,
      dataDir: services.settings.dataDir,
      configured: false,
      model: "",
      provider: "",
    });
  });

  test("the provider is the model's prefix", async () => {
    const { server } = fakeCore(fakeServices({ chatModel: "openai/gpt-4.1-mini" }));
    expect(await resultOf(server, "workspace.info")).toMatchObject({
      configured: true,
      model: "openai/gpt-4.1-mini",
      provider: "openai",
    });
    expect(providerOf("openai/gpt-4.1-mini")).toBe("openai");
    expect(providerOf("local-model")).toBe("");
    expect(providerOf("  anthropic/claude-sonnet-4  ")).toBe("anthropic");
  });
});

describe("session.list", () => {
  test("an empty workspace is an empty list", async () => {
    const { server } = fakeCore();
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("a non-string query is invalid params", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "session.list", { query: 5 });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("query");
    expect(counter.calls).toBe(0);
  });
});

describe("stats.summary", () => {
  test("requires range and scope", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "stats.summary");
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("range");
    expect(error.message).toContain("scope");
    expect(error.message).toContain("7d");
  });

  test("rejects values outside the documented unions", async () => {
    const { server } = fakeCore();
    const range = await errorOf(server, "stats.summary", { range: "1y", scope: "all" });
    expect(range.code).toBe(-32602);
    expect(range.message).toContain('unknown range "1y"');

    const scope = await errorOf(server, "stats.summary", { range: "7d", scope: "everything" });
    expect(scope.code).toBe(-32602);
    expect(scope.message).toContain('unknown scope "everything"');
  });

  test("an empty data directory is a full summary of zeros", async () => {
    const { server } = fakeCore();
    const summary = await resultOf(server, "stats.summary", { range: "7d", scope: "all" });
    expect(summary).toMatchObject({
      range: "7d",
      scope: "all",
      overview: { runs: 0, failed: 0, input: 0, output: 0 },
      models: [],
      tools: [],
      learning: { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
      activity: [],
      diagnostic: null,
    });
    expect(typeof summary.costLabel).toBe("string");
    expect(summary.period).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });
});

describe("settings.get", () => {
  test("returns the booted settings as plain data", async () => {
    const { server, services } = fakeCore();
    expect(await resultOf(server, "settings.get")).toEqual(
      services.settings as unknown as Record<string, unknown>,
    );
  });
});

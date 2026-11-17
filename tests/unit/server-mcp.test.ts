/**
 * The read-only MCP surface of the core protocol.
 *
 * Every case injects a fake boot, so nothing here spawns a stdio server, reads
 * a config file or contacts the network. The real boot path is covered by
 * `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { PluginRow, PluginRuntime } from "../../src/app/actions/plugins";
import type { Result } from "../../src/domain/markdown";
import type { PluginPolicy } from "../../src/storage/config-schema";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const POLICY: PluginPolicy = {
  chill: { notes: "on" },
  lockin: { notes: "explicit" },
  flashcards: { notes: "off" },
};

const ROWS: PluginRow[] = [
  {
    name: "notes",
    transport: "stdio",
    enabled: true,
    status: "connected",
    tools: [
      { name: "read_note", write: false },
      { name: "write_note", write: true },
    ],
  },
];

function fakeServices(overrides: { rows?: PluginRow[]; policy?: PluginPolicy } = {}): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-mcp-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-mcp-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-mcp-no-data"),
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
    ...(overrides.policy === undefined ? {} : { config: { plugins: { policy: overrides.policy } } }),
  } as unknown as CoreServices;
}

/** A runtime that counts the calls the protocol is allowed to make. */
function fakeRuntime(rows: PluginRow[], refreshed: PluginRow[] = rows) {
  const calls = { rows: 0, refresh: 0, start: 0, dispose: 0 };
  const runtime = {
    rows() {
      calls.rows += 1;
      return rows;
    },
    async refresh() {
      calls.refresh += 1;
      return refreshed;
    },
    async start() {
      calls.start += 1;
    },
    async dispose() {
      calls.dispose += 1;
    },
  } as unknown as PluginRuntime;
  return { runtime, calls };
}

function fakeCore(services: CoreServices) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
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
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    ),
  );
  if (response === null) throw new Error("expected a response");
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

describe("mcp capabilities", () => {
  test("the handshake advertises the read-only MCP methods", async () => {
    const { runtime } = fakeRuntime(ROWS);
    const server = fakeCore({ ...fakeServices(), pluginRuntime: runtime } as CoreServices);
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    for (const method of ["mcp.list", "mcp.refresh", "mcp.policy.get"]) {
      expect(result.capabilities as string[]).toContain(method);
    }
  });
});

describe("mcp.list", () => {
  test("returns the runtime rows and the stored policy without connecting anything", async () => {
    const { runtime, calls } = fakeRuntime(ROWS);
    const server = fakeCore({
      ...fakeServices({ policy: POLICY }),
      pluginRuntime: runtime,
    } as CoreServices);

    const result = await resultOf(server, "mcp.list");
    expect(result.servers).toEqual(ROWS);
    expect(result.policy).toEqual(POLICY);
    // Rows only: `mcp.list` is a read, so it never starts or refreshes a server.
    expect(calls.refresh).toBe(0);
    expect(calls.start).toBe(0);
  });

  test("a server row carries no command, args, env or credential", async () => {
    const { runtime } = fakeRuntime([
      {
        name: "notes",
        transport: "stdio",
        enabled: true,
        status: { failed: "the command exited" },
        tools: [{ name: "read_note", write: false }],
      },
    ]);
    const server = fakeCore({ ...fakeServices(), pluginRuntime: runtime } as CoreServices);

    const result = await resultOf(server, "mcp.list");
    const row = (result.servers as Record<string, unknown>[])[0]!;
    expect(Object.keys(row).sort()).toEqual(["enabled", "name", "status", "tools", "transport"]);
    const wire = JSON.stringify(result);
    for (const forbidden of ['"command":', '"args":', '"env":', '"token":', '"api_key":', '"secret":', '"password":']) {
      expect(wire).not.toContain(forbidden);
    }
    // A failure is the row's status, not an error response.
    expect(row.status).toEqual({ failed: "the command exited" });
  });

  test("an absent policy is an empty object, never invented cells", async () => {
    const { runtime } = fakeRuntime([]);
    const server = fakeCore({ ...fakeServices(), pluginRuntime: runtime } as CoreServices);
    const result = await resultOf(server, "mcp.list");
    expect(result.servers).toEqual([]);
    expect(result.policy).toEqual({});
  });

  test("a build without a plugin host reports -32601, not an empty lie", async () => {
    const response = await ask(fakeCore(fakeServices()), "mcp.list");
    if (!("error" in response)) throw new Error("expected an error");
    expect(response.error.code).toBe(-32601);
    expect(response.error.retryable).toBe(false);
  });
});

describe("mcp.refresh", () => {
  test("calls refresh exactly once and returns the refreshed rows", async () => {
    const before: PluginRow[] = [
      { name: "notes", transport: "stdio", enabled: true, status: "stopped", tools: [] },
    ];
    const after: PluginRow[] = [
      {
        name: "notes",
        transport: "stdio",
        enabled: true,
        status: "connected",
        tools: [{ name: "read_note", write: false }],
      },
    ];
    const { runtime, calls } = fakeRuntime(before, after);
    const server = fakeCore({ ...fakeServices(), pluginRuntime: runtime } as CoreServices);

    const result = await resultOf(server, "mcp.refresh");
    expect(result.servers).toEqual(after);
    expect(calls.refresh).toBe(1);
  });

  test("a failed server is a row status, not a protocol error", async () => {
    const failed: PluginRow[] = [
      {
        name: "notes",
        transport: "stdio",
        enabled: true,
        status: { failed: "command not found" },
        tools: [],
      },
    ];
    const { runtime } = fakeRuntime([], failed);
    const server = fakeCore({ ...fakeServices(), pluginRuntime: runtime } as CoreServices);

    const response = await ask(server, "mcp.refresh");
    if ("error" in response) throw new Error("a server failure must not fail the request");
    expect((response.result.servers as PluginRow[])[0]?.status).toEqual({ failed: "command not found" });
  });
});

describe("mcp.policy.get", () => {
  test("returns the stored policy and never mutates it", async () => {
    const { runtime } = fakeRuntime(ROWS);
    const server = fakeCore({
      ...fakeServices({ policy: POLICY }),
      pluginRuntime: runtime,
    } as CoreServices);

    const result = await resultOf(server, "mcp.policy.get");
    expect(result).toEqual({ policy: POLICY });
    // Reading never mutates: an unknown mcp method stays unknown.
    const unknown = await ask(server, "mcp.policy.remove", { command: "chill", server: "notes" });
    if (!("error" in unknown)) throw new Error("mcp.policy.remove must not exist");
    expect(unknown.error.code).toBe(-32601);
  });
});

describe("mcp methods stay behind a boot", () => {
  test("a boot refusal is the documented -32000 shape", async () => {
    const server = createCoreServer({
      boot: async () => ({
        ok: false,
        error: {
          kind: "boot",
          path: "/tmp/legacy",
          message: "this folder belongs to the old LockedIn",
          next: "Set LOCKEDIN_WORKSPACE to choose another folder.",
        },
      }) as Result<CoreServices, BootFailure>,
    });

    const response = await ask(server, "mcp.list");
    if (!("error" in response)) throw new Error("expected a boot refusal");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "boot", path: "/tmp/legacy" });
  });
});

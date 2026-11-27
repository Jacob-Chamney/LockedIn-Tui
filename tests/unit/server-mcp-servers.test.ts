/**
 * `mcp.server.set` / `mcp.server.remove`: Settings owns the configured servers.
 *
 * Every case injects fake hooks, so nothing writes a config file or starts a
 * stdio server. The real `patchConfig`/runtime path is covered by
 * `tests/integration/config.test.ts` and `plugin-runtime.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { PluginRow } from "../../src/app/actions/plugins";
import type { Result } from "../../src/domain/markdown";
import type {
  McpServerConfig,
  PluginPolicy,
} from "../../src/storage/config-schema";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const POLICY: PluginPolicy = { lockin: { notes: "explicit" } };

const ROWS: PluginRow[] = [
  {
    name: "notes",
    transport: "stdio",
    enabled: true,
    status: "connected",
    tools: [{ name: "read_note", write: false }],
  },
];

type SaveCall = { name: string; server: McpServerConfig };

function fakeServices(overrides: {
  saveMcpServer?: CoreServices["saveMcpServer"];
  removeMcpServer?: CoreServices["removeMcpServer"];
} = {}): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-mcp-servers-workspace"),
      paths: { schoolSessions: join(tmpdir(), "lockedin-mcp-servers-none") },
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
      dataDir: join(tmpdir(), "lockedin-mcp-servers-data"),
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
    config: { plugins: { policy: POLICY, servers: {} } },
    ...(overrides.saveMcpServer === undefined
      ? {}
      : { saveMcpServer: overrides.saveMcpServer }),
    ...(overrides.removeMcpServer === undefined
      ? {}
      : { removeMcpServer: overrides.removeMcpServer }),
  } as unknown as CoreServices;
}

function fakeCore(services: CoreServices): ReturnType<typeof createCoreServer> {
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
  if ("error" in response) {
    throw new Error(`${method} failed: ${response.error.message}`);
  }
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

describe("mcp.server.set", () => {
  test("the handshake advertises both server methods", async () => {
    const { server } = { server: fakeCore(fakeServices()) };
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    expect(result.capabilities).toContain("mcp.server.set");
    expect(result.capabilities).toContain("mcp.server.remove");
  });

  test("validates the name, command, args and enabled flag", async () => {
    const server = fakeCore(fakeServices());
    for (const name of ["", " bad name", "!x"]) {
      const error = await errorOf(server, "mcp.server.set", {
        name,
        command: "mcp-notes",
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("name");
    }
    const command = await errorOf(server, "mcp.server.set", {
      name: "notes",
      command: "  ",
    });
    expect(command.code).toBe(-32602);
    expect(command.message).toContain("command");

    const args = await errorOf(server, "mcp.server.set", {
      name: "notes",
      command: "mcp-notes",
      args: ["ok", 7],
    });
    expect(args.code).toBe(-32602);
    expect(args.message).toContain("args");

    const enabled = await errorOf(server, "mcp.server.set", {
      name: "notes",
      command: "mcp-notes",
      enabled: "yes",
    });
    expect(enabled.code).toBe(-32602);
    expect(enabled.message).toContain("enabled");
  });

  test("writes the normalized server and returns the refreshed rows", async () => {
    const calls: SaveCall[] = [];
    const server = fakeCore(
      fakeServices({
        saveMcpServer: async (name, config) => {
          calls.push({ name, server: config });
          return { ok: true as const, value: ROWS };
        },
      }),
    );

    const result = await resultOf(server, "mcp.server.set", {
      name: "notes",
      command: "  mcp-notes  ",
      args: ["--stdio"],
    });

    expect(calls).toEqual([
      {
        name: "notes",
        server: {
          transport: "stdio",
          command: "mcp-notes",
          args: ["--stdio"],
          enabled: true,
        },
      },
    ]);
    expect(result.servers).toEqual(ROWS);
    expect(result.policy).toEqual(POLICY);
  });

  test("a config refusal is one typed plugin error", async () => {
    const server = fakeCore(
      fakeServices({
        saveMcpServer: async () => ({
          ok: false as const,
          error: { message: "config.toml is not writable" },
        }),
      }),
    );
    const error = await errorOf(server, "mcp.server.set", {
      name: "notes",
      command: "mcp-notes",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "plugin", server: "notes" });
  });

  test("a build with no config writer says so", async () => {
    const server = fakeCore(fakeServices());
    const error = await errorOf(server, "mcp.server.set", {
      name: "notes",
      command: "mcp-notes",
    });
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("not available");
  });
});

describe("mcp.server.get", () => {
  test("returns the stored definition and refuses an unknown name", async () => {
    const services = fakeServices();
    (services as unknown as { config: { plugins: { servers: Record<string, McpServerConfig> } } })
      .config.plugins.servers.notes = {
      transport: "stdio",
      command: "mcp-notes",
      args: ["-y"],
      enabled: false,
    };
    const server = fakeCore(services);

    const result = await resultOf(server, "mcp.server.get", { name: "notes" });
    expect(result).toEqual({
      name: "notes",
      transport: "stdio",
      command: "mcp-notes",
      args: ["-y"],
      enabled: false,
    });

    const unknown = await errorOf(server, "mcp.server.get", { name: "nope" });
    expect(unknown.code).toBe(BOOT_FAILED);
    expect(unknown.retryable).toBe(false);
    expect(unknown.data).toMatchObject({ kind: "plugin", server: "nope" });
  });
});


describe("mcp.server.remove", () => {
  test("requires a name and returns the refreshed rows", async () => {
    const removed: string[] = [];
    const server = fakeCore(
      fakeServices({
        removeMcpServer: async (name) => {
          removed.push(name);
          return { ok: true as const, value: [] };
        },
      }),
    );

    const blank = await errorOf(server, "mcp.server.remove", { name: " " });
    expect(blank.code).toBe(-32602);
    expect(blank.message).toContain("name");

    const result = await resultOf(server, "mcp.server.remove", {
      name: " notes ",
    });
    expect(removed).toEqual(["notes"]);
    expect(result.servers).toEqual([]);
    expect(result.policy).toEqual(POLICY);
  });

  test("an unknown server is a typed refusal", async () => {
    const server = fakeCore(
      fakeServices({
        removeMcpServer: async () => ({
          ok: false as const,
          error: { message: "there is no MCP server “nope”" },
        }),
      }),
    );
    const error = await errorOf(server, "mcp.server.remove", { name: "nope" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "plugin", server: "nope" });
  });
});

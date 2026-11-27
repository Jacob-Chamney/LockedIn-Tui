/**
 * `mcp.policy.set`: the per-command MCP policy write.
 *
 * Every case injects a fake boot and a fake `savePolicy`, so nothing here writes
 * a config file, spawns a stdio server or contacts a provider. The real
 * `patchConfig` path is covered by `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { PluginRuntime } from "../../src/app/actions/plugins";
import type { Result } from "../../src/domain/markdown";
import type {
  PluginCommand,
  PluginPolicy,
  PluginPolicyCell,
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

const POLICY: PluginPolicy = {
  chill: { notes: "on" },
  lockin: { notes: "explicit" },
  flashcards: { notes: "off" },
};

const SERVERS = {
  notes: { transport: "stdio" as const, command: "mcp-notes", args: [], enabled: false },
  docs: { transport: "stdio" as const, command: "mcp-docs", args: [], enabled: false },
};

type SavePolicyInput = { command: PluginCommand; server: string; value: PluginPolicyCell };

/** A savePolicy fake that records calls and returns a merged matrix. */
function fakeSavePolicy(options: { fail?: string } = {}) {
  const calls: SavePolicyInput[] = [];
  const savePolicy = async (
    input: SavePolicyInput,
  ): Promise<Result<PluginPolicy, { message: string }>> => {
    calls.push(input);
    if (options.fail !== undefined) {
      return { ok: false as const, error: { message: options.fail } };
    }
    const next: PluginPolicy = { ...POLICY, [input.command]: { ...(POLICY[input.command] ?? {}) } };
    next[input.command]![input.server] = input.value;
    return { ok: true as const, value: next };
  };
  return { savePolicy, calls };
}

function fakeServices(
  overrides: {
    policy?: PluginPolicy;
    savePolicy?: CoreServices["savePolicy"];
    runtime?: PluginRuntime;
  } = {},
): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-mcp-policy-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-mcp-policy-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-mcp-policy-no-data"),
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
    config: {
      plugins: {
        policy: overrides.policy ?? POLICY,
        servers: SERVERS,
      },
    },
    ...(overrides.runtime === undefined ? {} : { pluginRuntime: overrides.runtime }),
    ...(overrides.savePolicy === undefined ? {} : { savePolicy: overrides.savePolicy }),
  } as unknown as CoreServices;
}

function fakeRuntime(): { runtime: PluginRuntime; calls: { rows: number; refresh: number } } {
  const calls = { rows: 0, refresh: 0 };
  const runtime = {
    rows() {
      calls.rows += 1;
      return [];
    },
    async refresh() {
      calls.refresh += 1;
      return [];
    },
  } as unknown as PluginRuntime;
  return { runtime, calls };
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

describe("mcp.policy.set capability", () => {
  test("the handshake advertises the write", async () => {
    const server = fakeCore(fakeServices());
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    expect(result.capabilities as string[]).toContain("mcp.policy.set");
  });
});

describe("mcp.policy.set validation", () => {
  test("an unknown command is -32602 naming the accepted set", async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "reader",
      server: "notes",
      value: "off",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("reader");
    expect(error.message).toContain("chill, lockin, flashcards, study-guide, skill, work");
    expect(calls).toEqual([]);
  });

  test("work is a policy row, and its cell is stored", async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const result = await resultOf(server, "mcp.policy.set", {
      command: "work",
      server: "notes",
      value: "explicit",
    });
    expect((result.policy as Record<string, Record<string, string>>).work).toEqual({
      notes: "explicit",
    });
    expect(calls).toEqual([{ command: "work", server: "notes", value: "explicit" }]);
  });

  test("an unknown value is -32602 naming the accepted set", async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "chill",
      server: "notes",
      value: "always",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("always");
    expect(error.message).toContain("on, explicit, off");
    expect(calls).toEqual([]);
  });

  test("a missing or blank server is -32602", async () => {
    const { savePolicy } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    for (const value of [undefined, "", "   ", 7]) {
      const error = await errorOf(server, "mcp.policy.set", {
        command: "chill",
        server: value,
        value: "off",
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("server");
    }
  });

  test("the app is not booted for a malformed request", async () => {
    let boots = 0;
    const server = createCoreServer({
      boot: async () => {
        boots += 1;
        return { ok: true, value: fakeServices() } as Result<CoreServices, BootFailure>;
      },
    });
    await errorOf(server, "mcp.policy.set", { command: "nope", server: "notes", value: "off" });
    await errorOf(server, "mcp.policy.set", { command: "chill", server: "notes", value: "nope" });
    await errorOf(server, "mcp.policy.set", { command: "chill", server: "", value: "off" });
    expect(boots).toBe(0);
  });
});

describe("mcp.policy.set never calls a plugin", () => {
  test('refuses "on" for flashcards with the product message', async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "flashcards",
      server: "notes",
      value: "on",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toBe(
      'flashcards never calls plugins, so plugins.policy.flashcards.notes cannot be "on". Set it to "off"; this command never calls a plugin.',
    );
    expect(calls).toEqual([]);
  });

  test('refuses "on" for study-guide with the same copy', async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "study-guide",
      server: "notes",
      value: "on",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("study-guide never calls plugins");
    expect(calls).toEqual([]);
  });

  test('"off" and "explicit" stay allowed for the two generation commands', async () => {
    for (const [command, value] of [
      ["flashcards", "off"],
      ["study-guide", "explicit"],
    ] as const) {
      const { savePolicy, calls } = fakeSavePolicy();
      const server = fakeCore(fakeServices({ savePolicy }));
      const result = await resultOf(server, "mcp.policy.set", { command, server: "notes", value });
      expect(result.policy).toBeDefined();
      expect(calls).toEqual([{ command, server: "notes", value }]);
    }
  });
});

describe("mcp.policy.set write", () => {
  test("saves one cell and returns the whole new matrix", async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));

    const result = await resultOf(server, "mcp.policy.set", {
      command: "lockin",
      server: "notes",
      value: "off",
    });
    expect(calls).toEqual([{ command: "lockin", server: "notes", value: "off" }]);
    expect(result.policy).toEqual({
      chill: { notes: "on" },
      lockin: { notes: "off" },
      flashcards: { notes: "off" },
    });
  });

  test("mcp.policy.get reflects the write immediately", async () => {
    const { savePolicy } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));

    expect(await resultOf(server, "mcp.policy.get")).toEqual({ policy: POLICY });
    await resultOf(server, "mcp.policy.set", { command: "chill", server: "notes", value: "off" });
    expect(await resultOf(server, "mcp.policy.get")).toEqual({
      policy: { ...POLICY, chill: { notes: "off" } },
    });
  });

  test("mcp.list reports the same post-write matrix", async () => {
    const { savePolicy } = fakeSavePolicy();
    const { runtime, calls } = fakeRuntime();
    const server = fakeCore(fakeServices({ savePolicy, runtime }));

    await resultOf(server, "mcp.policy.set", {
      command: "skill",
      server: "docs",
      value: "explicit",
    });
    const listed = await resultOf(server, "mcp.list");
    expect(listed.policy).toEqual({ ...POLICY, skill: { docs: "explicit" } });
    // A policy write is configuration: it never refreshes or starts a server.
    expect(calls.refresh).toBe(0);
  });

  test("a server present only in the stored policy is accepted", async () => {
    const policy: PluginPolicy = { chill: { legacy: "on" } };
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ policy, savePolicy }));
    await resultOf(server, "mcp.policy.set", {
      command: "lockin",
      server: "legacy",
      value: "explicit",
    });
    expect(calls).toEqual([{ command: "lockin", server: "legacy", value: "explicit" }]);
  });
});

describe("mcp.policy.set failures", () => {
  test("an unconfigured server is a typed plugin error naming command and server", async () => {
    const { savePolicy, calls } = fakeSavePolicy();
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "chill",
      server: "ghost",
      value: "off",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "plugin",
      command: "chill",
      server: "ghost",
      message: error.message,
    });
    expect(error.message).toContain("ghost");
    expect(calls).toEqual([]);
  });

  test("a config write failure is one -32000 config error and leaves the policy alone", async () => {
    const { savePolicy } = fakeSavePolicy({ fail: "The config could not be written." });
    const server = fakeCore(fakeServices({ savePolicy }));
    const error = await errorOf(server, "mcp.policy.set", {
      command: "chill",
      server: "notes",
      value: "off",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({ kind: "config", message: "The config could not be written." });
    expect(await resultOf(server, "mcp.policy.get")).toEqual({ policy: POLICY });
  });

  test("a build without a config writer is -32601, not a silent success", async () => {
    const server = fakeCore(fakeServices());
    const error = await errorOf(server, "mcp.policy.set", {
      command: "chill",
      server: "notes",
      value: "off",
    });
    expect(error.code).toBe(-32601);
    expect(error.retryable).toBe(false);
  });
});

/**
 * The per-call permission gate for write-capable plugin tools.
 *
 * Two halves, both offline:
 *
 * - `createPluginRuntime` is driven through a fake `McpHost`, so the test can
 *   count exactly which tool calls reached the "server". No process is spawned
 *   and no credential exists.
 * - `createCoreServer` is driven through a fake boot that only counts boots and
 *   captures the installed gate, so `mcp.confirm` and the `mcp.permission`
 *   event are exercised without a workspace, a chat or a provider.
 *
 * The product rule under test: every write tool call asks once, nothing is
 * remembered, and a refused or timed-out call never reaches the host.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import {
  createPluginRuntime,
  type PluginRuntime,
  type PluginWriteRequest,
} from "../../src/app/actions/plugins";
import type { Result } from "../../src/domain/markdown";
import type { McpHost } from "../../src/mcp/stdio";
import type { McpTool } from "../../src/mcp/types";
import {
  CAPABILITIES,
  PLUGIN_PERMISSION_TIMEOUT_MS,
  createCoreServer,
  type CoreNotification,
  type CoreServices,
  type JsonRpcResponse,
} from "../../src/server/protocol";

/* -------------------------------------------------------------------------- */
/* A fake host: records calls, never starts a process                          */
/* -------------------------------------------------------------------------- */

type HostCall = { id: string; tool: string; input: Record<string, unknown> };

const TOOLS: McpTool[] = [
  {
    name: "read_note",
    description: "Read one note.",
    readOnly: true,
    destructive: false,
    label: "external explanation",
  },
  {
    name: "write_note",
    description: "Replace a note.",
    readOnly: false,
    destructive: true,
    label: "external explanation",
  },
];

function fakeHost(tools: readonly McpTool[] = TOOLS): {
  host: McpHost;
  calls: HostCall[];
} {
  const calls: HostCall[] = [];
  const alive = new Set<string>();
  const host: McpHost = {
    async connect(id) {
      alive.add(id);
      return { ok: true, value: { id, pid: null, alive: true, calls: 0, stderr: [] } };
    },
    async listTools() {
      return { ok: true, value: [...tools] };
    },
    async call(id, tool, input) {
      calls.push({ id, tool, input });
      return {
        ok: true,
        value: { text: `ran ${tool}`, isError: false, ms: 1, label: "external explanation" },
      };
    },
    async close(id) {
      if (id === undefined) alive.clear();
      else alive.delete(id);
    },
    state(id) {
      return { id, pid: null, alive: alive.has(id), calls: 0, stderr: [] };
    },
    pidOf() {
      return null;
    },
    stderrOf() {
      return [];
    },
    servers() {
      return [];
    },
  };
  return { host, calls };
}

async function readyRuntime(
  options: { enabled?: boolean; tools?: readonly McpTool[] } = {},
): Promise<{ runtime: PluginRuntime; calls: HostCall[] }> {
  const { host, calls } = fakeHost(options.tools);
  const runtime = createPluginRuntime(
    [
      {
        id: "notes",
        command: "fake-mcp",
        args: [],
        enabled: options.enabled ?? true,
      },
    ],
    { host },
  );
  await runtime.start();
  return { runtime, calls };
}

function toolResult(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* sourceFor: what is offered, and what runs                                  */
/* -------------------------------------------------------------------------- */

describe("Chill stays read-only", () => {
  test("a write tool is absent in chill even when a gate is installed", async () => {
    const { runtime, calls } = await readyRuntime();
    runtime.setWriteApproval?.(async () => true);

    const chill = runtime.sourceFor("chill");
    if (chill === null) throw new Error("expected read-only chill tools");
    expect(chill.specs.map((spec) => spec.name)).toEqual(["read_note"]);
    expect(chill.specs.every((spec) => spec.write === false)).toBe(true);

    // The same runtime still offers it where a write is legitimate.
    const work = runtime.sourceFor("work");
    expect(work?.specs.map((spec) => spec.name)).toContain("write_note");

    const refused = toolResult(await chill.resolveTool("write_note", { path: "a.md" }));
    expect(refused).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(calls).toHaveLength(0);
  });
});

describe("plugin write tools need a gate", () => {
  test("without approveWrite a write tool is absent and cannot be resolved", async () => {
    const { runtime, calls } = await readyRuntime();
    const source = runtime.sourceFor("chill");
    if (source === null) throw new Error("expected read-only chill tools");

    expect(source.specs.map((spec) => spec.name)).toEqual(["read_note"]);
    expect(source.specs.every((spec) => spec.write === false)).toBe(true);

    // A model can name any tool; the resolver refuses one that was not offered.
    const refused = toolResult(await source.resolveTool("write_note", { path: "a.md" }));
    expect(refused).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(calls).toHaveLength(0);
  });

  test("with approveWrite the write tool is offered, marked write and labelled", async () => {
    const { runtime, calls } = await readyRuntime();
    const asked: PluginWriteRequest[] = [];
    const source = runtime.sourceFor("work", {
      approveWrite: async (request) => {
        asked.push(request);
        return true;
      },
    });
    if (source === null) throw new Error("expected plugin tools");

    const write = source.specs.find((spec) => spec.name === "write_note");
    expect(write).toBeDefined();
    expect(write?.write).toBe(true);
    expect(write?.command).toBe(false);
    // Plugin output is external explanation, never a source.
    expect(write?.description).toContain("(external explanation)");
    // Offering the spec asks nothing: only a call does.
    expect(asked).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("an approved call asks once and reaches the host exactly once", async () => {
    const { runtime, calls } = await readyRuntime();
    const asked: PluginWriteRequest[] = [];
    const source = runtime.sourceFor("work", {
      approveWrite: async (request) => {
        asked.push(request);
        return true;
      },
    });
    if (source === null) throw new Error("expected plugin tools");

    const text = await source.resolveTool("write_note", { path: "a.md", body: "hi" });
    expect(text).toBe("ran write_note");
    expect(asked).toEqual([
      { server: "notes", tool: "write_note", input: { path: "a.md", body: "hi" } },
    ]);
    expect(calls).toEqual([
      { id: "notes", tool: "write_note", input: { path: "a.md", body: "hi" } },
    ]);
  });

  test("every write call asks again: nothing is remembered for the session", async () => {
    const { runtime, calls } = await readyRuntime();
    let approvals = 0;
    const source = runtime.sourceFor("work", {
      approveWrite: async () => {
        approvals += 1;
        return true;
      },
    });
    if (source === null) throw new Error("expected plugin tools");

    await source.resolveTool("write_note", { path: "a.md", body: "one" });
    await source.resolveTool("write_note", { path: "a.md", body: "two" });

    expect(approvals).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.input["body"])).toEqual(["one", "two"]);
  });

  test("a denied call returns the permission error and never reaches the host", async () => {
    const { runtime, calls } = await readyRuntime();
    const source = runtime.sourceFor("work", { approveWrite: async () => false });
    if (source === null) throw new Error("expected plugin tools");

    const denied = toolResult(await source.resolveTool("write_note", { path: "a.md" }));
    expect(denied).toEqual({
      ok: false,
      error: { kind: "permission", message: "the user declined this plugin write" },
    });
    expect(calls).toHaveLength(0);
  });

  test("a gate that throws is a denial, not a crash or a plugin call", async () => {
    const { runtime, calls } = await readyRuntime();
    const source = runtime.sourceFor("work", {
      approveWrite: async () => {
        throw new Error("the shell went away");
      },
    });
    if (source === null) throw new Error("expected plugin tools");

    const denied = toolResult(await source.resolveTool("write_note", { path: "a.md" }));
    expect(denied).toMatchObject({
      ok: false,
      error: { kind: "permission", message: "the user declined this plugin write" },
    });
    expect(calls).toHaveLength(0);
  });

  test("a read-only call still runs without asking", async () => {
    const { runtime, calls } = await readyRuntime();
    let approvals = 0;
    const source = runtime.sourceFor("work", {
      approveWrite: async () => {
        approvals += 1;
        return false;
      },
    });
    if (source === null) throw new Error("expected plugin tools");

    expect(await source.resolveTool("read_note", { path: "a.md" })).toBe("ran read_note");
    expect(approvals).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("a disabled server's off switch wins over an approval gate", async () => {
    const { runtime, calls } = await readyRuntime({ enabled: false });
    const source = runtime.sourceFor("work", { approveWrite: async () => true });
    // Nothing is offered, so there is nothing to approve into running.
    expect(source).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("lock-in still requires the explicit turn call before a write is offered", async () => {
    const { runtime } = await readyRuntime();
    const gate = async (): Promise<boolean> => true;

    expect(runtime.sourceFor("lockin", { approveWrite: gate })).toBeNull();

    const explicit = runtime.sourceFor("lockin", {
      explicitCall: true,
      approveWrite: gate,
    });
    if (explicit === null) throw new Error("expected explicit lock-in tools");
    expect(explicit.specs.map((spec) => spec.name).sort()).toEqual(["read_note", "write_note"]);
  });

  test("the installed gate is the fallback for every source and can be removed", async () => {
    const { runtime, calls } = await readyRuntime();
    let approvals = 0;
    runtime.setWriteApproval?.(async () => {
      approvals += 1;
      return true;
    });

    const source = runtime.sourceFor("work");
    if (source === null) throw new Error("expected plugin tools");
    expect(source.specs.some((spec) => spec.name === "write_note")).toBe(true);
    await source.resolveTool("write_note", { path: "a.md" });
    expect(approvals).toBe(1);
    expect(calls).toHaveLength(1);

    runtime.setWriteApproval?.(null);
    const after = runtime.sourceFor("chill");
    if (after === null) throw new Error("expected read-only tools");
    expect(after.specs.map((spec) => spec.name)).toEqual(["read_note"]);
  });
});

/* -------------------------------------------------------------------------- */
/* mcp.confirm: answers one prompt, never boots, never replays                */
/* -------------------------------------------------------------------------- */

function fakeServices(runtime: PluginRuntime): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-plugin-permission-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-plugin-permission-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-plugin-permission-no-data"),
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
    pluginRuntime: runtime,
  } as unknown as CoreServices;
}

/** A runtime whose only job is to capture the gate the protocol installs. */
function gatedRuntime(): {
  runtime: PluginRuntime;
  gate: () => ((request: PluginWriteRequest) => Promise<boolean>) | null;
} {
  let installed: ((request: PluginWriteRequest) => Promise<boolean>) | null = null;
  const runtime = {
    rows: () => [],
    async refresh() {
      return [];
    },
    async start() {},
    async dispose() {},
    async connect() {
      return [];
    },
    async close() {
      return [];
    },
    async setEnabled() {
      return [];
    },
    sourceFor: () => null,
    setWriteApproval(gate: ((request: PluginWriteRequest) => Promise<boolean>) | null) {
      installed = gate;
    },
  } as unknown as PluginRuntime;
  return { runtime, gate: () => installed };
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
  if (response === null) throw new Error("expected a response");
  return response;
}

function resultOf(response: JsonRpcResponse): Record<string, unknown> {
  if ("error" in response) throw new Error(`expected ok, got ${response.error.message}`);
  return response.result;
}

describe("mcp.confirm", () => {
  test("it is a capability and the documented timeout is 120 s", () => {
    expect(CAPABILITIES as readonly string[]).toContain("mcp.confirm");
    expect(PLUGIN_PERMISSION_TIMEOUT_MS).toBe(120_000);
  });

  test("the protocol installs the gate on the first boot", async () => {
    const { runtime, gate } = gatedRuntime();
    const server = createCoreServer({
      boot: async () =>
        ({ ok: true, value: fakeServices(runtime) }) as Result<CoreServices, BootFailure>,
    });
    expect(gate()).toBeNull();
    await ask(server, "mcp.list");
    expect(typeof gate()).toBe("function");
  });

  test("an allow:true answer resolves one request with the documented event", async () => {
    const { runtime, gate } = gatedRuntime();
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: async () =>
        ({ ok: true, value: fakeServices(runtime) }) as Result<CoreServices, BootFailure>,
      notify: (notification) => notifications.push(notification),
    });
    await ask(server, "mcp.list");

    const installed = gate();
    if (installed === null) throw new Error("the gate was not installed");
    const decision = installed({
      server: "notes",
      tool: "write_note",
      input: { path: "a.md", body: "hi" },
    });

    const event = notifications.find((entry) => entry.method === "mcp.permission");
    expect(event?.params).toMatchObject({
      server: "notes",
      tool: "write_note",
      input: { path: "a.md", body: "hi" },
      write: true,
    });
    const requestId = event?.params?.["requestId"];
    expect(typeof requestId).toBe("string");

    expect(await resultOf(await ask(server, "mcp.confirm", { requestId, allow: true }))).toEqual({
      ok: true,
    });
    expect(await decision).toBe(true);

    // A late answer has nothing left to resolve and is still a success.
    expect(await resultOf(await ask(server, "mcp.confirm", { requestId, allow: false }))).toEqual({
      ok: true,
    });
  });

  test("an allow:false answer resolves the same request as a denial", async () => {
    const { runtime, gate } = gatedRuntime();
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: async () =>
        ({ ok: true, value: fakeServices(runtime) }) as Result<CoreServices, BootFailure>,
      notify: (notification) => notifications.push(notification),
    });
    await ask(server, "mcp.list");

    const installed = gate();
    if (installed === null) throw new Error("the gate was not installed");
    const decision = installed({ server: "notes", tool: "write_note", input: {} });
    const event = notifications.find((entry) => entry.method === "mcp.permission");
    const requestId = event?.params?.["requestId"];

    await ask(server, "mcp.confirm", { requestId, allow: false });
    expect(await decision).toBe(false);
  });

  test("an unknown request id is a benign no-op that never boots the app", async () => {
    let boots = 0;
    const server = createCoreServer({
      boot: async () => {
        boots += 1;
        return { ok: true, value: fakeServices(gatedRuntime().runtime) } as Result<
          CoreServices,
          BootFailure
        >;
      },
    });

    expect(
      await resultOf(await ask(server, "mcp.confirm", { requestId: "late-answer", allow: true })),
    ).toEqual({ ok: true });
    // Resolving an in-memory prompt needs no workspace, no config and no model.
    expect(boots).toBe(0);
  });

  test("allow must be a boolean and requestId a non-empty string", async () => {
    const server = createCoreServer({
      boot: async () =>
        ({
          ok: true,
          value: fakeServices(gatedRuntime().runtime),
        }) as Result<CoreServices, BootFailure>,
    });

    for (const params of [
      { requestId: "any", allow: "yes" },
      { requestId: "any", allow: 1 },
      { requestId: "any" },
      { allow: true },
      { requestId: "  ", allow: true },
    ]) {
      const response = await ask(server, "mcp.confirm", params);
      if (!("error" in response)) throw new Error(`expected a refusal for ${JSON.stringify(params)}`);
      expect(response.error.code).toBe(-32602);
    }
  });
});

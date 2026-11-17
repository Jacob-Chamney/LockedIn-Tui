/**
 * Proposal tools inside a project chat (`work.chat.*` + `work.approvals.*`).
 *
 * A project chat is read-only by default. When the project's approving profile
 * carries `allowWrite`/`allowCommand`, the chat is offered proposal-only tools:
 * they build the same value the explicit `work.write.propose` /
 * `work.command.propose` methods build, store it in the same in-memory map
 * `decide` consumes, and start/finish nothing. These cases drive the tool
 * resolver the chat controller actually receives, then decide through the
 * public methods — no provider, no network, no shell.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProject,
  createProjectAgent,
  makeAgentId,
  makeProjectId,
  setProjectDefaultAgent,
  type ChatToolSource,
} from "../../src/app/actions/projects";
import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreNotification,
  type CoreServices,
  type CoreServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-proposals-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));
});

afterEach(async () => {
  await removeTemp(base);
});

/* -------------------------------------------------------------------------- */
/* fake chat controller and boot seam                                          */
/* -------------------------------------------------------------------------- */

type FakeController = {
  state: () => Record<string, unknown>;
  usage: () => { tokens: number; costMicroUsd: number | null; durationMs: number | null };
  subscribe: (listener: (state: Record<string, unknown>) => void) => () => void;
  load: () => Promise<void>;
  send: (text: string) => Promise<{ kind: "sent"; requestId: string; outcome: "done" }>;
  cancel: () => void;
  dispose: () => void;
};

function fakeController(): FakeController {
  const state: Record<string, unknown> = {
    status: "idle",
    model: null,
    streamed: "",
    messages: [],
    blocked: null,
    error: null,
  };
  return {
    state: () => state,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe: () => () => {},
    load: async () => {},
    send: async () => ({ kind: "sent", requestId: "chat-1", outcome: "done" }),
    cancel: () => {},
    dispose: () => {},
  };
}

type ChatFactory = NonNullable<CoreServices["createChat"]>;

type Harness = {
  server: CoreServer;
  notifications: CoreNotification[];
  built: ChatToolSource[];
};

function harness(): Harness {
  const notifications: CoreNotification[] = [];
  const built: ChatToolSource[] = [];
  const services = {
    workspace,
    settings: { historyLimit: 20 } as unknown as CoreServices["settings"],
    // The proposal tools and the decide handlers are what this file covers, not
    // the outer Settings opt-in; that gate is covered by
    // `tests/unit/server-work-optin.test.ts`. With it on, the profile flags are
    // the remaining gate each case exercises.
    config: {
      work: { allow_write: true, allow_command: true },
    } as unknown as CoreServices["config"],
    createChat: ((
      _history: Parameters<ChatFactory>[0],
      _scope: Parameters<ChatFactory>[1],
      _mode: Parameters<ChatFactory>[2],
      _context: Parameters<ChatFactory>[3],
      tools: Parameters<ChatFactory>[4],
    ) => {
      if (tools !== undefined) built.push(tools);
      return fakeController() as unknown as ReturnType<ChatFactory>;
    }) as ChatFactory,
  } as unknown as CoreServices;
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
  return { server, notifications, built };
}

/* -------------------------------------------------------------------------- */
/* request helpers                                                             */
/* -------------------------------------------------------------------------- */

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: CoreServer,
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

async function resultOf(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result;
}

async function errorOf(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

/* -------------------------------------------------------------------------- */
/* projects                                                                    */
/* -------------------------------------------------------------------------- */

type Permissions = "read-only" | "write" | "commands";

/** A registered project with one default profile and a real empty root. */
async function projectWith(permissions: Permissions): Promise<{ id: string; root: string }> {
  const name = `Proposal ${permissions}`;
  const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  await mkdir(root, { recursive: true });
  const id = makeProjectId(name);
  unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
  const agentId = makeAgentId("Builder");
  unwrap(
    await createProjectAgent({
      workspace,
      projectId: id,
      id: agentId,
      agent: {
        id: agentId,
        name: "Builder",
        task: "Build.",
        model: "",
        permissions,
      },
    }),
  );
  unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
  return { id, root };
}

async function openChat(
  harnessed: Harness,
  projectId: string,
): Promise<ChatToolSource> {
  await resultOf(harnessed.server, "work.chat.open", { projectId });
  const tools = harnessed.built.at(-1);
  if (tools === undefined) throw new Error("work.chat.open did not build a toolbox");
  return tools;
}

function toolNames(tools: ChatToolSource): string[] {
  return tools.specs.map((spec) => spec.name);
}

function parseTool(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`tool result is not an object: ${raw}`);
  }
  return parsed as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* cases                                                                       */
/* -------------------------------------------------------------------------- */

describe("project chat tool selection", () => {
  test("the handshake lists work.approvals.list", () => {
    expect(CAPABILITIES).toContain("work.approvals.list" as (typeof CAPABILITIES)[number]);
  });

  test("a write-capable profile gets write_file and delete_file, but not run_command", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    expect(toolNames(tools)).toEqual([
      "list_files",
      "read_file",
      "search_files",
      "write_file",
      "delete_file",
    ]);
  });

  test("a command-capable profile gets run_command as well", async () => {
    const project = await projectWith("commands");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    expect(toolNames(tools)).toContain("run_command");
    expect(toolNames(tools)).toContain("write_file");
  });

  test("a read-only profile keeps exactly the three read-only tools", async () => {
    const project = await projectWith("read-only");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    expect(toolNames(tools)).toEqual(["list_files", "read_file", "search_files"]);
    // A read-only chat still says writes are off, like before this packet.
    const context = await tools.context({ toolMode: "build", webExplicit: false });
    expect(context).toContain("Writes and commands are off");
  });
});

describe("write_file proposal tool", () => {
  test("creates a pending proposal and a notification, and writes no file", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);
    const path = join(project.root, "notes.md");

    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "# Notes\n" }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: "pending-approval",
      path: "notes.md",
      message: "the user must approve this before it is applied",
    });
    expect(result.id).toEqual(expect.any(String));
    expect(existsSync(path)).toBe(false);

    const proposal = harnessed.notifications.find(
      (entry) => entry.method === "work.write.proposal",
    );
    expect(proposal?.params).toMatchObject({
      projectId: project.id,
      path: "notes.md",
      kind: "create",
      baseHash: null,
      stats: { added: 1, removed: 0 },
    });
    // The raw replacement is never sent to the shell; the diff is.
    expect(proposal?.params).not.toHaveProperty("newContent");

    const listed = (await resultOf(harnessed.server, "work.approvals.list", {
      projectId: project.id,
    })) as { writes: Array<Record<string, unknown>>; commands: unknown[] };
    expect(listed.commands).toEqual([]);
    expect(listed.writes).toHaveLength(1);
    expect(listed.writes[0]).toMatchObject({
      id: result.id,
      projectId: project.id,
      path: "notes.md",
      kind: "create",
      baseHash: null,
    });
    expect(listed.writes[0]).not.toHaveProperty("newContent");
    expect(existsSync(path)).toBe(false);
  });

  test("deciding through work.write.decide applies it and emits approval.resolved", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "# Notes\n" }),
    );

    const approved = await resultOf(harnessed.server, "work.write.decide", {
      id: result.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({
      decision: "approve",
      applied: true,
      path: "notes.md",
      hunks: [0],
      bytes: 8,
    });
    expect(await readFile(join(project.root, "notes.md"), "utf8")).toBe("# Notes\n");

    const resolved = harnessed.notifications.find(
      (entry) => entry.method === "work.approval.resolved",
    );
    expect(resolved?.params).toEqual({ id: result.id, kind: "write" });

    const listed = (await resultOf(harnessed.server, "work.approvals.list")) as {
      writes: unknown[];
      commands: unknown[];
    };
    expect(listed).toEqual({ writes: [], commands: [] });
  });

  test("a path escape is refused by the tool and leaves nothing pending", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    const result = parseTool(
      await tools.resolveTool("write_file", { path: "../escape.md", content: "x\n" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(String(result.error)).toContain("climbs out of the project root");
    expect(existsSync(join(base, "escape.md"))).toBe(false);

    const listed = (await resultOf(harnessed.server, "work.approvals.list")) as {
      writes: unknown[];
    };
    expect(listed.writes).toEqual([]);
  });
});

describe("run_command proposal tool", () => {
  test("proposes without running, then a deny runs nothing", async () => {
    const project = await projectWith("commands");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);
    const marker = join(project.root, "denied-marker.txt");

    const result = parseTool(
      await tools.resolveTool("run_command", {
        argv: ["touch", "denied-marker.txt"],
        cwd: ".",
        reason: "prove a denial runs nothing",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: "pending-approval",
      argv: ["touch", "denied-marker.txt"],
      message: "the user must approve this before it is applied",
    });
    expect(result.id).toEqual(expect.any(String));
    expect(existsSync(marker)).toBe(false);

    const proposal = harnessed.notifications.find(
      (entry) => entry.method === "work.command.proposal",
    );
    expect(proposal?.params).toMatchObject({
      projectId: project.id,
      argv: ["touch", "denied-marker.txt"],
      cwd: ".",
      reason: "prove a denial runs nothing",
    });
    expect(String(proposal?.params?.risk)).toContain("outside the project");

    const listed = (await resultOf(harnessed.server, "work.approvals.list", {
      projectId: project.id,
    })) as { writes: unknown[]; commands: Array<Record<string, unknown>> };
    expect(listed.writes).toEqual([]);
    expect(listed.commands).toHaveLength(1);
    expect(listed.commands[0]).toMatchObject({
      id: result.id,
      projectId: project.id,
      argv: ["touch", "denied-marker.txt"],
      cwd: ".",
    });

    const denied = await resultOf(harnessed.server, "work.command.decide", {
      id: result.id,
      decision: "deny",
    });
    expect(denied).toMatchObject({
      decision: "deny",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    expect(existsSync(marker)).toBe(false);
  });

  test("propose and approve run the exact argv and emit approval.resolved", async () => {
    const project = await projectWith("commands");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);
    const argv =
      Bun.which("printf") === null
        ? [process.execPath, "-e", "process.stdout.write('ok')"]
        : ["printf", "ok"];

    const result = parseTool(await tools.resolveTool("run_command", { argv }));
    const approved = await resultOf(harnessed.server, "work.command.decide", {
      id: result.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({
      decision: "approve",
      argv,
      cwd: ".",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });

    const resolved = harnessed.notifications.find(
      (entry) => entry.method === "work.approval.resolved",
    );
    expect(resolved?.params).toEqual({ id: result.id, kind: "command" });
  });

  test("shell syntax is refused and nothing is pending", async () => {
    const project = await projectWith("commands");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    const result = parseTool(
      await tools.resolveTool("run_command", { argv: ["echo", "hi; rm -rf ."] }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(String(result.error)).toContain("argv");

    const listed = (await resultOf(harnessed.server, "work.approvals.list")) as {
      commands: unknown[];
    };
    expect(listed.commands).toEqual([]);
  });
});

describe("read-only project chat", () => {
  test("the write tool is not exposed and a fall-through call is an unknown tool", async () => {
    const project = await projectWith("read-only");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);

    expect(toolNames(tools)).not.toContain("write_file");
    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "x\n" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result.error as { kind: string }).kind).toBe("tool");
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);

    const listed = (await resultOf(harnessed.server, "work.approvals.list")) as {
      writes: unknown[];
      commands: unknown[];
    };
    expect(listed).toEqual({ writes: [], commands: [] });
  });
});

describe("work.approvals.list", () => {
  test("filters by project and needs no workspace boot", async () => {
    const one = await projectWith("write");
    const two = await projectWith("commands");
    const harnessed = harness();
    const oneTools = await openChat(harnessed, one.id);
    await resultOf(harnessed.server, "work.chat.open", { projectId: two.id });
    const twoTools = harnessed.built.at(-1)!;

    await oneTools.resolveTool("write_file", { path: "a.md", content: "a\n" });
    await twoTools.resolveTool("write_file", { path: "b.md", content: "b\n" });

    const all = (await resultOf(harnessed.server, "work.approvals.list")) as {
      writes: Array<{ projectId: string }>;
    };
    expect(all.writes.map((row) => row.projectId).sort()).toEqual([one.id, two.id].sort());

    const onlyOne = (await resultOf(harnessed.server, "work.approvals.list", {
      projectId: one.id,
    })) as { writes: Array<{ projectId: string; path: string }> };
    expect(onlyOne.writes).toHaveLength(1);
    expect(onlyOne.writes[0]).toMatchObject({ projectId: one.id, path: "a.md" });

    // A stale project id filters to nothing rather than failing.
    expect(
      await resultOf(harnessed.server, "work.approvals.list", { projectId: "gone-000000" }),
    ).toEqual({ writes: [], commands: [] });

    const invalid = await errorOf(harnessed.server, "work.approvals.list", { projectId: "  " });
    expect(invalid.code).toBe(-32602);
  });
});

describe("work.approval.resolved", () => {
  test("a rejected write is reported resolved too, and writes nothing", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);
    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "x\n" }),
    );

    const rejected = await resultOf(harnessed.server, "work.write.decide", {
      id: result.id,
      decision: "reject",
    });
    expect(rejected).toMatchObject({ decision: "reject", applied: false, bytes: 0 });
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);

    const resolved = harnessed.notifications.filter(
      (entry) => entry.method === "work.approval.resolved",
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.params).toEqual({ id: result.id, kind: "write" });
  });

  test("a decided proposal is gone from the pending list", async () => {
    const project = await projectWith("write");
    const harnessed = harness();
    const tools = await openChat(harnessed, project.id);
    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "x\n" }),
    );

    const missing = await errorOf(harnessed.server, "work.write.decide", {
      id: "not-a-proposal",
      decision: "approve",
    });
    expect(missing.code).toBe(BOOT_FAILED);
    expect(missing.retryable).toBe(false);

    // The unknown id left the real pending row alone.
    const listed = (await resultOf(harnessed.server, "work.approvals.list")) as {
      writes: Array<{ id: string }>;
    };
    expect(listed.writes.map((row) => row.id)).toEqual([result.id as string]);
  });
});

/**
 * Project chat over the JSON-RPC core (`work.chat.*`).
 *
 * Every case uses an injected boot seam and a fake `createChat`, so no test here
 * contacts a provider. The project registry is read from a throwaway temp
 * workspace (metadata only), because `work.chat.*` resolves the project through
 * `loadProjects` and must never trust a path from the shell.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import type { Workspace } from "../../src/storage/workspace";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  type CoreNotification,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

let base: string;
let workspace: Workspace;
let projectRoot: string;
let projectId: string;

const PROJECT_META = () => ({
  schema: 1,
  id: projectId,
  name: "Atlas",
  root: projectRoot,
  instructions: "Prefer small diffs.",
  default_agent: "",
  agents: [],
  tasks: [],
  mode: "chat",
  swarm_name: "",
  archived: false,
  created: "2026-11-01T09:00:00.000Z",
});

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-work-chat-"));
  projectId = "atlas-abc123";
  projectRoot = join(base, "atlas");
  await mkdir(projectRoot, { recursive: true });
  const workProjects = join(base, "ws", "work", "projects");
  await mkdir(join(workProjects, projectId), { recursive: true });
  await writeFile(join(workProjects, projectId, "meta.json"), `${JSON.stringify(PROJECT_META(), null, 2)}\n`);
  workspace = {
    root: join(base, "ws"),
    paths: { workProjects },
  } as unknown as Workspace;
});

afterEach(async () => {
  await removeTemp(base);
});

function request(line: string): JsonRpcRequest {
  const parsed = JSON.parse(line) as JsonRpcRequest;
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

type BuiltChat = {
  history: { load: () => Promise<unknown[]> };
  scope: string | undefined;
  mode: string | undefined;
  context: unknown;
  tools: { specs: unknown[] } | undefined;
};

type FakeController = {
  state: () => Record<string, unknown>;
  usage: () => { tokens: number; costMicroUsd: number | null; durationMs: number | null };
  subscribe: (listener: (state: Record<string, unknown>) => void) => () => void;
  load: () => Promise<void>;
  send: (text: string) => Promise<{ kind: "sent"; requestId: string; outcome: "done" }>;
  cancel: () => void;
  dispose: () => void;
  sent: string[];
  cancels: number;
  disposed: boolean;
};

/** A controller whose `load` reads the provided port, and whose send appends. */
function fakeController(history: { load: () => Promise<unknown[]> }): FakeController {
  let state: Record<string, unknown> = {
    status: "idle",
    model: null,
    streamed: "",
    messages: [],
    blocked: null,
    error: null,
  };
  const listeners = new Set<(state: Record<string, unknown>) => void>();
  const controller: FakeController = {
    state: () => state,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      const records = (await history.load()) as Array<{ role: string; content: string }>;
      state = {
        ...state,
        messages: records.map((record, index) => ({
          id: `history-${index}`,
          role: record.role,
          text: record.content,
          outcome: "done",
        })),
      };
    },
    async send(text) {
      controller.sent.push(text);
      const turn = controller.sent.length;
      state = {
        ...state,
        messages: [
          ...(state.messages as unknown[]),
          { id: `u-${turn}`, role: "user", text, outcome: "done" },
          { id: `a-${turn}`, role: "assistant", text: `reply ${turn}`, outcome: "done" },
        ],
      };
      for (const listener of listeners) listener(state);
      return { kind: "sent", requestId: `chat-${turn}`, outcome: "done" };
    },
    cancel() {
      controller.cancels += 1;
    },
    dispose() {
      controller.disposed = true;
    },
    sent: [],
    cancels: 0,
    disposed: false,
  };
  return controller;
}

type ChatFactory = NonNullable<CoreServices["createChat"]>;

function makeServices() {
  const calls = { built: [] as BuiltChat[], controllers: [] as FakeController[] };
  const services = {
    workspace,
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
      dataDir: join(base, "data"),
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
    createChat: ((
      history: Parameters<ChatFactory>[0],
      scope: Parameters<ChatFactory>[1],
      mode: Parameters<ChatFactory>[2],
      context: Parameters<ChatFactory>[3],
      tools: Parameters<ChatFactory>[4],
    ) => {
      const controller = fakeController(history);
      calls.built.push({ history, scope, mode, context, tools });
      calls.controllers.push(controller);
      return controller as unknown as ReturnType<ChatFactory>;
    }) as ChatFactory,    saveConfig: async (patch: Record<string, unknown>) => {
      void patch;
      return {
        ok: true as const,
        value: {
          username: "friend",
          theme: "lockedin",
          chatModel: "openai/gpt-4.1-mini",
          baseUrl: "",
          maxToolCalls: 8,
          maxTokensPerRequest: 16000,
          budgetUsd: 0,
          period: "day",
          warnAt: 0.8,
          pauseAtLimit: false,
          dataDir: join(base, "data"),
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
      };
    },
  } as unknown as CoreServices;
  return { services, calls };
}

function makeServer(
  services: CoreServices,
  notifications: CoreNotification[] = [],
  counter = { calls: 0 },
) {
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
    notify: (notification) => notifications.push(notification),
  });
  return server;
}

/** One `chats/chat-<n>.jsonl` record pair. */
function chatRecords(question: string, answer: string): string {
  return [
    JSON.stringify({ role: "user", content: question, at: "2026-11-01T09:00:00Z" }),
    JSON.stringify({ role: "assistant", content: answer, at: "2026-11-01T09:00:05Z" }),
    "",
  ].join("\n");
}

async function writeChat(chatId: string, body: string): Promise<void> {
  const folder = join(workspace.paths.workProjects, projectId, "chats");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${chatId}.jsonl`), body);
}

describe("work chat capabilities", () => {
  test("the handshake lists the four project-chat methods", () => {
    for (const method of ["work.chat.list", "work.chat.open", "work.chat.send", "work.chat.cancel"]) {
      expect(CAPABILITIES).toContain(method as (typeof CAPABILITIES)[number]);
    }
  });
});

describe("work.chat.list", () => {
  test("an empty project has no chats", async () => {
    const { services } = makeServices();
    expect(await resultOf(makeServer(services), "work.chat.list", { projectId })).toEqual({
      chats: [],
    });
  });

  test("lists the project's chat files in numeric order", async () => {
    await writeChat("chat-2", chatRecords("second", "answer two"));
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const { services } = makeServices();
    expect(await resultOf(makeServer(services), "work.chat.list", { projectId })).toEqual({
      chats: ["chat-1", "chat-2"],
    });
  });

  test("an unknown project is the typed project error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services), "work.chat.list", { projectId: "missing-000000" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "project", projectId: "missing-000000" });

    const missing = await errorOf(makeServer(services), "work.chat.list", {});
    expect(missing.code).toBe(-32602);
  });
});

describe("work.chat.open", () => {
  test("with no chatId it starts chat-1 and reports an idle snapshot", async () => {
    const { services, calls } = makeServices();
    const opened = (await resultOf(makeServer(services), "work.chat.open", { projectId })) as {
      chatId: string;
      snapshot: Record<string, unknown>;
    };

    expect(opened.chatId).toBe("chat-1");
    expect(opened.snapshot).toMatchObject({
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
    });
    expect(opened.snapshot.usage).toMatchObject({ tokens: 0, durationMs: null });

    // One controller, built for the work side with the project toolbox.
    expect(calls.built).toHaveLength(1);
    expect(calls.built[0]).toMatchObject({ scope: "work", mode: "work" });
    expect(typeof calls.built[0]!.context).toBe("function");
    expect(Array.isArray(calls.built[0]!.tools?.specs)).toBe(true);
  });

  test("with no chatId it resumes the newest existing chat and loads its history", async () => {
    await writeChat("chat-1", chatRecords("older", "older reply"));
    await writeChat("chat-2", chatRecords("newest", "newest reply"));
    const { services } = makeServices();
    const opened = (await resultOf(makeServer(services), "work.chat.open", { projectId })) as {
      chatId: string;
      snapshot: { messages: Array<{ id: string; role: string; text: string; outcome: string }> };
    };

    expect(opened.chatId).toBe("chat-2");
    expect(opened.snapshot.messages).toEqual([
      { id: "history-0", role: "user", text: "newest", outcome: "done" },
      { id: "history-1", role: "assistant", text: "newest reply", outcome: "done" },
    ]);
  });

  test("an explicit known chat opens that chat, and a second open reuses the controller", async () => {
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const { services, calls } = makeServices();
    const server = makeServer(services);

    const first = (await resultOf(server, "work.chat.open", { projectId, chatId: "chat-1" })) as {
      chatId: string;
    };
    const second = (await resultOf(server, "work.chat.open", { projectId, chatId: "chat-1" })) as {
      chatId: string;
    };
    expect(first.chatId).toBe("chat-1");
    expect(second.chatId).toBe("chat-1");
    expect(calls.built).toHaveLength(1);
  });

  test("an explicit unknown or malformed chatId is a typed chat error", async () => {
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const { services } = makeServices();
    const server = makeServer(services);

    for (const chatId of ["chat-9", "../../etc/passwd"]) {
      const error = await errorOf(server, "work.chat.open", { projectId, chatId });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "chat", projectId, chatId });
    }

    const invalidChat = await errorOf(server, "work.chat.open", { projectId, chatId: "  " });
    expect(invalidChat.code).toBe(-32602);
  });

  test("an unknown project is the typed project error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services), "work.chat.open", { projectId: "missing-000000" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "project", projectId: "missing-000000" });
  });
});

describe("work.chat.send", () => {
  test("returns the turn id and emits done and state events keyed by project and chat", async () => {
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const notifications: CoreNotification[] = [];
    const { services, calls } = makeServices();
    const server = makeServer(services, notifications);
    await resultOf(server, "work.chat.open", { projectId, chatId: "chat-1" });

    const sent = await resultOf(server, "work.chat.send", {
      projectId,
      chatId: "chat-1",
      text: "Explain this.",
    });
    expect(sent).toEqual({ turnId: `${projectId}:chat-1` });
    expect(calls.controllers[0]!.sent).toEqual(["Explain this."]);

    // The turn settles in a microtask; the coalesced state follows at ~33 ms.
    await Bun.sleep(60);
    const done = notifications.find((entry) => entry.method === "work.chat.done");
    expect(done?.params).toMatchObject({
      projectId,
      chatId: "chat-1",
      kind: "sent",
      outcome: "done",
    });

    const state = notifications.find((entry) => entry.method === "work.chat.state");
    expect(state?.params).toMatchObject({
      projectId,
      chatId: "chat-1",
      status: "idle",
      messages: expect.any(Array),
    });
  });

  test("a chat that was never opened nor stored is a typed chat error", async () => {
    const { services, calls } = makeServices();
    const error = await errorOf(makeServer(services), "work.chat.send", {
      projectId,
      chatId: "chat-4",
      text: "Hello",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "chat", projectId, chatId: "chat-4" });
    expect(calls.built).toHaveLength(0);
  });

  test("a freshly opened chat is addressable before it has a file", async () => {
    const notifications: CoreNotification[] = [];
    const { services } = makeServices();
    const server = makeServer(services, notifications);
    const opened = (await resultOf(server, "work.chat.open", { projectId })) as { chatId: string };

    const sent = await resultOf(server, "work.chat.send", {
      projectId,
      chatId: opened.chatId,
      text: "First turn.",
    });
    expect(sent).toEqual({ turnId: `${projectId}:${opened.chatId}` });
    await Bun.sleep(60);
    expect(notifications.some((entry) => entry.method === "work.chat.done")).toBe(true);
  });

  test("empty text and a missing chat id are -32602 and send nothing", async () => {
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const { services, calls } = makeServices();
    const server = makeServer(services);

    const empty = await errorOf(server, "work.chat.send", { projectId, chatId: "chat-1", text: "  " });
    expect(empty.code).toBe(-32602);
    expect(empty.message).toContain("text");

    const noChat = await errorOf(server, "work.chat.send", { projectId, text: "Hello" });
    expect(noChat.code).toBe(-32602);

    const badChat = await errorOf(server, "work.chat.send", {
      projectId,
      chatId: "../chat",
      text: "Hello",
    });
    expect(badChat.code).toBe(-32602);
    expect(calls.controllers.every((controller) => controller.sent.length === 0)).toBe(true);
  });

  test("an unknown project is the typed project error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services), "work.chat.send", {
      projectId: "missing-000000",
      chatId: "chat-1",
      text: "Hello",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "project", projectId: "missing-000000" });
  });
});

describe("work.chat.cancel", () => {
  test("cancels an open chat and is a no-op when nothing streams", async () => {
    await writeChat("chat-1", chatRecords("first", "answer one"));
    const { services, calls } = makeServices();
    const server = makeServer(services);

    // Nothing open yet: a cancel builds no controller and answers ok.
    expect(await resultOf(server, "work.chat.cancel", { projectId, chatId: "chat-1" })).toEqual({
      ok: true,
    });
    expect(calls.built).toHaveLength(0);

    await resultOf(server, "work.chat.open", { projectId, chatId: "chat-1" });
    expect(await resultOf(server, "work.chat.cancel", { projectId, chatId: "chat-1" })).toEqual({
      ok: true,
    });
    expect(calls.controllers[0]!.cancels).toBe(1);
  });

  test("requires a chat id and a registered project", async () => {
    const { services } = makeServices();
    const server = makeServer(services);

    expect((await errorOf(server, "work.chat.cancel", { projectId })).code).toBe(-32602);
    const unknown = await errorOf(server, "work.chat.cancel", {
      projectId: "missing-000000",
      chatId: "chat-1",
    });
    expect(unknown.data).toMatchObject({ kind: "project", projectId: "missing-000000" });
  });
});

describe("settings.patch and project chat controllers", () => {
  test("a models patch drops the controllers so the next open rebuilds them", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);

    await resultOf(server, "work.chat.open", { projectId });
    expect(calls.built).toHaveLength(1);

    await resultOf(server, "settings.patch", { patch: { models: { chat: "openai/gpt-4.1-mini" } } });
    expect(calls.controllers[0]!.disposed).toBe(true);

    await resultOf(server, "work.chat.open", { projectId });
    expect(calls.built).toHaveLength(2);
  });

  test("an unrelated settings patch keeps an open chat alive", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);

    await resultOf(server, "work.chat.open", { projectId });
    await resultOf(server, "settings.patch", { patch: { ui: { theme: "high-contrast" } } });

    expect(calls.controllers[0]!.disposed).toBe(false);
    await resultOf(server, "work.chat.open", { projectId });
    expect(calls.built).toHaveLength(1);
  });
});

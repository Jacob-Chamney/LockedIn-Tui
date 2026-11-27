/**
 * Skill chat over the JSON-RPC core (`skill.chat.*`).
 *
 * Every case uses an injected boot seam and a fake `createChat`, so no test here
 * contacts a provider. The goal is a real course written into a throwaway temp
 * workspace, because `skill.chat.*` resolves the goal through `loadCourse` and
 * never trusts a path from the shell.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import { createSkillChat, createSkillCourse } from "../../src/app/actions/skills";
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
let goalId: string;

function goalFolder(): string {
  return join(workspace.paths.goals, goalId);
}

function chatsFolder(): string {
  return join(goalFolder(), "chats");
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-skill-chat-"));
  workspace = {
    root: join(base, "ws"),
    paths: { goals: join(base, "ws", "skills", "goals") },
  } as unknown as Workspace;
  await mkdir(workspace.paths.goals, { recursive: true });
  const course = await createSkillCourse({
    workspace,
    goal: "Read disassembly output confidently",
    prior: "I know a little C",
    created: "2026-11-01T09:00:00Z",
  });
  if (!course.ok) throw new Error(course.error.message);
  goalId = course.value.id;
});

afterEach(async () => {
  await removeTemp(base);
});

function request(line: string): JsonRpcRequest {
  return JSON.parse(line) as JsonRpcRequest;
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
  tools: { specs: Array<{ name: string; write: boolean }> } | undefined;
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

function settingsView(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeServices() {
  const calls = { built: [] as BuiltChat[], controllers: [] as FakeController[] };
  const services = {
    workspace,
    settings: settingsView(),
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
    }) as ChatFactory,
    saveConfig: async () => ({
      ok: true as const,
      value: settingsView({ chatModel: "openai/gpt-4.1-mini" }),
    }),
  } as unknown as CoreServices;
  return { services, calls };
}

function makeServer(services: CoreServices, notifications: CoreNotification[] = []) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
}

/** One `chats/chat-<n>.jsonl` record pair. */
function chatRecords(question: string, answer: string): string {
  return [
    JSON.stringify({ role: "user", content: question, at: "2026-11-01T09:00:00Z" }),
    JSON.stringify({ role: "assistant", content: answer, at: "2026-11-01T09:00:05Z" }),
    "",
  ].join("\n");
}

async function newChat(): Promise<string> {
  const opened = await createSkillChat({ workspace, goalId });
  if (!opened.ok) throw new Error(opened.message);
  return opened.id;
}

async function writeChat(chatId: string, body: string): Promise<void> {
  await mkdir(chatsFolder(), { recursive: true });
  await writeFile(join(chatsFolder(), `${chatId}.jsonl`), body);
}

describe("skill chat capabilities", () => {
  test("the handshake lists the four goal-chat methods", () => {
    for (const method of [
      "skill.chat.list",
      "skill.chat.open",
      "skill.chat.send",
      "skill.chat.cancel",
    ]) {
      expect(CAPABILITIES).toContain(method as (typeof CAPABILITIES)[number]);
    }
  });
});

describe("skill.chat.list", () => {
  test("a goal with no chats lists none", async () => {
    const { services } = makeServices();
    expect(await resultOf(makeServer(services), "skill.chat.list", { goalId })).toEqual({
      chats: [],
    });
  });

  test("lists each chat with its title, last use and message count", async () => {
    const chatId = await newChat();
    await writeChat(chatId, chatRecords("Where do I start?", "With the call stack."));
    const { services } = makeServices();

    expect(await resultOf(makeServer(services), "skill.chat.list", { goalId })).toEqual({
      chats: [
        {
          id: chatId,
          title: "Where do I start?",
          lastUsed: "2026-11-01T09:00:05Z",
          messages: 2,
        },
      ],
    });
  });

  test("an unknown goal is the typed skill error and a blank id is -32602", async () => {
    const { services } = makeServices();
    const server = makeServer(services);

    const error = await errorOf(server, "skill.chat.list", { goalId: "missing-goal" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });

    expect((await errorOf(server, "skill.chat.list", {})).code).toBe(-32602);
    expect((await errorOf(server, "skill.chat.list", { goalId: "  " })).code).toBe(-32602);
  });
});

describe("skill.chat.open", () => {
  test("with no chatId it starts chat-1 and reports an idle snapshot", async () => {
    const { services, calls } = makeServices();
    const opened = (await resultOf(makeServer(services), "skill.chat.open", { goalId })) as {
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

    // The chat file and its `meta.json` entry are real, so a second open
    // resumes it instead of inventing another transcript.
    expect(existsSync(join(chatsFolder(), "chat-1.jsonl"))).toBe(true);
    const meta = await readFile(join(goalFolder(), "meta.json"), "utf8");
    expect(meta).toContain('"chat-1"');

    // One controller, built on the skills side with the goal's toolbox.
    expect(calls.built).toHaveLength(1);
    expect(calls.built[0]).toMatchObject({ scope: "skills", mode: "skill" });
    expect(typeof calls.built[0]!.context).toBe("function");
    expect(Array.isArray(calls.built[0]!.tools?.specs)).toBe(true);
    // Read-only tools only: nothing here can write a file or run a command.
    expect(calls.built[0]!.tools?.specs.map((spec) => spec.name).sort()).toEqual([
      "list_sources",
      "read_source",
      "search_sources",
    ]);
    expect(calls.built[0]!.tools?.specs.every((spec) => spec.write === false)).toBe(true);
  });

  test("with no chatId it resumes the newest existing chat and loads its history", async () => {
    const first = await newChat();
    const second = await newChat();
    expect([first, second]).toEqual(["chat-1", "chat-2"]);
    await writeChat(first, chatRecords("older", "older reply"));
    await writeChat(second, chatRecords("newest", "newest reply"));
    const { services } = makeServices();

    const opened = (await resultOf(makeServer(services), "skill.chat.open", { goalId })) as {
      chatId: string;
      snapshot: { messages: Array<{ id: string; role: string; text: string; outcome: string }> };
    };

    expect(opened.chatId).toBe(second);
    expect(opened.snapshot.messages).toEqual([
      { id: "history-0", role: "user", text: "newest", outcome: "done" },
      { id: "history-1", role: "assistant", text: "newest reply", outcome: "done" },
    ]);
  });

  test("an explicit known chat opens that chat and reuses the controller", async () => {
    const chatId = await newChat();
    await writeChat(chatId, chatRecords("first", "answer one"));
    const { services, calls } = makeServices();
    const server = makeServer(services);

    const first = (await resultOf(server, "skill.chat.open", { goalId, chatId })) as {
      chatId: string;
    };
    const second = (await resultOf(server, "skill.chat.open", { goalId, chatId })) as {
      chatId: string;
    };
    expect(first.chatId).toBe(chatId);
    expect(second.chatId).toBe(chatId);
    expect(calls.built).toHaveLength(1);
  });

  test("an explicit unknown or malformed chatId is a typed chat error", async () => {
    await newChat();
    const { services } = makeServices();
    const server = makeServer(services);

    for (const chatId of ["chat-9", "../../etc/passwd"]) {
      const error = await errorOf(server, "skill.chat.open", { goalId, chatId });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "chat", goalId, chatId });
    }
    // A refusal never starts a second transcript.
    expect(existsSync(join(chatsFolder(), "chat-9.jsonl"))).toBe(false);

    expect((await errorOf(server, "skill.chat.open", { goalId, chatId: "  " })).code).toBe(-32602);
    expect((await errorOf(server, "skill.chat.open", { goalId, chatId: 4 })).code).toBe(-32602);
  });

  test("an unknown goal is the typed skill error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services), "skill.chat.open", {
      goalId: "missing-goal",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });
});

describe("skill.chat.send", () => {
  test("returns the turn id and emits done and state events keyed by goal and chat", async () => {
    const chatId = await newChat();
    const notifications: CoreNotification[] = [];
    const { services, calls } = makeServices();
    const server = makeServer(services, notifications);
    await resultOf(server, "skill.chat.open", { goalId, chatId });

    const sent = await resultOf(server, "skill.chat.send", {
      goalId,
      chatId,
      text: "Explain this.",
    });
    expect(sent).toEqual({ turnId: `${goalId}:${chatId}` });
    expect(calls.controllers[0]!.sent).toEqual(["Explain this."]);

    // The turn settles in a microtask; the coalesced state follows at ~33 ms.
    await Bun.sleep(60);
    const done = notifications.find((entry) => entry.method === "skill.chat.done");
    expect(done?.params).toMatchObject({
      goalId,
      chatId,
      kind: "sent",
      outcome: "done",
    });

    const state = notifications.find((entry) => entry.method === "skill.chat.state");
    expect(state?.params).toMatchObject({
      goalId,
      chatId,
      status: "idle",
      messages: expect.any(Array),
    });
  });

  test("a chat that does not exist is a typed chat error and sends nothing", async () => {
    await newChat();
    const { services, calls } = makeServices();
    const error = await errorOf(makeServer(services), "skill.chat.send", {
      goalId,
      chatId: "chat-4",
      text: "Hello",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "chat", goalId, chatId: "chat-4" });
    expect(calls.built).toHaveLength(0);
    expect(existsSync(join(chatsFolder(), "chat-4.jsonl"))).toBe(false);
  });

  test("empty text and a missing chat id are -32602 and send nothing", async () => {
    const chatId = await newChat();
    const { services, calls } = makeServices();
    const server = makeServer(services);

    const empty = await errorOf(server, "skill.chat.send", { goalId, chatId, text: "  " });
    expect(empty.code).toBe(-32602);
    expect(empty.message).toContain("text");

    const noChat = await errorOf(server, "skill.chat.send", { goalId, text: "Hello" });
    expect(noChat.code).toBe(-32602);

    expect(calls.controllers.every((controller) => controller.sent.length === 0)).toBe(true);
  });

  test("an unknown goal is the typed skill error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services), "skill.chat.send", {
      goalId: "missing-goal",
      chatId: "chat-1",
      text: "Hello",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });
});

describe("skill.chat.cancel", () => {
  test("cancels an open chat and is a no-op when nothing streams", async () => {
    const chatId = await newChat();
    const { services, calls } = makeServices();
    const server = makeServer(services);

    // Nothing open yet: a cancel builds no controller and answers ok.
    expect(await resultOf(server, "skill.chat.cancel", { goalId, chatId })).toEqual({ ok: true });
    expect(calls.built).toHaveLength(0);

    await resultOf(server, "skill.chat.open", { goalId, chatId });
    expect(await resultOf(server, "skill.chat.cancel", { goalId, chatId })).toEqual({ ok: true });
    expect(calls.controllers[0]!.cancels).toBe(1);
  });

  test("requires a chat id and a known goal", async () => {
    const { services } = makeServices();
    const server = makeServer(services);

    expect((await errorOf(server, "skill.chat.cancel", { goalId })).code).toBe(-32602);
    const unknown = await errorOf(server, "skill.chat.cancel", {
      goalId: "missing-goal",
      chatId: "chat-1",
    });
    expect(unknown.code).toBe(BOOT_FAILED);
    expect(unknown.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });
});

describe("settings.patch and skill chat controllers", () => {
  test("a models patch drops the controllers so the next open rebuilds them", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);

    await resultOf(server, "skill.chat.open", { goalId });
    expect(calls.built).toHaveLength(1);

    await resultOf(server, "settings.patch", { patch: { models: { chat: "openai/gpt-4.1-mini" } } });
    expect(calls.controllers[0]!.disposed).toBe(true);

    await resultOf(server, "skill.chat.open", { goalId });
    expect(calls.built).toHaveLength(2);
  });

  test("an unrelated settings patch keeps an open chat alive", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);

    await resultOf(server, "skill.chat.open", { goalId });
    await resultOf(server, "settings.patch", { patch: { ui: { theme: "high-contrast" } } });

    expect(calls.controllers[0]!.disposed).toBe(false);
    await resultOf(server, "skill.chat.open", { goalId });
    expect(calls.built).toHaveLength(1);
  });
});

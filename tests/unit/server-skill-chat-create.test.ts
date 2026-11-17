/**
 * `skill.chat.create` over the JSON-RPC core.
 *
 * A goal can hold several chats, but `skill.chat.open` with no id only ever
 * resumes the newest, so the surface needs one explicit "new chat" verb. These
 * cases use an injected boot seam and a fake `createChat` over a real course in
 * a throwaway temp workspace: no provider, no keychain and no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
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
  base = await mkdtemp(join(TEMP_BASE, "server-skill-chat-create-"));
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

type FakeController = {
  state: () => Record<string, unknown>;
  usage: () => { tokens: number; costMicroUsd: number | null; durationMs: number | null };
  subscribe: (listener: (state: Record<string, unknown>) => void) => () => void;
  load: () => Promise<void>;
  send: (text: string) => Promise<{ kind: "sent"; requestId: string; outcome: "done" }>;
  cancel: () => void;
  dispose: () => void;
  sent: string[];
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
    cancel() {},
    dispose() {
      controller.disposed = true;
    },
    sent: [],
    disposed: false,
  };
  return controller;
}

type ChatFactory = NonNullable<CoreServices["createChat"]>;

function settingsView() {
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
    historyLimit: 20,
    responseStyle: "normal",
    tutorPolicy: "direct",
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
  };
}

function makeServices() {
  const calls = { controllers: [] as FakeController[] };
  const services = {
    workspace,
    settings: settingsView(),
    createChat: ((history: Parameters<ChatFactory>[0]) => {
      const controller = fakeController(history);
      calls.controllers.push(controller);
      return controller as unknown as ReturnType<ChatFactory>;
    }) as ChatFactory,
    saveConfig: async () => ({ ok: true as const, value: settingsView() }),
  } as unknown as CoreServices;
  return { services, calls };
}

function makeServer(services: CoreServices, notifications: CoreNotification[] = []) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
}

/** `chat-1`, created through the app action the goal manager uses. */
async function firstChat(): Promise<string> {
  const opened = await createSkillChat({ workspace, goalId });
  if (!opened.ok) throw new Error(opened.message);
  return opened.id;
}

async function writtenChats(): Promise<string[]> {
  const meta = JSON.parse(await readFile(join(goalFolder(), "meta.json"), "utf8")) as {
    chats: string[];
  };
  return meta.chats;
}

describe("skill chat create capability", () => {
  test("the handshake lists the four chat methods plus create", () => {
    for (const method of [
      "skill.chat.list",
      "skill.chat.open",
      "skill.chat.create",
      "skill.chat.send",
      "skill.chat.cancel",
    ]) {
      expect(CAPABILITIES).toContain(method as (typeof CAPABILITIES)[number]);
    }
  });
});

describe("skill.chat.create", () => {
  test("creates chat-2 then chat-3 in order, never reusing an id", async () => {
    const first = await firstChat();
    expect(first).toBe("chat-1");
    const { services } = makeServices();
    const server = makeServer(services);

    const second = (await resultOf(server, "skill.chat.create", { goalId })) as {
      chatId: string;
      snapshot: Record<string, unknown>;
    };
    const third = (await resultOf(server, "skill.chat.create", { goalId })) as {
      chatId: string;
    };

    expect(second.chatId).toBe("chat-2");
    expect(third.chatId).toBe("chat-3");
    expect(existsSync(join(chatsFolder(), "chat-1.jsonl"))).toBe(true);
    expect(existsSync(join(chatsFolder(), "chat-2.jsonl"))).toBe(true);
    expect(existsSync(join(chatsFolder(), "chat-3.jsonl"))).toBe(true);
    expect(await writtenChats()).toEqual(["chat-1", "chat-2", "chat-3"]);

    // `open` still resumes the newest; creation stays explicit.
    const resumed = (await resultOf(server, "skill.chat.open", { goalId })) as { chatId: string };
    expect(resumed.chatId).toBe("chat-3");
  });

  test("the snapshot is the standard idle shape with no model configured", async () => {
    const { services } = makeServices();
    const created = (await resultOf(makeServer(services), "skill.chat.create", {
      goalId,
    })) as { chatId: string; snapshot: Record<string, unknown> };

    expect(created.chatId).toBe("chat-1");
    expect(created.snapshot).toMatchObject({
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
    });
    expect(created.snapshot.usage).toMatchObject({ tokens: 0, durationMs: null });
  });

  test("send on the created chat reaches its lazily built controller", async () => {
    await firstChat();
    const notifications: CoreNotification[] = [];
    const { services, calls } = makeServices();
    const server = makeServer(services, notifications);

    const created = (await resultOf(server, "skill.chat.create", { goalId })) as {
      chatId: string;
    };
    expect(created.chatId).toBe("chat-2");
    expect(calls.controllers).toHaveLength(1);

    const sent = await resultOf(server, "skill.chat.send", {
      goalId,
      chatId: created.chatId,
      text: "Explain the call stack.",
    });
    expect(sent).toEqual({ turnId: `${goalId}:chat-2` });
    expect(calls.controllers[0]!.sent).toEqual(["Explain the call stack."]);

    await Bun.sleep(60);
    const done = notifications.find((entry) => entry.method === "skill.chat.done");
    expect(done?.params).toMatchObject({ goalId, chatId: "chat-2", kind: "sent" });
  });

  test("a created chat survives a model settings patch that drops controllers", async () => {
    await firstChat();
    const { services, calls } = makeServices();
    const server = makeServer(services);

    const created = (await resultOf(server, "skill.chat.create", { goalId })) as {
      chatId: string;
    };
    expect(created.chatId).toBe("chat-2");

    await resultOf(server, "settings.patch", { patch: { models: { chat: "openai/gpt-4.1-mini" } } });
    expect(calls.controllers[0]!.disposed).toBe(true);

    // The chat is on disk, so reopening it rebuilds a controller instead of
    // starting a new transcript.
    const reopened = (await resultOf(server, "skill.chat.open", {
      goalId,
      chatId: created.chatId,
    })) as { chatId: string };
    expect(reopened.chatId).toBe("chat-2");
    expect(await writtenChats()).toEqual(["chat-1", "chat-2"]);
  });

  test("an unknown goal is the typed skill error and creates nothing", async () => {
    const { services, calls } = makeServices();
    const error = await errorOf(makeServer(services), "skill.chat.create", {
      goalId: "missing-goal",
    });

    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
    expect(calls.controllers).toHaveLength(0);
    expect(existsSync(join(workspace.paths.goals, "missing-goal"))).toBe(false);
  });

  test("a blank or non-string goalId is -32602", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);

    expect((await errorOf(server, "skill.chat.create", {})).code).toBe(-32602);
    expect((await errorOf(server, "skill.chat.create", { goalId: "  " })).code).toBe(-32602);
    expect((await errorOf(server, "skill.chat.create", { goalId: 4 })).code).toBe(-32602);
    expect(calls.controllers).toHaveLength(0);
  });
});

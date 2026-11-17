/** Chat over the JSON-RPC core: snapshot, send, events and cancel. */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  createCoreServer,
  type CoreNotification,
  type CoreServices,
} from "../../src/server/protocol";

type Listener = (state: Record<string, unknown>) => void;

function fakeController() {
  const listeners: Listener[] = [];
  const calls = { load: 0, send: [] as string[], cancel: 0 };
  let state: Record<string, unknown> = {
    status: "idle",
    model: null,
    streamed: "",
    messages: [],
    blocked: null,
    error: null,
  };
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  const controller = {
    state: () => state,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe: (listener: Listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    load: async () => {
      calls.load += 1;
      state = { ...state, messages: [{ id: "m1", role: "assistant", text: "old", outcome: "done" }] };
      emit();
    },
    send: async (text: string) => {
      calls.send.push(text);
      state = {
        ...state,
        status: "streaming",
        messages: [
          ...(state.messages as unknown[]),
          { id: "m2", role: "user", text, outcome: "done" },
          { id: "m3", role: "assistant", text: "", outcome: null },
        ],
        streamed: "Hello",
      };
      emit();
      state = {
        ...state,
        status: "idle",
        streamed: "",
        messages: (state.messages as Array<Record<string, unknown>>).map((message) =>
          message.id === "m3" ? { ...message, text: "Hello", outcome: "done" } : message,
        ),
      };
      emit();
      return { kind: "sent", requestId: "r1", outcome: "done" };
    },
    cancel: () => {
      calls.cancel += 1;
      state = { ...state, status: "idle" };
      emit();
    },
  } as unknown as NonNullable<CoreServices["controller"]>;
  return { controller, calls };
}

function makeServer(controller: NonNullable<CoreServices["controller"]>, notifications: CoreNotification[]) {
  const services = {
    workspace: { root: join(tmpdir(), "lockedin-chat-ws"), paths: { schoolSessions: join(tmpdir(), "none") } },
    settings: {
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
      dataDir: join(tmpdir(), "lockedin-chat-data"),
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
    controller,
  } as unknown as CoreServices;
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
}

function req(id: number, method: string, params?: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

describe("chat protocol", () => {
  test("snapshot loads the controller and returns its state", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller, []);
    const response = await server.handle(req(1, "chat.snapshot"));
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        status: "idle",
        model: null,
        messages: [{ id: "m1", role: "assistant", text: "old", outcome: "done" }],
      },
    });
    expect(calls.load).toBe(1);
  });

  test("send returns a turn id and emits state plus done", async () => {
    const { controller, calls } = fakeController();
    const notifications: CoreNotification[] = [];
    const server = makeServer(controller, notifications);
    const response = await server.handle(req(2, "chat.send", { text: "hello" }));
    expect(response).toMatchObject({ id: 2, result: { turnId: "chill" } });
    expect(calls.send).toEqual(["hello"]);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const messages = notifications.filter((entry) => entry.method === "chat.state");
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.at(-1)!.params).toMatchObject({
      status: "idle",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "hello" }),
        expect.objectContaining({ role: "assistant", text: "Hello" }),
      ]),
    });
    expect(notifications.some((entry) => entry.method === "chat.done")).toBe(true);
  });

  test("cancel reaches the controller", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller, []);
    expect(await server.handle(req(3, "chat.cancel"))).toMatchObject({ id: 3, result: { ok: true } });
    expect(calls.cancel).toBe(1);
  });

  test("an empty message is refused", async () => {
    const { controller } = fakeController();
    const server = makeServer(controller, []);
    const response = await server.handle(req(4, "chat.send", { text: "  " }));
    expect(response).toMatchObject({ id: 4, error: { code: -32602 } });
  });
});

/**
 * Session opening and session-bound chat over the JSON-RPC core.
 *
 * The workspace is a real temporary folder (a session is opened from its own
 * `meta.json`), but every service above it is a fake: there is no provider, no
 * network and no keychain. `tests/integration/server-data.test.ts` drives the
 * same methods through the real boot.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { ChatController } from "../../src/app/chat-controller";
import type { Result } from "../../src/domain/markdown";
import type { ChatState } from "../../src/app/chat-model";
import type { SettingsView } from "../../src/types/settings";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreNotification,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const SESSION_ID = "2026-11-01-0900-physics-unit-4";
const SOURCE_HASH = `sha256:${"a".repeat(64)}`;

function view(): SettingsView {
  return {
    username: "friend",
    theme: "lockedin",
    chatModel: "",
    baseUrl: "",
    maxToolCalls: 8,
    maxTokensPerRequest: 16000,
    responseStyle: "normal",
    tutorPolicy: "direct",
    budgetUsd: 0,
    period: "day",
    warnAt: 0.8,
    pauseAtLimit: false,
    dataDir: join(tmpdir(), "lockedin-session-data"),
    archiveBackend: "folder",
    archiveFolder: "",
    historyLimit: 20,
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
  };
}

type FakeController = {
  controller: ChatController;
  sent: string[];
  cancels: number;
  loads: number;
  disposed: number;
  emit: (patch: Partial<ChatState>) => void;
};

/** Only the controller surface the protocol calls, plus test counters. */
function fakeController(): FakeController {
  const listeners = new Set<(state: ChatState) => void>();
  let state = {
    status: "idle",
    model: null,
    streamed: "",
    messages: [],
    blocked: null,
    error: null,
  } as unknown as ChatState;

  const fake: FakeController = {
    controller: {} as ChatController,
    sent: [],
    cancels: 0,
    loads: 0,
    disposed: 0,
    emit: (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
  };

  fake.controller = {
    state: () => state,
    subscribe: (listener: (state: ChatState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    load: async () => {
      fake.loads += 1;
    },
    send: async (text?: string) => {
      fake.sent.push(text ?? "");
      fake.emit({ status: "streaming" });
      fake.emit({ status: "idle" });
      return { kind: "sent", requestId: "turn-1", outcome: "done" } as const;
    },
    cancel: () => {
      fake.cancels += 1;
    },
    dispose: () => {
      fake.disposed += 1;
    },
  } as unknown as ChatController;

  return fake;
}

let base: string;
let sessionsDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-session-"));
  sessionsDir = join(base, "school", "sessions");
  const folder = join(sessionsDir, SESSION_ID);
  await mkdir(join(folder, "sources"), { recursive: true });
  await writeFile(
    join(folder, "meta.json"),
    `${JSON.stringify(
      {
        schema: 1,
        id: SESSION_ID,
        name: "Physics — Unit 4",
        created: "2026-11-01T09:00:00Z",
        prompt: "Study the boundary conditions.",
        steps: true,
        sources: [
          {
            original_path: "/home/me/input/lecture-4.md",
            stored_path: "sources/aaaaaaaa-lecture-4.md",
            name: "lecture-4.md",
            hash: SOURCE_HASH,
            kind: "markdown",
          },
        ],
        instructions_source: null,
        archived: false,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(folder, "prompt.md"), "Study the boundary conditions.\n");
  await writeFile(
    join(folder, "assignment-steps.md"),
    "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n",
  );
});

afterEach(async () => {
  await removeTemp(base);
});

function makeServices(): { services: CoreServices; built: FakeController[] } {
  const built: FakeController[] = [];
  const services = {
    workspace: {
      root: join(base, "workspace"),
      paths: {
        schoolSessions: sessionsDir,
        dataDir: join(base, "data"),
      },
    },
    settings: view(),
    createChat: (() => {
      const fake = fakeController();
      built.push(fake);
      return fake.controller;
    }) as CoreServices["createChat"],
  } as unknown as CoreServices;
  return { services, built };
}

function makeServer(services: CoreServices): {
  server: CoreServer;
  notifications: CoreNotification[];
} {
  const notifications: CoreNotification[] = [];
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
  return { server, notifications };
}

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

/** Let a resolved promise's `.then` handlers run without waiting on a clock. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session.open", () => {
  test("returns the prompt, sources and steps the manager renders", async () => {
    const { server } = makeServer(makeServices().services);
    expect(await resultOf(server, "session.open", { id: SESSION_ID })).toEqual({
      session: {
        id: SESSION_ID,
        name: "Physics — Unit 4",
        created: "2026-11-01T09:00:00.000Z",
        archived: false,
        prompt: "Study the boundary conditions.\n",
        sources: [
          {
            name: "lecture-4.md",
            originalPath: "/home/me/input/lecture-4.md",
            storedPath: "sources/aaaaaaaa-lecture-4.md",
            hash: SOURCE_HASH,
            kind: "markdown",
          },
        ],
        steps: {
          done: 1,
          total: 2,
          exists: true,
          markdown:
            "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n",
        },
      },
    });
  });

  test("a session with no steps reports an empty, absent step list", async () => {
    const { server } = makeServer(makeServices().services);
    const folder = join(sessionsDir, SESSION_ID);
    await writeFile(join(folder, "assignment-steps.md"), "");
    const opened = (await resultOf(server, "session.open", { id: SESSION_ID })) as {
      session: { steps: { done: number; total: number; exists: boolean; markdown: string } };
    };
    expect(opened.session.steps).toEqual({ done: 0, total: 0, exists: false, markdown: "" });
  });

  test("an unknown session is a typed -32000 error, not a crash", async () => {
    const { server } = makeServer(makeServices().services);
    const handle = await server.handle(
      request(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session.open",
          params: { id: "2026-12-31-0000-missing" },
        }),
      ),
    );
    if (handle === null || !("error" in handle)) throw new Error("expected an error");
    expect(handle.error.code).toBe(BOOT_FAILED);
    expect(handle.error.retryable).toBe(false);
    expect(handle.error.data).toMatchObject({
      kind: "session",
      id: "2026-12-31-0000-missing",
    });
    expect((handle.error.data as { message: string }).message).toContain("no session");
  });

  test("a missing id is invalid params", async () => {
    const { server } = makeServer(makeServices().services);
    const error = await errorOf(server, "session.open", {});
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("session id");
  });
});

describe("session.chat.snapshot", () => {
  test("returns the chill snapshot shape and builds one controller", async () => {
    const { services, built } = makeServices();
    const { server } = makeServer(services);

    const snapshot = await resultOf(server, "session.chat.snapshot", { id: SESSION_ID });
    expect(snapshot).toEqual({
      seq: 0,
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
      usage: { tokens: 0, costMicroUsd: null, durationMs: null },
    });

    // A second call reuses the controller and does not reload history.
    await resultOf(server, "session.chat.snapshot", { id: SESSION_ID });
    expect(built).toHaveLength(1);
    expect(built[0]!.loads).toBe(1);
  });

  test("an unknown session is a typed error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services).server, "session.chat.snapshot", {
      id: "2026-12-31-0000-missing",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "session", id: "2026-12-31-0000-missing" });
  });
});

describe("session.chat.send", () => {
  test("returns a turn id and emits coalesced state plus done with the session id", async () => {
    const { services, built } = makeServices();
    const { server, notifications } = makeServer(services);

    const sent = await resultOf(server, "session.chat.send", {
      id: SESSION_ID,
      text: "Explain the boundary conditions.",
    });
    expect(sent).toEqual({ turnId: SESSION_ID });
    expect(built[0]!.sent).toEqual(["Explain the boundary conditions."]);

    await tick();
    const done = notifications.find((entry) => entry.method === "session.chat.done");
    expect(done?.params).toMatchObject({
      sessionId: SESSION_ID,
      kind: "sent",
      requestId: "turn-1",
      outcome: "done",
    });

    // Two controller emissions inside one window become one state event.
    await Bun.sleep(60);
    const states = notifications.filter((entry) => entry.method === "session.chat.state");
    expect(states).toHaveLength(1);
    expect(states[0]!.params).toMatchObject({
      sessionId: SESSION_ID,
      status: "idle",
      usage: { tokens: 0, costMicroUsd: null, durationMs: null },
    });
    expect(states[0]!.params).toHaveProperty("messages");
    // The snapshot above was sequence 0, so the first emitted frame is 1.
    expect((states[0]!.params as { seq: number }).seq).toBe(1);
    const after = await resultOf(server, "session.chat.snapshot", { id: SESSION_ID });
    expect((after as { seq: number }).seq).toBe(1);
  });

  test("empty text is invalid params and builds no controller", async () => {
    const { services, built } = makeServices();
    const { server } = makeServer(services);
    for (const text of ["", "   ", 7]) {
      const error = await errorOf(server, "session.chat.send", { id: SESSION_ID, text });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("non-empty text");
    }
    expect(built).toHaveLength(0);
  });

  test("an unknown session is a typed error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services).server, "session.chat.send", {
      id: "2026-12-31-0000-missing",
      text: "hello",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "session" });
  });
});

describe("session.chat.cancel", () => {
  test("cancels the loaded controller", async () => {
    const { services, built } = makeServices();
    const { server } = makeServer(services);
    await resultOf(server, "session.chat.snapshot", { id: SESSION_ID });

    expect(await resultOf(server, "session.chat.cancel", { id: SESSION_ID })).toEqual({ ok: true });
    expect(built[0]!.cancels).toBe(1);
  });

  test("cancelling a session with no controller is a no-op, not an error", async () => {
    const { services, built } = makeServices();
    const { server } = makeServer(services);
    expect(await resultOf(server, "session.chat.cancel", { id: SESSION_ID })).toEqual({ ok: true });
    expect(built).toHaveLength(0);
  });

  test("an unknown session is a typed error", async () => {
    const { services } = makeServices();
    const error = await errorOf(makeServer(services).server, "session.chat.cancel", {
      id: "2026-12-31-0000-missing",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "session" });
  });
});

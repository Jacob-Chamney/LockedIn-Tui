/**
 * Session memory on the desktop path (`docs/product.md` §4.5).
 *
 * `recordTurn` already existed; nothing called it, so a completed session chat
 * never produced `memory.md`. These cases cover the two halves of the new call
 * site: the deterministic extractor (pure, no model, no cost) and the protocol's
 * write path after `session.chat.done`.
 *
 * The chat controller is a fake, so nothing here contacts a provider, opens a
 * keychain entry or touches the network. The session folder is real, because the
 * write under test is a real atomic file write.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { ChatController } from "../../src/app/chat-controller";
import type { Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { removeTemp } from "../helpers/cleanup";
import {
  MEMORY_POINTS_PER_TURN,
  MEMORY_POINT_CHARS,
  createCoreServer,
  extractMemoryPoints,
  type CoreNotification,
  type CoreServices,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const SESSION_ID = "2026-11-01-0900-memory-test";

let base: string;
let sessionsDir: string;
let folder: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-session-memory-"));
  sessionsDir = join(base, "school", "sessions");
  folder = join(sessionsDir, SESSION_ID);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, SESSION_FILES.meta),
    JSON.stringify({
      schema: 1,
      id: SESSION_ID,
      name: "Memory test",
      created: "2026-11-01T09:00:00.000Z",
      prompt: "Summarise the notes.",
      steps: false,
      sources: [],
      archived: false,
    }),
    "utf8",
  );
});

afterEach(async () => {
  await removeTemp(base);
});

type Turn = { outcome: "done" | "cancelled" | "error"; text: string };

/**
 * One controller whose `send` settles with the queued replies.
 *
 * It emits the new state through the same subscriber the protocol uses, so the
 * protocol reads the assistant answer exactly as it would from the real
 * controller. Everything else is inert: no history, no tools, no usage.
 */
function fakeController(turns: Turn[]): ChatController {
  type Listener = (state: FakeState) => void;
  type FakeState = {
    status: string;
    model: string | null;
    streamed: string;
    messages: Array<{ id: string; role: string; text: string; outcome?: string }>;
    blocked?: unknown;
    error?: unknown;
  };
  const queue = [...turns];
  const listeners = new Set<Listener>();
  let state: FakeState = {
    status: "idle",
    model: "custom/fake",
    streamed: "",
    messages: [],
  };
  const emit = (next: FakeState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  let sequence = 0;
  return {
    state: () => state as unknown as ReturnType<ChatController["state"]>,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {},
    async send() {
      const turn = queue.shift();
      if (turn === undefined) throw new Error("the fake chat has no reply queued");
      const requestId = `chat-${++sequence}`;
      const outcome = turn.outcome === "done" ? "done" : turn.outcome === "cancelled" ? "stopped" : "failed";
      emit({
        ...state,
        status: turn.outcome === "done" ? "idle" : turn.outcome === "cancelled" ? "cancelled" : "failed",
        messages: [
          ...state.messages,
          { id: `${requestId}-user`, role: "user", text: "explain", outcome: "done" },
          { id: `${requestId}-reply`, role: "assistant", text: turn.text, outcome },
        ],
      });
      return { kind: "sent" as const, requestId, outcome: turn.outcome };
    },
    cancel() {},
    dispose() {},
  } as unknown as ChatController;
}

/** A booted-looking core over one real session folder and a fake controller. */
function core(turns: Turn[], notifications: CoreNotification[] = []) {
  const services = {
    workspace: {
      root: base,
      paths: { schoolSessions: sessionsDir, dataDir: join(base, "data") },
    },
    settings: { historyLimit: 20 },
    createChat: () => fakeController(turns),
  } as unknown as CoreServices;
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
}

let nextId = 1;
async function ask(
  server: ReturnType<typeof core>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: nextId++,
    method,
    ...(params === undefined ? {} : { params }),
  });
  if (response === null) throw new Error("expected a response");
  return response;
}

/** Wait for the fire-and-forget memory write that follows `session.chat.done`. */
async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function memoryText(): Promise<string> {
  return readFile(join(folder, SESSION_FILES.memory), "utf8").catch(() => "");
}

async function sent(server: ReturnType<typeof core>): Promise<void> {
  const response = await ask(server, "session.chat.send", { id: SESSION_ID, text: "explain" });
  if ("error" in response) throw new Error(response.error.message);
}

describe("extractMemoryPoints", () => {
  test("prefers list items and strips Markdown emphasis", () => {
    const points = extractMemoryPoints(
      [
        "## Summary",
        "",
        "The **mitochondria** is the *powerhouse* of the cell.",
        "",
        "- **Glycolysis** happens in the cytoplasm",
        "- The _Krebs cycle_ happens in the `matrix`",
        "",
        "```js",
        "const notAPoint = true",
        "```",
      ].join("\n"),
    );
    expect(points).toEqual([
      "Glycolysis happens in the cytoplasm",
      "The Krebs cycle happens in the matrix",
    ]);
  });

  test("falls back to the first sentences of a prose answer", () => {
    const points = extractMemoryPoints(
      "## Summary\n\nBoundary conditions determine the integral limits. They also set the energy balance. A third sentence names the result.",
    );
    // The heading is structure, so it is not glued onto the first sentence.
    expect(points).toEqual([
      "Boundary conditions determine the integral limits.",
      "They also set the energy balance.",
      "A third sentence names the result.",
    ]);
  });

  test("caps at five points and keeps the document order", () => {
    const points = extractMemoryPoints(
      ["- one", "- two", "- three", "- four", "- five", "- six", "- seven"].join("\n"),
    );
    expect(points).toHaveLength(MEMORY_POINTS_PER_TURN);
    expect(points).toEqual(["one", "two", "three", "four", "five"]);
    expect(points).not.toContain("six");
  });

  test("bounds each point to one line of at most 200 characters", () => {
    const points = extractMemoryPoints(`- ${"x".repeat(500)}`);
    expect(points).toHaveLength(1);
    expect(points[0]?.length).toBe(MEMORY_POINT_CHARS);
    expect(points[0]?.endsWith("…")).toBe(true);
    expect(points[0]).not.toContain("\n");
  });

  test("drops duplicates, empties and fenced code", () => {
    const points = extractMemoryPoints(
      [
        "- **Same** point",
        "- same point",
        "-",
        "```",
        "only code here",
        "```",
        "",
        "Prose after the list is not used while bullets exist.",
      ].join("\n"),
    );
    expect(points).toEqual(["Same point"]);
  });

  test("an empty answer yields no points", () => {
    expect(extractMemoryPoints("")).toEqual([]);
    expect(extractMemoryPoints("```\ncode only\n```")).toEqual([]);
  });
});

describe("session memory write", () => {
  test("a completed turn writes the answer's bullets to memory.md", async () => {
    const notifications: CoreNotification[] = [];
    const server = core(
      [
        {
          outcome: "done",
          text: "Here is what matters.\n\n- Boundary conditions set the limits\n- Energy is conserved",
        },
      ],
      notifications,
    );

    await sent(server);
    await waitFor(async () => (await memoryText()) !== "", "memory.md");

    const text = await memoryText();
    expect(text).toContain("type: session-summary");
    expect(text).toContain(`session: ${SESSION_ID}`);
    expect(text).toContain("# Key points");
    expect(text).toContain("- Boundary conditions set the limits");
    expect(text).toContain("- Energy is conserved");
    // The preamble is prose, and list items were preferred over it.
    expect(text).not.toContain("Here is what matters");
    // The terminal event was emitted before the write completed.
    expect(notifications.some((entry) => entry.method === "session.chat.done")).toBe(true);
  });

  test("a cancelled turn writes no memory", async () => {
    const server = core([{ outcome: "cancelled", text: "" }]);

    await sent(server);
    // Cancelled is a no-op in the service, so waiting a turn of the event loop
    // is enough to prove no write was started.
    await Bun.sleep(60);
    expect(existsSync(join(folder, SESSION_FILES.memory))).toBe(false);
  });

  test("a failed turn writes no memory", async () => {
    const server = core([{ outcome: "error", text: "" }]);

    await sent(server);
    await Bun.sleep(60);
    expect(existsSync(join(folder, SESSION_FILES.memory))).toBe(false);
  });

  test("a second identical turn writes nothing new", async () => {
    const answer = "- Boundary conditions set the limits\n- Energy is conserved";
    const server = core([
      { outcome: "done", text: answer },
      { outcome: "done", text: answer },
    ]);

    await sent(server);
    await waitFor(async () => (await memoryText()) !== "", "the first memory write");
    const first = await memoryText();

    await sent(server);
    await Bun.sleep(80);
    expect(await memoryText()).toBe(first);
  });

  test("session.open returns the stored memory and null when there is none", async () => {
    const empty = await ask(core([]), "session.open", { id: SESSION_ID });
    if ("error" in empty) throw new Error(empty.error.message);
    // No memory yet: the key is absent, so a no-memory session shape is unchanged.
    expect((empty.result.session as { memory?: unknown }).memory).toBeUndefined();

    const server = core([{ outcome: "done", text: "- Boundary conditions set the limits" }]);
    await sent(server);
    await waitFor(async () => (await memoryText()) !== "", "memory.md");

    const opened = await ask(server, "session.open", { id: SESSION_ID });
    if ("error" in opened) throw new Error(opened.error.message);
    const memory = (opened.result.session as { memory?: { points: string[]; folded: string[]; updated: string } })
      .memory;
    expect(memory).toBeDefined();
    expect(memory?.points).toEqual(["Boundary conditions set the limits"]);
    expect(memory?.folded).toEqual([]);
    const updated = memory?.updated ?? "";
    expect(new Date(updated).toISOString()).toBe(updated);
  });
});

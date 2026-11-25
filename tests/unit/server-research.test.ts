/**
 * `research.start` / `list` / `read`: a background brief that must cite.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  createCoreServer,
  parseRequest,
  type CoreNotification,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const GOAL_ID = "read-disassembly-3f9a1c";

let base: string;
let goalsDir: string;

const HTML =
  "<html><head><title>Registers</title></head><body>" +
  "<p>A register is a named slot inside the processor and holds working state across calls.</p>" +
  "</body></html>";

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-research-"));
  goalsDir = join(base, "skills", "goals");
  await mkdir(join(goalsDir, GOAL_ID), { recursive: true });
  await writeFile(
    join(goalsDir, GOAL_ID, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: GOAL_ID,
      name: "Read disassembly",
      statement: "Read disassembly",
      level: "beginner",
      time_budget: "",
      created: "2026-11-01T09:00:00Z",
      pinned: false,
      archived: false,
      stages: [],
      sources: [],
      chats: [],
    }),
  );
});

afterEach(async () => {
  await removeTemp(base);
});

function services(generate: (prompt: string) => Promise<string>): CoreServices {
  return {
    workspace: { root: join(base, "workspace"), paths: { goals: goalsDir } },
    settings: { dataDir: join(base, "data") },
    generate,
    researchFetch: (async () =>
      new Response(HTML, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
  } as unknown as CoreServices;
}

function core(
  generate: (prompt: string) => Promise<string>,
  notifications: CoreNotification[],
) {
  const server = createCoreServer({
    boot: async () =>
      ({ ok: true, value: services(generate) }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
  return server;
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const parsed = parseRequest(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
  );
  if ("error" in parsed) throw new Error(parsed.error.message);
  const response = await server.handle(parsed as JsonRpcRequest);
  if (response === null) throw new Error("expected a response");
  return response;
}

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method}: ${response.error.message}`);
  return response.result as Record<string, unknown>;
}

/** Wait for one research.updated notification, with a deadline. */
async function settled(notifications: CoreNotification[]): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const found = notifications.find((notification) => notification.method === "research.updated");
    if (found) return found.params as Record<string, unknown>;
    await Bun.sleep(10);
  }
  throw new Error("no research.updated notification");
}

describe("research", () => {
  test("a started brief is fetched, cited, listed and readable", async () => {
    const notifications: CoreNotification[] = [];
    let prompt = "";
    const server = core(async (text) => {
      prompt = text;
      return "A register holds working state [1]. (agent explanation) That is why it survives a call.";
    }, notifications);

    const started = await resultOf(server, "research.start", {
      goalId: GOAL_ID,
      question: "why do registers survive a call?",
      urls: ["https://example.org/registers"],
    });
    expect(started.status).toBe("running");
    const event = await settled(notifications);
    expect(event.status).toBe("done");
    expect(prompt).toContain("why do registers survive a call?");
    expect(prompt).toContain("[1] Registers");

    const listed = await resultOf(server, "research.list", { goalId: GOAL_ID });
    const items = listed.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]!.question).toBe("why do registers survive a call?");

    const read = await resultOf(server, "research.read", {
      goalId: GOAL_ID,
      id: items[0]!.id,
    });
    expect(read.markdown).toContain("A register holds working state [1].");
    expect((read.item as Record<string, unknown>).sources).toHaveLength(1);
  });

  test("cancel discards a running brief and writes nothing", async () => {
    const notifications: CoreNotification[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = core(async () => {
      await gate;
      return "A register holds state [1].";
    }, notifications);

    const started = await resultOf(server, "research.start", {
      goalId: GOAL_ID,
      question: "why?",
      urls: ["https://example.org/registers"],
    });
    const researchId = started.id as string;
    const cancelled = await resultOf(server, "research.cancel", {
      goalId: GOAL_ID,
      id: researchId,
    });
    expect(cancelled.cancelled).toBe(true);

    release();
    const event = await settled(notifications);
    expect(event.status).toBe("cancelled");
    const listed = await resultOf(server, "research.list", { goalId: GOAL_ID });
    expect(listed.items).toEqual([]);

    const unknown = await resultOf(server, "research.cancel", {
      goalId: GOAL_ID,
      id: "not-running",
    });
    expect(unknown.cancelled).toBe(false);
  });

  test("a brief with no citation fails and writes nothing", async () => {
    const notifications: CoreNotification[] = [];
    const server = core(async () => "Registers are fast.", notifications);
    await resultOf(server, "research.start", {
      goalId: GOAL_ID,
      question: "why?",
      urls: ["https://example.org/registers"],
    });
    const event = await settled(notifications);
    expect(event.status).toBe("failed");
    expect(String(event.message)).toContain("cited no source");

    const listed = await resultOf(server, "research.list", { goalId: GOAL_ID });
    expect(listed.items).toEqual([]);
  });

  test("a local or non-https source is a shape error before any fetch", async () => {
    const notifications: CoreNotification[] = [];
    const server = core(async () => "x [1]", notifications);
    for (const url of ["http://example.org/a", "https://localhost/a", "not a url"]) {
      const response = await ask(server, "research.start", {
        goalId: GOAL_ID,
        question: "why?",
        urls: [url],
      });
      if (!("error" in response)) throw new Error("should have failed");
      expect(response.error.code).toBe(-32602);
    }
    expect(notifications).toHaveLength(0);
  });

  test("an unreadable source set fails with one message", async () => {
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: async () =>
        ({
          ok: true,
          value: {
            ...services(async () => "x [1]"),
            researchFetch: (async () =>
              new Response("no", { status: 500 })) as unknown as typeof fetch,
          } as unknown as CoreServices,
        }) as Result<CoreServices, BootFailure>,
      notify: (notification) => notifications.push(notification),
    });
    await resultOf(server, "research.start", {
      goalId: GOAL_ID,
      question: "why?",
      urls: ["https://example.org/a"],
    });
    const event = await settled(notifications);
    expect(event.status).toBe("failed");
    expect(String(event.message)).toContain("could be read");
  });
});

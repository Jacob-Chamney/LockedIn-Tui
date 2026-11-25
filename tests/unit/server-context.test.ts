/**
 * `session.chat.context` / `compact` / `uncompact`.
 *
 * The transcript is append-only; compaction is a view stored beside it. These
 * cases drive a real temp workspace so the invariant is checked on bytes: the
 * summary changes the next request, not `chat.jsonl`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const SESSION_ID = "2026-11-01-0900-physics";

let root: string;
let sessions: string;
let chatPath: string;

function transcript(): string {
  return Array.from({ length: 12 }, (_, index) =>
    JSON.stringify({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `record ${index}`,
      at: "2026-11-01T10:00:00.000Z",
    }),
  ).join("\n") + "\n";
}

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "server-context-"));
  sessions = join(root, "school", "sessions");
  chatPath = join(sessions, SESSION_ID, "chat.jsonl");
  await mkdir(join(sessions, SESSION_ID), { recursive: true });
  await writeFile(
    join(sessions, SESSION_ID, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: SESSION_ID,
      name: "Physics",
      created: "2026-11-01T09:00:00Z",
      prompt: "",
      sources: [],
      archived: false,
    }),
  );
  await writeFile(chatPath, transcript());
});

afterEach(async () => {
  await removeTemp(root);
});

function services(generate?: (prompt: string) => Promise<string>): CoreServices {
  return {
    workspace: { root, paths: { schoolSessions: sessions } },
    settings: { dataDir: join(root, "data") },
    ...(generate === undefined ? {} : { generate }),
  } as unknown as CoreServices;
}

function core(generate?: (prompt: string) => Promise<string>) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services(generate) }) as Result<CoreServices, BootFailure>,
  });
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

describe("session context", () => {
  test("the meter reports the transcript and says it can compact", async () => {
    const view = await resultOf(core(), "session.chat.context", { id: SESSION_ID });
    expect(view.messages).toBe(12);
    expect(view.kept).toBe(12);
    expect(view.through).toBe(0);
    expect(view.compactable).toBe(true);
    expect(Number(view.tokens)).toBeGreaterThan(0);
    expect(Number(view.window)).toBeGreaterThan(0);
  });

  test("compaction stores a summary, keeps the last eight, and leaves chat.jsonl alone", async () => {
    const before = await readFile(chatPath, "utf8");
    let prompt = "";
    const server = core(async (text) => {
      prompt = text;
      return "The learner is working on registers and has not covered the stack yet.";
    });

    const compacted = await resultOf(server, "session.chat.compact", { id: SESSION_ID });
    expect(compacted.through).toBe(4);
    expect(compacted.kept).toBe(8);
    expect(compacted.summary).toContain("registers");
    expect(prompt).toContain("record 0");
    expect(prompt).not.toContain("record 11");

    expect(await readFile(chatPath, "utf8")).toBe(before);
    const stored = JSON.parse(
      await readFile(join(sessions, SESSION_ID, "context.json"), "utf8"),
    );
    expect(stored.summary).toContain("registers");
    expect(stored.through).toBe(4);
  });

  test("uncompact drops the summary and the meter shows the full history", async () => {
    const server = core(async () => "a summary");
    await resultOf(server, "session.chat.compact", { id: SESSION_ID });
    const cleared = await resultOf(server, "session.chat.uncompact", { id: SESSION_ID });
    expect(cleared.through).toBe(0);
    expect(cleared.kept).toBe(12);
    const missing = await readFile(join(sessions, SESSION_ID, "context.json"), "utf8").catch(
      () => null,
    );
    expect(missing).toBeNull();
  });

  test("a short chat says there is nothing to compact, not a retry", async () => {
    await writeFile(chatPath, JSON.stringify({ role: "user", content: "one" }) + "\n");
    const server = core(async () => "a summary");
    const response = await ask(server, "session.chat.compact", { id: SESSION_ID });
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.message).toContain("nothing to compact");
    expect(response.error.retryable).toBe(false);
  });

  test("an empty summary and a provider failure write nothing", async () => {
    const empty = await ask(core(async () => "   "), "session.chat.compact", { id: SESSION_ID });
    if (!("error" in empty)) throw new Error("should have failed");
    expect(empty.error.message).toContain("empty");

    const failed = await ask(
      core(async () => {
        throw new Error("provider refused");
      }),
      "session.chat.compact",
      { id: SESSION_ID },
    );
    if (!("error" in failed)) throw new Error("should have failed");
    expect(failed.error.message).toContain("provider refused");
    const stored = await readFile(join(sessions, SESSION_ID, "context.json"), "utf8").catch(
      () => null,
    );
    expect(stored).toBeNull();
  });
});

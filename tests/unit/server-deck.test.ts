/**
 * `session.deck.state` / `session.deck.grade` / `session.deck.reset`.
 *
 * The deck is Markdown; the schedule is a small JSON beside it. These cases
 * drive a real temp workspace so the pairing, the write and the reset are the
 * bytes a learner would get, not a mock.
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
let outputs: string;

const DECK = `# Flashcards — Physics

## Card 1

Q: What does a register hold?
A: Working state.

## Card 2

Q: What does a call save?
A: The return address.
`;

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "server-deck-"));
  sessions = join(root, "school", "sessions");
  outputs = join(root, "school", "outputs", SESSION_ID);
  await mkdir(join(sessions, SESSION_ID), { recursive: true });
  await mkdir(outputs, { recursive: true });
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
  await writeFile(join(outputs, "flashcards.md"), DECK);
});

afterEach(async () => {
  await removeTemp(root);
});

function services(): CoreServices {
  return {
    workspace: { root, paths: { schoolSessions: sessions } },
    settings: { dataDir: join(root, "data") },
  } as unknown as CoreServices;
}

function core() {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services() }) as Result<CoreServices, BootFailure>,
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
  if ("error" in response) {
    throw new Error(`${method}: ${response.error.message} ${JSON.stringify(response.error.data)}`);
  }
  return response.result as Record<string, unknown>;
}

describe("session deck", () => {
  test("an ungraded deck has every card due now", async () => {
    const state = await resultOf(core(), "session.deck.state", { id: SESSION_ID });
    expect(state.due).toBe(2);
    expect(state.total).toBe(2);
    const cards = state.cards as Record<string, unknown>[];
    expect(cards[0]!.question).toBe("What does a register hold?");
    expect(cards[0]!.due).toBe(true);
    expect(cards[0]!.reps).toBe(0);
  });

  test("a grade persists and moves only that card", async () => {
    const server = core();
    const graded = await resultOf(server, "session.deck.grade", {
      id: SESSION_ID,
      index: 0,
      grade: "good",
    });
    expect(graded.due).toBe(1);
    const cards = graded.cards as Record<string, unknown>[];
    expect(cards[0]!.reps).toBe(1);
    expect(cards[0]!.due).toBe(false);
    expect(cards[0]!.lastGrade).toBe("good");
    expect(cards[1]!.reps).toBe(0);

    // A fresh read of the same workspace sees the write.
    const reread = await resultOf(core(), "session.deck.state", { id: SESSION_ID });
    expect(reread.due).toBe(1);
    const onDisk = JSON.parse(await readFile(join(outputs, "flashcards-schedule.json"), "utf8"));
    expect(onDisk.schema).toBe(1);
    expect(onDisk.cards).toHaveLength(2);
  });

  test("again is a lapse and a ten-minute step", async () => {
    const graded = await resultOf(core(), "session.deck.grade", {
      id: SESSION_ID,
      index: 1,
      grade: "again",
    });
    const card = (graded.cards as Record<string, unknown>[])[1]!;
    expect(card.lapses).toBe(1);
    expect(card.due).toBe(false);
    expect(card.lastGrade).toBe("again");
    expect(Number(card.intervalDays)).toBeLessThan(0.01);
  });

  test("reset makes every card due again", async () => {
    const server = core();
    await resultOf(server, "session.deck.grade", { id: SESSION_ID, index: 0, grade: "easy" });
    const reset = await resultOf(server, "session.deck.reset", { id: SESSION_ID });
    expect(reset.due).toBe(2);
    expect((reset.cards as Record<string, unknown>[])[0]!.reps).toBe(0);
  });

  test("a session with no deck is a refusal with the next step", async () => {
    await writeFile(join(outputs, "flashcards.md"), "");
    const response = await ask(core(), "session.deck.state", { id: SESSION_ID });
    // An empty deck parses to zero cards, which is a valid empty state: due 0.
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result.due).toBe(0);

    await (await import("node:fs/promises")).rm(join(outputs, "flashcards.md"));
    const missing = await ask(core(), "session.deck.state", { id: SESSION_ID });
    if (!("error" in missing)) throw new Error("should have failed");
    expect(missing.error.code).toBe(BOOT_FAILED);
    expect(missing.error.message).toContain("build one first");
  });

  test("a bad grade or index is a shape error, not a write", async () => {
    const server = core();
    for (const params of [
      { id: SESSION_ID, index: 0, grade: "maybe" },
      { id: SESSION_ID, index: -1, grade: "good" },
      { id: SESSION_ID, index: 1.5, grade: "good" },
    ]) {
      const response = await ask(server, "session.deck.grade", params);
      if (!("error" in response)) throw new Error("should have failed");
      expect(response.error.code).toBe(-32602);
    }
    const state = await resultOf(server, "session.deck.state", { id: SESSION_ID });
    expect(state.due).toBe(2);
  });
});

/**
 * `prompts.list` / `prompts.set`: stored notes, validation, and the proof that
 * a note reaches the generator without changing its contract.
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
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { PROMPT_IDS } from "../../src/domain/prompts";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const GOAL_ID = "read-disassembly";

let base: string;
let goalsDir: string;
const notes: Record<string, string> = {};

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-prompts-"));
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
  for (const key of Object.keys(notes)) delete notes[key];
});

afterEach(async () => {
  await removeTemp(base);
});

const MEASURE = JSON.stringify({
  goal: "read disassembly",
  held: ["registers hold state"],
  gaps: [],
  plan: [{ title: "one" }, { title: "two" }, { title: "three" }],
});

function services(generate: (prompt: string) => Promise<string>): CoreServices {
  return {
    workspace: { root: join(base, "workspace"), paths: { goals: goalsDir } },
    settings: { dataDir: join(base, "data") },
    generate,
    promptNote: (id: import("../../src/domain/prompts").PromptId) => notes[id] ?? "",
    savePrompt: async (id: import("../../src/domain/prompts").PromptId, note: string) => {
      if (note === "") delete notes[id];
      else notes[id] = note;
      return { ok: true, value: undefined } as Result<void, { message: string }>;
    },
  } as unknown as CoreServices;
}

function core(generate: (prompt: string) => Promise<string>) {
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

describe("prompts", () => {
  test("the list is the catalogue with no notes at first", async () => {
    const listed = await resultOf(core(async () => MEASURE), "prompts.list");
    const items = listed.items as Record<string, unknown>[];
    expect(items.map((item) => item.id)).toEqual([...PROMPT_IDS]);
    expect(items.every((item) => item.note === "" && item.custom === false)).toBe(true);
  });

  test("set stores a note and the measure prompt carries it", async () => {
    let prompt = "";
    const server = core(async (text) => {
      prompt = text;
      return MEASURE;
    });
    const set = await resultOf(server, "prompts.set", {
      id: "measure",
      text: "  prefer small words  ",
    });
    const measure = (set.items as Record<string, unknown>[]).find((item) => item.id === "measure")!;
    expect(measure.note).toBe("prefer small words");
    expect(measure.custom).toBe(true);

    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    expect(prompt).toContain("Standing note from the learner");
    expect(prompt).toContain("prefer small words");
    expect(prompt).toContain("those always win");
  });

  test("an omitted text clears the note", async () => {
    const server = core(async () => MEASURE);
    await resultOf(server, "prompts.set", { id: "step", text: "be concrete" });
    const cleared = await resultOf(server, "prompts.set", { id: "step" });
    const item = (cleared.items as Record<string, unknown>[]).find((entry) => entry.id === "step")!;
    expect(item.note).toBe("");
    expect(item.custom).toBe(false);
  });

  test("an unknown id or an over-long note is a shape error", async () => {
    const server = core(async () => MEASURE);
    for (const params of [
      { id: "nope", text: "x" },
      { id: "measure", text: "x".repeat(2001) },
      { id: "measure", text: 4 },
    ]) {
      const response = await ask(server, "prompts.set", params);
      if (!("error" in response)) throw new Error("should have failed");
      expect(response.error.code).toBe(-32602);
    }
  });

  test("the generic settings patch cannot write a note", async () => {
    const response = await ask(core(async () => MEASURE), "settings.patch", {
      patch: { prompts: { measure: "do it my way" } },
    });
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain("prompts.set");
  });
});

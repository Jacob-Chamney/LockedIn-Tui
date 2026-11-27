/**
 * The core bridge's read-only Skills surface: validation and typed failures.
 *
 * The boot seam is injected, so no test here creates a real workspace or
 * contacts a provider. The `goals` folder is a bare temp directory that only
 * `loadGoalRows` reads, and no course is ever opened: `skill.open` on a
 * missing id fails before any chapter file could be read. The real
 * create/list/open path is covered by `tests/integration/server-data.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const base = await mkdtemp(join(TEMP_BASE, "server-skills-"));
afterAll(async () => {
  await removeTemp(base);
});

/** A fake workspace whose only real path is the goals folder. */
function fakeServices(goals: string): CoreServices {
  return {
    workspace: {
      root: join(base, "workspace"),
      paths: { goals },
    },
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
  } as unknown as CoreServices;
}

/** A core whose boot resolves to a fake workspace and counts its calls. */
function fakeCore(goals: string) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: fakeServices(goals) } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
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

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

describe("skill capabilities", () => {
  test("the handshake advertises both read methods", async () => {
    expect([...CAPABILITIES]).toContain("skill.list");
    expect([...CAPABILITIES]).toContain("skill.open");
    const { server } = fakeCore(join(base, "no-goals"));
    const response = await server.handle(request('{"jsonrpc":"2.0","id":1,"method":"initialize"}'));
    expect(response).toMatchObject({
      result: { capabilities: expect.arrayContaining(["skill.list", "skill.open"]) },
    });
  });
});

describe("skill.list", () => {
  test("a workspace with no goals folder is an empty list", async () => {
    const { server } = fakeCore(join(base, "no-goals"));
    const response = await ask(server, "skill.list");
    if ("error" in response) throw new Error(`skill.list failed: ${response.error.message}`);
    expect(response.result).toEqual({ skills: [] });
  });

  test("a broken goal folder is a row carrying its reason, not an invented one", async () => {
    const goals = join(base, "goals");
    await mkdir(join(goals, "broken-goal"), { recursive: true });
    const { server } = fakeCore(goals);
    const response = await ask(server, "skill.list");
    if ("error" in response) throw new Error(`skill.list failed: ${response.error.message}`);
    const rows = response.result.skills as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "broken-goal",
      // A broken folder has no readable name, so the id stands in for it.
      name: "broken-goal",
      stage: { done: 0, total: 0 },
      lastOpened: "",
      chats: 0,
      archived: false,
    });
    expect(typeof rows[0]!.broken).toBe("string");
    expect((rows[0]!.broken as string).length).toBeGreaterThan(0);
    // Nothing was created by the read itself.
    expect(existsSync(join(goals, "broken-goal"))).toBe(true);
  });
});

describe("skill.open validation", () => {
  test("a missing, blank or non-string id is -32602 before boot", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    for (const id of [undefined, "", "   ", 3, null]) {
      const error = await errorOf(server, "skill.open", id === undefined ? {} : { id });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("skill id");
    }
    // A shape failure never reaches the workspace.
    expect(counter.calls).toBe(0);
  });

  test("an unknown id is one typed -32000 skill error", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    const error = await errorOf(server, "skill.open", { id: "missing-goal" });

    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "skill",
      id: "missing-goal",
      message: error.message,
    });
    expect(error.message).toContain('"missing-goal"');
    expect(counter.calls).toBe(1);
  });

  test("a path-like id never escapes the goals folder", async () => {
    const goals = join(base, "guarded-goals");
    await mkdir(goals, { recursive: true });
    const { server } = fakeCore(goals);

    // `confinedJoin` maps an escaping id to a sentinel, so there is no course
    // to read and the reply is the same typed skill error.
    const error = await errorOf(server, "skill.open", { id: "../../etc" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "../../etc" });
  });
});

describe("skill.open stages", () => {
  /** One goal folder with a hand-written `meta.json`, the shape the TUI writes. */
  async function goalWith(goals: string, id: string, meta: Record<string, unknown>): Promise<void> {
    await mkdir(join(goals, id), { recursive: true });
    await writeFile(join(goals, id, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  test("a curriculum goal returns its stages and an empty chapter list", async () => {
    const goals = join(base, "staged-goals");
    await goalWith(goals, "staged-goal", {
      schema: 1,
      id: "staged-goal",
      name: "Assembly basics",
      statement: "read disassembly output confidently",
      level: "beginner",
      time_budget: "6 weeks",
      created: "2026-11-01T09:00:00.000Z",
      pinned: false,
      archived: false,
      stages: [
        { id: "stage-1", title: "Registers", milestone: "explain a stack frame", status: "done" },
        { id: "stage-2", title: "Control flow", milestone: "", status: "active" },
        { id: "stage-3", title: "Conventions", milestone: "read a prologue", status: "pending" },
      ],
      sources: [],
      chats: [],
    });
    const { server } = fakeCore(goals);

    const response = await ask(server, "skill.open", { id: "staged-goal" });
    if ("error" in response) throw new Error(`skill.open failed: ${response.error.message}`);
    const skill = response.result.skill as Record<string, unknown>;

    // The stage ids are the ones `skill.lesson.build`/`read` accept, in
    // curriculum order; an empty milestone is absent rather than "".
    expect(skill.stages).toEqual([
      { id: "stage-1", title: "Registers", status: "done", milestone: "explain a stack frame" },
      { id: "stage-2", title: "Control flow", status: "active" },
      { id: "stage-3", title: "Conventions", status: "pending", milestone: "read a prologue" },
    ]);
    // A curriculum goal has no chapter index, so the page is stages only.
    expect(skill.chapters).toEqual([]);
    expect(skill).toMatchObject({
      id: "staged-goal",
      name: "Assembly basics",
      goal: "read disassembly output confidently",
      created: "2026-11-01T09:00:00.000Z",
      prior: "",
      plan: "template",
      chats: [],
    });
  });

  test("a template course has chapters and an empty stage list", async () => {
    const goals = join(base, "course-goals");
    await goalWith(goals, "course-goal", {
      schema: 1,
      id: "course-goal",
      name: "Read disassembly output confidently",
      goal: "Read disassembly output confidently",
      prior: "I know a little C",
      created: "2026-11-01T09:00:00.000Z",
      plan: "template",
      chapters: [
        {
          id: "ch-1",
          title: "Getting started",
          guide: "01-getting-started.md",
          practical: "01-getting-started-practical.md",
          done: false,
        },
      ],
    });
    const { server } = fakeCore(goals);

    const response = await ask(server, "skill.open", { id: "course-goal" });
    if ("error" in response) throw new Error(`skill.open failed: ${response.error.message}`);
    const skill = response.result.skill as Record<string, unknown>;

    // No curriculum is not an error: the stage picker is empty and the chapter
    // index is the page.
    expect(skill.stages).toEqual([]);
    expect(skill.chapters).toHaveLength(1);
  });

  test("a broken folder is still one typed skill error", async () => {
    const goals = join(base, "broken-goals");
    await mkdir(join(goals, "broken-goal"), { recursive: true });
    const { server } = fakeCore(goals);

    const error = await errorOf(server, "skill.open", { id: "broken-goal" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "broken-goal" });
  });

  test("a malformed course index is not reported as an empty course", async () => {
    const goals = join(base, "malformed-course-goals");
    await goalWith(goals, "malformed-course", {
      schema: 1,
      id: "malformed-course",
      name: "Broken index",
      goal: "Broken index",
      prior: "",
      created: "2026-11-01T09:00:00.000Z",
      // The key is there, so this is a course; the entries are unusable.
      chapters: [{ id: "ch-1" }],
    });
    const { server } = fakeCore(goals);

    const error = await errorOf(server, "skill.open", { id: "malformed-course" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "malformed-course" });
  });
});

/**
 * The core bridge's `skill.chapter` surface: validation and typed failures.
 *
 * The boot seam is injected, so nothing here boots a workspace or contacts a
 * provider. A course index and its two chapter files are hand-written into a
 * bare temp `goals` folder, because `loadCourse`/`loadChapter` read only
 * `workspace.paths.goals`. The successful read over a real created course lives
 * in `tests/integration/server-data.test.ts`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const base = await mkdtemp(join(TEMP_BASE, "server-skill-chapter-"));
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

/** Write the smallest course `readCourse` accepts, plus its two chapter files. */
async function writeCourse(goals: string, id: string): Promise<void> {
  const folder = join(goals, id);
  await mkdir(join(folder, "chapters"), { recursive: true });
  await writeFile(
    join(folder, "meta.json"),
    `${JSON.stringify(
      {
        schema: 1,
        id,
        name: "Read disassembly output confidently",
        goal: "Read disassembly output confidently",
        prior: "",
        created: "2026-11-01T09:00:00.000Z",
        chapters: [
          {
            id: "ch-1",
            title: "Getting started",
            guide: "01-getting-started.md",
            practical: "01-getting-started-practical.md",
            done: false,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(folder, "chapters", "01-getting-started.md"), "# Lesson\n", "utf8");
  await writeFile(
    join(folder, "chapters", "01-getting-started-practical.md"),
    "# Practical\n",
    "utf8",
  );
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
  params: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, "skill.chapter", params);
  if (!("error" in response)) throw new Error("skill.chapter should have failed");
  return response.error;
}

const MISSING_SKILL = { id: "missing-goal", chapterId: "ch-1" };

describe("skill.chapter capabilities", () => {
  test("the handshake advertises it", async () => {
    expect([...CAPABILITIES]).toContain("skill.chapter");
    const { server } = fakeCore(join(base, "no-goals"));
    const response = await server.handle(request('{"jsonrpc":"2.0","id":1,"method":"initialize"}'));
    expect(response).toMatchObject({
      result: { capabilities: expect.arrayContaining(["skill.chapter"]) },
    });
  });
});

describe("skill.chapter validation", () => {
  test("a missing, blank or non-string id is -32602 before boot", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    for (const id of [undefined, "", "   ", 3, null, ["goal"]]) {
      const params = id === undefined ? { chapterId: "ch-1" } : { id, chapterId: "ch-1" };
      const error = await errorOf(server, params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("skill id");
    }
    expect(counter.calls).toBe(0);
  });

  test("a missing, blank or non-string chapterId is -32602 before boot", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    for (const chapterId of [undefined, "", "   ", 1, null, { id: "ch-1" }]) {
      const params =
        chapterId === undefined ? { id: "goal" } : { id: "goal", chapterId };
      const error = await errorOf(server, params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("chapter id");
    }
    expect(counter.calls).toBe(0);
  });

  test("a non-boolean practical is -32602 before boot", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    for (const practical of ["true", 1, 0, null, {}, []]) {
      const error = await errorOf(server, { ...MISSING_SKILL, practical });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("boolean");
    }
    expect(counter.calls).toBe(0);
  });

  test("practical is optional and defaults to the lesson", async () => {
    const goals = join(base, "default-goals");
    await writeCourse(goals, "goal");
    const { server } = fakeCore(goals);
    const response = await ask(server, "skill.chapter", { id: "goal", chapterId: "ch-1" });
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result).toEqual({
      text: "# Lesson\n",
      practical: false,
      chapter: { id: "ch-1", title: "Getting started" },
    });
  });
});

describe("skill.chapter failures", () => {
  test("an unknown skill is the typed skill shape -32000", async () => {
    const { server, counter } = fakeCore(join(base, "no-goals"));
    const error = await errorOf(server, MISSING_SKILL);

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

    const error = await errorOf(server, { id: "../../etc", chapterId: "ch-1" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "../../etc" });
  });

  test("an unknown chapter is the typed chapter shape -32000", async () => {
    const goals = join(base, "chapter-goals");
    await writeCourse(goals, "goal");
    const { server } = fakeCore(goals);

    const error = await errorOf(server, { id: "goal", chapterId: "ch-9" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "chapter",
      id: "goal",
      chapterId: "ch-9",
      message: error.message,
    });
    expect(error.message).toContain('"ch-9"');
  });

  test("a chapter file that cannot be read is the same chapter shape", async () => {
    const goals = join(base, "missing-body-goals");
    await writeCourse(goals, "goal");
    // The practical exists in the index but not on disk.
    await rm(join(goals, "goal", "chapters", "01-getting-started-practical.md"));
    const { server } = fakeCore(goals);

    const error = await errorOf(server, { id: "goal", chapterId: "ch-1", practical: true });
    // One reported failure, never a partial answer or a second attempt.
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "chapter", id: "goal", chapterId: "ch-1" });
  });
});

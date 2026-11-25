/**
 * Review entries for promoted mistakes and Work swarm tasks.
 *
 * One real workspace: a lock-in session with a promoted mistake note, and a
 * project whose swarm board is process state. The model loop is a seam, so
 * nothing here contacts a provider.
 *
 * The two new queue kinds differ on purpose: a mistake is a durable Markdown
 * note whose `status` changes, while a task is a live board row verified through
 * `work.swarm.verify`. Both are derived, never invented.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import { parseDocument, readString, type Result } from "../../src/domain/markdown";
import { createLockInSession } from "../../src/services/lockin/create";
import {
  promoteMistake,
  recordMistake,
} from "../../src/services/lockin/mistakes";
import { createAgent, setDefaultAgent, type AgentProfile } from "../../src/services/work/agents";
import { register, setMode } from "../../src/services/work/register";
import type { SwarmBoard, WorkerResult } from "../../src/services/work/swarm";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import type { SettingsView } from "../../src/types/settings";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspace: Workspace;
let sessionId: string;
let projectId: string;
let agent: AgentProfile;

function view(dataDir: string): SettingsView {
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
    dataDir,
    archiveBackend: "folder",
    archiveFolder: "",
    historyLimit: 20,
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
  };
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-review-extended-"));
  workspace = unwrap(await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") }));

  const input = join(base, "lecture-4.md");
  await writeFile(input, "# Unit 4\n\nBoundary conditions.\n");
  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T14:30:00Z",
      name: "Physics — Unit 4",
      files: [input],
    }),
  );
  sessionId = created.session.id;
  unwrap(
    await recordMistake({
      workspace,
      sessionId,
      text: "Energy is conserved per object.",
      step: "Derive the energy balance",
    }),
  );
  unwrap(await promoteMistake({ workspace, sessionId, index: 0 }));

  const projectRoot = join(base, "project");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  projectId = unwrap(await register({ workspace, root: projectRoot, name: "Atlas" })).meta.id;
  unwrap(await setMode({ workspace, id: projectId, mode: "swarm", swarmName: "Review crew" }));
  agent = unwrap(await createAgent({ workspace, projectId, name: "Reviewer" }));
  unwrap(await setDefaultAgent({ workspace, projectId, id: agent.id }));
});

afterEach(async () => {
  await removeTemp(base);
});

function makeServer(runner?: () => Promise<WorkerResult>): CoreServer {
  const services = {
    workspace,
    settings: view(join(base, "data")),
    ...(runner === undefined ? {} : { swarmRunner: runner }),
  } as unknown as CoreServices;
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
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

async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  ms = 2_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(5);
  }
}

type QueueItem = Record<string, unknown>;

function itemsOf(result: Record<string, unknown>): QueueItem[] {
  const queue = result.queue as { items?: QueueItem[] } | undefined;
  return queue?.items ?? [];
}

const MISTAKE_ID = () => `mistake:${sessionId}:0`;

describe("a promoted mistake in the review queue", () => {
  test("appears on the school side only, with its provenance", async () => {
    const server = makeServer();

    const all = itemsOf(await resultOf(server, "review.queue"));
    const mistake = all.find((item) => item.kind === "mistake");
    expect(mistake).toMatchObject({
      id: MISTAKE_ID(),
      label: "Energy is conserved per object.",
      context: "Physics — Unit 4",
      contextId: sessionId,
      reason: "uncorrected",
      origin: "session-mistake",
    });

    const school = itemsOf(await resultOf(server, "review.queue", { side: "school" }));
    expect(school.map((item) => item.id)).toContain(MISTAKE_ID());
    expect(itemsOf(await resultOf(server, "review.queue", { side: "skills" }))).toEqual([]);
    expect(itemsOf(await resultOf(server, "review.queue", { side: "work" }))).toEqual([]);
  });

  test("known marks the note reviewed and removes it without deleting it", async () => {
    const server = makeServer();
    const marked = await resultOf(server, "review.mark", {
      itemId: MISTAKE_ID(),
      result: "known",
    });
    expect(itemsOf(marked).some((item) => item.kind === "mistake")).toBe(false);

    const notePath = join(workspace.root, "school/vault/knowledge");
    const files = await import("node:fs/promises").then((fs) => fs.readdir(notePath));
    const note = files.find((name) => name.endsWith(".md"))!;
    const parsed = parseDocument(await readFile(join(notePath, note), "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(readString(parsed.value.data, "status")).toBe("reviewed");
    expect(readString(parsed.value.data, "reviewed_at")).not.toBe("");
    // The body still carries the label; only the frontmatter changed.
    expect(parsed.value.body).toContain("not one of the session's sources");
  });

  test("missed increments a durable count and keeps it in the queue", async () => {
    const server = makeServer();
    const first = await resultOf(server, "review.mark", {
      itemId: MISTAKE_ID(),
      result: "missed",
    });
    const item = itemsOf(first).find((entry) => entry.kind === "mistake");
    expect(item?.count).toBe(1);

    const second = await resultOf(server, "review.mark", {
      itemId: MISTAKE_ID(),
      result: "missed",
    });
    expect(itemsOf(second).find((entry) => entry.kind === "mistake")?.count).toBe(2);

    const listed = itemsOf(await resultOf(server, "review.queue"));
    expect(listed.find((entry) => entry.kind === "mistake")?.count).toBe(2);
  });

  test("a malformed mistake id is invalid params and an unknown one is a refusal", async () => {
    const server = makeServer();
    const malformed = await errorOf(server, "review.mark", {
      itemId: `mistake:${sessionId}:x`,
      result: "known",
    });
    expect(malformed.code).toBe(-32602);

    const unknown = await errorOf(server, "review.mark", {
      itemId: `mistake:${sessionId}:9`,
      result: "known",
    });
    expect(unknown.code).toBe(BOOT_FAILED);
    expect(unknown.data).toMatchObject({ kind: "review" });
    expect(unknown.retryable).toBe(false);
  });
});

describe("a done swarm task in the review queue", () => {
  async function settled(server: CoreServer, runId: string): Promise<SwarmBoard> {
    let board: SwarmBoard | undefined;
    await until(async () => {
      const result = await resultOf(server, "work.swarm.board", { projectId, runId });
      board = result.board as SwarmBoard;
      return board.status !== "running" && board.reportPath !== null;
    }, "the swarm to settle");
    if (board === undefined) throw new Error("no board");
    return board;
  }

  async function run(server: CoreServer): Promise<string> {
    const started = await resultOf(server, "work.swarm.run", {
      projectId,
      objective: "Review the change",
      plan: [{ title: "Check the API", assignment: "read the routes" }],
    });
    const runId = started.runId as string;
    await settled(server, runId);
    return runId;
  }

  test("is an item on the work side until a person verifies it", async () => {
    const server = makeServer(async () => ({ status: "done", summary: "read the routes" }));
    const runId = await run(server);

    const work = itemsOf(await resultOf(server, "review.queue", { side: "work" }));
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({
      id: `task:${projectId}:${runId}:task-1`,
      kind: "task",
      label: "Check the API",
      context: "Atlas",
      reason: "unverified",
      origin: "swarm",
      priority: 5,
    });

    // Learning sides never show a Work task.
    for (const side of ["school", "skills"]) {
      const items = itemsOf(await resultOf(server, "review.queue", { side }));
      expect(items.some((item) => item.kind === "task")).toBe(false);
    }

    const marked = await resultOf(server, "review.mark", {
      itemId: `task:${projectId}:${runId}:task-1`,
      result: "known",
    });
    expect(itemsOf(marked).some((item) => item.kind === "task")).toBe(false);

    const board = await resultOf(server, "work.swarm.board", { projectId, runId });
    expect((board.board as SwarmBoard).tasks[0]?.verified).toBe(true);
    const report = await readFile((board.board as SwarmBoard).reportPath!, "utf8");
    expect(report).toContain("[verified]");
  });

  test("missed is refused: a completed task has no miss signal", async () => {
    const server = makeServer(async () => ({ status: "done", summary: "read the routes" }));
    const runId = await run(server);

    const error = await errorOf(server, "review.mark", {
      itemId: `task:${projectId}:${runId}:task-1`,
      result: "missed",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("no miss signal");
    expect(error.retryable).toBe(false);
  });

  test("a malformed task id is invalid params", async () => {
    const server = makeServer();
    for (const itemId of ["task:only-project", "task:a:b:c:d"]) {
      const error = await errorOf(server, "review.mark", { itemId, result: "known" });
      expect(error.code).toBe(-32602);
    }
  });
});

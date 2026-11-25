/**
 * Durable swarm verification: a report outlives the process.
 *
 * A board is process state, so the interesting case is a **new core** over the
 * same workspace: it has no runs in memory and must still list a done task from
 * the report and verify it there. An old report (written before task ids) is
 * read by position and verified the same way.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { createAgent, setDefaultAgent, type AgentProfile } from "../../src/services/work/agents";
import { register, setMode } from "../../src/services/work/register";
import { reportsDir, type SwarmBoard, type WorkerResult } from "../../src/services/work/swarm";
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
  base = await mkdtemp(join(TEMP_BASE, "swarm-durable-"));
  workspace = unwrap(await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") }));
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
): Promise<{ code: number; message: string; data?: unknown }> {
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

async function settled(server: CoreServer, runId: string): Promise<SwarmBoard> {
  let board: SwarmBoard | undefined;
  await until(async () => {
    const result = await resultOf(server, "work.swarm.board", { projectId, runId });
    board = result.board as SwarmBoard;
    return board.status !== "running" && board.reportPath !== null;
  }, "the swarm to settle");
  return board!;
}

type QueueItem = Record<string, unknown>;

function itemsOf(result: Record<string, unknown>): QueueItem[] {
  const queue = result.queue as { items?: QueueItem[] } | undefined;
  return queue?.items ?? [];
}

describe("a done task in a report outlives the core", () => {
  test("a fresh core lists it from the report and verifies it on disk", async () => {
    const first = makeServer(async () => ({ status: "done", summary: "read the routes" }));
    const started = await resultOf(first, "work.swarm.run", {
      projectId,
      objective: "Review the change",
      plan: [{ title: "Check the API", assignment: "read the routes" }],
    });
    const runId = started.runId as string;
    await settled(first, runId);

    // A new core has no board for this run.
    const restarted = makeServer();
    expect(await resultOf(restarted, "work.swarm.runs", { projectId })).toEqual({ runs: [] });

    const listed = itemsOf(await resultOf(restarted, "review.queue", { side: "work" }));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: `task:${projectId}:${runId}:task-1`,
      kind: "task",
      label: "Check the API",
      context: "Atlas",
      reason: "unverified",
      origin: "swarm",
    });

    await resultOf(restarted, "review.mark", {
      itemId: `task:${projectId}:${runId}:task-1`,
      result: "known",
    });

    // The report is the durable record; the board is still gone.
    const report = await readFile(join(reportsDir(workspace, projectId), `${runId}.md`), "utf8");
    expect(report).toContain("- [verified] task-1 · Reviewer — read the routes");
    expect(report).toContain("- task-1 · Check the API — Reviewer");
    expect(itemsOf(await resultOf(restarted, "review.queue", { side: "work" }))).toEqual([]);
    expect(await resultOf(restarted, "work.swarm.runs", { projectId })).toEqual({ runs: [] });

    // The decision is in the activity log, exactly as the board path records it.
    const activity = await readFile(join(base, "data", "activity.jsonl"), "utf8");
    const record = activity
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.kind === "swarm" && entry.event === "verified");
    expect(record).toMatchObject({
      kind: "swarm",
      project: projectId,
      run: runId,
      task: "task-1",
      status: "verified",
    });
  });

  test("an old report without task ids is read and verified by position", async () => {
    const runs = reportsDir(workspace, projectId);
    await mkdir(runs, { recursive: true });
    const runId = "2026-10-01T09-00-00Z";
    const path = join(runs, `${runId}.md`);
    await writeFile(
      path,
      [
        "---",
        `run: ${runId}`,
        'objective: "Old run"',
        "status: done",
        "agents: 1",
        "---",
        "",
        "## Plan",
        "",
        "- Check the API — Reviewer",
        "",
        "## Task results",
        "",
        "- [done] Reviewer — read the routes",
        "",
      ].join("\n"),
    );

    const restarted = makeServer();
    const listed = itemsOf(await resultOf(restarted, "review.queue", { side: "work" }));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: `task:${projectId}:${runId}:task-1`,
      label: "Check the API",
    });

    await resultOf(restarted, "review.mark", {
      itemId: `task:${projectId}:${runId}:task-1`,
      result: "known",
    });
    const report = await readFile(path, "utf8");
    // Only the bracket changes: an old report gains no id in place.
    expect(report).toContain("- [verified] Reviewer — read the routes");
    expect(report).toContain("- Check the API — Reviewer");
    expect(itemsOf(await resultOf(restarted, "review.queue", { side: "work" }))).toEqual([]);
  });

  test("a report with no matching task is a typed refusal, not a crash", async () => {
    const runs = reportsDir(workspace, projectId);
    await mkdir(runs, { recursive: true });
    const runId = "2026-10-02T09-00-00Z";
    await writeFile(
      join(runs, `${runId}.md`),
      [
        "---",
        `run: ${runId}`,
        "status: done",
        "---",
        "",
        "## Plan",
        "",
        "- One — Reviewer",
        "",
        "## Task results",
        "",
        "- [done] Reviewer — read",
        "",
      ].join("\n"),
    );

    const restarted = makeServer();
    const error = await errorOf(restarted, "review.mark", {
      itemId: `task:${projectId}:${runId}:task-4`,
      result: "known",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("no task task-4");
  });
});

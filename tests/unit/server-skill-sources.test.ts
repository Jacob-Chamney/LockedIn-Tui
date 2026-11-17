/**
 * Skill sources over the JSON-RPC core (`skill.sources.*`).
 *
 * The goal is a real course written into a throwaway temp workspace, because
 * both methods resolve the goal through `loadCourse` and then read that goal's
 * `meta.json` — the shell never supplies a path. The boot seam is injected, so
 * no provider, keychain or network is involved; the files are local temp files
 * the "user" picked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import { createSkillCourse } from "../../src/app/actions/skills";
import type { Result } from "../../src/domain/markdown";
import type { Workspace } from "../../src/storage/workspace";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

let base: string;
let workspace: Workspace;
let goalId: string;

function goalFolder(): string {
  return join(workspace.paths.goals, goalId);
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-skill-sources-"));
  workspace = {
    root: join(base, "ws"),
    paths: {
      goals: join(base, "ws", "skills", "goals"),
      schoolVault: join(base, "ws", "school", "vault"),
      schoolSessions: join(base, "ws", "school", "sessions"),
    },
  } as unknown as Workspace;
  await mkdir(workspace.paths.goals, { recursive: true });
  const course = await createSkillCourse({
    workspace,
    goal: "Read disassembly output confidently",
    prior: "I know a little C",
    created: "2026-11-01T09:00:00Z",
  });
  if (!course.ok) throw new Error(course.error.message);
  goalId = course.value.id;
});

afterEach(async () => {
  await removeTemp(base);
});

function request(line: string): JsonRpcRequest {
  return JSON.parse(line) as JsonRpcRequest;
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

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result;
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

/** A core whose boot only supplies the temp workspace: no model, no history. */
function makeServer() {
  const services = { workspace } as unknown as CoreServices;
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
}

/** A picked file the "user" owns, outside the workspace. */
async function picked(name: string, body: string): Promise<string> {
  const path = join(base, "picked", name);
  await mkdir(join(base, "picked"), { recursive: true });
  await writeFile(path, body, "utf8");
  return path;
}

type SourceRow = {
  name: string;
  storedPath: string;
  kind: string;
  hash: string;
  excerpt: string | null;
  excerptLocation: string | null;
};

async function listSources(server: ReturnType<typeof createCoreServer>): Promise<SourceRow[]> {
  const listed = (await resultOf(server, "skill.sources.list", { goalId })) as {
    sources: SourceRow[];
  };
  return listed.sources;
}

describe("skill sources capabilities", () => {
  test("the handshake lists both source methods", () => {
    for (const method of ["skill.sources.list", "skill.sources.add"]) {
      expect(CAPABILITIES).toContain(method as (typeof CAPABILITIES)[number]);
    }
  });
});

describe("skill.sources.list", () => {
  test("a fresh goal has no gathered sources yet", async () => {
    expect(await resultOf(makeServer(), "skill.sources.list", { goalId })).toEqual({ sources: [] });
  });

  test("an unknown goal is the typed skill error and a blank id is -32602", async () => {
    const server = makeServer();

    const error = await errorOf(server, "skill.sources.list", { goalId: "missing-goal" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });

    expect((await errorOf(server, "skill.sources.list", {})).code).toBe(-32602);
    expect((await errorOf(server, "skill.sources.list", { goalId: "   " })).code).toBe(-32602);
  });

  test("a malformed source list is one typed source error, not a partial list", async () => {
    const metaPath = join(goalFolder(), "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
    await writeFile(metaPath, `${JSON.stringify({ ...meta, sources: [{ name: 1 }] }, null, 2)}\n`);

    const error = await errorOf(makeServer(), "skill.sources.list", { goalId });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "source", goalId });
  });
});

describe("skill.sources.add", () => {
  test("bad file shapes are -32602 and write nothing", async () => {
    const server = makeServer();
    for (const files of [undefined, [], "notes.md", [123], [""], ["  "]]) {
      const error = await errorOf(server, "skill.sources.add", {
        goalId,
        ...(files === undefined ? {} : { files }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("file");
    }
    expect(await listSources(server)).toEqual([]);
  });

  test("an unknown goal is the typed skill error and a blank id is -32602", async () => {
    const server = makeServer();
    const file = await picked("notes.md", "# Notes\n");

    const error = await errorOf(server, "skill.sources.add", {
      goalId: "missing-goal",
      files: [file],
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill", id: "missing-goal" });

    expect(
      (await errorOf(server, "skill.sources.add", { files: [file] })).code,
    ).toBe(-32602);
  });

  test("a missing file is one typed source error and records no row", async () => {
    const server = makeServer();
    const missing = join(base, "picked", "gone.md");

    const error = await errorOf(server, "skill.sources.add", { goalId, files: [missing] });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "source", goalId });
    expect(error.message.length).toBeGreaterThan(0);

    // A refused batch leaves no source row and no file under `sources/`.
    expect(await listSources(server)).toEqual([]);
    expect(existsSync(join(goalFolder(), "sources"))).toBe(false);
  });

  test("a file from the school side is refused by the wall and records no row", async () => {
    const server = makeServer();
    const schoolFile = join(workspace.paths.schoolVault, "concepts", "kept.md");
    await mkdir(join(workspace.paths.schoolVault, "concepts"), { recursive: true });
    await writeFile(schoolFile, "# School note\n", "utf8");

    const error = await errorOf(server, "skill.sources.add", { goalId, files: [schoolFile] });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "source", goalId });
    expect(await listSources(server)).toEqual([]);
  });
});

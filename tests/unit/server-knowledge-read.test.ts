/**
 * `knowledge.read`: open one knowledge hit in a reader.
 *
 * Every case uses a throwaway folder and an injected boot seam, so nothing here
 * boots the real app, contacts a provider or touches the network. The real
 * workspace path is covered by `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  KNOWLEDGE_BODY_LIMIT,
  createCoreServer,
  parseRequest,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type KnowledgeHit,
} from "../../src/server/protocol";
import { dataPaths, workspacePaths } from "../../src/storage/paths";
import type { Workspace } from "../../src/storage/workspace";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

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
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  });
  const response = await server.handle(request(line));
  if (response === null) throw new Error("expected a response for a request with an id");
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

type ReadResult = { hit: KnowledgeHit; body: string; truncated: boolean };

async function readOf(server: CoreServer, id: unknown): Promise<ReadResult> {
  return (await resultOf(server, "knowledge.read", { id })) as unknown as ReadResult;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-knowledge-read-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  const paths = workspacePaths(workspaceRoot, dataDir);
  workspace = { root: workspaceRoot, schema: 1, paths, data: dataPaths(dataDir) };
  for (const dir of [paths.schoolVault, paths.skillVault, paths.schoolSessions, paths.goals]) {
    await mkdir(dir, { recursive: true });
  }
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function core(): { server: CoreServer; counter: { calls: number } } {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return {
        ok: true,
        value: { workspace, settings: { dataDir } } as unknown as CoreServices,
      } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
}

async function writeSchoolNote(input: {
  slug: string;
  title: string;
  body: string;
  topics?: string[];
}): Promise<string> {
  const file = join(workspace.paths.schoolVault, "concepts", `${input.slug}.md`);
  await mkdir(join(workspace.paths.schoolVault, "concepts"), { recursive: true });
  const topics =
    input.topics === undefined || input.topics.length === 0
      ? ""
      : `topics:\n${input.topics.map((topic) => `  - ${topic}`).join("\n")}\n`;
  await writeFile(
    file,
    [
      "---",
      `id: ${input.slug}`,
      "side: school",
      "type: concept",
      `title: ${input.title}`,
      ...topics.split("\n").filter((line) => line !== ""),
      "---",
      "",
      input.body,
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

describe("knowledge.read validation", () => {
  test("a blank or non-string id is invalid params and never boots", async () => {
    const { server, counter } = core();
    for (const id of ["", "   ", 5, undefined, null]) {
      const error = await errorOf(server, "knowledge.read", { id });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown id is a typed knowledge error naming the id", async () => {
    const { server } = core();
    for (const id of ["note:work:elsewhere.md", "session:", "not-a-scheme", "goal:"]) {
      const error = await errorOf(server, "knowledge.read", { id });
      expect(error.code).toBe(-32000);
      expect(error.retryable).toBe(false);
      expect(error.message).toContain(id);
      expect(error.data).toMatchObject({ kind: "knowledge", id });
    }
  });
});

describe("knowledge.read confinement", () => {
  test("absolute, escaping and cross-wall note paths are refused", async () => {
    await writeFile(join(base, "outside.md"), "SECRET outside the vault\n", "utf8");
    await writeSchoolNote({ slug: "inside", title: "Inside", body: "Inside body." });
    const { server } = core();

    for (const id of [
      "note:school:/etc/passwd",
      "note:school:../outside.md",
      "note:school:concepts/../../outside.md",
      `note:school:${join(base, "outside.md")}`,
      "note:school:skills/vault/knowledge/other.md",
    ]) {
      const error = await errorOf(server, "knowledge.read", { id });
      expect(error.code).toBe(-32000);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "knowledge", id });
      expect(JSON.stringify(error)).not.toContain("SECRET");
    }
  });

  test("a missing note is a typed error, not a crash", async () => {
    const { server } = core();
    const error = await errorOf(server, "knowledge.read", {
      id: "note:school:school/vault/concepts/missing.md",
    });
    expect(error.code).toBe(-32000);
    expect(error.data).toMatchObject({ kind: "knowledge" });
  });
});

describe("knowledge.read bodies", () => {
  test("a note body has the frontmatter stripped and nothing else changed", async () => {
    await writeSchoolNote({
      slug: "boundary",
      title: "Boundary conditions",
      body: "## Limits\n\nBoundary conditions set the integral limits.",
      topics: ["Physics/Mechanics"],
    });
    const { server } = core();
    const result = await readOf(server, "note:school:school/vault/concepts/boundary.md");

    expect(result.truncated).toBe(false);
    expect(result.hit).toMatchObject({
      id: "note:school:school/vault/concepts/boundary.md",
      kind: "note",
      title: "Boundary conditions",
      side: "school",
      path: "school/vault/concepts/boundary.md",
    });
    expect(result.body).toContain("## Limits");
    expect(result.body).toContain("Boundary conditions set the integral limits.");
    expect(result.body).not.toContain("---");
    expect(result.body).not.toContain("title:");
    expect(result.body).not.toContain("topics:");
    // No machine layout leaks into the reply.
    expect(JSON.stringify(result)).not.toContain(workspaceRoot);
  });

  test("a bare tree path is accepted for a note row", async () => {
    await writeSchoolNote({ slug: "tree", title: "Tree note", body: "Tree body." });
    const { server } = core();
    const result = await readOf(server, "school/vault/concepts/tree.md");
    expect(result.hit.kind).toBe("note");
    expect(result.hit.id).toBe("note:school:school/vault/concepts/tree.md");
    expect(result.body).toContain("Tree body.");
  });

  test("a body over the cap is cut on a character boundary and flagged", async () => {
    const longBody = `${"a".repeat(KNOWLEDGE_BODY_LIMIT + 2048)}`;
    await writeSchoolNote({ slug: "long", title: "Long note", body: longBody });
    const { server } = core();
    const result = await readOf(server, "note:school:school/vault/concepts/long.md");

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.body, "utf8")).toBe(KNOWLEDGE_BODY_LIMIT);
    expect(result.body.length).toBe(KNOWLEDGE_BODY_LIMIT);
  });
});

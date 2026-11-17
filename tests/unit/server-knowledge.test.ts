/**
 * `knowledge.search` and `knowledge.tree`: the read-only knowledge base.
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
  createCoreServer,
  parseRequest,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type KnowledgeHit,
  type KnowledgeTopicGroup,
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

async function hitsOf(
  server: CoreServer,
  params: Record<string, unknown>,
): Promise<KnowledgeHit[]> {
  return (await resultOf(server, "knowledge.search", params)).hits as KnowledgeHit[];
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-knowledge-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  const paths = workspacePaths(workspaceRoot, dataDir);
  workspace = { root: workspaceRoot, schema: 1, paths, data: dataPaths(dataDir) };
  for (const dir of [
    paths.schoolVault,
    paths.skillVault,
    paths.schoolSessions,
    paths.goals,
    paths.workProjects,
    paths.archiveIndex,
  ]) {
    await mkdir(dir, { recursive: true });
  }
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function fakeServices(): CoreServices {
  return {
    workspace,
    settings: { dataDir },
  } as unknown as CoreServices;
}

function core(): { server: CoreServer; counter: { calls: number } } {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: fakeServices() } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, counter };
}

type NoteInput = {
  side: "school" | "skills";
  folder: string;
  slug: string;
  title: string;
  body: string;
  topics?: string[];
  updated?: string;
};

async function writeNote(input: NoteInput): Promise<string> {
  const vault = input.side === "school" ? workspace.paths.schoolVault : workspace.paths.skillVault;
  const file = join(vault, input.folder, `${input.slug}.md`);
  await mkdir(join(vault, input.folder), { recursive: true });
  const topics =
    input.topics === undefined || input.topics.length === 0
      ? ""
      : `topics:\n${input.topics.map((topic) => `  - ${topic}`).join("\n")}\n`;
  const updated = input.updated === undefined ? "" : `updated: ${input.updated}\n`;
  const text = [
    "---",
    `id: ${input.slug}`,
    `side: ${input.side}`,
    `type: ${input.side === "school" ? "concept" : "knowledge"}`,
    `title: ${input.title}`,
    ...topics.split("\n").filter((line) => line !== ""),
    ...updated.split("\n").filter((line) => line !== ""),
    "---",
    "",
    input.body,
    "",
  ].join("\n");
  await writeFile(file, text, "utf8");
  return file;
}

async function writeProject(id: string, name: string, instructions: string): Promise<void> {
  const root = join(base, "project-root");
  await mkdir(root, { recursive: true });
  const folder = join(workspace.paths.workProjects, id);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "meta.json"),
    `${JSON.stringify(
      {
        schema: 1,
        id,
        name,
        root,
        instructions,
        default_agent: "",
        agents: [],
        tasks: [],
        mode: "chat",
        swarm_name: "",
        archived: false,
        created: "2026-11-01T09:00:00.000Z",
        last_opened_at: "2026-11-01T09:30:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("knowledge.search validation", () => {
  test("a blank query is invalid params and never boots", async () => {
    const { server, counter } = core();
    for (const query of ["", "   ", 5, undefined]) {
      const error = await errorOf(server, "knowledge.search", { query });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("query");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown scope is invalid params and names the accepted set", async () => {
    const { server, counter } = core();
    const error = await errorOf(server, "knowledge.search", { query: "energy", scope: "reader" });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("all, school, skills, work");
    expect(counter.calls).toBe(0);
  });

  test("an unknown tree side is invalid params", async () => {
    const { server, counter } = core();
    const error = await errorOf(server, "knowledge.tree", { side: "work" });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("school, skills, all");
    expect(counter.calls).toBe(0);
  });
});

describe("knowledge.search scope projection", () => {
  beforeEach(async () => {
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "school-shared",
      title: "School shared topic",
      body: "A shared wall token appears here.",
    });
    await writeNote({
      side: "skills",
      folder: "knowledge",
      slug: "skills-shared",
      title: "Skills shared topic",
      body: "A shared wall token appears here too.",
    });
    await writeProject("shared-lab", "Shared Lab", "keep the shared wall token visible");
  });

  test("all returns every side, one read labelled per row", async () => {
    const { server } = core();
    const hits = await hitsOf(server, { query: "shared" });
    expect(new Set(hits.map((hit) => hit.side))).toEqual(new Set(["school", "skills", "work"]));
  });

  test("school and skills never cross the wall", async () => {
    const { server } = core();
    const school = await hitsOf(server, { query: "shared", scope: "school" });
    expect(school.length).toBeGreaterThan(0);
    expect(school.every((hit) => hit.side === "school")).toBe(true);
    expect(school.some((hit) => hit.path.startsWith("skills/"))).toBe(false);

    const skills = await hitsOf(server, { query: "shared", scope: "skills" });
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every((hit) => hit.side === "skills")).toBe(true);
    expect(skills.some((hit) => hit.path.startsWith("school/"))).toBe(false);
  });

  test("work returns only project rows", async () => {
    const { server } = core();
    const work = await hitsOf(server, { query: "shared", scope: "work" });
    expect(work.length).toBe(1);
    expect(work[0]).toMatchObject({ kind: "project", side: "work", path: "work/projects/shared-lab/meta.json" });
  });
});

describe("knowledge.search ranking", () => {
  test("title prefix beats word match beats body substring", async () => {
    const { server } = core();
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "prefix",
      title: "Gradient descent",
      body: "The method walks downhill.",
      updated: "2026-11-01T09:00:00.000Z",
    });
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "word",
      title: "The gradient method",
      body: "It uses a direction.",
      updated: "2026-11-02T09:00:00.000Z",
    });
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "substring",
      title: "Analysis notes",
      body: "A subgradient appears in the proof.",
      updated: "2026-11-03T09:00:00.000Z",
    });

    const hits = await hitsOf(server, { query: "gradient" });
    expect(hits.map((hit) => hit.title)).toEqual([
      "Gradient descent",
      "The gradient method",
      "Analysis notes",
    ]);
    expect(hits.map((hit) => hit.score)).toEqual([3, 2, 1]);
  });
});

describe("knowledge.search limits and paths", () => {
  test("caps at 50 hits", async () => {
    const { server } = core();
    for (let index = 0; index < 60; index += 1) {
      await writeNote({
        side: "school",
        folder: "concepts",
        slug: `bulk-${index}`,
        title: `Bulk note ${index}`,
        body: `zebra fact number ${index}`,
      });
    }
    const hits = await hitsOf(server, { query: "zebra" });
    expect(hits).toHaveLength(50);
    expect(hits.every((hit) => hit.kind === "note")).toBe(true);
  });

  test("paths are workspace-relative and never absolute", async () => {
    const { server } = core();
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "energy",
      title: "Energy balance",
      body: "The energy balance closes.",
    });
    const hits = await hitsOf(server, { query: "energy" });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.path.startsWith("/")).toBe(false);
      expect(hit.path.includes("\\")).toBe(false);
      expect(hit.path.includes(workspaceRoot)).toBe(false);
      expect(hit.id.length).toBeGreaterThan(0);
      expect(hit.excerpt.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("knowledge.search resilience", () => {
  test("a broken session folder is skipped, never an error", async () => {
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "resilient",
      title: "Resilient note",
      body: "A resilient fact survives.",
    });
    const broken = join(workspace.paths.schoolSessions, "broken-session");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "meta.json"), "not json at all", "utf8");

    const { server } = core();
    const hits = await hitsOf(server, { query: "resilient" });
    expect(hits.map((hit) => hit.title)).toEqual(["Resilient note"]);
    expect(hits.some((hit) => hit.path.includes("broken-session"))).toBe(false);
  });
});

describe("knowledge.tree", () => {
  test("groups notes by first-level topic and puts untopiced notes in (no topic)", async () => {
    const { server } = core();
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "mechanics",
      title: "Mechanics",
      body: "Forces.",
      topics: ["Physics/Mechanics"],
    });
    await writeNote({
      side: "skills",
      folder: "knowledge",
      slug: "thermodynamics",
      title: "Thermodynamics",
      body: "Heat.",
      topics: ["Physics/Thermodynamics"],
    });
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "loose",
      title: "Loose note",
      body: "No topic.",
    });

    const groups = (await resultOf(server, "knowledge.tree")).groups as KnowledgeTopicGroup[];
    expect(groups.map((group) => group.topic)).toEqual(["(no topic)", "Physics"]);
    const physics = groups.find((group) => group.topic === "Physics");
    expect(physics?.notes.map((note) => note.title)).toEqual(["Mechanics", "Thermodynamics"]);
    expect(physics?.notes.every((note) => note.path.startsWith("school/") || note.path.startsWith("skills/"))).toBe(true);
  });

  test("a side filter reads one side only", async () => {
    const { server } = core();
    await writeNote({
      side: "school",
      folder: "concepts",
      slug: "school-only",
      title: "School only",
      body: "School.",
      topics: ["Coding"],
    });
    await writeNote({
      side: "skills",
      folder: "knowledge",
      slug: "skills-only",
      title: "Skills only",
      body: "Skills.",
      topics: ["Coding"],
    });

    const school = (await resultOf(server, "knowledge.tree", { side: "school" }))
      .groups as KnowledgeTopicGroup[];
    expect(school).toHaveLength(1);
    expect(school[0]!.notes.map((note) => note.path)).toEqual(["school/vault/concepts/school-only.md"]);

    const skills = (await resultOf(server, "knowledge.tree", { side: "skills" }))
      .groups as KnowledgeTopicGroup[];
    expect(skills[0]!.notes.map((note) => note.path)).toEqual([
      "skills/vault/knowledge/skills-only.md",
    ]);
  });
});

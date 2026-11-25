/**
 * `knowledge.graph`: the capability exists, boots once, and returns the derived
 * projection. The builder's detail is covered by `learning-graph.test.ts`.
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
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const GOAL = "read-disassembly";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "server-graph-"));
  const folder = join(root, "skills", "goals", GOAL);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: GOAL,
      name: "Read disassembly",
      statement: "Read disassembly",
      level: "beginner",
      time_budget: "",
      created: "2026-11-01T09:00:00Z",
      pinned: false,
      archived: false,
      stages: [],
      sources: [
        {
          name: "intel.md",
          storedPath: "sources/intel.md",
          hash: `sha256:${"a".repeat(64)}`,
          kind: "markdown",
          excerpt: { text: "registers hold state" },
        },
      ],
      chats: [],
    }),
  );
});

afterEach(async () => {
  await removeTemp(root);
});

function services(): CoreServices {
  return {
    workspace: {
      root,
      paths: {
        root,
        goals: join(root, "skills", "goals"),
        schoolSessions: join(root, "school", "sessions"),
      },
    },
    settings: { dataDir: join(root, "data") },
  } as unknown as CoreServices;
}

async function ask(
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: services() }) as Result<CoreServices, BootFailure>,
  });
  const parsed = parseRequest(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
  );
  if ("error" in parsed) throw new Error(parsed.error.message);
  const response = await server.handle(parsed as JsonRpcRequest);
  if (response === null) throw new Error("expected a response");
  return response;
}

describe("knowledge.graph", () => {
  test("returns the goal and its source", async () => {
    const response = await ask("knowledge.graph");
    if ("error" in response) throw new Error(response.error.message);
    const graph = response.result.graph as Record<string, unknown>;
    expect((graph.counts as Record<string, number>).goal).toBe(1);
    expect((graph.counts as Record<string, number>).source).toBe(1);
    const nodes = graph.nodes as Record<string, unknown>[];
    expect(nodes.some((node) => node.kind === "goal" && node.label === "Read disassembly")).toBe(true);
  });

  test("a broken folder is a diagnostic, not a request error", async () => {
    await writeFile(join(root, "skills", "goals", GOAL, "meta.json"), "{oops");
    const response = await ask("knowledge.graph");
    if ("error" in response) throw new Error(response.error.message);
    const graph = response.result.graph as Record<string, unknown>;
    expect((graph.diagnostics as string[]).length).toBe(1);
    expect((graph.nodes as unknown[]).length).toBe(0);
  });
});

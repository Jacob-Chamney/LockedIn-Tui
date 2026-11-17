/**
 * The read-only Work surface of the core protocol.
 *
 * Every case injects a boot seam pointed at an empty temporary directory, so no
 * test creates a workspace, writes a project or contacts a provider. The real
 * `work.list`/`work.open`/`work.create` path over a registered project is
 * covered by `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
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

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

let base: string;
let workProjects: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-work-unit-"));
  workProjects = join(base, "work", "projects");
});

afterEach(async () => {
  await removeTemp(base);
});

function fakeServices(): CoreServices {
  return {
    workspace: {
      root: join(base, "workspace"),
      paths: {
        workProjects,
        schoolSessions: join(base, "workspace", "school", "sessions"),
      },
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

function fakeCore() {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: fakeServices() } as Result<CoreServices, BootFailure>;
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
  if (response === null) throw new Error("expected a response for a request with an id");
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

describe("work capabilities", () => {
  test("the handshake advertises the Work methods", async () => {
    const { server } = fakeCore();
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    for (const method of ["work.list", "work.open", "work.create"]) {
      expect(result.capabilities).toContain(method);
    }
  });
});

describe("work.list", () => {
  test("an empty workspace is an empty list and boots once", async () => {
    const { server, counter } = fakeCore();
    expect(await resultOf(server, "work.list")).toEqual({ projects: [] });
    expect(await resultOf(server, "work.list")).toEqual({ projects: [] });
    expect(counter.calls).toBe(1);
  });
});

describe("work.open", () => {
  test("an unknown project is a typed -32000 error, not a crash", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "work.open", { id: "my-app-4f2a1c" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "project", id: "my-app-4f2a1c" });
  });

  test("a blank or non-string id is invalid params", async () => {
    const { server } = fakeCore();
    for (const id of ["", "   ", 7, null, undefined]) {
      const error = await errorOf(server, "work.open", id === undefined ? {} : { id });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("project id");
    }
  });
});

describe("work.create", () => {
  test("requires a name, a folder and a known mode", async () => {
    const { server } = fakeCore();

    const name = await errorOf(server, "work.create", { folder: join(base, "app"), mode: "chat" });
    expect(name.code).toBe(-32602);
    expect(name.message).toContain("name");

    const folder = await errorOf(server, "work.create", { name: "My app", mode: "chat" });
    expect(folder.code).toBe(-32602);
    expect(folder.message).toContain("folder");

    const mode = await errorOf(server, "work.create", {
      name: "My app",
      folder: join(base, "app"),
      mode: "solo",
    });
    expect(mode.code).toBe(-32602);
    expect(mode.message).toContain("chat");
    expect(mode.message).toContain("swarm");
  });

  test("refuses instructions it cannot persist instead of dropping them", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "work.create", {
      name: "My app",
      folder: join(base, "app"),
      mode: "chat",
      instructions: "Prefer small diffs.",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("instructions");
  });
});

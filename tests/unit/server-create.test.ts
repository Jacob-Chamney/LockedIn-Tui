/**
 * `session.create`: parameter validation and the typed failure shape.
 *
 * Every case injects the boot seam, so nothing here reads the user's config or
 * contacts a provider. The real workspace path (create → open) is covered by
 * `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { MAX_SESSION_NAME, SESSION_FILES } from "../../src/domain/session";
import { BLOCKED_COPY } from "../../src/services/lockin/picker";
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

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-create-"));
});

afterEach(async () => {
  await removeTemp(base);
});

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/**
 * The paths `createLockInSession` touches: the sessions root it writes into and
 * the skills roots it refuses. Everything else is inert for this method.
 */
function fakeServices(root = join(base, "workspace")): CoreServices {
  const sessions = join(root, "school", "sessions");
  return {
    workspace: {
      root,
      schema: 1,
      paths: {
        root,
        marker: join(root, "workspace.json"),
        config: join(root, "config.toml"),
        schoolVault: join(root, "school", "vault"),
        schoolSessions: sessions,
        skillVault: join(root, "skills", "vault"),
        goals: join(root, "skills", "goals"),
        workProjects: join(root, "work", "projects"),
        archiveIndex: join(root, "archive-index"),
        attachments: join(root, "attachments"),
        exports: join(root, "exports"),
        input: join(root, "input"),
        dataDir: join(base, "data"),
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

/** A core whose boot resolves to `services`, counting how often it is called. */
function fakeCore(services: CoreServices = fakeServices()) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
    },
  });
  return { server, services, counter };
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
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

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

describe("session.create capabilities", () => {
  test("is advertised in the handshake", () => {
    expect(CAPABILITIES).toContain("session.create");
  });
});

describe("session.create validation", () => {
  test("requires a non-empty name", async () => {
    const { server, counter } = fakeCore();

    for (const name of [undefined, "", "   ", 5, null]) {
      const params = name === undefined ? {} : { name };
      const error = await errorOf(server, "session.create", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("name");
    }
    // Malformed params never boot the workspace.
    expect(counter.calls).toBe(0);
  });

  test("caps the name at the service limit", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "session.create", {
      name: "x".repeat(MAX_SESSION_NAME + 1),
      prompt: "Study.",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain(String(MAX_SESSION_NAME));
    expect(counter.calls).toBe(0);
  });

  test("rejects badly shaped optional fields by name", async () => {
    const { server, counter } = fakeCore();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "Session", prompt: 7 }, "prompt"],
      [{ name: "Session", files: "notes.md" }, "files"],
      [{ name: "Session", files: ["notes.md", ""] }, "files"],
      [{ name: "Session", files: [2] }, "files"],
      [{ name: "Session", instructionsFile: "" }, "instructionsFile"],
      [{ name: "Session", instructionsFile: 3 }, "instructionsFile"],
      [{ name: "Session", steps: "no" }, "steps"],
    ];
    for (const [params, field] of cases) {
      const error = await errorOf(server, "session.create", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain(field);
    }
    expect(counter.calls).toBe(0);
  });
});

describe("session.create refusal", () => {
  test("no file, prompt or instructions file is a typed -32000 session-create error", async () => {
    const { server, services, counter } = fakeCore();

    const error = await errorOf(server, "session.create", { name: "Physics — Unit 4" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    // The service owns the copy: its blocked message is preserved verbatim.
    expect(error.data).toEqual({ kind: "session-create", message: BLOCKED_COPY });
    expect(counter.calls).toBe(1);
    // Nothing was written — not even the sessions root.
    expect(existsSync(services.workspace.paths.schoolSessions)).toBe(false);
  });
});

describe("session.create success shape", () => {
  test("returns the id and name the shell opens next", async () => {
    const { server, services } = fakeCore();
    const input = join(base, "lecture-4.md");
    await writeFile(input, "# Unit 4\n\nBoundary conditions.\n");

    const response = await ask(server, "session.create", {
      name: "  Physics — Unit 4  ",
      prompt: "Study the boundary conditions.",
      files: [input],
      steps: false,
    });
    if ("error" in response) throw new Error(`create failed: ${response.error.message}`);

    const result = response.result as { id: string; name: string };
    // The name is trimmed for storage; the response is exactly {id, name}.
    expect(result.name).toBe("Physics — Unit 4");
    expect(result.id.startsWith("20")).toBe(true);
    expect(result.id.endsWith("-physics-unit-4")).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["id", "name"]);

    const folder = join(services.workspace.paths.schoolSessions, result.id);
    expect(existsSync(join(folder, SESSION_FILES.meta))).toBe(true);
    expect(existsSync(join(folder, SESSION_FILES.prompt))).toBe(true);
  });
});

describe("session.create idempotency", () => {
  function folders(services: CoreServices): string[] {
    try {
      return readdirSync(services.workspace.paths.schoolSessions).filter(
        (name) => !name.startsWith("."),
      );
    } catch {
      return [];
    }
  }

  test("a repeated requestId creates one session and returns the same id", async () => {
    const { server, services } = fakeCore();
    const params = { name: "Physics", prompt: "Study.", requestId: "attempt-1" };

    const first = await ask(server, "session.create", params);
    const second = await ask(server, "session.create", params);
    if ("error" in first || "error" in second) throw new Error("create failed");

    expect(second.result).toEqual(first.result);
    expect(folders(services)).toHaveLength(1);
  });

  test("a different requestId creates a second session", async () => {
    const { server, services } = fakeCore();
    await ask(server, "session.create", {
      name: "Physics",
      prompt: "Study.",
      requestId: "attempt-1",
    });
    await ask(server, "session.create", {
      name: "Chemistry",
      prompt: "Study.",
      requestId: "attempt-2",
    });
    expect(folders(services)).toHaveLength(2);
  });

  test("a failed create is not cached: a corrected retry with the same id runs", async () => {
    const { server, services } = fakeCore();
    const missing = join(base, "missing-lecture.md");
    const failed = await errorOf(server, "session.create", {
      name: "Physics",
      files: [missing],
      requestId: "attempt-3",
    });
    expect(failed.code).toBe(BOOT_FAILED);
    expect(folders(services)).toHaveLength(0);

    const retry = await ask(server, "session.create", {
      name: "Physics",
      prompt: "Study.",
      requestId: "attempt-3",
    });
    if ("error" in retry) throw new Error(`retry failed: ${retry.error.message}`);
    expect(folders(services)).toHaveLength(1);
  });

  test("a bad requestId is invalid params", async () => {
    for (const requestId of ["", "   ", 7, "x".repeat(129)]) {
      const error = await errorOf(fakeCore().server, "session.create", {
        name: "Physics",
        prompt: "Study.",
        requestId,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("requestId");
    }
  });

  test("a call without a requestId still creates", async () => {
    const { server, services } = fakeCore();
    const response = await ask(server, "session.create", {
      name: "Physics",
      prompt: "Study.",
    });
    if ("error" in response) throw new Error(response.error.message);
    expect(folders(services)).toHaveLength(1);
  });
});

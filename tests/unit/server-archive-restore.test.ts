/**
 * `archive.restore` — the validation and refusal shapes of the folder restore.
 *
 * Every case either sends a malformed request or boots a core whose settings
 * cannot restore in this build, so nothing here touches the filesystem and
 * nothing restores, moves or deletes a session. The real folder round trip is
 * covered by `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";
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

function fakeServices(overrides: Partial<CoreServices> = {}): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-restore-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-restore-no-sessions"),
        goals: join(tmpdir(), "lockedin-restore-no-goals"),
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
      dataDir: join(tmpdir(), "lockedin-restore-no-data"),
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
    ...overrides,
  } as unknown as CoreServices;
}

/** A fake boot with the shared fixture settings patched for one case. */
function withSettings(patch: Record<string, unknown>): CoreServices {
  const base = fakeServices();
  return {
    ...base,
    settings: { ...(base.settings as unknown as Record<string, unknown>), ...patch },
  } as unknown as CoreServices;
}

/** A core over a fake boot that counts how often the app was booted. */
function fakeCore(services: CoreServices) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services } as Result<CoreServices, BootFailure>;
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
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      }),
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

const ARCHIVED_ID = "2026-11-01-0900-physics-unit-4";

describe("archive.restore capabilities", () => {
  test("the handshake advertises the restore method exactly once", () => {
    expect(CAPABILITIES).toContain("archive.restore");
    expect([...CAPABILITIES].filter((name) => name === "archive.restore")).toHaveLength(1);
  });
});

describe("archive.restore validation", () => {
  test("a missing or blank id is -32602 before boot", async () => {
    const { server, counter } = fakeCore(withSettings({ archiveFolder: "/tmp/archive" }));
    for (const id of [undefined, "", "   ", 7, null]) {
      const error = await errorOf(server, "archive.restore", {
        side: "school",
        ...(id === undefined ? {} : { id }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    // A bad shape is answered before the app ever boots.
    expect(counter.calls).toBe(0);
  });

  test("an unknown side is -32602 naming the accepted set", async () => {
    const { server, counter } = fakeCore(withSettings({ archiveFolder: "/tmp/archive" }));
    for (const side of [undefined, "", "all", "SCHOOL", 3, null]) {
      const error = await errorOf(server, "archive.restore", {
        id: ARCHIVED_ID,
        ...(side === undefined ? {} : { side }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain('"school"');
      expect(error.message).toContain('"skills"');
    }
    expect(counter.calls).toBe(0);
  });
});

describe("archive.restore refusals", () => {
  test("a skills row that is not archived is one typed archive refusal", async () => {
    const { server, counter } = fakeCore(withSettings({ archiveFolder: "/tmp/archive" }));

    const error = await errorOf(server, "archive.restore", { id: ARCHIVED_ID, side: "skills" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: ARCHIVED_ID,
      side: "skills",
      message: error.message,
    });
    expect(error.message).toContain(ARCHIVED_ID);
    expect(error.message).not.toContain("later packet");
    // Goal restore reads the workspace now, so the app boots exactly once.
    expect(counter.calls).toBe(1);
  });

  test("a GitHub backend that cannot be built is one archive refusal", async () => {
    const { server } = fakeCore(withSettings({ archiveBackend: "github", archiveFolder: "/tmp/archive" }));

    const error = await errorOf(server, "archive.restore", { id: ARCHIVED_ID, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: ARCHIVED_ID,
      side: "school",
      message: error.message,
    });
    expect(error.message).toContain("GitHub archive");
    // Restore is supported on GitHub when the backend builds; this refusal is
    // about the missing backend, not a promise of a later packet.
    expect(error.message).not.toContain("later packet");
  });

  test("a folder backend with no folder set is one archived-folder hint", async () => {
    const { server } = fakeCore(withSettings({ archiveBackend: "folder", archiveFolder: "  " }));

    const error = await errorOf(server, "archive.restore", { id: ARCHIVED_ID, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: ARCHIVED_ID,
      side: "school",
      message: error.message,
    });
    expect(error.message).toContain("archive folder");
    expect(error.message).toContain("Settings");
  });

  test("a boot refusal is the documented -32000 shape", async () => {
    const server = createCoreServer({
      boot: async () =>
        ({
          ok: false,
          error: {
            kind: "boot",
            path: "/tmp/legacy",
            message: "this folder belongs to the old LockedIn",
            next: "Set LOCKEDIN_WORKSPACE to choose another folder.",
          },
        }) as Result<CoreServices, BootFailure>,
    });

    const error = await errorOf(server, "archive.restore", { id: ARCHIVED_ID, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "boot", path: "/tmp/legacy" });
  });
});

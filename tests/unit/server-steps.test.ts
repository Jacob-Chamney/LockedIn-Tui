/**
 * `session.toggleStep`: parameter validation and error shapes.
 *
 * No workspace is created here. A fake boot seam answers, and the directory it
 * names does not exist, so a valid-shaped request ends at the session lookup —
 * which is exactly the error the shell must render. The real write, the file
 * bytes and the counts are covered by
 * `tests/integration/server-data.test.ts`.
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

/** A well-formed id that no workspace in this test can contain. */
const MISSING_ID = "2026-12-31-0000-missing";

function fakeServices(): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-toggle-unit-workspace"),
      paths: {
        // Absent on purpose: `openSession` reports "there is no session …".
        schoolSessions: join(tmpdir(), "lockedin-toggle-unit-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-toggle-unit-no-data"),
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
  return { server, counter };
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(
    request(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "session.toggleStep",
        ...(params === undefined ? {} : { params }),
      }),
    ),
  );
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, params);
  if (!("error" in response)) throw new Error("session.toggleStep should have failed");
  return response.error;
}

describe("session.toggleStep", () => {
  test("is advertised as a capability", () => {
    expect(CAPABILITIES).toContain("session.toggleStep");
  });

  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, { ...(id === undefined ? {} : { id }), index: 0 });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    // A bad shape is answered before the app ever boots.
    expect(counter.calls).toBe(0);
  });

  test("requires a non-negative integer index", async () => {
    const { server, counter } = fakeCore();
    for (const index of [undefined, -1, 1.5, "0", null, Number.NaN]) {
      const error = await errorOf(server, {
        id: MISSING_ID,
        ...(index === undefined ? {} : { index }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("index");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape, not a steps failure", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, { id: MISSING_ID, index: 0 });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
    expect(error.message).toContain(MISSING_ID);
  });

  test("a boot refusal wins over the session lookup", async () => {
    const failure: BootFailure = {
      kind: "boot",
      path: "/home/me/LockedIn",
      message: "“LockedIn” belongs to the old LockedIn (v0.7).",
      next: "Start with LOCKEDIN_WORKSPACE=~/LockedIn-Tui bun start.",
    };
    const server = createCoreServer({
      boot: async () => ({ ok: false, error: failure }) as Result<CoreServices, BootFailure>,
    });
    const error = await errorOf(server, { id: MISSING_ID, index: 0 });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "boot", path: failure.path });
  });
});

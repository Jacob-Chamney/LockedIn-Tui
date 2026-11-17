/**
 * Session archive / remove / export: validation and the two failure shapes.
 *
 * The injected boot has no workspace on disk, so a case that resolves a session
 * asserts the "unknown session" refusal instead of doing file IO. The real
 * folder moves are covered by `tests/integration/server-data.test.ts`; nothing
 * here reads the user's home directory, the keychain or the network.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { ArchiveBackend } from "../../src/archive/types";
import { err, ok, type Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

type FakeOptions = {
  archiveFolder?: string;
  archiveBackend?: "folder" | "github";
  createGithubArchive?: CoreServices["createGithubArchive"];
};

/** A fake boot: no folder on disk, so only refusals and shapes are exercised. */
function fakeServices(options: FakeOptions = {}): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-unit-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-unit-no-sessions"),
        exports: join(tmpdir(), "lockedin-unit-no-exports"),
      },
    },
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16_000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: join(tmpdir(), "lockedin-unit-no-data"),
      archiveBackend: options.archiveBackend ?? "folder",
      archiveFolder: options.archiveFolder ?? "",
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    },
    ...(options.createGithubArchive === undefined
      ? {}
      : { createGithubArchive: options.createGithubArchive }),
  } as unknown as CoreServices;
}

function fakeCore(options: FakeOptions = {}) {
  const services = fakeServices(options);
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
  return { server, services };
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

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have been refused`);
  return response.error;
}

const VERBS = ["session.archive", "session.remove", "session.export"] as const;

describe("session archive/remove/export capabilities", () => {
  test("initialize advertises the three manager verbs", async () => {
    const { server } = fakeCore();
    const response = await server.handle(
      request('{"jsonrpc":"2.0","id":1,"method":"initialize"}'),
    );
    if (response === null || !("result" in response)) throw new Error("initialize must answer");
    const capabilities = response.result.capabilities as string[];
    for (const method of VERBS) expect(capabilities).toContain(method);
  });
});

describe("session action id validation", () => {
  test("every verb refuses a missing, blank or non-string id with -32602", async () => {
    const { server } = fakeCore({ archiveFolder: join(tmpdir(), "lockedin-unit-archive") });

    for (const method of VERBS) {
      for (const params of [{}, { id: "   " }, { id: 42 }]) {
        const error = await errorOf(server, method, params);
        expect(error.code).toBe(-32602);
        expect(error.message).toContain("session id");
      }
    }
  });
});

describe("session.archive configuration", () => {
  test("a folder backend with no archive folder is one archive refusal", async () => {
    const { server } = fakeCore({ archiveFolder: "" });
    const error = await errorOf(server, "session.archive", { id: "2026-11-01-0900-physics" });

    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: "2026-11-01-0900-physics",
      message: error.message,
    });
    // Actionable, and never the generic action shape: the fix is Settings.
    expect(error.message).toContain("archive folder");
    expect(error.message).toContain("Settings");
  });

  test("a whitespace-only archive folder is empty, not configured", async () => {
    const { server } = fakeCore({ archiveFolder: "   " });
    const error = await errorOf(server, "session.archive", { id: "2026-11-01-0900-physics" });
    expect(error.data).toMatchObject({ kind: "archive" });
  });

  test("a GitHub backend with no backend in this build is an archive refusal", async () => {
    const { server } = fakeCore({ archiveBackend: "github", archiveFolder: "" });
    const error = await errorOf(server, "session.archive", { id: "2026-11-01-0900-physics" });

    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "archive", id: "2026-11-01-0900-physics" });
    expect(error.message).toContain("GitHub");
  });

  test("a backend that refuses to build is an archive refusal, not a failed action", async () => {
    const { server } = fakeCore({
      archiveBackend: "github",
      createGithubArchive: async () =>
        err({
          kind: "auth",
          repo: "me/notes",
          message: "GitHub archive needs a token in the OS keychain.",
          next: "Link a GitHub token in Settings → Providers, then retry.",
        }),
    });
    const error = await errorOf(server, "session.archive", { id: "2026-11-01-0900-physics" });

    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: "2026-11-01-0900-physics",
      message: "GitHub archive needs a token in the OS keychain.",
    });
    expect(error.message).toBe("GitHub archive needs a token in the OS keychain.");
  });

  test("a configured GitHub backend is passed through as one ready backend", async () => {
    let built = 0;
    const backend = { id: "github" } as unknown as ArchiveBackend;
    // The session is still unknown here: the assertion is that building the
    // backend happened once and the refusal still names the session, so the
    // shell's next action is to refresh its list.
    const { server } = fakeCore({
      archiveBackend: "github",
      createGithubArchive: async () => {
        built += 1;
        return ok(backend);
      },
    });
    const error = await errorOf(server, "session.archive", { id: "2026-11-01-0900-physics" });

    expect(built).toBe(1);
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "session", id: "2026-11-01-0900-physics" });
  });
});

describe("unknown session", () => {
  test("all three verbs report the session shape and are not retryable", async () => {
    const id = "2026-12-31-0000-missing";
    const { server } = fakeCore({
      // A configured folder so `archive` reaches the session lookup.
      archiveFolder: join(tmpdir(), "lockedin-unit-archive"),
    });

    for (const method of VERBS) {
      const error = await errorOf(server, method, { id });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "session", id });
      expect(error.message).toContain(id);
    }
  });
});

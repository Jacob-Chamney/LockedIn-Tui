/**
 * `session.output.build` and `session.output.read`: parameter validation and
 * error shapes.
 *
 * No workspace is created here. A fake boot seam answers, and the directory it
 * names does not exist, so a valid-shaped request ends at the session lookup —
 * which is exactly the error the shell must render. The real build, the file
 * bytes and the reader's `exists` state are covered by
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
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

/** A well-formed id that no workspace in this test can contain. */
const MISSING_ID = "2026-12-31-0000-missing";

function fakeServices(): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-outputs-unit-workspace"),
      paths: {
        // Absent on purpose: `openSession` reports "there is no session …".
        schoolSessions: join(tmpdir(), "lockedin-outputs-unit-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-outputs-unit-no-data"),
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

function request(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  const parsed = parseRequest(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  );
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(request(method, params));
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
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

describe("session.output capabilities", () => {
  test("both methods are advertised", () => {
    expect(CAPABILITIES).toContain("session.output.build");
    expect(CAPABILITIES).toContain("session.output.read");
  });
});

describe("session.output.build", () => {
  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.output.build", {
        ...(id === undefined ? {} : { id }),
        kind: "study-guide",
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    // A bad shape is answered before the app ever boots.
    expect(counter.calls).toBe(0);
  });

  test("requires a known kind and names the accepted set", async () => {
    const { server, counter } = fakeCore();
    for (const kind of [undefined, "", "guide", "deck", 3, null]) {
      const error = await errorOf(server, "session.output.build", {
        id: MISSING_ID,
        ...(kind === undefined ? {} : { kind }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("study-guide, flashcards");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape", async () => {
    const { server } = fakeCore();
    for (const kind of ["study-guide", "flashcards"]) {
      const error = await errorOf(server, "session.output.build", { id: MISSING_ID, kind });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
      expect(error.message).toContain(MISSING_ID);
    }
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
    const error = await errorOf(server, "session.output.build", {
      id: MISSING_ID,
      kind: "study-guide",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "boot", path: failure.path });
  });
});

describe("session.output.read", () => {
  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.output.read", {
        ...(id === undefined ? {} : { id }),
        kind: "study-guide",
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    expect(counter.calls).toBe(0);
  });

  test("requires a known kind and a known part, without booting", async () => {
    const { server, counter } = fakeCore();

    for (const kind of [undefined, "", "study_guide", 1]) {
      const error = await errorOf(server, "session.output.read", {
        id: MISSING_ID,
        ...(kind === undefined ? {} : { kind }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("study-guide, flashcards");
    }

    const badPart = await errorOf(server, "session.output.read", {
      id: MISSING_ID,
      kind: "study-guide",
      part: "deck",
    });
    expect(badPart.code).toBe(-32602);
    expect(badPart.message).toContain("guide, answers, cards");
    expect(counter.calls).toBe(0);
  });

  test("a part that belongs to another kind is refused, not substituted", async () => {
    const { server, counter } = fakeCore();

    for (const [kind, part] of [
      ["study-guide", "cards"],
      ["flashcards", "guide"],
      ["flashcards", "answers"],
    ] as const) {
      const error = await errorOf(server, "session.output.read", {
        id: MISSING_ID,
        kind,
        part,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("belongs to another kind");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape for a missing part", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "session.output.read", {
      id: MISSING_ID,
      kind: "flashcards",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });
});

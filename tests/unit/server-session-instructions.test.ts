/**
 * `session.instructions.*`: parameter validation and error shapes.
 *
 * No workspace is created here. A fake boot seam answers, and the directory it
 * names does not exist, so a valid-shaped request ends at the session lookup —
 * which is exactly the error the shell must render. The real writes, the
 * copied source and the provenance round-trip are covered by
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
      root: join(tmpdir(), "lockedin-instructions-unit-workspace"),
      paths: {
        // Absent on purpose: `openSession` reports "there is no session …".
        schoolSessions: join(tmpdir(), "lockedin-instructions-unit-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-instructions-unit-no-data"),
      archiveBackend: "folder",
      archiveFolder: "",
      archiveGithubRepo: "",
      archiveGithubBranch: "main",
      archiveGithubConsent: false,
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

describe("session.instructions capabilities", () => {
  test("advertises the four methods", () => {
    expect(CAPABILITIES).toEqual(
      expect.arrayContaining([
        "session.instructions.get",
        "session.instructions.save",
        "session.instructions.import",
        "session.instructions.reextract",
      ]),
    );
  });
});

describe("session.instructions.get", () => {
  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.instructions.get", {
        ...(id === undefined ? {} : { id }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    // A bad shape is answered before the app ever boots.
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "session.instructions.get", { id: MISSING_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });
});

describe("session.instructions.save", () => {
  test("requires a text string, and accepts an empty one", async () => {
    const { server, counter } = fakeCore();
    for (const text of [undefined, 3, null, ["line"], { text: "x" }]) {
      const error = await errorOf(server, "session.instructions.save", {
        id: MISSING_ID,
        ...(text === undefined ? {} : { text }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("text");
    }
    expect(counter.calls).toBe(0);

    // An empty string is the service's own rule: it clears the prompt. With no
    // such session the request still reaches the session lookup, not a shape
    // refusal.
    const request = await ask(server, "session.instructions.save", {
      id: MISSING_ID,
      text: "",
    });
    if (!("error" in request)) throw new Error("an unknown session must fail");
    expect(request.error.code).toBe(BOOT_FAILED);
    expect(request.error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });

  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.instructions.save", {
        ...(id === undefined ? {} : { id }),
        text: "Study.",
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "session.instructions.save", {
      id: MISSING_ID,
      text: "Study.",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });
});

describe("session.instructions.import", () => {
  test("requires a non-empty file path", async () => {
    const { server, counter } = fakeCore();
    for (const file of [undefined, "", "   ", 3, null, ["a.md"]]) {
      const error = await errorOf(server, "session.instructions.import", {
        id: MISSING_ID,
        ...(file === undefined ? {} : { file }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("file path");
    }
    expect(counter.calls).toBe(0);
  });

  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.instructions.import", {
        ...(id === undefined ? {} : { id }),
        file: join(tmpdir(), "assignment.md"),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "session.instructions.import", {
      id: MISSING_ID,
      file: join(tmpdir(), "assignment.md"),
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });
});

describe("session.instructions.reextract", () => {
  test("requires a non-empty session id", async () => {
    const { server, counter } = fakeCore();
    for (const id of [undefined, "", "   ", 5, null]) {
      const error = await errorOf(server, "session.instructions.reextract", {
        ...(id === undefined ? {} : { id }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the session error shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "session.instructions.reextract", { id: MISSING_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: MISSING_ID });
  });
});

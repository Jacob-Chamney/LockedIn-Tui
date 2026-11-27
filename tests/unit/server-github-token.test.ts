/**
 * The GitHub archive token protocol: status, link and clear.
 *
 * Every case injects fake hooks, so no keychain or network is touched. The
 * token-validation service has its own unit test; this file proves the wire
 * shape and the refusals.
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

function fakeServices(overrides: {
  status?: CoreServices["githubTokenStatus"];
  link?: CoreServices["linkGithubToken"];
  clear?: CoreServices["clearGithubToken"];
} = {}): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-gh-workspace"),
      paths: { schoolSessions: join(tmpdir(), "lockedin-gh-none") },
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
      dataDir: join(tmpdir(), "lockedin-gh-data"),
      archiveBackend: "github",
      archiveFolder: "",
      archiveGithubRepo: "me/archive",
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
    ...(overrides.status === undefined ? {} : { githubTokenStatus: overrides.status }),
    ...(overrides.link === undefined ? {} : { linkGithubToken: overrides.link }),
    ...(overrides.clear === undefined ? {} : { clearGithubToken: overrides.clear }),
  } as unknown as CoreServices;
}

function fakeCore(services: CoreServices): ReturnType<typeof createCoreServer> {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
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

describe("GitHub token methods", () => {
  test("the handshake advertises status, link and clear", async () => {
    const server = fakeCore(fakeServices());
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    for (const method of [
      "archive.github.token.status",
      "archive.github.token.link",
      "archive.github.token.clear",
    ]) {
      expect(result.capabilities).toContain(method);
    }
  });

  test("status reports linked without returning the token", async () => {
    const server = fakeCore(
      fakeServices({ status: async () => ({ ok: true, value: { linked: true } }) }),
    );
    expect(await resultOf(server, "archive.github.token.status")).toEqual({
      linked: true,
    });
  });

  test("link validates a non-empty token and returns the login", async () => {
    const tokens: string[] = [];
    const server = fakeCore(
      fakeServices({
        link: async (token) => {
          tokens.push(token);
          return { ok: true, value: { login: "friend" } };
        },
      }),
    );

    const blank = await errorOf(server, "archive.github.token.link", { token: " " });
    expect(blank.code).toBe(-32602);
    const tooLong = await errorOf(server, "archive.github.token.link", {
      token: "a".repeat(513),
    });
    expect(tooLong.code).toBe(-32602);

    const linked = await resultOf(server, "archive.github.token.link", {
      token: "  ghp_" + "a".repeat(36) + "  ",
    });
    expect(linked).toEqual({ linked: true, login: "friend" });
    expect(tokens).toEqual(["ghp_" + "a".repeat(36)]);
  });

  test("a rejected token is one typed archive refusal", async () => {
    const server = fakeCore(
      fakeServices({
        link: async () => ({
          ok: false,
          error: { message: "GitHub rejected the token" },
        }),
      }),
    );
    const error = await errorOf(server, "archive.github.token.link", {
      token: "ghp_" + "a".repeat(36),
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "archive" });
  });

  test("clear removes the token and reports unlinked", async () => {
    var cleared = 0;
    const server = fakeCore(
      fakeServices({
        clear: async () => {
          cleared += 1;
          return { ok: true, value: undefined };
        },
      }),
    );
    expect(await resultOf(server, "archive.github.token.clear")).toEqual({
      linked: false,
    });
    expect(cleared).toBe(1);
  });

  test("a build with no keychain writer says so", async () => {
    const server = fakeCore(fakeServices());
    for (const method of [
      "archive.github.token.status",
      "archive.github.token.clear",
    ]) {
      const error = await errorOf(server, method);
      expect(error.code).toBe(-32601);
      expect(error.message).toContain("not available");
    }
  });
});

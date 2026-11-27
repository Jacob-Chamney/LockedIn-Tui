/**
 * `stats.export` — the transport half of the Stats export action.
 *
 * The protocol owns the request shape, the handshake capability and the default
 * format. The document itself is built by `src/stats/summary.ts` from the real
 * counter files, so the seeded cases (headers, rows, determinism) live in
 * `tests/integration/server-data.test.ts`. Nothing here contacts a provider or
 * the network, and no file is written: the reply is text for the shell to save.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/** A data directory that does not exist: the readers report empty counters. */
function fakeServices(): CoreServices {
  const root = join(tmpdir(), "lockedin-unit-stats-export-missing");
  return {
    workspace: {
      root,
      paths: {
        config: join(root, "config.toml"),
        schoolSessions: join(root, "school", "sessions"),
        goals: join(root, "skills", "goals"),
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
      dataDir: join(tmpdir(), "lockedin-unit-stats-export-data"),
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

async function ask(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "stats.export",
    ...(params === undefined ? {} : { params }),
  });
  const response = await server.handle(request(line));
  if (response === null) throw new Error("expected a response for a request with an id");
  return response;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, params);
  if (!("error" in response)) throw new Error("stats.export should have failed");
  return response.error;
}

describe("stats.export capabilities", () => {
  test("is advertised in the handshake capabilities exactly once", () => {
    expect(CAPABILITIES).toContain("stats.export");
    expect([...CAPABILITIES].filter((name) => name === "stats.export")).toHaveLength(1);
  });
});

describe("stats.export request shape", () => {
  test("missing range or scope is -32602 before the app boots, naming the accepted sets", async () => {
    const { server, counter } = fakeCore();
    for (const params of [{}, { range: "7d" }, { scope: "all" }]) {
      const error = await errorOf(server, params);
      expect(error.code).toBe(-32602);
      expect(error.retryable).toBeUndefined();
      expect(error.message).toContain("stats.export");
      expect(error.message).toContain("7d, 30d, 90d, all");
      expect(error.message).toContain("all, school, skills, work");
    }
    // Shape failures never reach the workspace.
    expect(counter.calls).toBe(0);
  });

  test("an unknown range is -32602 naming the accepted set", async () => {
    const { server, counter } = fakeCore();
    for (const range of ["1d", "7D", "", 7, null, ["7d"]]) {
      const error = await errorOf(server, { range, scope: "all" });
      expect(error.code).toBe(-32602);
      expect(error.retryable).toBeUndefined();
      expect(error.message).toContain("stats.export: unknown range");
      expect(error.message).toContain("7d, 30d, 90d, all");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown scope is -32602 naming the accepted set", async () => {
    const { server, counter } = fakeCore();
    for (const scope of ["everywhere", "ALL", "", 1, null, ["all"]]) {
      const error = await errorOf(server, { range: "all", scope });
      expect(error.code).toBe(-32602);
      expect(error.retryable).toBeUndefined();
      expect(error.message).toContain("stats.export: unknown scope");
      expect(error.message).toContain("all, school, skills, work");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown format is -32602 naming md and csv, before booting", async () => {
    const { server, counter } = fakeCore();
    for (const format of ["pdf", "MD", "CSV", "", 1, null, ["md"]]) {
      const error = await errorOf(server, { range: "all", scope: "all", format });
      expect(error.code).toBe(-32602);
      expect(error.retryable).toBeUndefined();
      expect(error.message).toContain("stats.export: unknown format");
      expect(error.message).toContain("md, csv");
    }
    expect(counter.calls).toBe(0);
  });

  test("an omitted format defaults to md and the reply repeats it", async () => {
    const { server, counter } = fakeCore();
    const response = await ask(server, { range: "all", scope: "all" });
    if ("error" in response) throw new Error(`stats.export should answer: ${response.error.message}`);
    expect(counter.calls).toBe(1);
    expect(response.result.format).toBe("md");
    expect(typeof response.result.text).toBe("string");
    expect(String(response.result.text).startsWith("# Stats — all · all")).toBe(true);
  });

  test("csv is explicit and returns a csv document", async () => {
    const { server } = fakeCore();
    const response = await ask(server, { range: "all", scope: "all", format: "csv" });
    if ("error" in response) throw new Error(`stats.export should answer: ${response.error.message}`);
    expect(response.result.format).toBe("csv");
    expect(
      String(response.result.text).startsWith(
        "section,model,runs,input,output,cost_micro_usd,cost_label\n",
      ),
    ).toBe(true);
  });
});

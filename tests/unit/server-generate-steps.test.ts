/**
 * `session.generateSteps` over the injected boot seam.
 *
 * These cases never build a workspace, never contact a provider and never read
 * the user's home directory: the "session" is a hand-written `meta.json` in a
 * throwaway folder, and the completion is a plain function. The real boot path
 * is covered by `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { removeTemp } from "../helpers/cleanup";
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

const SESSION_ID = "2026-11-01-0900-mitochondria";

let base: string;
let sessionsDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-generate-"));
  sessionsDir = join(base, "school", "sessions");
  await mkdir(sessionsDir, { recursive: true });
});

afterEach(async () => {
  await removeTemp(base);
});

/** The smallest `CoreServices` the protocol needs; only the seams under test vary. */
function fakeServices(
  overrides: { generate?: (prompt: string) => Promise<string> } = {},
): CoreServices {
  return {
    workspace: {
      root: join(base, "workspace"),
      paths: { schoolSessions: sessionsDir },
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
    ...(overrides.generate === undefined ? {} : { generate: overrides.generate }),
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

/** A session folder that `openSession` will accept; no sources, no steps. */
async function makeSession(id: string): Promise<string> {
  const folder = join(sessionsDir, id);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "meta.json"),
    `${JSON.stringify(
      {
        schema: 1,
        id,
        name: "Mitochondria",
        created: "2026-11-01T09:00:00.000Z",
        prompt: "",
        steps: true,
        sources: [],
        instructions_source: null,
        archived: false,
      },
      null,
      2,
    )}\n`,
  );
  return folder;
}

describe("session.generateSteps", () => {
  test("is advertised as a capability", async () => {
    expect(CAPABILITIES).toContain("session.generateSteps");
    const { server } = fakeCore();
    const response = await server.handle(request('{"jsonrpc":"2.0","id":1,"method":"initialize"}'));
    expect(response).toMatchObject({
      result: { capabilities: expect.arrayContaining(["session.generateSteps"]) },
    });
  });

  test("a missing or non-string id is invalid params and never boots", async () => {
    const { server, counter } = fakeCore();
    for (const params of [{}, { id: 7 }, { id: "   " }]) {
      const error = await errorOf(server, "session.generateSteps", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown session is the typed session error shape", async () => {
    const generate = async () => '{"phases":[]}';
    const { server } = fakeCore(fakeServices({ generate }));

    const error = await errorOf(server, "session.generateSteps", { id: "2026-12-31-0000-missing" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id: "2026-12-31-0000-missing" });
  });

  test("without a completion the reply names the model setting that fixes it", async () => {
    await makeSession(SESSION_ID);
    const { server } = fakeCore();

    const error = await errorOf(server, "session.generateSteps", { id: SESSION_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("link a model in Settings → Providers");
    expect(error.data).toEqual({
      kind: "generation",
      id: SESSION_ID,
      message: "link a model in Settings → Providers",
    });
  });
});

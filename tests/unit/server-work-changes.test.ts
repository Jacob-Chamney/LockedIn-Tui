/**
 * `work.changes` — the transport half of the read-only Changes summary.
 *
 * The protocol owns two things here: the request shape and project resolution.
 * The git work itself (`src/services/work/changes.ts`) is exercised over a real
 * repository in `tests/integration/server-data.test.ts`, so nothing in this file
 * creates a workspace, runs git or contacts the network. An unknown project
 * fails at the metadata read with the shared project error shape every `work.*`
 * method uses, before the service is ever called.
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

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/**
 * A workspace whose project registry folder does not exist.
 *
 * That is the honest unit-level state: no project is registered, so resolution
 * fails with the service's own "not registered" message and `changes()` is
 * never reached.
 */
function fakeServices(): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-unit-work-changes"),
      paths: {
        workProjects: join(tmpdir(), "lockedin-unit-work-changes-projects"),
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
      dataDir: join(tmpdir(), "lockedin-unit-work-changes-data"),
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

describe("work.changes request shape", () => {
  test("is advertised in the handshake capabilities", () => {
    expect(CAPABILITIES).toContain("work.changes");
  });

  test("a missing, blank or non-string projectId is -32602 without booting", async () => {
    const { server, counter } = fakeCore();
    for (const params of [{}, { projectId: "" }, { projectId: "   " }, { projectId: 7 }]) {
      const response = await ask(server, "work.changes", params);
      if (!("error" in response)) throw new Error("work.changes should have been refused");
      expect(response.error.code).toBe(-32602);
      expect(response.error.retryable).toBeUndefined();
      expect(response.error.message).toBe("work.changes requires a project id");
    }
    // Shape validation happens before the workspace is opened at all.
    expect(counter.calls).toBe(0);
  });

  test("an unknown project is the typed project error, not a changes error", async () => {
    const { server } = fakeCore();
    const projectId = "missing-000000";
    const response = await ask(server, "work.changes", { projectId });
    if (!("error" in response)) throw new Error("an unknown project must fail");

    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe("this project is not registered in this workspace");
    expect(response.error.data).toEqual({
      kind: "project",
      projectId,
      message: "this project is not registered in this workspace",
    });
  });
});

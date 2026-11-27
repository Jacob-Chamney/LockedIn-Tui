/**
 * The read-only archive surface of the core protocol.
 *
 * Every case injects a fake boot or a fake GitHub backend, so nothing here
 * restores, deletes, writes a file or contacts the network. The real folder
 * backend is covered by `tests/integration/server-data.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArchiveBackend, ArchiveEntry, ArchiveSide } from "../../src/archive/types";
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
      root: join(tmpdir(), "lockedin-archive-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-archive-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-archive-no-data"),
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
    ...overrides,
  } as unknown as CoreServices;
}

/** A fake boot with the shared fixture settings patched for one case. */
function withSettings(
  patch: Record<string, unknown>,
  extra: Partial<CoreServices> = {},
): CoreServices {
  const base = fakeServices();
  return {
    ...base,
    ...extra,
    settings: { ...(base.settings as unknown as Record<string, unknown>), ...patch },
  } as unknown as CoreServices;
}

/** One archived entry, shaped exactly as both archive backends return it. */
function entry(side: ArchiveSide, id: string, backend: "folder" | "github" = "github"): ArchiveEntry {
  return {
    id,
    kind: side === "school" ? "session" : "goal",
    title: `${id} title`,
    tags: ["fixture"],
    archivedAt: "2026-11-01T09:00:00.000Z",
    sizeBytes: 18422,
    backend,
  };
}

/**
 * A GitHub backend that lists fixed entries and counts its calls.
 *
 * `put`, `restore` and `remove` throw, so a listing that accidentally calls a
 * write path fails loudly instead of mutating a fixture.
 */
function fakeBackend(entries: ArchiveEntry[]) {
  const calls = { list: 0, sides: [] as ArchiveSide[] };
  const backend = {
    id: "github" as const,
    archiveRoot: "github:fixture",
    async list(side: ArchiveSide) {
      calls.list += 1;
      calls.sides.push(side);
      return {
        ok: true as const,
        value: {
          entries: entries.filter((row) => row.kind === (side === "school" ? "session" : "goal")),
          diagnostics: [],
        },
      };
    },
    async ensureReady() {
      throw new Error("archive.list must not call ensureReady");
    },
    async put() {
      throw new Error("archive.list must not write");
    },
    async restore() {
      throw new Error("archive.list must not restore");
    },
    async remove() {
      throw new Error("archive.list must not remove");
    },
  } as unknown as ArchiveBackend;
  return { backend, calls };
}

function fakeCore(services: CoreServices) {
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

describe("archive capabilities", () => {
  test("the handshake advertises the read-only archive listing", async () => {
    const server = fakeCore(fakeServices());
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    expect(result.capabilities as string[]).toContain("archive.list");
  });
});

describe("archive.list", () => {
  test("an empty folder archive is an empty list, not an error", async () => {
    const server = fakeCore(fakeServices());
    // No `archive.folder` configured is the first-run state.
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
  });

  test("a folder archive with no items yet lists nothing and writes nothing", async () => {
    const archiveFolder = join(tmpdir(), `lockedin-archive-empty-${randomUUID()}`);
    const server = fakeCore(withSettings({ archiveFolder, archiveBackend: "folder" }));

    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
  });

  test("a GitHub backend this build cannot provide is one archive refusal", async () => {
    const server = fakeCore(withSettings({ archiveBackend: "github" }));

    const response = await ask(server, "archive.list");
    if (!("error" in response)) throw new Error("a build without GitHub must refuse");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      message: response.error.message,
    });
    expect(response.error.message).toContain("not available in this build");
  });

  test("an unconfigured GitHub backend reports its own message once", async () => {
    let calls = 0;
    const server = fakeCore(
      withSettings(
        { archiveBackend: "github" },
        {
          createGithubArchive: async () => {
            calls += 1;
            return {
              ok: false as const,
              error: {
                kind: "config" as const,
                field: "archive.github.repo",
                message: "No GitHub archive repository is configured.",
                next: "Set archive.github.repo to owner/name in Settings → Storage and archive.",
              },
            };
          },
        },
      ),
    );

    const response = await ask(server, "archive.list");
    if (!("error" in response)) throw new Error("an unconfigured GitHub backend must refuse");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe("No GitHub archive repository is configured.");
    expect(response.error.data).toEqual({
      kind: "archive",
      message: "No GitHub archive repository is configured.",
    });
    // Building the backend is configuration: it is attempted once, not retried.
    expect(calls).toBe(1);
  });

  test("lists both sides and projects each row onto the wire shape", async () => {
    const school = entry("school", "2026-11-01-0900-physics-unit-4");
    const skills = entry("skills", "assembly-basics-a1b2c3");
    const { backend, calls } = fakeBackend([school, skills]);
    const server = fakeCore(
      withSettings(
        { archiveBackend: "github", archiveFolder: "" },
        { createGithubArchive: async () => ({ ok: true as const, value: backend }) },
      ),
    );

    const result = await resultOf(server, "archive.list");
    const rows = result.rows as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        id: school.id,
        side: "school",
        name: school.title,
        date: school.archivedAt,
        sizeBytes: school.sizeBytes,
        backend: "github",
        kind: "session",
      },
      {
        id: skills.id,
        side: "skills",
        name: skills.title,
        date: skills.archivedAt,
        sizeBytes: skills.sizeBytes,
        backend: "github",
        kind: "goal",
      },
    ]);
    // One listing per side, and no write path was reached.
    expect(calls.sides.sort()).toEqual(["school", "skills"]);
    expect(calls.list).toBe(2);
  });

  test("a relative archive folder is one archive-shaped refusal", async () => {
    const server = fakeCore(
      withSettings({ archiveFolder: "relative/archive", archiveBackend: "folder" }),
    );

    const response = await ask(server, "archive.list");
    if (!("error" in response)) throw new Error("a relative archive root must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "archive" });
    expect(response.error.message).toContain("absolute");
  });
});

describe("archive.list stays behind a boot", () => {
  test("a boot refusal is the documented -32000 shape", async () => {
    const server = createCoreServer({
      boot: async () => ({
        ok: false,
        error: {
          kind: "boot",
          path: "/tmp/legacy",
          message: "this folder belongs to the old LockedIn",
          next: "Set LOCKEDIN_WORKSPACE to choose another folder.",
        },
      }) as Result<CoreServices, BootFailure>,
    });

    const response = await ask(server, "archive.list");
    if (!("error" in response)) throw new Error("expected a boot refusal");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "boot", path: "/tmp/legacy" });
  });
});

/**
 * `archive.restore` / `archive.remove` on the **GitHub** backend.
 *
 * The GitHub adapter itself talks to the network, so this suite injects a fake
 * `createGithubArchive` through the boot seam. The fake implements the
 * `ArchiveBackend` port over a local directory standing in for the remote
 * repository: `restore` copies an item down, `remove` deletes it. That keeps
 * the protocol's own rules under test — backend resolution, id confinement,
 * metadata normalisation, rollback and the move — with no transport, no token
 * and no HTTP.
 *
 * The real GitHub adapter's request shapes (`restore`/`remove`) are covered by
 * `tests/unit/archive-github.test.ts`; this file never claims to test them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import type { ArchiveBackend, ArchiveError, ArchiveRef } from "../../src/archive/types";
import { err, ok, type Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { createLockInSession } from "../../src/services/lockin/create";
import { saveGoal, validateInput } from "../../src/services/skills/create";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type CoreServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;
/** Stands in for the owner/name repository. */
let remoteRoot: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-archive-github-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));
  remoteRoot = join(base, "remote");
  await mkdir(remoteRoot, { recursive: true });
});

afterEach(async () => {
  await removeTemp(base);
});

type FakeOptions = {
  /** The download fails before anything lands. */
  failRestore?: boolean;
  /** The download lands, then `meta.json` is unreadable. */
  corruptMeta?: boolean;
  /** The remote delete fails after a successful restore. */
  failRemove?: boolean;
};

type FakeCalls = {
  order: string[];
  restores: ArchiveRef[];
  removes: ArchiveRef[];
  removeOptions: Array<{ confirm?: boolean } | undefined>;
  /** A restore never converts the destination into a write target. */
  destinations: string[];
};

/**
 * A fake GitHub backend: the remote item is a folder under `remoteRoot`.
 *
 * `archiveRoot` is a URI-shaped label, exactly like the real adapter's repo
 * label, so a caller that tried to treat it as a filesystem path would not find
 * the fake's data by accident.
 */
function fakeGithub(options: FakeOptions = {}): { backend: ArchiveBackend; calls: FakeCalls } {
  const calls: FakeCalls = {
    order: [],
    restores: [],
    removes: [],
    removeOptions: [],
    destinations: [],
  };

  const remoteFolder = (ref: ArchiveRef): string =>
    join(remoteRoot, ref.side, ref.kind ?? "session", ref.id);

  const backend: ArchiveBackend = {
    id: "github",
    archiveRoot: "github://owner/archive",
    async ensureReady() {
      return ok({ root: remoteRoot, created: [] });
    },
    async put() {
      throw new Error("put is not part of this surface");
    },
    async list() {
      return ok({ entries: [], diagnostics: [] });
    },
    async restore(ref, destination) {
      calls.order.push(`restore:${ref.side}:${ref.id}`);
      calls.restores.push(ref);
      calls.destinations.push(destination);
      if (options.failRestore) {
        return err({
          kind: "network",
          path: remoteFolder(ref),
          message: "the download was refused by the injected transport",
          next: "Retry the restore when the network is back.",
        });
      }
      const source = remoteFolder(ref);
      if (!existsSync(source)) {
        return err({
          kind: "storage",
          path: source,
          message: `There is no archived “${ref.id}” on the ${ref.side} side.`,
          next: "Push the item first, or pick another entry.",
        });
      }
      await cp(source, destination, { recursive: true });
      if (options.corruptMeta) {
        await writeFile(join(destination, SESSION_FILES.meta), "not json\n");
      }
      return ok({ ref, path: destination, files: 1 });
    },
    async remove(ref, removeOptions) {
      calls.order.push(`remove:${ref.side}:${ref.id}`);
      calls.removes.push(ref);
      calls.removeOptions.push(removeOptions);
      if (options.failRemove) {
        return err({
          kind: "network",
          path: remoteFolder(ref),
          message: "the delete was refused by the injected transport",
          next: "Retry the delete when the network is back.",
        });
      }
      const target = remoteFolder(ref);
      if (!existsSync(target)) return ok({ removed: false, path: target, files: 0 });
      const files = 1;
      await rm(target, { recursive: true, force: true });
      return ok({ removed: true, path: target, files });
    },
  };

  return { backend, calls };
}

/** Settings that select GitHub and build the injected fake. */
function githubServices(input: {
  create?: () => Promise<Result<ArchiveBackend, ArchiveError>>;
}): { services: CoreServices; built: { calls: number } } {
  const built = { calls: 0 };
  const services = {
    workspace,
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
      dataDir,
      archiveBackend: "github",
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
    ...(input.create === undefined
      ? {}
      : {
          createGithubArchive: async () => {
            built.calls += 1;
            return input.create!();
          },
        }),
  } as unknown as CoreServices;
  return { services, built };
}

function core(services: CoreServices): CoreServer {
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
  server: CoreServer,
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
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method}: ${response.error.message}`);
  return response.result;
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

/** A real session whose live folder is then moved into the fake remote. */
async function archivedSession() {
  const inputs = join(base, "input");
  await mkdir(inputs, { recursive: true });
  const lecture = join(inputs, "lecture-4.md");
  await writeFile(lecture, "# Unit 4\n\nBoundary conditions.\n");
  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T09:00:00Z",
      name: "Physics — Unit 4",
      prompt: "Study the boundary conditions.",
      files: [lecture],
    }),
  );
  const sessionId = created.session.id;
  const steps =
    "# Assignment steps\n\n> 0 of 1 steps done\n\n## Solve\n\n- [ ] Derive the energy balance\n";
  await writeFile(join(created.folder, SESSION_FILES.steps), steps);
  await writeFile(
    join(created.folder, SESSION_FILES.chat),
    `${JSON.stringify({ role: "user", content: "Hi", at: "2026-11-01T09:10:00Z" })}\n`,
  );

  const archived = join(remoteRoot, "school", "session", sessionId);
  await cp(created.folder, archived, { recursive: true });
  await rm(join(archived, SESSION_FILES.chat), { force: true });
  const meta = JSON.parse(await readFile(join(archived, SESSION_FILES.meta), "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    join(archived, SESSION_FILES.meta),
    `${JSON.stringify({ ...meta, archived: true, chat_archived: false }, null, 2)}\n`,
  );
  await rm(created.folder, { recursive: true, force: true });

  return { id: sessionId, folder: created.folder, lecture, steps, archived };
}

/** A real curriculum goal whose live folder is then moved into the fake remote. */
async function archivedGoal() {
  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(
        validateInput({
          statement: "read disassembly output confidently",
          level: "beginner",
          timeBudget: "6 weeks",
        }),
      ),
      stages: [
        { title: "Registers", milestone: "explain a stack frame" },
        { title: "Control flow", milestone: "trace a loop" },
        { title: "Conventions", milestone: "read a prologue" },
      ],
      created: "2026-11-01T09:00:00.000Z",
    }),
  );

  const archived = join(remoteRoot, "skills", "goal", saved.goal.id);
  await cp(saved.folder, archived, { recursive: true });
  const meta = JSON.parse(await readFile(join(archived, "meta.json"), "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    join(archived, "meta.json"),
    `${JSON.stringify({ ...meta, archived: true }, null, 2)}\n`,
  );
  await rm(saved.folder, { recursive: true, force: true });

  return { id: saved.goal.id, folder: saved.folder, archived };
}

describe("archive.restore on the GitHub backend", () => {
  test("restores a school session as a move and normalises its metadata", async () => {
    const session = await archivedSession();
    const { backend, calls } = fakeGithub();
    const { services, built } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    expect(await resultOf(server, "archive.restore", { id: session.id, side: "school" })).toEqual({
      action: "restore",
      side: "school",
      id: session.id,
    });
    expect(built.calls).toBe(1);

    // One download, then one remote delete: a restore is a move, not a copy.
    expect(calls.order).toEqual([
      `restore:school:${session.id}`,
      `remove:school:${session.id}`,
    ]);
    expect(calls.restores[0]).toEqual({
      side: "school",
      id: session.id,
      backend: "github",
      kind: "session",
    });
    // A restore never asks the adapter for a delete confirmation; that gate is
    // `archive.remove`'s.
    expect(calls.removeOptions).toEqual([undefined]);
    expect(existsSync(session.archived)).toBe(false);

    // The destination is the workspace's own sessions folder, not a UI path.
    expect(calls.destinations).toEqual([
      join(workspace.paths.schoolSessions, session.id),
    ]);

    // Live again, with the archived steps and source, and no chat history.
    expect(existsSync(session.folder)).toBe(true);
    await expect(readFile(join(session.folder, SESSION_FILES.steps), "utf8")).resolves.toBe(
      session.steps,
    );
    expect(existsSync(join(session.folder, SESSION_FILES.chat))).toBe(false);
    const meta = JSON.parse(
      await readFile(join(session.folder, SESSION_FILES.meta), "utf8"),
    ) as Record<string, unknown>;
    expect(meta.archived).toBe(false);
    expect(meta.chat_archived).toBeUndefined();
    // The user's original is never touched by a restore.
    expect(existsSync(session.lecture)).toBe(true);
    expect(
      ((await resultOf(server, "session.list")).sessions as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([session.id]);
  });

  test("a failed download leaves the archive and creates no live folder", async () => {
    const session = await archivedSession();
    const archivedMeta = await readFile(join(session.archived, SESSION_FILES.meta), "utf8");
    const { backend, calls } = fakeGithub({ failRestore: true });
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.restore", { id: session.id, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "session-action",
      id: session.id,
      action: "restore",
      message: error.message,
    });
    expect(error.message).toContain("injected transport");

    // No delete was attempted and nothing was written on either side.
    expect(calls.order).toEqual([`restore:school:${session.id}`]);
    expect(existsSync(session.archived)).toBe(true);
    await expect(readFile(join(session.archived, SESSION_FILES.meta), "utf8")).resolves.toBe(
      archivedMeta,
    );
    expect(existsSync(session.folder)).toBe(false);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("a restore that cannot be normalised removes the fresh folder and keeps the archive", async () => {
    const session = await archivedSession();
    const { backend, calls } = fakeGithub({ corruptMeta: true });
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.restore", { id: session.id, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({
      kind: "session-action",
      id: session.id,
      action: "restore",
    });

    // The copy landed, then the rollback removed it; the archive was not deleted.
    expect(calls.order).toEqual([`restore:school:${session.id}`]);
    expect(calls.removes).toEqual([]);
    expect(existsSync(session.folder)).toBe(false);
    expect(existsSync(session.archived)).toBe(true);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("a failed remote delete rolls the restore back", async () => {
    const session = await archivedSession();
    const { backend, calls } = fakeGithub({ failRemove: true });
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.restore", { id: session.id, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({
      kind: "session-action",
      id: session.id,
      action: "restore",
    });

    expect(calls.order).toEqual([
      `restore:school:${session.id}`,
      `remove:school:${session.id}`,
    ]);
    // The move did not complete, so the live copy was rolled back and the
    // remote copy is still the only one.
    expect(existsSync(session.folder)).toBe(false);
    expect(existsSync(session.archived)).toBe(true);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("restores a skills goal as a move and clears its archived flag", async () => {
    const goal = await archivedGoal();
    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    expect(await resultOf(server, "archive.restore", { id: goal.id, side: "skills" })).toEqual({
      action: "restore",
      side: "skills",
      id: goal.id,
    });

    expect(calls.order).toEqual([`restore:skills:${goal.id}`, `remove:skills:${goal.id}`]);
    expect(calls.restores[0]).toEqual({
      side: "skills",
      id: goal.id,
      backend: "github",
      kind: "goal",
    });
    expect(calls.destinations).toEqual([join(workspace.paths.goals, goal.id)]);
    expect(existsSync(goal.archived)).toBe(false);

    expect(existsSync(goal.folder)).toBe(true);
    const meta = JSON.parse(await readFile(join(goal.folder, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.archived).toBe(false);
    expect((meta.stages as unknown[]).length).toBe(3);
    expect(
      ((await resultOf(server, "skill.list")).skills as Array<{ id: string }>).map((row) => row.id),
    ).toEqual([goal.id]);
  });

  test("an id that is not in the remote archive is one refusal and nothing moves", async () => {
    const missing = "2026-12-31-0000-missing";
    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.restore", { id: missing, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({
      kind: "session-action",
      id: missing,
      action: "restore",
    });
    expect(calls.removes).toEqual([]);
    expect(existsSync(join(workspace.paths.schoolSessions, missing))).toBe(false);
  });

  test("a GitHub backend that cannot be built is the typed refusal before any read", async () => {
    const { services, built } = githubServices({
      create: async () =>
        err({
          kind: "config",
          field: "archive.github.repo",
          repo: "owner/archive",
          message:
            "No GitHub archive repository is configured; set it in Settings → Storage and archive.",
          next: "Set archive.github.repo to owner/name in Settings → Storage and archive.",
        }),
    });
    const server = core(services);

    for (const side of ["school", "skills"] as const) {
      const error = await errorOf(server, "archive.restore", { id: "2026-11-01-0900-x", side });
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.data).toEqual({
        kind: "archive",
        id: "2026-11-01-0900-x",
        side,
        message: error.message,
      });
      expect(error.message).toContain("GitHub");
      expect(error.message).toContain("Settings");
    }
    // The build was attempted once per request; nothing was read or written.
    expect(built.calls).toBe(2);
    expect(existsSync(join(workspace.paths.schoolSessions, "2026-11-01-0900-x"))).toBe(false);
  });

  test("a build with no GitHub backend keeps one refusal naming Settings", async () => {
    const { services } = githubServices({});
    const server = core(services);

    const error = await errorOf(server, "archive.restore", {
      id: "2026-11-01-0900-x",
      side: "skills",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "archive", side: "skills" });
    expect(error.message).toContain("GitHub");
  });

  test("a session that is already open is refused and never overwritten", async () => {
    const session = await archivedSession();
    await mkdir(session.folder, { recursive: true });
    await writeFile(join(session.folder, "marker.txt"), "live\n");

    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.restore", { id: session.id, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "archive", id: session.id, side: "school" });
    expect(error.message).toContain("already open");

    expect(calls.order).toEqual([]);
    await expect(readFile(join(session.folder, "marker.txt"), "utf8")).resolves.toBe("live\n");
    expect(existsSync(session.archived)).toBe(true);
  });
});

describe("archive.remove on the GitHub backend", () => {
  test("deletes only the archived session and leaves the live copy alone", async () => {
    const session = await archivedSession();
    // Restore the live copy for the test: remove must delete the archive row
    // only, never a live session.
    await cp(session.archived, session.folder, { recursive: true });
    const liveMeta = await readFile(join(session.folder, SESSION_FILES.meta), "utf8");

    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    expect(await resultOf(server, "archive.remove", { id: session.id, side: "school" })).toEqual({
      action: "delete",
      side: "school",
      id: session.id,
    });

    // One confirmed remote delete of the school/session item, by id only.
    expect(calls.order).toEqual([`remove:school:${session.id}`]);
    expect(calls.removes[0]).toEqual({
      side: "school",
      id: session.id,
      backend: "github",
      kind: "session",
    });
    expect(calls.removeOptions).toEqual([{ confirm: true }]);
    expect(existsSync(session.archived)).toBe(false);

    // The live session and the user's original file are byte-identical.
    expect(existsSync(session.folder)).toBe(true);
    await expect(readFile(join(session.folder, SESSION_FILES.meta), "utf8")).resolves.toBe(liveMeta);
    expect(existsSync(session.lecture)).toBe(true);
  });

  test("deletes only the archived goal and leaves the live goal alone", async () => {
    const goal = await archivedGoal();
    await cp(goal.archived, goal.folder, { recursive: true });
    const liveMeta = await readFile(join(goal.folder, "meta.json"), "utf8");

    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    expect(await resultOf(server, "archive.remove", { id: goal.id, side: "skills" })).toEqual({
      action: "delete",
      side: "skills",
      id: goal.id,
    });

    expect(calls.removes[0]).toEqual({
      side: "skills",
      id: goal.id,
      backend: "github",
      kind: "goal",
    });
    expect(calls.removeOptions).toEqual([{ confirm: true }]);
    expect(existsSync(goal.archived)).toBe(false);
    expect(existsSync(goal.folder)).toBe(true);
    await expect(readFile(join(goal.folder, "meta.json"), "utf8")).resolves.toBe(liveMeta);
  });

  test("an id that is not archived is one refusal naming the id and side", async () => {
    const missing = "2026-12-31-0000-missing";
    const { backend, calls } = fakeGithub();
    const { services } = githubServices({ create: async () => ok(backend) });
    const server = core(services);

    const error = await errorOf(server, "archive.remove", { id: missing, side: "school" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: missing,
      side: "school",
      message: error.message,
    });
    expect(error.message).toContain(missing);
    expect(error.message).toContain("school");
    expect(calls.removes).toHaveLength(1);
    expect(calls.removes[0]).toEqual({
      side: "school",
      id: missing,
      backend: "github",
      kind: "session",
    });
  });

  test("an unbuildable GitHub backend deletes nothing", async () => {
    const { services, built } = githubServices({
      create: async () =>
        err({
          kind: "consent",
          repo: "owner/archive",
          message: "Archiving to GitHub needs consent.",
          next: "Grant consent in Settings → Storage and archive first.",
        }),
    });
    const server = core(services);

    const error = await errorOf(server, "archive.remove", {
      id: "2026-11-01-0900-x",
      side: "school",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "archive",
      id: "2026-11-01-0900-x",
      side: "school",
      message: error.message,
    });
    expect(error.message).toContain("consent");
    expect(built.calls).toBe(1);
  });
});

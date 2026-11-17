/**
 * The global Work write/command opt-in (`docs/product.md` §8.2).
 *
 * The gate needs **both** permissions: the stored `[work]` flag in
 * `config.toml` and the resolved agent profile's own flag. Every case here boots
 * the real composition root in a throwaway workspace (no model, so no provider
 * is contacted) because the gate reads configuration and the profile from disk.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boot } from "../../src/app/boot";
import {
  createProject,
  createProjectAgent,
  makeAgentId,
  makeProjectId,
  setProjectDefaultAgent,
} from "../../src/app/actions/projects";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  WORK_COMMAND_OPT_IN_OFF,
  WORK_WRITE_OPT_IN_OFF,
  createCoreServer,
  parseRequest,
  type CoreServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type WorkPermissions,
} from "../../src/server/protocol";
import { patchConfig } from "../../src/storage/config";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const NOW = () => new Date("2026-11-01T12:00:00Z");

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-optin-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));
});

afterEach(async () => {
  await removeTemp(base);
});

/**
 * The real boot plus the real `main.ts` `saveWorkPermissions` wrapper.
 *
 * `main.ts` starts readline and owns stdout, so it is not importable; this
 * mirrors its wrapper exactly — one `patchConfig` for `[work]`, `updateConfig`,
 * then the stored values — while the protocol remains the thing under test.
 */
function permissionsCore(): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      return {
        ok: true,
        value: {
          ...booted.value,
          saveWorkPermissions: async (input: WorkPermissions) => {
            const written = await patchConfig(booted.value.workspace.paths, {
              work: {
                allow_write: input.allowWrite,
                allow_command: input.allowCommand,
              },
            });
            if (!written.ok) {
              return { ok: false as const, error: { message: written.error.message } };
            }
            await booted.value.updateConfig(written.value.config);
            return {
              ok: true as const,
              value: {
                allowWrite: written.value.config.work.allow_write,
                allowCommand: written.value.config.work.allow_command,
              },
            };
          },
        },
      };
    },
  });
}

/** A core built by a boot with no `saveWorkPermissions` writer. */
function readerCore(): CoreServer {
  return createCoreServer({
    boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
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
    request(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) })),
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
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result;
}

async function errorOf(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have been refused`);
  return response.error;
}

/** A registered project whose one default profile has the requested capability. */
async function projectWith(
  permissions: "read-only" | "write" | "commands",
): Promise<{ id: string; root: string }> {
  const name = `Opt-in ${permissions}`;
  const root = join(base, permissionSlug(permissions));
  await mkdir(root, { recursive: true });
  const id = makeProjectId(name);
  unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
  const agentId = makeAgentId("Builder");
  unwrap(
    await createProjectAgent({
      workspace,
      projectId: id,
      id: agentId,
      agent: {
        id: agentId,
        name: "Builder",
        task: "Build.",
        model: "",
        permissions,
      },
    }),
  );
  unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
  return { id, root };
}

function permissionSlug(permissions: string): string {
  return permissions.replace(/[^a-z0-9]+/g, "-");
}

const WRITE_BODY = "# Notes\n";

async function proposeWrite(server: CoreServer, projectId: string): Promise<string> {
  const proposed = await resultOf(server, "work.write.propose", {
    projectId,
    path: "notes.md",
    newContent: WRITE_BODY,
  });
  return proposed.id as string;
}

async function proposeCommand(server: CoreServer, projectId: string): Promise<string> {
  const argv = Bun.which("printf") === null
    ? [process.execPath, "-e", "process.stdout.write('ok')"]
    : ["printf", "ok"];
  const proposed = await resultOf(server, "work.command.propose", { projectId, argv });
  return proposed.id as string;
}

describe("work.permissions.get", () => {
  test("a fresh workspace reports both flags off", async () => {
    expect(await resultOf(readerCore(), "work.permissions.get")).toEqual({
      allowWrite: false,
      allowCommand: false,
    });
  });
});

describe("work.permissions.set", () => {
  test("writes the two booleans and reports what config stores", async () => {
    const server = permissionsCore();

    expect(await resultOf(server, "work.permissions.set", { allowWrite: true })).toEqual({
      allowWrite: true,
      allowCommand: false,
    });
    expect(await resultOf(server, "work.permissions.get")).toEqual({
      allowWrite: true,
      allowCommand: false,
    });

    // One field at a time: the omitted flag keeps its stored value.
    expect(await resultOf(server, "work.permissions.set", { allowCommand: true })).toEqual({
      allowWrite: true,
      allowCommand: true,
    });

    const text = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(text).toContain("[work]");
    expect(text).toContain("allow_write = true");
    expect(text).toContain("allow_command = true");
  });

  test("the stored flags survive a restart", async () => {
    const first = permissionsCore();
    await resultOf(first, "work.permissions.set", { allowWrite: true, allowCommand: false });

    // A second core is a second process: it boots from config.toml, not from the
    // first core's memory.
    expect(await resultOf(readerCore(), "work.permissions.get")).toEqual({
      allowWrite: true,
      allowCommand: false,
    });
  });

  test("a bad shape is -32602 and leaves the stored values alone", async () => {
    const server = permissionsCore();
    await resultOf(server, "work.permissions.set", { allowWrite: true });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    expect((await errorOf(server, "work.permissions.set", { allowWrite: "yes" })).code).toBe(-32602);
    expect((await errorOf(server, "work.permissions.set", { allowCommand: 1 })).code).toBe(-32602);

    await expect(readFile(join(workspaceRoot, "config.toml"), "utf8")).resolves.toBe(before);
    expect(await resultOf(server, "work.permissions.get")).toEqual({
      allowWrite: true,
      allowCommand: false,
    });
  });

  test("a build with no writer is -32601 and writes nothing", async () => {
    const server = readerCore();
    const error = await errorOf(server, "work.permissions.set", { allowWrite: true });

    expect(error.code).toBe(-32601);
    expect(error.retryable).toBe(false);
    expect(await resultOf(server, "work.permissions.get")).toEqual({
      allowWrite: false,
      allowCommand: false,
    });
    // The read-only core did create the default config, but it never contains
    // the enabled flag.
    const text = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(text).not.toContain("allow_write = true");
  });

  test("settings.patch cannot change the Work opt-in", async () => {
    const server = permissionsCore();
    const error = await errorOf(server, "settings.patch", {
      patch: { work: { allow_write: true } },
    });
    expect(error.code).toBe(-32602);
    expect(await resultOf(server, "work.permissions.get")).toEqual({
      allowWrite: false,
      allowCommand: false,
    });
  });

  test("a request with no fields is a no-op success", async () => {
    const server = permissionsCore();
    expect(await resultOf(server, "work.permissions.set", {})).toEqual({
      allowWrite: false,
      allowCommand: false,
    });
  });
});

describe("the write gate needs both flags", () => {
  test("off by default refuses a write-capable profile and writes nothing", async () => {
    const project = await projectWith("write");
    const server = permissionsCore();
    const proposalId = await proposeWrite(server, project.id);
    const path = join(project.root, "notes.md");

    const error = await errorOf(server, "work.write.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(WORK_WRITE_OPT_IN_OFF);
    expect(error.data).toMatchObject({ kind: "write", projectId: project.id, path: "notes.md" });
    expect(existsSync(path)).toBe(false);

    // The refusal is not a decision: the proposal is still pending, so the user
    // can turn the gate on and approve the same value.
    expect(await resultOf(server, "work.approvals.list", { projectId: project.id })).toMatchObject({
      writes: [{ id: proposalId }],
    });

    await resultOf(server, "work.permissions.set", { allowWrite: true });
    const approved = await resultOf(server, "work.write.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(approved).toMatchObject({ decision: "approve", applied: true, path: "notes.md" });
    expect(await readFile(path, "utf8")).toBe(WRITE_BODY);
  });

  test("the profile alone refuses with the profile message", async () => {
    const project = await projectWith("read-only");
    const server = permissionsCore();
    await resultOf(server, "work.permissions.set", { allowWrite: true });
    const proposalId = await proposeWrite(server, project.id);

    const error = await errorOf(server, "work.write.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("is not allowed to write");
    expect(error.message).not.toBe(WORK_WRITE_OPT_IN_OFF);
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);
  });

  test("a reject still works with both flags off", async () => {
    const project = await projectWith("write");
    const server = permissionsCore();
    const proposalId = await proposeWrite(server, project.id);

    expect(
      await resultOf(server, "work.write.decide", { id: proposalId, decision: "reject" }),
    ).toEqual({ decision: "reject", applied: false, path: "notes.md", hunks: [], bytes: 0 });
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);
  });
});

describe("the command gate needs both flags", () => {
  test("off by default refuses a command-capable profile and starts nothing", async () => {
    const project = await projectWith("commands");
    const server = permissionsCore();
    const proposalId = await proposeCommand(server, project.id);

    const error = await errorOf(server, "work.command.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(WORK_COMMAND_OPT_IN_OFF);
    expect(error.data).toMatchObject({ kind: "command", projectId: project.id });

    await resultOf(server, "work.permissions.set", { allowCommand: true });
    const approved = await resultOf(server, "work.command.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(approved).toMatchObject({ decision: "approve", exitCode: 0 });
  });

  test("the profile alone refuses with the profile message", async () => {
    const project = await projectWith("read-only");
    const server = permissionsCore();
    await resultOf(server, "work.permissions.set", { allowCommand: true });
    const proposalId = await proposeCommand(server, project.id);

    const error = await errorOf(server, "work.command.decide", {
      id: proposalId,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("is not allowed to run commands");
    expect(error.message).not.toBe(WORK_COMMAND_OPT_IN_OFF);
  });

  test("a denial still works with both flags off", async () => {
    const project = await projectWith("commands");
    const server = permissionsCore();
    const proposalId = await proposeCommand(server, project.id);

    expect(
      await resultOf(server, "work.command.decide", { id: proposalId, decision: "deny" }),
    ).toMatchObject({ decision: "deny", exitCode: null, stdout: "" });
  });
});

describe("the gate leaves the user's folder alone", () => {
  test("a refused approval creates no file or temp file in the project", async () => {
    const project = await projectWith("write");
    const server = permissionsCore();
    await proposeWrite(server, project.id);

    await errorOf(server, "work.write.decide", {
      id: await proposeWrite(server, project.id),
      decision: "approve",
    });

    expect(await readdir(project.root)).toEqual([]);
  });
});

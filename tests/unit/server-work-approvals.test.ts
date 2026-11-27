/**
 * The Work write/command approval surface: transport validation and refusal
 * shapes.
 *
 * These cases use a real (throwaway) workspace so a proposal can be confined
 * and an approved write can land, but they never boot the app: the boot seam
 * returns the workspace the test already created. Nothing here contacts a
 * provider or the network. The full end-to-end path over `boot()` lives in
 * `tests/integration/server-data.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROPOSAL_TTL_MS } from "../../src/server/work-approvals";
import {
  createProject,
  createProjectAgent,
  makeAgentId,
  makeProjectId,
  setProjectDefaultAgent,
} from "../../src/app/actions/projects";
import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type CoreServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-approvals-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));
});

afterEach(async () => {
  await removeTemp(base);
});

function services(): CoreServices {
  return {
    workspace,
    // None of the approval handlers render settings; they do read the stored
    // global opt-in. These cases exercise the *profile* half of the gate, so the
    // outer gate is on; `tests/unit/server-work-optin.test.ts` covers the
    // Settings half and the default-off refusal.
    settings: { dataDir } as unknown as CoreServices["settings"],
    config: {
      work: { allow_write: true, allow_command: true },
    } as unknown as CoreServices["config"],
  } as CoreServices;
}

function fakeCore(clock?: { now: () => number }): {
  server: CoreServer;
  counter: { calls: number };
} {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: services() } as Result<CoreServices, BootFailure>;
    },
    ...(clock === undefined ? {} : { now: clock.now }),
  });
  return { server, counter };
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
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
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
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
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

type ProjectOptions = {
  /** `read-only`, `write` or `commands` for the one seeded profile. */
  permissions?: "read-only" | "write" | "commands";
  /** Set the seeded profile as the project default. */
  default?: boolean;
  /** Create no profile at all (the blocked state). */
  noAgent?: boolean;
};

/** A registered project with a real empty root and one optional profile. */
async function registeredProject(
  name: string,
  options: ProjectOptions = {},
): Promise<{ id: string; root: string }> {
  const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  await mkdir(root, { recursive: true });
  const id = makeProjectId(name);
  unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
  if (options.noAgent === true) return { id, root };

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
        permissions: options.permissions ?? "write",
      },
    }),
  );
  if (options.default === true) {
    unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
  }
  return { id, root };
}

describe("work.write.propose validation", () => {
  test("requires a project id, a relative path and a string-or-null content", async () => {
    const { server, counter } = fakeCore();

    const project = await errorOf(server, "work.write.propose", {
      path: "notes.md",
      newContent: "x",
    });
    expect(project.code).toBe(-32602);
    expect(project.message).toContain("project id");

    const path = await errorOf(server, "work.write.propose", {
      projectId: "p",
      path: "   ",
      newContent: "x",
    });
    expect(path.code).toBe(-32602);
    expect(path.message).toContain("path");

    const content = await errorOf(server, "work.write.propose", {
      projectId: "p",
      path: "notes.md",
      newContent: 5,
    });
    expect(content.code).toBe(-32602);
    expect(content.message).toContain("newContent");

    // Shape validation never needs the workspace.
    expect(counter.calls).toBe(0);
  });
});

describe("work.write.decide validation", () => {
  test("requires an id and an approve/reject decision", async () => {
    const { server, counter } = fakeCore();

    const id = await errorOf(server, "work.write.decide", { decision: "approve" });
    expect(id.code).toBe(-32602);
    expect(id.message).toContain("proposal id");

    const decision = await errorOf(server, "work.write.decide", {
      id: "x",
      decision: "maybe",
    });
    expect(decision.code).toBe(-32602);
    expect(decision.message).toContain("approve");

    expect(counter.calls).toBe(0);
  });

  test("hunks are non-negative integers and only accepted with an approval", async () => {
    const { server, counter } = fakeCore();

    const notArray = await errorOf(server, "work.write.decide", {
      id: "x",
      decision: "approve",
      hunks: 1,
    });
    expect(notArray.code).toBe(-32602);
    expect(notArray.message).toContain("array");

    const negative = await errorOf(server, "work.write.decide", {
      id: "x",
      decision: "approve",
      hunks: [-1],
    });
    expect(negative.code).toBe(-32602);
    expect(negative.message).toContain("non-negative");

    const withReject = await errorOf(server, "work.write.decide", {
      id: "x",
      decision: "reject",
      hunks: [0],
    });
    expect(withReject.code).toBe(-32602);
    expect(withReject.message).toContain("approve");

    expect(counter.calls).toBe(0);
  });

  test("an unknown proposal id is a typed -32000 write failure", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "work.write.decide", {
      id: "missing-proposal",
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "write", id: "missing-proposal" });
    expect(error.message).toContain("no pending write proposal");
    // The proposal store is in memory, so a lookup cannot need the workspace.
    expect(counter.calls).toBe(0);
  });
});

describe("work.command.propose validation", () => {
  test("argv must be an array of non-empty strings, never a shell line", async () => {
    const { server, counter } = fakeCore();

    const string = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: "printf ok",
    });
    expect(string.code).toBe(BOOT_FAILED);
    expect(string.retryable).toBe(false);
    expect(string.data).toMatchObject({ kind: "command" });
    expect(string.message).toContain("argv array");

    const empty = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: [],
    });
    expect(empty.code).toBe(BOOT_FAILED);
    expect(empty.data).toMatchObject({ kind: "command" });

    const emptyProgram = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: ["   "],
    });
    expect(emptyProgram.code).toBe(BOOT_FAILED);
    expect(emptyProgram.data).toMatchObject({ kind: "command" });

    const metacharacter = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: ["echo", "hi; rm -rf ."],
    });
    expect(metacharacter.code).toBe(BOOT_FAILED);
    expect(metacharacter.data).toMatchObject({ kind: "command" });
    expect(metacharacter.message).toContain("argv arrays");

    const nonString = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: ["echo", 5],
    });
    expect(nonString.code).toBe(BOOT_FAILED);
    expect(nonString.data).toMatchObject({ kind: "command" });

    // Every refusal above is decided before the workspace is needed.
    expect(counter.calls).toBe(0);
  });

  test("cwd and reason must be strings when supplied", async () => {
    const { server, counter } = fakeCore();
    const cwd = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: ["printf", "ok"],
      cwd: 1,
    });
    expect(cwd.code).toBe(-32602);
    expect(cwd.message).toContain("cwd");

    const reason = await errorOf(server, "work.command.propose", {
      projectId: "p",
      argv: ["printf", "ok"],
      reason: 1,
    });
    expect(reason.code).toBe(-32602);
    expect(reason.message).toContain("reason");
    expect(counter.calls).toBe(0);
  });
});

describe("work.command.decide validation", () => {
  test("requires an id and an approve/deny decision", async () => {
    const { server, counter } = fakeCore();

    const id = await errorOf(server, "work.command.decide", { decision: "approve" });
    expect(id.code).toBe(-32602);
    expect(id.message).toContain("proposal id");

    const decision = await errorOf(server, "work.command.decide", {
      id: "x",
      decision: "reject",
    });
    expect(decision.code).toBe(-32602);
    expect(decision.message).toContain("deny");

    expect(counter.calls).toBe(0);
  });

  test("an unknown proposal id is a typed -32000 command failure", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "work.command.decide", {
      id: "missing-command",
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "command", id: "missing-command" });
    expect(error.message).toContain("no pending command proposal");
    expect(counter.calls).toBe(0);
  });
});

describe("work approvals — permission gates", () => {
  test("an unknown project is the shared project error shape", async () => {
    const { server } = fakeCore();
    const write = await errorOf(server, "work.write.propose", {
      projectId: "missing-000000",
      path: "notes.md",
      newContent: "x\n",
    });
    expect(write.code).toBe(BOOT_FAILED);
    expect(write.retryable).toBe(false);
    expect(write.data).toMatchObject({ kind: "project", projectId: "missing-000000" });

    const command = await errorOf(server, "work.command.propose", {
      projectId: "missing-000000",
      argv: ["printf", "ok"],
    });
    expect(command.code).toBe(BOOT_FAILED);
    expect(command.retryable).toBe(false);
    expect(command.data).toMatchObject({ kind: "project", projectId: "missing-000000" });
  });

  test("a project with no profile refuses a write approval", async () => {
    const project = await registeredProject("Empty crew", { noAgent: true });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    const error = await errorOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({
      kind: "write",
      projectId: project.id,
      path: "notes.md",
    });
    expect(error.message).toContain("no agent profile");
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);
  });

  test("a project with no profile still rejects a write, and consumes it", async () => {
    const project = await registeredProject("Empty crew", { noAgent: true });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    // Rejecting applies nothing, so it needs no profile: `server-work-approvals`
    // used to resolve one first, so Reject failed with "no agent profile", the
    // proposal was never consumed, and the shell kept a row it could not close.
    const rejected = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "reject",
    });
    expect(rejected).toMatchObject({ decision: "reject", applied: false, hunks: [], bytes: 0 });
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);

    // Consumed: a second decision is the documented "no pending proposal".
    const again = await errorOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "reject",
    });
    expect(again.message).toContain("no pending write proposal");
    expect(await resultOf(server, "work.approvals.list", { projectId: project.id })).toMatchObject({
      writes: [],
    });
  });

  test("a project with no profile still denies a command, and consumes it", async () => {
    const project = await registeredProject("Empty crew", { noAgent: true });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv: ["printf", "ok"],
    });
    const denied = await resultOf(server, "work.command.decide", {
      id: proposed.id,
      decision: "deny",
      reason: "not now",
    });
    expect(denied).toMatchObject({ decision: "deny", exitCode: null, stdout: "", stderr: "" });
    expect(await resultOf(server, "work.approvals.list", { projectId: project.id })).toMatchObject({
      commands: [],
    });
  });

  test("the profile's allowWrite gates an approval", async () => {
    const project = await registeredProject("Read only", { permissions: "read-only" });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    const error = await errorOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "write", projectId: project.id });
    expect(error.message).toContain("not allowed to write");
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);
  });

  test("the profile's allowCommand gates an approval", async () => {
    const project = await registeredProject("No commands", { permissions: "write" });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv: ["printf", "ok"],
    });
    const error = await errorOf(server, "work.command.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "command", projectId: project.id });
    expect(error.message).toContain("not allowed to run commands");
  });

  test("a project with no default uses its first profile", async () => {
    const project = await registeredProject("First profile", {
      permissions: "write",
      default: false,
    });
    const { server } = fakeCore();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    const decided = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(decided).toMatchObject({
      decision: "approve",
      applied: true,
      path: "notes.md",
    });
    expect(await readFile(join(project.root, "notes.md"), "utf8")).toBe("# Notes\n");
  });
});

describe("proposal TTL", () => {
  test("a write proposed before the window is refused and dropped", async () => {
    const project = await registeredProject("Stale crew");
    let clock = 1_000;
    const { server } = fakeCore({ now: () => clock });

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    clock += PROPOSAL_TTL_MS + 1;

    const error = await errorOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("expired");
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);

    // Consumed by the refusal: a second decide is the "no pending proposal" one.
    const again = await errorOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(again.message).toContain("no pending write proposal");
  });

  test("a proposal inside the window still decides", async () => {
    const project = await registeredProject("Fresh crew");
    let clock = 5_000;
    const { server } = fakeCore({ now: () => clock });

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    clock += PROPOSAL_TTL_MS - 1;
    const decided = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(decided.applied).toBe(true);
    expect(existsSync(join(project.root, "notes.md"))).toBe(true);
  });

  test("the approvals list hides an expired proposal", async () => {
    const project = await registeredProject("Listed crew");
    let clock = 9_000;
    const { server } = fakeCore({ now: () => clock });

    await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    const fresh = await resultOf(server, "work.approvals.list", { projectId: project.id });
    expect((fresh.writes as unknown[]).length).toBe(1);

    clock += PROPOSAL_TTL_MS + 1;
    const stale = await resultOf(server, "work.approvals.list", { projectId: project.id });
    expect(stale.writes).toEqual([]);
  });

  test("a command proposal expires the same way", async () => {
    const project = await registeredProject("Stale command crew", { permissions: "commands" });
    let clock = 2_000;
    const { server } = fakeCore({ now: () => clock });

    const proposed = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv: ["printf", "ok"],
    });
    clock += PROPOSAL_TTL_MS + 1;
    const error = await errorOf(server, "work.command.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(error.message).toContain("expired");
    expect(error.data).toMatchObject({ kind: "command" });
  });
});

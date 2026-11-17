/**
 * `work.agent.save` / `work.agent.delete` / `work.defaultAgent` validation.
 *
 * Every case here uses the injected boot seam with a workspace root that does
 * not exist, so nothing is written and no project is needed. The shape checks run
 * before boot, and the "unknown project" case proves the typed error path without
 * touching disk. The real create/update/delete round trip is covered by
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
import {
  MAX_AGENT_NAME_CHARS,
  MAX_TOOL_CALLS,
  MIN_TOOL_CALLS,
  forSwarm,
  type AgentProfile,
} from "../../src/services/work/agents";

const ABSENT_ROOT = join(tmpdir(), "lockedin-unit-work-agents-absent");

/**
 * The minimal service surface these methods touch.
 *
 * `paths.workProjects` points at a folder that does not exist, so
 * `loadProjectMeta` fails with its "not registered" path error — exactly the
 * unknown-project shape, with no fixture and no writes.
 */
function fakeServices(): CoreServices {
  return {
    workspace: {
      root: ABSENT_ROOT,
      paths: {
        schoolSessions: join(ABSENT_ROOT, "school", "sessions"),
        workProjects: join(ABSENT_ROOT, "work", "projects"),
      },
    },
    settings: {
      chatModel: "",
      dataDir: join(ABSENT_ROOT, "data"),
      historyLimit: 20,
    },
  } as unknown as CoreServices;
}

/** A core whose boot resolves to `services`, counting how often it is called. */
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

/** A save call with a valid agent, so only the field under test is invalid. */
function validAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Reviewer",
    role: "reviewer",
    instructions: "Review only.",
    model: "",
    maxToolCalls: MIN_TOOL_CALLS,
    allowedTools: ["read_file"],
    allowWrite: false,
    allowCommand: false,
    template: "",
    ...overrides,
  };
}

describe("work agent capabilities", () => {
  test("the handshake advertises the three methods", () => {
    expect(CAPABILITIES).toEqual(
      expect.arrayContaining(["work.agent.save", "work.agent.delete", "work.defaultAgent"]),
    );
  });
});

describe("work.agent.save validation", () => {
  test("a missing or blank project id is -32602 before boot", async () => {
    const { server, counter } = fakeCore();
    for (const projectId of [undefined, "", "   ", 3]) {
      const error = await errorOf(server, "work.agent.save", {
        ...(projectId === undefined ? {} : { projectId }),
        agent: validAgent(),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("project id");
    }
    // Shape failures never reach the workspace.
    expect(counter.calls).toBe(0);
  });

  test("the agent must be an object", async () => {
    const { server, counter } = fakeCore();
    for (const agent of [undefined, "reviewer", 3, ["reviewer"], null]) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("agent object");
    }
    expect(counter.calls).toBe(0);
  });

  test("creating requires a non-empty name, capped at the service's maximum", async () => {
    const { server, counter } = fakeCore();
    for (const agent of [{}, { name: "" }, { name: "   " }, { name: 3 }]) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("name");
    }

    const tooLong = await errorOf(server, "work.agent.save", {
      projectId: "my-app-4f2a1c",
      agent: validAgent({ name: "x".repeat(MAX_AGENT_NAME_CHARS + 1) }),
    });
    expect(tooLong.code).toBe(-32602);
    expect(tooLong.message).toContain(String(MAX_AGENT_NAME_CHARS));
    expect(counter.calls).toBe(0);
  });

  test("an update may omit the name but still refuses a blank one", async () => {
    const { server } = fakeCore();
    // An id without a name is a valid update shape; it reaches the workspace and
    // fails as an unknown project, not as bad params.
    const update = await errorOf(server, "work.agent.save", {
      projectId: "my-app-4f2a1c",
      agent: { id: "reviewer-9ab12c", model: "openai/gpt-4.1-mini" },
    });
    expect(update.code).toBe(BOOT_FAILED);

    const blank = await errorOf(server, "work.agent.save", {
      projectId: "my-app-4f2a1c",
      agent: { id: "reviewer-9ab12c", name: "  " },
    });
    expect(blank.code).toBe(-32602);
    expect(blank.message).toContain("name");
  });

  test("an id must be one folder-safe agent id", async () => {
    const { server } = fakeCore();
    for (const id of ["", "   ", "Reviewer", "reviewer 9ab12c", "../escape", "-leading", 7]) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent: validAgent({ id }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("agent.id");
    }
  });

  test("maxToolCalls is a whole number inside the service's bound", async () => {
    const { server } = fakeCore();
    for (const maxToolCalls of [0, MAX_TOOL_CALLS + 1, 1.5, -1, "8", Number.NaN]) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent: validAgent({ maxToolCalls }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("maxToolCalls");
      expect(error.message).toContain(String(MAX_TOOL_CALLS));
    }
  });

  test("allowedTools is an array of non-empty strings", async () => {
    const { server } = fakeCore();
    for (const allowedTools of ["read_file", [""], [3], ["read_file", "  "]]) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent: validAgent({ allowedTools }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("allowedTools");
    }
  });

  test("the capability flags and text fields must have their documented type", async () => {
    const { server } = fakeCore();
    for (const [field, value] of [
      ["allowWrite", "true"],
      ["allowCommand", 1],
      ["role", 3],
      ["instructions", null],
      ["model", []],
      ["template", {}],
    ] as const) {
      const error = await errorOf(server, "work.agent.save", {
        projectId: "my-app-4f2a1c",
        agent: validAgent({ [field]: value }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain(field);
    }
  });

  test("an unknown project is a typed -32000 project error", async () => {
    const { server } = fakeCore();
    const response = await ask(server, "work.agent.save", {
      projectId: "my-app-4f2a1c",
      agent: validAgent(),
    });
    if (!("error" in response)) throw new Error("an unknown project must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "project",
      projectId: "my-app-4f2a1c",
    });
  });
});

describe("work.agent.delete validation", () => {
  test("requires a project id and an agent id", async () => {
    const { server, counter } = fakeCore();
    const noProject = await errorOf(server, "work.agent.delete", {
      agentId: "reviewer-9ab12c",
    });
    expect(noProject.code).toBe(-32602);
    expect(noProject.message).toContain("project id");

    for (const agentId of [undefined, "", "   ", 7]) {
      const error = await errorOf(server, "work.agent.delete", {
        projectId: "my-app-4f2a1c",
        ...(agentId === undefined ? {} : { agentId }),
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("agent id");
    }
    expect(counter.calls).toBe(0);
  });

  test("an unknown project is the project error shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "work.agent.delete", {
      projectId: "my-app-4f2a1c",
      agentId: "reviewer-9ab12c",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "project", projectId: "my-app-4f2a1c" });
  });
});

describe("work.defaultAgent validation", () => {
  test("omitting or nulling agentId is a valid clear request", async () => {
    const { server, counter } = fakeCore();
    for (const params of [
      { projectId: "my-app-4f2a1c" },
      { projectId: "my-app-4f2a1c", agentId: null },
    ]) {
      const error = await errorOf(server, "work.defaultAgent", params);
      // Shape is accepted; the absent project is what stops it.
      expect(error.code).toBe(BOOT_FAILED);
      expect(error.data).toMatchObject({ kind: "project" });
    }
    expect(counter.calls).toBe(1);
  });

  test("a blank or non-string agentId is -32602", async () => {
    const { server } = fakeCore();
    for (const agentId of ["", "   ", 7, {}]) {
      const error = await errorOf(server, "work.defaultAgent", {
        projectId: "my-app-4f2a1c",
        agentId,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("agentId");
    }
  });

  test("a missing project id is -32602", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "work.defaultAgent", { agentId: null });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("project id");
  });
});

describe("the swarm boundary", () => {
  test("a stored profile may ask for commands, but a worker copy never gets them", () => {
    // `work.agent.save` stores what the user asked for. The product rule
    // "swarm workers never inherit command access" is applied when a profile
    // crosses into a swarm, so no save needs to rewrite the flags.
    const stored: AgentProfile = {
      id: "implementer-9ab12c",
      name: "Implementer",
      role: "builder",
      instructions: "Change the code.",
      model: "",
      maxToolCalls: 8,
      allowedTools: ["list_files", "read_file", "search_files"],
      allowWrite: true,
      allowCommand: true,
      template: "",
    };

    const worker = forSwarm(stored);
    expect(worker.allowWrite).toBe(false);
    expect(worker.allowCommand).toBe(false);
    // The saved profile is a value; the narrowed copy did not mutate it.
    expect(stored.allowWrite).toBe(true);
    expect(stored.allowCommand).toBe(true);
    expect(worker.allowedTools).toEqual(["list_files", "read_file", "search_files"]);
  });
});

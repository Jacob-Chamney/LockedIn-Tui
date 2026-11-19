/**
 * The core bridge over a real workspace.
 *
 * Every case creates a throwaway workspace and data directory with the real
 * storage layer, boots the real composition root (no model configured, so no
 * provider is contacted) and drives the JSON-RPC method table. Nothing here
 * reads the user's home directory or the network; `provider.list` only asks the
 * keychain whether an entry exists, and the test never asserts its contents.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boot } from "../../src/app/boot";
import { runGoalAction } from "../../src/app/actions/archive";
import { AWARDS_FILE } from "../../src/app/actions/achievements";
import { ACHIEVEMENTS } from "../../src/domain/achievements";
import {
  createPluginRuntime,
  mergeToolSources,
  type PluginRuntime,
} from "../../src/app/actions/plugins";
import { openFolderArchive } from "../../src/archive/folder";
import type { ArchiveBackend } from "../../src/archive/types";
import {
  createProject,
  createProjectAgent,
  makeAgentId,
  makeProjectId,
  setProjectDefaultAgent,
  type ChatToolSource,
} from "../../src/app/actions/projects";
import { createSkillChat, createSkillCourse } from "../../src/app/actions/skills";
import type { ChatController } from "../../src/app/chat-controller";
import type { ChatRequest, ChatService } from "../../src/llm/chat";
import type { McpHost } from "../../src/mcp/stdio";
import type { McpTool } from "../../src/mcp/types";
import { ok, type Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { createLockInSession } from "../../src/services/lockin/create";
import { BLOCKED_COPY } from "../../src/services/lockin/picker";
import { listZip } from "../../src/services/lockin/zip";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { applyTransition } from "../../src/services/skills/progress";
import { gatherSources } from "../../src/services/skills/gather";
import { READ_ONLY_TOOL_NAMES } from "../../src/services/work/scope";
import type { ActivityRecord } from "../../src/services/work/activity";
import type { SwarmBoard } from "../../src/services/work/swarm";
import { patchConfig } from "../../src/storage/config";
import type { PluginCommand, PluginPolicyCell } from "../../src/storage/config-schema";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreNotification,
  type CoreServer,
  DECISION_LOCAL_MODEL_REASON,
  DECISION_RULES_ONLY_REFUSAL,
  type DecisionSettings,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type KeybindWrite,
  type KnowledgeHit,
  type KnowledgeTopicGroup,
  type ThemeTokens,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

/** Fixed clock so range boundaries and session dates are deterministic. */
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
  base = await mkdtemp(join(TEMP_BASE, "server-data-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  workspace = unwrap(await createWorkspace(workspaceRoot, { dataDir }));
});

afterEach(async () => {
  await removeTemp(base);
});

/** A core wired to the real boot, pointed at this test's directories. */
function core(root: string = workspaceRoot): CoreServer {
  return createCoreServer({
    boot: () => boot({ workspaceRoot: root, dataDir, env: {}, now: NOW }),
  });
}

/**
 * Turn the global Work opt-in on **before boot**.
 *
 * The gate reads configuration, so this is the real read path: `patchConfig`
 * writes `[work]`, and the next boot loads it. Tests that only need the outer
 * gate open use this; the setter itself is covered by
 * `tests/unit/server-work-optin.test.ts`.
 */
async function allowWorkOnDisk(
  flags: { write?: boolean; command?: boolean } = { write: true },
): Promise<void> {
  unwrap(
    await patchConfig(workspace.paths, {
      work: {
        allow_write: flags.write === true,
        allow_command: flags.command === true,
      },
    }),
  );
}

/**
 * A core wired to the real boot with one injected completion.
 *
 * `regenerateSessionSteps` is otherwise provider-bound, so the seam is replaced
 * after boot: no network, no key, no model configured.
 */
function generatingCore(generate: (prompt: string) => Promise<string>): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      return { ok: true, value: { ...booted.value, generate } };
    },
  });
}

/**
 * A core wired to the real boot and the real `main.ts` `savePolicy` wrapper.
 *
 * `main.ts` is the process entry point (it starts readline and writes stdout),
 * so it is not importable from a test; this mirrors its wrapper exactly — one
 * `patchConfig` call, `updateConfig`, then the stored matrix — while leaving the
 * protocol as the thing under test.
 */
function policyCore(root: string = workspaceRoot): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot: root, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      return {
        ok: true,
        value: {
          ...booted.value,
          savePolicy: async (input: {
            command: PluginCommand;
            server: string;
            value: PluginPolicyCell;
          }) => {
            const written = await patchConfig(booted.value.workspace.paths, {
              plugins: { policy: { [input.command]: { [input.server]: input.value } } },
            });
            if (!written.ok) {
              return { ok: false as const, error: { message: written.error.message } };
            }
            await booted.value.updateConfig(written.value.config);
            return { ok: true as const, value: written.value.config.plugins.policy };
          },
        },
      };
    },
  });
}

/**
 * A core wired to the real boot and the real `main.ts` `saveKeybinds` wrapper.
 *
 * `main.ts` is the process entry point (it starts readline and writes stdout),
 * so it is not importable from a test; this mirrors its wrapper exactly — one
 * `patchConfig` for the two keybind tables, an empty binding for a cleared
 * action, `updateConfig`, then the stored maps — while leaving the protocol as
 * the thing under test.
 */
function keybindCore(root: string = workspaceRoot): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot: root, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      return {
        ok: true,
        value: {
          ...booted.value,
          saveKeybinds: async (input: KeybindWrite) => {
            const keybinds = { ...input.keybinds };
            const fixedKeybinds = { ...input.fixedKeybinds };
            for (const action of input.cleared.keybinds) keybinds[action] = "";
            for (const action of input.cleared.fixedKeybinds) fixedKeybinds[action] = "";
            const written = await patchConfig(booted.value.workspace.paths, {
              ui: { keybinds, fixed_keybinds: fixedKeybinds },
            });
            if (!written.ok) {
              return { ok: false as const, error: { message: written.error.message } };
            }
            await booted.value.updateConfig(written.value.config);
            return {
              ok: true as const,
              value: {
                keybinds: written.value.config.ui.keybinds,
                fixedKeybinds: written.value.config.ui.fixed_keybinds,
              },
            };
          },
        },
      };
    },
  });
}

/**
 * A core wired to the real boot and the real `main.ts` `saveDecision` wrapper.
 *
 * `main.ts` is the process entry point (it starts readline and writes stdout),
 * so it is not importable from a test; this mirrors its wrapper exactly — one
 * `patchConfig` writing both `[decision_layer]` values, `updateConfig`, then the
 * stored values — while leaving the protocol as the thing under test.
 */
function decisionCore(root: string = workspaceRoot): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot: root, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      return {
        ok: true,
        value: {
          ...booted.value,
          saveDecision: async (input: DecisionSettings) => {
            const written = await patchConfig(booted.value.workspace.paths, {
              decision_layer: { enabled: input.enabled, model: input.model },
            });
            if (!written.ok) {
              return { ok: false as const, error: { message: written.error.message } };
            }
            await booted.value.updateConfig(written.value.config);
            return {
              ok: true as const,
              value: {
                enabled: written.value.config.decision_layer.enabled,
                model: written.value.config.decision_layer.model,
              },
            };
          },
        },
      };
    },
  });
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

/**
 * A core wired to the real boot and the real `main.ts` `saveThemeTokens` wrapper.
 *
 * Mirrors its wrapper: one `patchConfig` of `[ui.custom_theme]`, an empty
 * sentinel for a token the request dropped, `updateConfig`, then the visible
 * map. `main.ts` itself is the process entry point and is not importable.
 */
function themeCore(root: string = workspaceRoot): CoreServer {
  return createCoreServer({
    boot: async () => {
      const booted = await boot({ workspaceRoot: root, dataDir, env: {}, now: NOW });
      if (!booted.ok) return booted;
      let stored: ThemeTokens = { ...booted.value.config.ui.custom_theme };
      const visible = (tokens: ThemeTokens): ThemeTokens => {
        const out: ThemeTokens = {};
        for (const [token, value] of Object.entries(tokens)) {
          if (typeof value === "string" && value.trim() !== "") out[token] = value;
        }
        return out;
      };
      return {
        ok: true,
        value: {
          ...booted.value,
          saveThemeTokens: async (tokens: ThemeTokens) => {
            const patch: ThemeTokens = {};
            for (const token of Object.keys(stored)) patch[token] = "";
            for (const [token, value] of Object.entries(tokens)) patch[token] = value;
            const written = await patchConfig(booted.value.workspace.paths, {
              ui: { custom_theme: patch },
            });
            if (!written.ok) {
              return { ok: false as const, error: { message: written.error.message } };
            }
            await booted.value.updateConfig(written.value.config);
            stored = visible(written.value.config.ui.custom_theme);
            return { ok: true as const, value: stored };
          },
        },
      };
    },
  });
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

describe("workspace.info", () => {
  test("reports the booted workspace, its data directory and its model", async () => {
    expect(await resultOf(core(), "workspace.info")).toEqual({
      path: workspaceRoot,
      dataDir,
      configured: false,
      model: "",
      provider: "",
    });
  });
});

describe("settings.get", () => {
  test("returns the booted settings, including the documented defaults", async () => {
    const settings = await resultOf(core(), "settings.get");
    expect(settings).toMatchObject({
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16_000,
      budgetUsd: 0,
      period: "day",
      dataDir,
      archiveBackend: "folder",
      pluginServers: [],
      historyLimit: 20,
    });
  });
});

describe("theme.custom", () => {
  test("a fresh workspace has no overrides; the palette catalogue is the shell's", async () => {
    const server = themeCore();
    expect(await resultOf(server, "theme.custom.get")).toEqual({ tokens: {} });
    // No colour was invented in the file.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).not.toMatch(/background = "#/);
  });

  test("tokens round-trip through config.toml and a restart, and {} clears them", async () => {
    const server = themeCore();
    expect(
      await resultOf(server, "theme.custom.set", {
        tokens: { background: "#101820", primary: "#AABBCC" },
      }),
    ).toEqual({ tokens: { background: "#101820", primary: "#AABBCC" } });
    expect(await resultOf(server, "theme.custom.get")).toEqual({
      tokens: { background: "#101820", primary: "#AABBCC" },
    });

    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toMatch(/\[ui\.custom_theme\][^[]*background = "#101820"/s);

    // The config file is the truth: a fresh core reads the same map.
    expect(await resultOf(themeCore(), "theme.custom.get")).toEqual({
      tokens: { background: "#101820", primary: "#AABBCC" },
    });

    expect(await resultOf(server, "theme.custom.set", { tokens: {} })).toEqual({ tokens: {} });
    expect(await resultOf(themeCore(), "theme.custom.get")).toEqual({ tokens: {} });
  });

  test("an unknown token or a bad colour is -32602 and leaves the file alone", async () => {
    const server = themeCore();
    // Boot once so the config file exists, then prove the refusal writes nothing.
    expect(await resultOf(server, "theme.custom.get")).toEqual({ tokens: {} });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    for (const tokens of [
      { background: "#101820", red: "#FF0000" },
      { background: "crimson" },
      { background: "#12345" },
    ]) {
      const response = await ask(server, "theme.custom.set", { tokens });
      if (!("error" in response)) throw new Error("a bad token must be refused");
      expect(response.error.code).toBe(-32602);
    }
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
    expect(await resultOf(server, "theme.custom.get")).toEqual({ tokens: {} });
  });
});

describe("provider.list", () => {
  test("returns the catalogue with no provider linked on a fresh workspace", async () => {
    const listed = (await resultOf(core(), "provider.list")) as {
      providers: Array<{ id: string; label: string; keyRequired: boolean; linked: boolean }>;
      linked: string[];
    };
    expect(listed.providers.map((entry) => entry.id)).toEqual([
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "opencode-zen",
      "opencode-go",
      "custom",
    ]);
    // Linked state depends on the machine's keychain, which this test must not
    // assert: every row is boolean and every linked id names a real row.
    expect(listed.providers.every((entry) => typeof entry.linked === "boolean")).toBe(true);
    expect(Array.isArray(listed.linked)).toBe(true);
    expect(
      listed.linked.every((id) => listed.providers.some((entry) => entry.id === id)),
    ).toBe(true);
    expect(listed.providers.find((entry) => entry.id === "openai")?.label).toBe("OpenAI");
  });
});

describe("session.list", () => {
  test("an empty workspace is an empty list", async () => {
    expect(await resultOf(core(), "session.list")).toEqual({ sessions: [] });
  });

  test("rows carry what the manager renders", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    await writeFile(
      join(created.folder, SESSION_FILES.steps),
      "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n",
    );

    const result = await resultOf(core(), "session.list");
    expect(result.sessions).toEqual([
      {
        id: created.session.id,
        name: "Physics — Unit 4",
        date: "2026-11-01T09:00:00.000Z",
        sources: 0,
        steps: { done: 1, total: 2 },
        archived: false,
      },
    ]);
  });

  test("query filters by id and name", async () => {
    unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study.",
      }),
    );
    const server = core();

    const hit = await resultOf(server, "session.list", { query: "physics" });
    expect(hit.sessions).toHaveLength(1);

    expect(await resultOf(server, "session.list", { query: "chemistry" })).toEqual({ sessions: [] });
  });
});

describe("session.open", () => {
  test("returns the prompt, sources and steps from the session folder", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
        files: [join(inputs, "lecture-4.md")],
      }),
    );
    const steps =
      "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n";
    await writeFile(join(created.folder, SESSION_FILES.steps), steps);

    const opened = (await resultOf(core(), "session.open", { id: created.session.id })) as {
      session: {
        id: string;
        name: string;
        created: string;
        archived: boolean;
        prompt: string;
        sources: Array<{
          name: string;
          originalPath: string;
          storedPath: string;
          hash: string;
          kind: string;
        }>;
        steps: { done: number; total: number; exists: boolean; markdown: string };
      };
    };

    expect(opened.session).toMatchObject({
      id: created.session.id,
      name: "Physics — Unit 4",
      created: "2026-11-01T09:00:00.000Z",
      archived: false,
      prompt: "Study the boundary conditions.",
    });
    expect(opened.session.sources).toHaveLength(1);
    expect(opened.session.sources[0]).toMatchObject({
      name: "lecture-4.md",
      originalPath: join(inputs, "lecture-4.md"),
      hash: created.session.sources[0]!.hash,
      kind: "markdown",
    });
    // Stored paths are session-relative; the shell never receives one it can use.
    expect(opened.session.sources[0]!.storedPath.startsWith("sources/")).toBe(true);
    expect(opened.session.steps).toEqual({ done: 1, total: 2, exists: true, markdown: steps });
  });

  test("an unknown session is a typed -32000 error", async () => {
    const response = await ask(core(), "session.open", { id: "2026-12-31-0000-missing" });
    if (!("error" in response)) throw new Error("an unknown session must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "session",
      id: "2026-12-31-0000-missing",
    });
  });
});

describe("session.coverage", () => {
  type Coverage = {
    sources: Array<{
      hash: string;
      name: string;
      originalPath: string;
      count: number;
      documents: string[];
      firstLine: string | null;
      referenced: boolean;
      fromMemoryOnly: boolean;
    }>;
    unreferenced: Array<{ name: string; referenced: boolean }>;
    total: number;
    referencedCount: number;
  };

  /** Digest of every relative path and its bytes under one folder. */
  async function hashTree(root: string): Promise<string> {
    const hash = createHash("sha256");
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        hash.update(path.slice(root.length));
        if (entry.isDirectory()) await walk(path);
        else hash.update(await readFile(path));
      }
    };
    await walk(root);
    return hash.digest("hex");
  }

  test("a source named by the steps is referenced and the other is a gap", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n");
    await writeFile(join(inputs, "reading-notes.md"), "# Reading notes\n\nA summary.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
        files: [join(inputs, "lecture-4.md"), join(inputs, "reading-notes.md")],
      }),
    );
    await writeFile(
      join(created.folder, SESSION_FILES.steps),
      "# Assignment steps\n\n> 0 of 1 steps done\n\n- [ ] Read lecture-4.md and summarise the limits\n",
    );

    const result = (await resultOf(core(), "session.coverage", {
      id: created.session.id,
    })) as { coverage: Coverage };

    expect(result.coverage.total).toBe(2);
    expect(result.coverage.referencedCount).toBe(1);
    // Count descending: the referenced source sorts first.
    expect(result.coverage.sources.map((entry) => entry.name)).toEqual([
      "lecture-4.md",
      "reading-notes.md",
    ]);

    const cited = result.coverage.sources[0]!;
    expect(cited).toMatchObject({
      name: "lecture-4.md",
      referenced: true,
      documents: ["steps"],
      fromMemoryOnly: false,
    });
    expect(cited.count).toBeGreaterThan(0);
    expect(cited.firstLine).toContain("lecture-4.md");

    const gap = result.coverage.sources[1]!;
    expect(gap).toMatchObject({ name: "reading-notes.md", referenced: false, documents: [] });
    expect(gap.count).toBe(0);
    expect(gap.firstLine).toBeNull();
    expect(result.coverage.unreferenced.map((entry) => entry.name)).toEqual(["reading-notes.md"]);
  });

  test("a session with no sources is a valid empty report", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Empty",
        prompt: "Study.",
        steps: false,
      }),
    );

    const result = (await resultOf(core(), "session.coverage", {
      id: created.session.id,
    })) as { coverage: Coverage };

    expect(result.coverage).toEqual({
      sources: [],
      unreferenced: [],
      total: 0,
      referencedCount: 0,
    });
  });

  test("memory mentions stay labelled and never become a source", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study.",
        files: [join(inputs, "lecture-4.md")],
        steps: false,
      }),
    );
    await writeFile(
      join(created.folder, SESSION_FILES.memory),
      "# Key points\n\n- lecture-4.md sets the integral limits\n",
    );

    const result = (await resultOf(core(), "session.coverage", {
      id: created.session.id,
    })) as { coverage: Coverage };

    expect(result.coverage.total).toBe(1);
    expect(result.coverage.referencedCount).toBe(1);
    expect(result.coverage.sources[0]).toMatchObject({
      name: "lecture-4.md",
      referenced: true,
      documents: ["memory"],
      fromMemoryOnly: true,
    });
    // Memory is a document, never a source row of its own.
    expect(result.coverage.sources.map((entry) => entry.name)).toEqual(["lecture-4.md"]);
  });

  test("reading coverage writes nothing to the session", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study.",
        files: [join(inputs, "lecture-4.md")],
        steps: false,
      }),
    );

    const before = await hashTree(created.folder);
    await resultOf(core(), "session.coverage", { id: created.session.id });
    expect(await hashTree(created.folder)).toBe(before);
  });
});

describe("session.create", () => {
  test("creates from a written prompt and a chosen file, and the prompt, source and steps flag survive", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, "lecture-4.md");
    await writeFile(lecture, "# Unit 4\n\nBoundary conditions.\n");

    const created = await resultOf(core(), "session.create", {
      name: "Physics — Unit 4",
      prompt: "Study the boundary conditions.",
      files: [lecture],
      steps: false,
    });
    // The shell gets an id and a name, then calls `session.open` for the detail.
    expect(Object.keys(created).sort()).toEqual(["id", "name"]);
    expect(created.name).toBe("Physics — Unit 4");
    const id = created.id as string;
    expect(existsSync(join(workspaceRoot, "school", "sessions", id))).toBe(true);

    const opened = (await resultOf(core(), "session.open", { id })) as {
      session: {
        id: string;
        name: string;
        prompt: string;
        sources: Array<{ name: string; storedPath: string; kind: string }>;
        steps: { done: number; total: number; exists: boolean; markdown: string };
      };
    };
    expect(opened.session).toMatchObject({ id, name: "Physics — Unit 4" });
    expect(opened.session.prompt).toBe("Study the boundary conditions.");
    expect(opened.session.sources).toHaveLength(1);
    expect(opened.session.sources[0]).toMatchObject({
      name: "lecture-4.md",
      kind: "markdown",
    });
    expect(opened.session.sources[0]!.storedPath.startsWith("sources/")).toBe(true);
    // `steps: false` records no steps: the reader gets the empty state, once.
    expect(opened.session.steps).toEqual({ done: 0, total: 0, exists: false, markdown: "" });
    // The user's original is copied, never moved.
    expect(existsSync(lecture)).toBe(true);
  });

  test("no source, prompt or instructions file is a typed -32000 refusal that writes nothing", async () => {
    const response = await ask(core(), "session.create", { name: "Physics — Unit 4" });
    if (!("error" in response)) throw new Error("a create without inputs must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    // The service's blocked copy is preserved; the kind names the command.
    expect(response.error.data).toEqual({ kind: "session-create", message: BLOCKED_COPY });

    expect(await resultOf(core(), "session.list")).toEqual({ sessions: [] });
  });

  test("two sessions with the same name get distinct ids", async () => {
    const server = core();
    const first = await resultOf(server, "session.create", {
      name: "Physics — Unit 4",
      prompt: "First pass.",
    });
    const second = await resultOf(server, "session.create", {
      name: "Physics — Unit 4",
      prompt: "Second pass.",
    });
    expect(second.id).not.toBe(first.id);

    // Both are real folders with their own prompt, not one overwritten session.
    for (const [id, prompt] of [
      [first.id, "First pass."],
      [second.id, "Second pass."],
    ] as const) {
      const opened = (await resultOf(server, "session.open", { id })) as {
        session: { id: string; prompt: string };
      };
      expect(opened.session).toMatchObject({ id, prompt });
    }
  });
});

describe("session.toggleStep", () => {
  /** A two-step file whose progress line matches its items. */
  const ORIGINAL =
    "# Assignment steps\n\n> 1 of 2 steps done\n\n## Understand\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n";

  test("rewrites only the bracket and the progress line, and toggling back restores the bytes", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    const stepsPath = join(created.folder, SESSION_FILES.steps);
    await writeFile(stepsPath, ORIGINAL);
    const server = core();

    const toggled = (await resultOf(server, "session.toggleStep", {
      id: created.session.id,
      index: 1,
    })) as {
      index: number;
      checked: boolean;
      done: number;
      total: number;
      markdown: string;
      hash: string;
    };

    expect(toggled).toMatchObject({ index: 1, checked: true, done: 2, total: 2 });

    // The file is the truth: the reply is the whole new document.
    await expect(readFile(stepsPath, "utf8")).resolves.toBe(toggled.markdown);

    // Exactly two lines moved: the toggled checkbox and the progress count.
    const before = ORIGINAL.split("\n");
    const after = toggled.markdown.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before
      .map((line, at) => (line === after[at] ? -1 : at))
      .filter((at) => at >= 0);
    expect(changed).toEqual([2, 7]);
    expect(after[2]).toBe("> 2 of 2 steps done");
    expect(after[7]).toBe("- [x] Derive the energy balance");

    // A stable hash of the bytes the shell is about to render.
    expect(toggled.hash).toBe(
      `sha256:${createHash("sha256").update(toggled.markdown).digest("hex")}`,
    );
    expect(toggled.hash.startsWith("sha256:")).toBe(true);

    // Toggling the same step again returns the original bytes, byte for byte.
    const restored = (await resultOf(server, "session.toggleStep", {
      id: created.session.id,
      index: 1,
    })) as { checked: boolean; done: number; total: number; markdown: string; hash: string };
    expect(restored).toMatchObject({ checked: false, done: 1, total: 2, markdown: ORIGINAL });
    await expect(readFile(stepsPath, "utf8")).resolves.toBe(ORIGINAL);
    expect(restored.hash).toBe(`sha256:${createHash("sha256").update(ORIGINAL).digest("hex")}`);
  });

  test("an out-of-range index is a typed steps error and leaves the file untouched", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study.",
      }),
    );
    const stepsPath = join(created.folder, SESSION_FILES.steps);
    await writeFile(stepsPath, ORIGINAL);

    const response = await ask(core(), "session.toggleStep", {
      id: created.session.id,
      index: 99,
    });
    if (!("error" in response)) throw new Error("an out-of-range index must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "steps", id: created.session.id });
    expect(response.error.message).toContain("99");

    await expect(readFile(stepsPath, "utf8")).resolves.toBe(ORIGINAL);
  });

  test("a session with no steps file is a typed steps error", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "No steps yet",
        prompt: "Study.",
        steps: false,
      }),
    );

    const response = await ask(core(), "session.toggleStep", {
      id: created.session.id,
      index: 0,
    });
    if (!("error" in response)) throw new Error("a session without steps must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "steps", id: created.session.id });
    expect(response.error.message).toContain("steps");
    // Nothing was created by the refusal.
    expect(existsSync(join(created.folder, SESSION_FILES.steps))).toBe(false);
  });
});

describe("session.generateSteps", () => {
  /** Four concrete steps, so the service has no broad step to refine. */
  const PLAN = JSON.stringify({
    phases: [
      {
        phase: "Understand",
        items: [
          "Read section 4.2 and state the mitochondrion's function",
          "List the four stages of cellular respiration in lecture-4.md",
          "State the ATP yield of the electron transport chain in section 4.2",
          "Trace where NADH hands its electrons to complex I",
        ],
      },
    ],
  });

  const SOURCE = "# Unit 4\n\nThe mitochondrion produces ATP.\n";

  /** A session whose only source is a readable Markdown file, with no steps. */
  async function biologySession(): Promise<{ id: string; folder: string }> {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, "lecture-4.md");
    await writeFile(lecture, SOURCE);
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Biology — Mitochondria",
        prompt: "Study the mitochondrion.",
        files: [lecture],
        steps: false,
      }),
    );
    return { id: created.session.id, folder: created.folder };
  }

  test("builds the file from the session sources and reports nothing kept", async () => {
    const session = await biologySession();
    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return PLAN;
    });

    const generated = (await resultOf(server, "session.generateSteps", { id: session.id })) as {
      markdown: string;
      kept: number;
      lost: number;
    };

    // Nothing was checked before, so the merge kept and lost nothing.
    expect(generated).toMatchObject({ kept: 0, lost: 0 });
    expect(generated.markdown).toContain("## Understand");
    expect(generated.markdown).toContain(
      "- [ ] Read section 4.2 and state the mitochondrion's function",
    );
    // The progress line is computed from the plan, not inherited.
    expect(generated.markdown.split("\n")[2]).toBe("> 0 of 4 steps done");

    // The file is the truth: the reply and the bytes agree, byte for byte.
    await expect(readFile(join(session.folder, SESSION_FILES.steps), "utf8")).resolves.toBe(
      generated.markdown,
    );

    // The completion received the session's own source text, not a summary.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The mitochondrion produces ATP.");

    // The session reader sees the same document without a second read.
    const opened = (await resultOf(server, "session.open", { id: session.id })) as {
      session: { steps: { done: number; total: number; exists: boolean; markdown: string } };
    };
    expect(opened.session.steps).toEqual({
      done: 0,
      total: 4,
      exists: true,
      markdown: generated.markdown,
    });
  });

  test("regeneration keeps a checked step whose exact text survives", async () => {
    const session = await biologySession();
    const previous = [
      "# Assignment steps",
      "",
      "> 1 of 3 steps done",
      "",
      "## Understand",
      "",
      "- [x] State the ATP yield of the electron transport chain in section 4.2",
      "- [ ] Read section 4.2 and state the mitochondrion's function",
      "- [ ] Trace where NADH hands its electrons to complex I",
      "",
    ].join("\n");
    await writeFile(join(session.folder, SESSION_FILES.steps), previous);
    const server = generatingCore(async () => PLAN);

    const generated = (await resultOf(server, "session.generateSteps", { id: session.id })) as {
      markdown: string;
      kept: number;
      lost: number;
    };

    // One checked step's text is in the fresh plan; nothing checked was dropped.
    expect(generated).toMatchObject({ kept: 1, lost: 0 });
    expect(generated.markdown).toContain(
      "- [x] State the ATP yield of the electron transport chain in section 4.2",
    );
    expect(generated.markdown).toContain("- [ ] List the four stages of cellular respiration");
    expect(generated.markdown.split("\n")[2]).toBe("> 1 of 4 steps done");
    await expect(readFile(join(session.folder, SESSION_FILES.steps), "utf8")).resolves.toBe(
      generated.markdown,
    );
  });

  test("a failed completion is one typed message and leaves the previous steps", async () => {
    const session = await biologySession();
    const previous =
      "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Keep me exactly as written\n- [ ] Do not touch this line\n";
    const stepsPath = join(session.folder, SESSION_FILES.steps);
    await writeFile(stepsPath, previous);
    const server = generatingCore(async () => {
      throw new Error("upstream overloaded at 503");
    });

    const response = await ask(server, "session.generateSteps", { id: session.id });
    if (!("error" in response)) throw new Error("a failed completion must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    // One actionable sentence from the service's failure policy, not raw JSON.
    expect(response.error.message).toContain("overloaded");
    expect(response.error.data).toMatchObject({ kind: "generation", id: session.id });

    // A failed generation writes nothing at all.
    await expect(readFile(stepsPath, "utf8")).resolves.toBe(previous);
  });

  test("a source that cannot be read is one typed message and writes nothing", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    // An unknown extension reads as UTF-8 text; these bytes are not valid UTF-8,
    // so the source is copied but cannot be turned into text.
    const binary = join(inputs, "scan.bin");
    await writeFile(binary, Uint8Array.from([0xff, 0xfe, 0x00]));
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Biology — Scanned",
        prompt: "Study the scan.",
        files: [binary],
        steps: false,
      }),
    );
    const stepsPath = join(created.folder, SESSION_FILES.steps);
    expect(existsSync(stepsPath)).toBe(false);
    const server = generatingCore(async () => PLAN);

    const response = await ask(server, "session.generateSteps", { id: created.session.id });
    if (!("error" in response)) throw new Error("an unreadable source must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toContain("scan.bin");
    expect(response.error.data).toMatchObject({
      kind: "generation",
      id: created.session.id,
    });

    // The blocking source is reported once and no partial plan is written.
    expect(existsSync(stepsPath)).toBe(false);
  });

  test("an unknown session is the session error shape, even with no model", async () => {
    const response = await ask(core(), "session.generateSteps", {
      id: "2026-12-31-0000-missing",
    });
    if (!("error" in response)) throw new Error("an unknown session must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "session", id: "2026-12-31-0000-missing" });
  });
});

describe("session.document", () => {
  const SOURCE = "# Unit 4\n\nThe mitochondrion produces ATP in the matrix.\n";

  /** A session whose only source is a readable Markdown file, with no steps. */
  async function biologySession(): Promise<{ id: string; folder: string }> {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, "lecture-4.md");
    await writeFile(lecture, SOURCE);
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Biology — Mitochondria",
        prompt: "Study the mitochondrion.",
        files: [lecture],
        steps: false,
      }),
    );
    return { id: created.session.id, folder: created.folder };
  }

  test("writes the done-when contract from the session sources", async () => {
    const session = await biologySession();
    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return "# Done when\n\n- [ ] State where ATP is produced.\n";
    });

    const document = (await resultOf(server, "session.document", {
      id: session.id,
      kind: "contract",
    })) as { text: string; name: string };

    expect(document).toEqual({
      text: "# Done when\n\n- [ ] State where ATP is produced.",
      name: SESSION_FILES.contract,
    });
    // The reply is the bytes on disk: trimmed text plus one newline.
    await expect(readFile(join(session.folder, SESSION_FILES.contract), "utf8")).resolves.toBe(
      `${document.text}\n`,
    );

    // The completion received the session's own source text.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The mitochondrion produces ATP in the matrix.");

    // A generated document is not a chat turn: no transcript is created.
    expect(existsSync(join(session.folder, SESSION_FILES.chat))).toBe(false);
  });

  test("writes the contradictions report", async () => {
    const session = await biologySession();
    const server = generatingCore(async () => "No substantive contradictions found.");

    const document = (await resultOf(server, "session.document", {
      id: session.id,
      kind: "contradictions",
    })) as { text: string; name: string };

    expect(document.name).toBe(SESSION_FILES.contradictions);
    await expect(
      readFile(join(session.folder, SESSION_FILES.contradictions), "utf8"),
    ).resolves.toBe(`${document.text}\n`);
  });

  test("check reviews one attempt and writes check.md", async () => {
    const session = await biologySession();
    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return "Right: the ATP yield. Gap: name the complex. What carries the electrons?";
    });

    const document = (await resultOf(server, "session.document", {
      id: session.id,
      kind: "check",
      attempt: "I said the yield is 30 ATP.",
    })) as { text: string; name: string };

    expect(document.name).toBe(SESSION_FILES.check);
    expect(document.text).toContain("Gap: name the complex.");
    await expect(readFile(join(session.folder, SESSION_FILES.check), "utf8")).resolves.toBe(
      `${document.text}\n`,
    );

    // The attempt reached the completion, so the review is about the learner's
    // own answer rather than a generic reading of the sources.
    expect(prompts[0]).toContain("Learner attempt:\nI said the yield is 30 ATP.");
    expect(existsSync(join(session.folder, SESSION_FILES.chat))).toBe(false);
  });

  test("a failed completion is one typed message and leaves the old document", async () => {
    const session = await biologySession();
    const contractPath = join(session.folder, SESSION_FILES.contract);
    const previous = "# Done when\n\n- [x] Keep me exactly as written\n";
    await writeFile(contractPath, previous);
    const server = generatingCore(async () => {
      throw new Error("upstream overloaded at 503");
    });

    const response = await ask(server, "session.document", {
      id: session.id,
      kind: "contract",
    });
    if (!("error" in response)) throw new Error("a failed completion must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toContain("overloaded");
    expect(response.error.data).toMatchObject({ kind: "generation", id: session.id });

    // The previous bytes survive; a document that never generated is not created.
    await expect(readFile(contractPath, "utf8")).resolves.toBe(previous);
    expect(existsSync(join(session.folder, SESSION_FILES.check))).toBe(false);
    expect((await readdir(session.folder)).filter((name) => name.startsWith(".check"))).toEqual([]);
  });

  test("with no model it is one Settings sentence and writes nothing", async () => {
    const session = await biologySession();
    const response = await ask(core(), "session.document", {
      id: session.id,
      kind: "contract",
    });
    if (!("error" in response)) throw new Error("a missing model must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe("link a model in Settings → Providers");
    expect(response.error.data).toEqual({
      kind: "generation",
      id: session.id,
      message: "link a model in Settings → Providers",
    });

    expect(existsSync(join(session.folder, SESSION_FILES.contract))).toBe(false);
  });

  test("an unknown session is the session error shape, and a bad kind is -32602", async () => {
    const server = core();
    const id = "2026-12-31-0000-missing";

    const unknown = await ask(server, "session.document", { id, kind: "contract" });
    if (!("error" in unknown)) throw new Error("an unknown session must be an error");
    expect(unknown.error.code).toBe(BOOT_FAILED);
    expect(unknown.error.retryable).toBe(false);
    expect(unknown.error.data).toMatchObject({ kind: "session", id });

    const badKind = await ask(server, "session.document", { id, kind: "summary" });
    if (!("error" in badKind)) throw new Error("an unknown kind must be refused");
    expect(badKind.error.code).toBe(-32602);
  });
});

describe("session.output.build and session.output.read", () => {
  const SOURCE = "# Unit 4\n\nThe mitochondrion produces ATP in the matrix.\n";

  /** Two valid guide sections; headings, questions and answers all cite the source. */
  const GUIDE = JSON.stringify({
    sections: [
      {
        heading: "Energy balance",
        question: "Where is ATP produced?",
        answer: "In the mitochondrial matrix.",
      },
      {
        heading: "Electron transport",
        question: "What does NADH donate?",
        answer: "Electrons to complex I.",
      },
    ],
  });

  /** Two cards, each with exactly four choices and one 0-based correct index. */
  const CARDS = JSON.stringify({
    cards: [
      {
        question: "Where is ATP produced?",
        answer: "The mitochondrial matrix.",
        choices: [
          "The cytoplasm",
          "The mitochondrial matrix",
          "The nucleus",
          "The Golgi apparatus",
        ],
        correct: 1,
      },
      {
        question: "What does NADH donate?",
        answer: "Electrons.",
        choices: ["Protons", "Electrons", "Oxygen", "ATP"],
        correct: 1,
      },
    ],
  });

  /** A session whose only source is a readable Markdown file, with no steps. */
  async function biologySession(): Promise<{ id: string; folder: string }> {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, "lecture-4.md");
    await writeFile(lecture, SOURCE);
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Biology — Mitochondria",
        prompt: "Study the mitochondrion.",
        files: [lecture],
        steps: false,
      }),
    );
    return { id: created.session.id, folder: created.folder };
  }

  function outputsFolder(id: string): string {
    return join(workspaceRoot, "school", "outputs", id);
  }

  test("builds a study guide and its answers from the session sources", async () => {
    const session = await biologySession();
    // An old output must not leak into the new prompt: a rebuild derives from
    // the sources, not from the previous document.
    await mkdir(outputsFolder(session.id), { recursive: true });
    await writeFile(join(outputsFolder(session.id), "study-guide.md"), "OLD GUIDE TEXT\n");

    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return GUIDE;
    });

    const built = (await resultOf(server, "session.output.build", {
      id: session.id,
      kind: "study-guide",
    })) as {
      kind: string;
      markdown: string;
      answers: string;
      files: Record<string, string>;
    };

    expect(built.kind).toBe("study-guide");
    expect(built.files).toEqual({
      guide: "study-guide.md",
      answers: "study-guide-answers.md",
    });

    // The guide is the document the shell renders, section by section.
    expect(built.markdown).toContain("# Study guide — Biology — Mitochondria");
    expect(built.markdown).toContain("> 0 of 2 sections reviewed");
    expect(built.markdown).toContain("## Energy balance\n\nWhere is ATP produced?\n\n- [ ] Reviewed");
    expect(built.markdown).toContain("## Electron transport");
    // The answer is not in the guide: revealing it must not rewrite the guide.
    expect(built.markdown).not.toContain("In the mitochondrial matrix.");
    expect(built.answers).toContain("# Study guide answers — Biology — Mitochondria");
    expect(built.answers).toContain("## Energy balance\n\nIn the mitochondrial matrix.");

    // The reply and the bytes on disk agree, file for file.
    await expect(
      readFile(join(outputsFolder(session.id), "study-guide.md"), "utf8"),
    ).resolves.toBe(built.markdown);
    await expect(
      readFile(join(outputsFolder(session.id), "study-guide-answers.md"), "utf8"),
    ).resolves.toBe(built.answers);

    // Exactly one model call, with the session's own source text and the old
    // output excluded.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The mitochondrion produces ATP in the matrix.");
    expect(prompts[0]).toContain('"sections"');
    expect(prompts[0]).not.toContain("OLD GUIDE TEXT");
    // A generated output is not a chat turn and not a source.
    expect(existsSync(join(session.folder, SESSION_FILES.chat))).toBe(false);
    expect(built.markdown).not.toContain("lecture-4.md\n\n#");
  });

  test("builds a flashcard deck with four choices and one correct answer", async () => {
    const session = await biologySession();
    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return CARDS;
    });

    const built = (await resultOf(server, "session.output.build", {
      id: session.id,
      kind: "flashcards",
    })) as { kind: string; markdown: string; files: Record<string, string> };

    expect(built.kind).toBe("flashcards");
    expect(built.files).toEqual({ cards: "flashcards.md" });

    expect(built.markdown).toContain("# Flashcards — Biology — Mitochondria");
    expect(built.markdown).toContain(
      "## Card 1\n\nQ: Where is ATP produced?\nA: The mitochondrial matrix.\nM: no\nK: no\n\n### Choices",
    );
    expect(built.markdown).toContain("- [ ] The cytoplasm");
    expect(built.markdown).toContain("- [x] The mitochondrial matrix");
    expect(built.markdown).toContain("## Card 2");
    expect(built.markdown).toContain("- [x] Electrons");

    await expect(
      readFile(join(outputsFolder(session.id), "flashcards.md"), "utf8"),
    ).resolves.toBe(built.markdown);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The mitochondrion produces ATP in the matrix.");
    expect(prompts[0]).toContain('"cards"');
  });

  test("malformed model output is one typed message and writes nothing", async () => {
    const session = await biologySession();
    const server = generatingCore(async () => "I think the mitochondrion makes ATP.");

    const response = await ask(server, "session.output.build", {
      id: session.id,
      kind: "study-guide",
    });
    if (!("error" in response)) throw new Error("a non-JSON reply must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "generation", id: session.id });
    expect(response.error.message).toContain("JSON");
    // Nothing was created by the refusal: no file and no temp beside it.
    expect(existsSync(join(outputsFolder(session.id), "study-guide.md"))).toBe(false);
    expect(existsSync(join(outputsFolder(session.id), "study-guide-answers.md"))).toBe(false);
    expect(
      existsSync(outputsFolder(session.id))
        ? (await readdir(outputsFolder(session.id))).filter((name) => name.includes(".tmp-"))
        : [],
    ).toEqual([]);
  });

  test("a card without exactly four choices is refused and no deck is written", async () => {
    const session = await biologySession();
    const threeChoices = JSON.stringify({
      cards: [
        {
          question: "Where is ATP produced?",
          answer: "The mitochondrial matrix.",
          choices: ["The cytoplasm", "The mitochondrial matrix", "The nucleus"],
          correct: 1,
        },
      ],
    });
    const server = generatingCore(async () => threeChoices);

    const response = await ask(server, "session.output.build", {
      id: session.id,
      kind: "flashcards",
    });
    if (!("error" in response)) throw new Error("a three-choice card must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toContain("exactly 4 choices");
    expect(response.error.data).toMatchObject({ kind: "generation", id: session.id });
    expect(existsSync(join(outputsFolder(session.id), "flashcards.md"))).toBe(false);
  });

  test("a provider failure is one typed message and leaves the old document", async () => {
    const session = await biologySession();
    await mkdir(outputsFolder(session.id), { recursive: true });
    const guidePath = join(outputsFolder(session.id), "study-guide.md");
    const previous = "# Study guide — old\n\n> 1 of 1 sections reviewed\n";
    await writeFile(guidePath, previous);
    const server = generatingCore(async () => {
      throw new Error("upstream overloaded at 503");
    });

    const response = await ask(server, "session.output.build", {
      id: session.id,
      kind: "study-guide",
    });
    if (!("error" in response)) throw new Error("a failed completion must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toContain("overloaded");
    expect(response.error.data).toMatchObject({ kind: "generation", id: session.id });
    await expect(readFile(guidePath, "utf8")).resolves.toBe(previous);
  });

  test("with no model it is one Settings sentence and writes nothing", async () => {
    const session = await biologySession();
    const response = await ask(core(), "session.output.build", {
      id: session.id,
      kind: "flashcards",
    });
    if (!("error" in response)) throw new Error("a missing model must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe("link a model in Settings → Providers");
    expect(response.error.data).toEqual({
      kind: "generation",
      id: session.id,
      message: "link a model in Settings → Providers",
    });
    expect(existsSync(join(outputsFolder(session.id), "flashcards.md"))).toBe(false);
  });

  test("read reports a missing output as an empty success", async () => {
    const session = await biologySession();
    const server = core();

    for (const [kind, part] of [
      ["study-guide", undefined],
      ["study-guide", "guide"],
      ["study-guide", "answers"],
      ["flashcards", undefined],
      ["flashcards", "cards"],
    ] as const) {
      const read = (await resultOf(server, "session.output.read", {
        id: session.id,
        kind,
        ...(part === undefined ? {} : { part }),
      })) as { markdown: string; exists: boolean };
      expect(read).toEqual({ markdown: "", exists: false });
    }
  });

  test("read returns the written documents", async () => {
    const session = await biologySession();
    const built = (await resultOf(generatingCore(async () => GUIDE), "session.output.build", {
      id: session.id,
      kind: "study-guide",
    })) as { markdown: string; answers: string };
    const deck = (await resultOf(generatingCore(async () => CARDS), "session.output.build", {
      id: session.id,
      kind: "flashcards",
    })) as { markdown: string };

    const server = core();
    const guide = (await resultOf(server, "session.output.read", {
      id: session.id,
      kind: "study-guide",
    })) as { markdown: string; exists: boolean };
    const answers = (await resultOf(server, "session.output.read", {
      id: session.id,
      kind: "study-guide",
      part: "answers",
    })) as { markdown: string; exists: boolean };
    const cards = (await resultOf(server, "session.output.read", {
      id: session.id,
      kind: "flashcards",
    })) as { markdown: string; exists: boolean };

    expect(guide).toEqual({ markdown: built.markdown, exists: true });
    expect(answers).toEqual({ markdown: built.answers, exists: true });
    expect(cards).toEqual({ markdown: deck.markdown, exists: true });
  });

  test("mark toggles one section, the progress line, and nothing else", async () => {
    const session = await biologySession();
    const built = (await resultOf(generatingCore(async () => GUIDE), "session.output.build", {
      id: session.id,
      kind: "study-guide",
    })) as { markdown: string };

    const server = core();
    const marked = (await resultOf(server, "session.output.mark", {
      id: session.id,
      index: 1,
    })) as { markdown: string; checked: boolean; done: number; total: number; hash: string };

    expect(marked.checked).toBe(true);
    expect(marked.done).toBe(1);
    expect(marked.total).toBeGreaterThan(1);
    expect(marked.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // One bracket and the progress line are the only differences.
    const before = built.markdown.split("\n");
    const after = marked.markdown.split("\n");
    const changed = before
      .map((line, index) => (line === after[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(changed).toHaveLength(2);

    // The file on disk is what the reply said it is.
    const path = join(workspaceRoot, "school", "outputs", session.id, "study-guide.md");
    expect(await readFile(path, "utf8")).toBe(marked.markdown);

    // Toggling again restores the built document byte for byte.
    const back = (await resultOf(server, "session.output.mark", {
      id: session.id,
      index: 1,
    })) as { markdown: string; done: number };
    expect(back.markdown).toBe(built.markdown);
    expect(back.done).toBe(0);
  });

  test("mark refuses an out-of-range section and a session with no guide", async () => {
    const session = await biologySession();
    const server = core();

    const missing = await ask(server, "session.output.mark", { id: session.id, index: 0 });
    if (!("error" in missing)) throw new Error("a guide that does not exist must be refused");
    expect(missing.error.retryable).toBe(false);
    expect(missing.error.data).toMatchObject({ kind: "output", id: session.id });
    expect(String((missing.error.data as { message?: string }).message)).toContain(
      "build the study guide first",
    );

    await resultOf(generatingCore(async () => GUIDE), "session.output.build", {
      id: session.id,
      kind: "study-guide",
    });
    const beyond = await ask(server, "session.output.mark", { id: session.id, index: 99 });
    if (!("error" in beyond)) throw new Error("an out-of-range section must be refused");
    expect(beyond.error.retryable).toBe(false);
  });

  test("an unknown session is the session shape and a bad shape is -32602", async () => {
    const server = core();
    const id = "2026-12-31-0000-missing";

    const build = await ask(server, "session.output.build", { id, kind: "study-guide" });
    if (!("error" in build)) throw new Error("an unknown session must be an error");
    expect(build.error.code).toBe(BOOT_FAILED);
    expect(build.error.retryable).toBe(false);
    expect(build.error.data).toMatchObject({ kind: "session", id });

    const read = await ask(server, "session.output.read", { id, kind: "flashcards" });
    if (!("error" in read)) throw new Error("an unknown session must be an error");
    expect(read.error.code).toBe(BOOT_FAILED);
    expect(read.error.retryable).toBe(false);
    expect(read.error.data).toMatchObject({ kind: "session", id });

    const badKind = await ask(server, "session.output.build", { id, kind: "deck" });
    if (!("error" in badKind)) throw new Error("an unknown kind must be refused");
    expect(badKind.error.code).toBe(-32602);

    const badPart = await ask(server, "session.output.read", {
      id,
      kind: "flashcards",
      part: "answers",
    });
    if (!("error" in badPart)) throw new Error("a foreign part must be refused");
    expect(badPart.error.code).toBe(-32602);
  });
});

describe("session archive, remove and export", () => {
  /** A session with one copied source and one stored chat turn. */
  async function physicsSession(name = "Physics — Unit 4") {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, `lecture-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`);
    await writeFile(lecture, "# Unit 4\n\nBoundary conditions.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name,
        prompt: "Study the boundary conditions.",
        files: [lecture],
      }),
    );
    // Chat history is the one thing an archive must never carry.
    await writeFile(
      join(created.folder, SESSION_FILES.chat),
      `${JSON.stringify({ role: "user", content: "Hi", at: "2026-11-01T09:10:00Z" })}\n`,
    );
    return { id: created.session.id, folder: created.folder, lecture };
  }

  /** Boot a core whose config selects a folder archive at `archiveRoot`. */
  async function archiveCore(archiveRoot: string): Promise<CoreServer> {
    unwrap(
      await patchConfig(workspace.paths, {
        archive: { backend: "folder", folder: archiveRoot },
      }),
    );
    return core();
  }

  test("export writes one zip inside the workspace exports folder", async () => {
    const session = await physicsSession();
    const server = core();

    const exported = await resultOf(server, "session.export", { id: session.id });
    expect(Object.keys(exported).sort()).toEqual(["action", "path"]);
    expect(exported.action).toBe("export");
    // There is no destination parameter: the path is the workspace's own.
    expect(exported.path).toBe(join(workspaceRoot, "exports", `session-${session.id}.zip`));
    expect(existsSync(exported.path as string)).toBe(true);

    const bytes = new Uint8Array(await Bun.file(exported.path as string).arrayBuffer());
    const entries = listZip(bytes);
    expect(entries).toContain(SESSION_FILES.meta);
    expect(entries.some((entry) => entry.startsWith("sources/"))).toBe(true);
    expect(entries).not.toContain(SESSION_FILES.chat);

    // Export is additive: the live session and the user's file are untouched.
    expect(existsSync(session.folder)).toBe(true);
    expect(existsSync(session.lecture)).toBe(true);
    expect(await resultOf(server, "session.list")).toMatchObject({ sessions: [{ id: session.id }] });

    // The zip is renamed into place, so no temp file survives.
    const leftovers = (await readdir(join(workspaceRoot, "exports"))).filter((name) =>
      name.includes(".tmp-"),
    );
    expect(leftovers).toEqual([]);
  });

  test("archive moves the session into the configured folder archive", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);

    const archived = await resultOf(server, "session.archive", { id: session.id });
    expect(archived).toEqual({ action: "archive", backend: "folder" });

    // The live folder is gone and the archived copy carries the session.
    expect(existsSync(session.folder)).toBe(false);
    const folder = join(archiveRoot, "school", "session", session.id);
    expect(existsSync(folder)).toBe(true);
    const meta = JSON.parse(await readFile(join(folder, SESSION_FILES.meta), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.archived).toBe(true);
    // The archive says the chat was not carried, so a restore cannot imply one.
    expect(meta.chat_archived).toBe(false);
    expect(existsSync(join(folder, SESSION_FILES.chat))).toBe(false);
    expect(await readdir(join(folder, "sources"))).toHaveLength(1);

    // The user's original file is never moved or deleted, and the manager agrees.
    expect(existsSync(session.lecture)).toBe(true);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });

    // No partial destination or temp folder survives the move.
    expect((await readdir(join(archiveRoot, "school", "session"))).filter((name) =>
      name.startsWith(".tmp-"),
    )).toEqual([]);
  });

  test("an archive that cannot land is one typed action error with no debris", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    // A previous copy already owns the destination: the service refuses before
    // it stages anything, so the live session stays exactly as it was.
    const destination = join(archiveRoot, "school", "session", session.id);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "keep.txt"), "previous archive\n");
    const metaBefore = await readFile(join(session.folder, SESSION_FILES.meta), "utf8");
    const server = await archiveCore(archiveRoot);

    const response = await ask(server, "session.archive", { id: session.id });
    if (!("error" in response)) throw new Error("an occupied archive must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "session-action",
      id: session.id,
      action: "archive",
    });
    expect(response.error.message).toContain("already exists");

    // Nothing was written or removed by the failure.
    await expect(readFile(join(session.folder, SESSION_FILES.meta), "utf8")).resolves.toBe(
      metaBefore,
    );
    expect(await readdir(join(archiveRoot, "school", "session"))).toEqual([session.id]);
    await expect(readFile(join(destination, "keep.txt"), "utf8")).resolves.toBe(
      "previous archive\n",
    );
  });

  test("remove deletes one session folder and nothing else", async () => {
    const first = await physicsSession("Physics — Unit 4");
    const second = await physicsSession("Chemistry — Unit 5");
    const server = core();

    expect(await resultOf(server, "session.remove", { id: first.id })).toEqual({
      action: "delete",
    });
    expect(existsSync(first.folder)).toBe(false);
    // The user's original file is never the app's to delete.
    expect(existsSync(first.lecture)).toBe(true);
    // A sibling session is untouched.
    expect(existsSync(second.folder)).toBe(true);

    const listed = (await resultOf(server, "session.list")) as { sessions: Array<{ id: string }> };
    expect(listed.sessions.map((row) => row.id)).toEqual([second.id]);
  });

  test("no archive backend is one archive refusal and the session stays", async () => {
    const session = await physicsSession();
    const server = core();

    const response = await ask(server, "session.archive", { id: session.id });
    if (!("error" in response)) throw new Error("an unconfigured archive must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      id: session.id,
      message: response.error.message,
    });
    expect(response.error.message).toContain("archive folder");

    // A refusal never deletes the live folder.
    expect(existsSync(session.folder)).toBe(true);
    expect(existsSync(join(session.folder, SESSION_FILES.meta))).toBe(true);
  });

  test("an unknown session is the session shape for all three verbs", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const id = "2026-12-31-0000-missing";

    for (const method of ["session.archive", "session.remove", "session.export"] as const) {
      const response = await ask(server, method, { id });
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown session`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "session", id });
    }

    // No verb invented a session, an archive or an export.
    expect(existsSync(join(workspaceRoot, "exports", `session-${id}.zip`))).toBe(false);
    expect(existsSync(join(archiveRoot, "school", "session", id))).toBe(false);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("a failed export is one typed action error and the session survives", async () => {
    const session = await physicsSession();
    // The export target is occupied by a folder, so the rename cannot land. The
    // service still cleans its staging folder and temp file up.
    const target = join(workspaceRoot, "exports", `session-${session.id}.zip`);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "keep.txt"), "previous export\n");
    const server = core();

    const response = await ask(server, "session.export", { id: session.id });
    if (!("error" in response)) throw new Error("a blocked export must be reported");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "session-action",
      id: session.id,
      action: "export",
    });

    // The session is intact, the occupied target is untouched and nothing else
    // was left in `exports/`.
    expect(await resultOf(server, "session.list")).toMatchObject({ sessions: [{ id: session.id }] });
    expect(await readdir(join(workspaceRoot, "exports"))).toEqual([`session-${session.id}.zip`]);
    await expect(readFile(join(target, "keep.txt"), "utf8")).resolves.toBe("previous export\n");
  });
});

describe("source.list and source.add", () => {
  test("adds a picked file once, skips the duplicate and lists the copy", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const lecture = join(inputs, "lecture-4.md");
    await writeFile(lecture, "# Unit 4\n\nBoundary conditions.\n");
    const server = core();

    expect(
      await resultOf(server, "source.add", { sessionId: created.session.id, paths: [lecture] }),
    ).toEqual({ added: 1, skipped: 0 });

    // The same bytes are one source, whatever the path: de-duplicated by hash.
    expect(
      await resultOf(server, "source.add", { sessionId: created.session.id, paths: [lecture] }),
    ).toEqual({ added: 0, skipped: 1 });

    const listed = (await resultOf(server, "source.list", {
      sessionId: created.session.id,
    })) as {
      sources: Array<{
        name: string;
        originalPath: string;
        storedPath: string;
        hash: string;
        kind: string;
      }>;
    };
    expect(listed.sources).toHaveLength(1);
    expect(listed.sources[0]).toMatchObject({
      name: "lecture-4.md",
      originalPath: lecture,
      kind: "markdown",
    });
    // The copy lives inside the session; the shell cannot address it directly.
    expect(listed.sources[0]!.storedPath.startsWith("sources/")).toBe(true);
    expect(listed.sources[0]!.hash.startsWith("sha256:")).toBe(true);
    expect(existsSync(join(created.folder, listed.sources[0]!.storedPath))).toBe(true);
    // The user's original is never moved or deleted.
    expect(existsSync(lecture)).toBe(true);
  });

  test("copying a file that cannot be read is a typed source error and adds nothing", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study.",
      }),
    );
    const server = core();

    const response = await ask(server, "source.add", {
      sessionId: created.session.id,
      paths: [join(base, "missing.md")],
    });
    if (!("error" in response)) throw new Error("a missing file must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "source",
      sessionId: created.session.id,
    });

    expect(await resultOf(server, "source.list", { sessionId: created.session.id })).toEqual({
      sources: [],
    });
  });

  test("an unknown session is a typed -32000 error for both methods", async () => {
    const server = core();
    const id = "2026-12-31-0000-missing";

    const listed = await ask(server, "source.list", { sessionId: id });
    if (!("error" in listed)) throw new Error("an unknown session must be an error");
    expect(listed.error.code).toBe(BOOT_FAILED);
    expect(listed.error.retryable).toBe(false);
    expect(listed.error.data).toMatchObject({ kind: "session", sessionId: id });

    const added = await ask(server, "source.add", { sessionId: id, paths: [join(base, "a.md")] });
    if (!("error" in added)) throw new Error("an unknown session must be an error");
    expect(added.error.code).toBe(BOOT_FAILED);
    expect(added.error.retryable).toBe(false);
    expect(added.error.data).toMatchObject({ kind: "session", sessionId: id });
  });
});

describe("session.chat", () => {
  test("an unconfigured model still yields an idle snapshot, not a crash", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Test session",
        prompt: "notes",
      }),
    );

    const snapshot = await resultOf(core(), "session.chat.snapshot", { id: created.session.id });
    expect(snapshot).toMatchObject({
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
    });
    expect(snapshot.usage).toMatchObject({ tokens: 0, durationMs: null });
  });

  test("sending with no model emits done(no-model) and never contacts a provider", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Test session",
        prompt: "notes",
      }),
    );
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
      notify: (notification) => notifications.push(notification),
    });

    const sent = await resultOf(server, "session.chat.send", {
      id: created.session.id,
      text: "Explain this.",
    });
    expect(sent).toEqual({ turnId: created.session.id });

    // The turn's promise settles in a microtask; the coalesced state follows.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const done = notifications.find((entry) => entry.method === "session.chat.done");
    expect(done?.params).toMatchObject({ sessionId: created.session.id, kind: "no-model" });

    await Bun.sleep(60);
    const state = notifications.find((entry) => entry.method === "session.chat.state");
    expect(state?.params).toMatchObject({
      sessionId: created.session.id,
      status: "idle",
      blocked: { reason: "no model configured" },
    });
  });

  test("cancelling a session with nothing in flight is ok", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Test session",
        prompt: "notes",
      }),
    );
    expect(
      await resultOf(core(), "session.chat.cancel", { id: created.session.id }),
    ).toEqual({ ok: true });
  });
});

/**
 * Session memory over the real path (`docs/product.md` §4.5).
 *
 * The model is a fake `ChatService` injected through `boot`, so the whole chain
 * — real controller, real history, real `recordTurn`, real atomic write — runs
 * offline. Memory is history, never a source, and only a completed turn writes.
 */
describe("session memory", () => {
  type FakeTurn = { text: string } | "cancelled" | "error";

  function fakeChat(turn: FakeTurn): ChatService {
    return {
      async *send() {
        if (turn === "cancelled") {
          yield { type: "cancelled" as const };
          return;
        }
        if (turn === "error") {
          yield {
            type: "error" as const,
            error: { kind: "network" as const, message: "offline" },
          };
          return;
        }
        yield { type: "text" as const, delta: turn.text };
        yield {
          type: "done" as const,
          text: turn.text,
          steps: [],
          usage: { input: 10, output: 5, total: 15 },
          durationMs: 8,
        };
      },
      cancel() {},
      active() {
        return [];
      },
    };
  }

  function chatCore(turn: FakeTurn, notifications: CoreNotification[] = []): CoreServer {
    return createCoreServer({
      boot: () =>
        boot({
          workspaceRoot,
          dataDir,
          env: {},
          now: NOW,
          createService: () => fakeChat(turn),
        }),
      notify: (notification) => notifications.push(notification),
    });
  }

  /** Config with a model, so the turn reaches the fake service. */
  async function modelConfigured(): Promise<void> {
    await writeFile(
      join(workspaceRoot, "config.toml"),
      '[models]\nchat = "custom/fake"\n',
      "utf8",
    );
  }

  async function newSession(): Promise<string> {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Memory session",
        prompt: "Summarise the notes.",
      }),
    );
    return created.session.id;
  }

  function memoryPath(id: string): string {
    return join(workspaceRoot, "school", "sessions", id, SESSION_FILES.memory);
  }

  async function waitFor<T>(check: () => T | undefined | null | false, label: string): Promise<T> {
    const deadline = Date.now() + 4_000;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  test("a completed turn writes memory.md and session.open returns it", async () => {
    await modelConfigured();
    const id = await newSession();
    const notifications: CoreNotification[] = [];
    const server = chatCore(
      {
        text:
          "Boundary conditions determine the integral limits.\n\n" +
          "- **Energy** is conserved\n" +
          "- The *limits* set the bounds",
      },
      notifications,
    );

    expect(await resultOf(server, "session.chat.send", { id, text: "Explain this." })).toEqual({
      turnId: id,
    });
    await waitFor(
      () =>
        notifications.some(
          (entry) => entry.method === "session.chat.done" &&
            (entry.params as { outcome?: string }).outcome === "done",
        ),
      "session.chat.done",
    );
    await waitFor(() => existsSync(memoryPath(id)), "memory.md");

    const text = await readFile(memoryPath(id), "utf8");
    expect(text).toContain("---");
    expect(text).toContain("type: session-summary");
    expect(text).toContain(`session: ${id}`);
    expect(text).toContain("# Key points");
    // List items are preferred over the prose preamble, and Markdown is stripped.
    expect(text).toContain("- Energy is conserved");
    expect(text).toContain("- The limits set the bounds");
    expect(text).not.toContain("Boundary conditions determine the integral limits.");
    expect(text).not.toContain("**");

    const opened = await resultOf(server, "session.open", { id });
    const memory = (opened.session as {
      memory: { points: string[]; folded: string[]; updated: string } | null;
    }).memory;
    expect(memory?.points).toEqual(["Energy is conserved", "The limits set the bounds"]);
    expect(memory?.folded).toEqual([]);
    const updated = memory?.updated ?? "";
    expect(new Date(updated).toISOString()).toBe(updated);

    // The same note feeds the review queue's "session memory" items, which can
    // never appear while nothing writes `memory.md`.
    const queue = await resultOf(server, "review.queue", {});
    const items = (queue.queue as { items: Array<{ id: string; kind: string }> }).items;
    expect(items.map((item) => item.kind)).toContain("memory");
    expect(items.map((item) => item.id)).toContain(`memory:${id}:${id}-0`);
  });

  test("a cancelled turn leaves no memory file", async () => {
    await modelConfigured();
    const id = await newSession();
    const notifications: CoreNotification[] = [];
    const server = chatCore("cancelled", notifications);

    await resultOf(server, "session.chat.send", { id, text: "Explain this." });
    await waitFor(
      () => notifications.some((entry) => entry.method === "session.chat.done"),
      "session.chat.done",
    );
    // Cancelled is a service-level no-op; give the fire-and-forget call a turn
    // of the event loop before proving nothing was written.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(existsSync(memoryPath(id))).toBe(false);

    const opened = await resultOf(server, "session.open", { id });
    expect((opened.session as { memory?: unknown }).memory).toBeUndefined();
  });

  test("a turn with no model records nothing — the no-model reply is not a fact", async () => {
    const id = await newSession();
    const server = core();
    await resultOf(server, "session.chat.send", { id, text: "Explain this." });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(existsSync(memoryPath(id))).toBe(false);
  });
});

describe("stats.summary", () => {
  test("an empty data directory is a summary of zeros", async () => {
    const summary = await resultOf(core(), "stats.summary", { range: "7d", scope: "all" });
    expect(summary).toMatchObject({
      range: "7d",
      scope: "all",
      overview: { runs: 0, failed: 0, input: 0, output: 0 },
      costMicroUsd: 0,
      models: [],
      tools: [],
      learning: { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
      activity: [],
      bestStreak: 0,
      activeDays: 0,
      diagnostic: null,
    });
  });

  test("aggregates the counters the stats page reads", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "usage.json"),
      JSON.stringify({
        schema: 1,
        runs: [
          {
            model: "openai/gpt-4.1-mini",
            input: 10,
            output: 5,
            costMicroUsd: 7,
            at: "2026-10-31T09:00:00Z",
            failed: false,
            scope: "school",
          },
        ],
      }),
    );
    await writeFile(
      join(dataDir, "stats.json"),
      JSON.stringify({
        schema: 1,
        events: [
          { kind: "step-toggled", at: "2026-10-31T09:05:00Z", scope: "school" },
          { kind: "tool-call", at: "2026-10-31T09:06:00Z", scope: "school", name: "read_file" },
        ],
      }),
    );

    // `all` keeps the assertion independent of the wall clock; the range
    // boundaries themselves are covered by the stats service's own tests.
    const summary = await resultOf(core(), "stats.summary", { range: "all", scope: "all" });
    expect(summary).toMatchObject({
      range: "all",
      scope: "all",
      overview: { runs: 1, failed: 0, input: 10, output: 5 },
      costMicroUsd: 7,
      models: [{ model: "openai/gpt-4.1-mini", runs: 1, input: 10, output: 5, costMicroUsd: 7 }],
      tools: [{ name: "read_file", calls: 1 }],
      learning: { steps: 1, cardsKnown: 0, cardsMissed: 0, lessons: 0 },
      activity: [{ date: "2026-10-31", runs: 1, tokens: 15 }],
      bestStreak: 1,
      activeDays: 1,
    });

    // Scope narrows the same data without changing the shape.
    const scoped = await resultOf(core(), "stats.summary", { range: "all", scope: "work" });
    expect(scoped).toMatchObject({ scope: "work", overview: { runs: 0 } });
  });
});

describe("stats.export", () => {
  /** One run plus the two learning counters the stats page reads. */
  async function seedCounters(): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "usage.json"),
      JSON.stringify({
        schema: 1,
        runs: [
          {
            model: "openai/gpt-4.1-mini",
            input: 10,
            output: 5,
            costMicroUsd: 7,
            at: "2026-10-31T09:00:00Z",
            failed: false,
            scope: "school",
          },
        ],
      }),
    );
    await writeFile(
      join(dataDir, "stats.json"),
      JSON.stringify({
        schema: 1,
        events: [
          { kind: "step-toggled", at: "2026-10-31T09:05:00Z", scope: "school" },
          { kind: "tool-call", at: "2026-10-31T09:06:00Z", scope: "school", name: "read_file" },
        ],
      }),
    );
  }

  test("an empty data directory exports a valid Markdown document", async () => {
    const exported = await resultOf(core(), "stats.export", {
      range: "7d",
      scope: "all",
    });
    expect(exported.format).toBe("md");
    expect(exported.text).toBe(
      [
        "# Stats — 7d · all",
        "",
        "> Estimates, not a bill.",
        "",
        "## Overview",
        "",
        "- runs: 0 (0 failed)",
        "- tokens: 0 in / 0 out",
        "- cost: $0.0000",
        "",
        "## Models",
        "",
        "| model | runs | input | output | cost |",
        "|---|---|---|---|---|",
        "| — | 0 | 0 | 0 | — |",
        "",
        "## Tools",
        "",
        "| tool | calls |",
        "|---|---|",
        "| — | 0 |",
        "",
        "## Learning",
        "",
        "- steps: 0",
        "- cards known: 0",
        "- cards missed: 0",
        "- lessons completed: 0",
        "",
      ].join("\n"),
    );
  });

  test("exports the seeded counters as exact Markdown and CSV", async () => {
    await seedCounters();
    const usageBefore = await readFile(join(dataDir, "usage.json"), "utf8");

    const md = await resultOf(core(), "stats.export", { range: "all", scope: "all", format: "md" });
    expect(md).toEqual({
      format: "md",
      text: [
        "# Stats — all · all",
        "",
        "> Estimates, not a bill.",
        "",
        "## Overview",
        "",
        "- runs: 1 (0 failed)",
        "- tokens: 10 in / 5 out",
        "- cost: $0.0000",
        "",
        "## Models",
        "",
        "| model | runs | input | output | cost |",
        "|---|---|---|---|---|",
        "| openai/gpt-4.1-mini | 1 | 10 | 5 | $0.0000 |",
        "",
        "## Tools",
        "",
        "| tool | calls |",
        "|---|---|",
        "| read_file | 1 |",
        "",
        "## Learning",
        "",
        "- steps: 1",
        "- cards known: 0",
        "- cards missed: 0",
        "- lessons completed: 0",
        "",
      ].join("\n"),
    });

    const csv = await resultOf(core(), "stats.export", { range: "all", scope: "all", format: "csv" });
    expect(csv).toEqual({
      format: "csv",
      text: [
        "section,model,runs,input,output,cost_micro_usd,cost_label",
        "model,openai/gpt-4.1-mini,1,10,5,7,$0.0000",
        "total,all,1,10,5,7,$0.0000",
        "learning,steps,1,0,0,0,",
        "",
      ].join("\n"),
    });

    // Export is read-only: the counters the export described are untouched.
    expect(await readFile(join(dataDir, "usage.json"), "utf8")).toBe(usageBefore);
  });

  test("an omitted format is Markdown, and repeated calls are byte-identical", async () => {
    await seedCounters();
    const first = await resultOf(core(), "stats.export", { range: "all", scope: "all" });
    const second = await resultOf(core(), "stats.export", { range: "all", scope: "all" });
    expect(first.format).toBe("md");
    expect(second).toEqual(first);
    expect(String(first.text).startsWith("# Stats — all · all")).toBe(true);
  });

  test("an empty data directory exports a valid CSV document", async () => {
    const csv = await resultOf(core(), "stats.export", {
      range: "all",
      scope: "all",
      format: "csv",
    });
    expect(csv).toEqual({
      format: "csv",
      text: [
        "section,model,runs,input,output,cost_micro_usd,cost_label",
        "total,all,0,0,0,0,$0.0000",
        "learning,steps,0,0,0,0,",
        "",
      ].join("\n"),
    });
  });

  test("an invalid range, scope or format is -32602 and writes nothing", async () => {
    await seedCounters();
    const usageBefore = await readFile(join(dataDir, "usage.json"), "utf8");
    const cases: Array<Record<string, unknown>> = [
      { range: "1d", scope: "all" },
      { range: "all", scope: "everywhere" },
      { range: "all", scope: "all", format: "pdf" },
    ];
    for (const params of cases) {
      const response = await ask(core(), "stats.export", params);
      if (!("error" in response)) throw new Error(`${JSON.stringify(params)} should have failed`);
      expect(response.error.code).toBe(-32602);
      expect(response.error.retryable).toBeUndefined();
    }
    expect(await readFile(join(dataDir, "usage.json"), "utf8")).toBe(usageBefore);
  });
});

describe("work", () => {
  test("an empty workspace has no projects", async () => {
    expect(await resultOf(core(), "work.list")).toEqual({ projects: [] });
  });

  test("a registered project lists its metadata and agents", async () => {
    const projectRoot = join(base, "my-app");
    await mkdir(projectRoot, { recursive: true });
    const id = makeProjectId("My app");
    const created = unwrap(
      await createProject({
        workspace,
        id,
        name: "My app",
        folder: projectRoot,
        mode: "chat",
      }),
    );
    expect(created.id).toBe(id);
    const agentId = makeAgentId("Reviewer");
    unwrap(
      await createProjectAgent({
        workspace,
        projectId: id,
        id: agentId,
        agent: {
          id: agentId,
          name: "Reviewer",
          task: "Review only.",
          model: "",
          permissions: "read-only",
        },
      }),
    );
    unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));

    const listed = (await resultOf(core(), "work.list")) as {
      projects: Array<{
        id: string;
        name: string;
        folder: string;
        mode: string;
        swarmName: string;
        archived: boolean;
        agents: Array<{
          id: string;
          name: string;
          task: string;
          model: string;
          permissions: string;
        }>;
      }>;
    };
    expect(listed.projects).toEqual([
      {
        id,
        name: "My app",
        // The registered root is the resolved absolute path, never the raw input.
        folder: created.folder,
        mode: "chat",
        swarmName: "",
        archived: false,
        agents: [
          {
            id: agentId,
            name: "Reviewer",
            task: "Review only.",
            model: "",
            permissions: "read-only",
          },
        ],
      },
    ]);

    const opened = (await resultOf(core(), "work.open", { id })) as {
      project: Record<string, unknown>;
    };
    expect(opened.project).toMatchObject({
      id,
      name: "My app",
      root: created.folder,
      rootMissing: false,
      mode: "chat",
      swarmName: "",
      archived: false,
      instructions: "",
      defaultAgent: agentId,
      tasks: 0,
      hasGit: false,
    });
    // The full profile drives the agent sidebar, so capabilities stay visible.
    expect(opened.project.agents).toEqual([
      expect.objectContaining({
        id: agentId,
        name: "Reviewer",
        role: "builder",
        instructions: "Review only.",
        model: "",
        allowWrite: false,
        allowCommand: false,
      }),
    ]);
    expect(typeof opened.project.lastOpened).toBe("string");
    expect((opened.project.lastOpened as string).length).toBeGreaterThan(0);
    // Registration is metadata only: the user's folder is still there.
    expect(existsSync(projectRoot)).toBe(true);
  });

  test("work.create registers a project, and opening it returns the detail", async () => {
    const folder = join(base, "brand-new");
    const created = await resultOf(core(), "work.create", {
      name: "Brand new",
      folder,
      mode: "swarm",
    });
    // The shell gets an id and a name, then calls `work.open` for the detail.
    expect(Object.keys(created).sort()).toEqual(["id", "name"]);
    expect(created.name).toBe("Brand new");
    // "New project" may name a folder that does not exist yet; it is created.
    expect(existsSync(folder)).toBe(true);

    const opened = (await resultOf(core(), "work.open", { id: created.id })) as {
      project: Record<string, unknown>;
    };
    expect(opened.project).toMatchObject({
      id: created.id,
      name: "Brand new",
      mode: "swarm",
      swarmName: "",
      archived: false,
      rootMissing: false,
      agents: [],
      tasks: 0,
    });
    expect(typeof opened.project.root).toBe("string");
    expect(existsSync(opened.project.root as string)).toBe(true);

    // One folder is one project: a second registration is a typed refusal that
    // names the existing project instead of creating a duplicate.
    const duplicate = await ask(core(), "work.create", {
      name: "Brand new again",
      folder,
      mode: "chat",
    });
    if (!("error" in duplicate)) throw new Error("a duplicate root must be refused");
    expect(duplicate.error.code).toBe(BOOT_FAILED);
    expect(duplicate.error.retryable).toBe(false);
    expect(duplicate.error.data).toMatchObject({ kind: "project-create" });
  });

  test("an unknown project is a typed -32000 error", async () => {
    const response = await ask(core(), "work.open", { id: "missing-000000" });
    if (!("error" in response)) throw new Error("an unknown project must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "project", id: "missing-000000" });
  });
});

describe("work.changes", () => {
  const gitAvailable = Bun.which("git") !== null;
  const GIT_IDENTITY = [
    "-c",
    "user.name=LockedIn Fixture",
    "-c",
    "user.email=fixture@example.invalid",
  ];
  /**
   * A bare git environment: no user or system config, no prompts, no pager and
   * no locale-dependent output, plus optional locks off so this helper cannot
   * rewrite the index while it checks the summary's own promise.
   */
  const GIT_ENV: Record<string, string | undefined> = {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: process.platform === "win32" ? "more" : "cat",
    LC_ALL: "C",
  };

  async function git(root: string, args: readonly string[]): Promise<string> {
    const process = Bun.spawn({
      cmd: ["git", ...GIT_IDENTITY, ...args],
      cwd: root,
      env: GIT_ENV,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr.trim()}`);
    }
    return stdout;
  }

  /** Register a folder as a project id, the way the Work wizard does. */
  async function register(name: string, folder: string): Promise<string> {
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder, mode: "chat" }));
    return id;
  }

  test.skipIf(!gitAvailable)(
    "summarises a real repository, and reading it writes nothing",
    async () => {
      const projectRoot = join(base, "changes-repo");
      await mkdir(projectRoot, { recursive: true });
      await writeFile(join(projectRoot, "notes.md"), "# Notes\n\none\n");
      await git(projectRoot, ["init", "-q", "-b", "main"]);
      await git(projectRoot, ["add", "-A"]);
      await git(projectRoot, ["commit", "-q", "-m", "seed"]);

      const id = await register("Changes repo", projectRoot);

      // The test's own modification: one tracked line, unstaged.
      await writeFile(join(projectRoot, "notes.md"), "# Notes\n\none changed\n");

      const before = await git(projectRoot, ["status", "--porcelain"]);
      const result = await resultOf(core(), "work.changes", { projectId: id });
      const after = await git(projectRoot, ["status", "--porcelain"]);

      // Reading the summary leaves the working tree exactly as it found it.
      expect(after).toBe(before);
      expect(result).toEqual({
        changes: {
          available: true,
          branch: "main",
          detached: false,
          dirty: true,
          staged: 0,
          unstaged: 1,
          files: [
            {
              path: "notes.md",
              status: "modified",
              added: 1,
              removed: 1,
              staged: false,
              unstaged: true,
            },
          ],
        },
      });
    },
  );

  test.skipIf(!gitAvailable)(
    "a folder that is not a repository is unavailable, never an error",
    async () => {
      const projectRoot = join(base, "changes-plain");
      await mkdir(projectRoot, { recursive: true });
      await writeFile(join(projectRoot, "notes.md"), "plain\n");
      const id = await register("Changes plain", projectRoot);

      const result = (await resultOf(core(), "work.changes", { projectId: id })) as {
        changes: { available: boolean; reason: string; message: string };
      };

      expect(result.changes.available).toBe(false);
      expect(result.changes.reason).toBe("not a git repository");
      expect(result.changes.message).toContain("not a git repository");
      // The rest of Work still opens the project; nothing was created in it.
      expect((await readdir(projectRoot)).sort()).toEqual(["notes.md"]);
      const opened = (await resultOf(core(), "work.open", { id })) as {
        project: Record<string, unknown>;
      };
      expect(opened.project.hasGit).toBe(false);
    },
  );

  test("an unknown project is the typed project error", async () => {
    const response = await ask(core(), "work.changes", { projectId: "missing-000000" });
    if (!("error" in response)) throw new Error("an unknown project must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "project",
      projectId: "missing-000000",
      message: "this project is not registered in this workspace",
    });
  });
});

describe("work agents", () => {
  /** A fresh registered project for this test, with an empty real folder. */
  async function registeredProject(name: string, mode: "chat" | "swarm" = "chat") {
    const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await mkdir(root, { recursive: true });
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder: root, mode }));
    return { id, root };
  }

  /** The same document the shell renders after an agent write. */
  async function opened(server: CoreServer, projectId: string) {
    const result = (await resultOf(server, "work.open", { id: projectId })) as {
      project: {
        id: string;
        defaultAgent: string | null;
        agents: Array<{
          id: string;
          name: string;
          role: string;
          instructions: string;
          model: string;
          maxToolCalls: number;
          allowedTools: string[];
          allowWrite: boolean;
          allowCommand: boolean;
          template: string;
        }>;
      };
    };
    return result.project;
  }

  function metaPath(projectId: string): string {
    return join(workspaceRoot, "work", "projects", projectId, "meta.json");
  }

  /** A complete profile payload, with no id: the create path. */
  function agentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: "Reviewer",
      role: "reviewer",
      instructions: "Review only.",
      model: "",
      maxToolCalls: 6,
      allowedTools: ["read_file"],
      allowWrite: false,
      allowCommand: false,
      template: "",
      ...overrides,
    };
  }

  test("creates a profile, and work.open returns the stored flags", async () => {
    const project = await registeredProject("Agent app");
    const server = core();

    const saved = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });
    // The reply is the id the shell needs to select the new row.
    expect(Object.keys(saved)).toEqual(["id"]);
    const agentId = saved.id as string;
    expect(agentId).toMatch(/^reviewer-[0-9a-f]{6}$/);

    const detail = await opened(server, project.id);
    expect(detail.agents).toEqual([
      {
        id: agentId,
        name: "Reviewer",
        role: "reviewer",
        instructions: "Review only.",
        model: "",
        maxToolCalls: 6,
        allowedTools: ["read_file"],
        allowWrite: false,
        allowCommand: false,
        template: "",
      },
    ]);
    // A create never picks a default: that is a separate, explicit action.
    expect(detail.defaultAgent).toBeNull();

    // Metadata only: the write landed in the workspace's project folder, and
    // the user's own folder is untouched.
    expect(existsSync(metaPath(project.id))).toBe(true);
    expect(await readdir(project.root)).toEqual([]);
  });

  test("updates in place, keeping the id and the fields the patch omits", async () => {
    const project = await registeredProject("Agent app");
    const server = core();
    const { id } = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });

    const updated = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: { id, name: "Review editor", model: "openai/gpt-4.1-mini" },
    });
    expect(updated).toEqual({ id });

    const detail = await opened(server, project.id);
    expect(detail.agents).toHaveLength(1);
    expect(detail.agents[0]).toMatchObject({
      id,
      name: "Review editor",
      model: "openai/gpt-4.1-mini",
      // Not in the patch: the saved values survive the update.
      role: "reviewer",
      instructions: "Review only.",
      maxToolCalls: 6,
      allowedTools: ["read_file"],
    });
  });

  test("sets the default, reports it on work.open, and clears it with null", async () => {
    const project = await registeredProject("Agent app");
    const server = core();
    const { id: rawId } = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });
    const id = rawId as string;

    expect(await resultOf(server, "work.defaultAgent", { projectId: project.id, agentId: id })).toEqual(
      { defaultAgent: id },
    );
    expect((await opened(server, project.id)).defaultAgent).toBe(id);

    // `null` and an omitted agentId both clear it.
    expect(
      await resultOf(server, "work.defaultAgent", { projectId: project.id, agentId: null }),
    ).toEqual({ defaultAgent: null });
    expect((await opened(server, project.id)).defaultAgent).toBeNull();

    await resultOf(server, "work.defaultAgent", { projectId: project.id, agentId: id });
    expect(await resultOf(server, "work.defaultAgent", { projectId: project.id })).toEqual({
      defaultAgent: null,
    });
    expect((await opened(server, project.id)).defaultAgent).toBeNull();
  });

  test("deletes the profile and leaves no default pointing at it", async () => {
    const project = await registeredProject("Agent app");
    const server = core();
    const { id } = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });
    await resultOf(server, "work.defaultAgent", { projectId: project.id, agentId: id });

    expect(
      await resultOf(server, "work.agent.delete", { projectId: project.id, agentId: id }),
    ).toEqual({ ok: true });

    const detail = await opened(server, project.id);
    expect(detail.agents).toEqual([]);
    expect(detail.defaultAgent).toBeNull();

    const meta = JSON.parse(await readFile(metaPath(project.id), "utf8")) as {
      agents: unknown[];
      default_agent: string;
    };
    expect(meta.agents).toEqual([]);
    expect(meta.default_agent).toBe("");
  });

  test("a duplicate name and an unknown agent id are typed agent errors", async () => {
    const project = await registeredProject("Agent app");
    const server = core();
    const { id } = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });

    // The service's own refusal is preserved, not re-worded.
    const duplicate = await ask(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload({ name: "reviewer" }),
    });
    if (!("error" in duplicate)) throw new Error("a duplicate agent name must be refused");
    expect(duplicate.error.code).toBe(BOOT_FAILED);
    expect(duplicate.error.retryable).toBe(false);
    expect(duplicate.error.data).toMatchObject({ kind: "agent", projectId: project.id });
    expect(duplicate.error.message).toContain("already used");

    const unknownUpdate = await ask(server, "work.agent.save", {
      projectId: project.id,
      agent: { id: "missing-000000", name: "Ghost" },
    });
    if (!("error" in unknownUpdate)) throw new Error("an unknown agent id must be an error");
    expect(unknownUpdate.error.code).toBe(BOOT_FAILED);
    expect(unknownUpdate.error.data).toMatchObject({ kind: "agent", projectId: project.id });
    expect(unknownUpdate.error.message).toContain("missing-000000");

    const unknownDelete = await ask(server, "work.agent.delete", {
      projectId: project.id,
      agentId: "missing-000000",
    });
    if (!("error" in unknownDelete)) throw new Error("an unknown agent id must be an error");
    expect(unknownDelete.error.code).toBe(BOOT_FAILED);
    expect(unknownDelete.error.retryable).toBe(false);
    expect(unknownDelete.error.data).toMatchObject({
      kind: "agent",
      projectId: project.id,
      agentId: "missing-000000",
    });

    // Nothing was deleted or added by the refusals.
    expect((await opened(server, project.id)).agents).toHaveLength(1);
    expect(id).toMatch(/^reviewer-/);
  });

  test("an unknown project is the project error shape for all three methods", async () => {
    const server = core();
    const projectId = "missing-000000";

    const saves = await ask(server, "work.agent.save", {
      projectId,
      agent: agentPayload(),
    });
    if (!("error" in saves)) throw new Error("an unknown project must be an error");
    expect(saves.error.code).toBe(BOOT_FAILED);
    expect(saves.error.retryable).toBe(false);
    expect(saves.error.data).toMatchObject({ kind: "project", projectId });

    const deleted = await ask(server, "work.agent.delete", {
      projectId,
      agentId: "reviewer-9ab12c",
    });
    if (!("error" in deleted)) throw new Error("an unknown project must be an error");
    expect(deleted.error.code).toBe(BOOT_FAILED);
    expect(deleted.error.retryable).toBe(false);
    expect(deleted.error.data).toMatchObject({ kind: "project", projectId });

    const cleared = await ask(server, "work.defaultAgent", { projectId, agentId: null });
    if (!("error" in cleared)) throw new Error("an unknown project must be an error");
    expect(cleared.error.code).toBe(BOOT_FAILED);
    expect(cleared.error.retryable).toBe(false);
    expect(cleared.error.data).toMatchObject({ kind: "project", projectId });
  });

  test("a swarm project stores the requested flags; only a worker copy is read-only", async () => {
    // The product rule "swarm workers never inherit command access" is applied
    // at the swarm boundary (`forSwarm`), not by rewriting a saved profile. This
    // packet must not silently narrow what the user asked for.
    const project = await registeredProject("Swarm app", "swarm");
    const server = core();

    const { id } = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload({ name: "Implementer", allowWrite: true, allowCommand: true }),
    });

    const detail = await opened(server, project.id);
    expect(detail.agents[0]).toMatchObject({ id, allowWrite: true, allowCommand: true });
  });

  test("a bad shape is -32602 and leaves meta.json byte-identical", async () => {
    const project = await registeredProject("Agent app");
    const server = core();
    await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: agentPayload(),
    });
    const before = await readFile(metaPath(project.id), "utf8");

    for (const agent of [
      { name: "" },
      agentPayload({ maxToolCalls: 0 }),
      agentPayload({ allowWrite: "yes" }),
      agentPayload({ allowedTools: "read_file" }),
    ]) {
      const error = await ask(server, "work.agent.save", { projectId: project.id, agent });
      if (!("error" in error)) throw new Error("a bad shape must be refused");
      expect(error.error.code).toBe(-32602);
    }

    await expect(readFile(metaPath(project.id), "utf8")).resolves.toBe(before);
  });
});

describe("work templates", () => {
  /** The three shipped ids, in the order the picker shows them. */
  const BUILT_INS = ["reviewer", "implementer", "researcher"];

  async function registerProject(name: string) {
    const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await mkdir(root, { recursive: true });
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
    return { id, root };
  }

  /** One project template file, exactly as `saveProjectTemplate` writes it. */
  async function writeTemplate(id: string, overrides: Record<string, unknown> = {}) {
    const folder = join(workspaceRoot, "work", "templates");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, `${id}.json`),
      JSON.stringify({
        schema: 1,
        name: "Pair programmer",
        role: "pair",
        instructions: "Work one small step at a time and explain each edit.",
        model: "",
        max_tool_calls: 6,
        allowed_tools: ["read_file", "search_files"],
        allow_write: false,
        allow_command: false,
        ...overrides,
      }),
      "utf8",
    );
  }

  test("a fresh workspace lists the three built-ins", async () => {
    const listed = (await resultOf(core(), "work.templates.list")) as {
      templates: Array<Record<string, unknown>>;
    };
    expect(listed.templates.map((template) => template.id)).toEqual(BUILT_INS);
    expect(listed.templates.every((template) => template.source === "built-in")).toBe(true);
    expect(listed.templates[0]).toMatchObject({
      id: "reviewer",
      name: "Reviewer",
      role: "reviewer",
      source: "built-in",
      maxToolCalls: 8,
      allowedTools: ["list_files", "read_file", "search_files"],
    });
    // The row carries the fields the picker fills, so the shell keeps no second
    // template table.
    expect(typeof listed.templates[0].instructions).toBe("string");
    expect((listed.templates[0].instructions as string).length).toBeGreaterThan(0);
  });

  test("a project template file is listed for a registered project", async () => {
    const project = await registerProject("Template app");
    await writeTemplate("pair-programmer");
    const server = core();

    const listed = (await resultOf(server, "work.templates.list", {
      projectId: project.id,
    })) as { templates: Array<Record<string, unknown>> };

    expect(listed.templates.map((template) => template.id)).toEqual([
      ...BUILT_INS,
      "pair-programmer",
    ]);
    expect(listed.templates[3]).toEqual({
      id: "pair-programmer",
      name: "Pair programmer",
      role: "pair",
      summary: "Work one small step at a time and explain each edit.",
      source: "project",
      instructions: "Work one small step at a time and explain each edit.",
      maxToolCalls: 6,
      allowedTools: ["read_file", "search_files"],
    });
    // Listing is a read: the template folder is exactly what the test wrote.
    expect(await readdir(join(workspaceRoot, "work", "templates"))).toEqual([
      "pair-programmer.json",
    ]);
  });

  test("a broken template file is skipped and the list still answers", async () => {
    const project = await registerProject("Template app");
    await writeTemplate("pair-programmer");
    await writeFile(
      join(workspaceRoot, "work", "templates", "broken.json"),
      "{ not json",
      "utf8",
    );

    const listed = (await resultOf(core(), "work.templates.list", {
      projectId: project.id,
    })) as { templates: Array<Record<string, unknown>> };
    expect(listed.templates.map((template) => template.id)).toEqual([
      ...BUILT_INS,
      "pair-programmer",
    ]);
  });

  test("an unknown project is the project shape and nothing is written", async () => {
    const before = existsSync(join(workspaceRoot, "work", "templates"));
    const response = await ask(core(), "work.templates.list", {
      projectId: "missing-000000",
    });
    if (!("error" in response)) throw new Error("an unknown project must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "project",
      projectId: "missing-000000",
    });
    expect(existsSync(join(workspaceRoot, "work", "templates"))).toBe(before);
  });

  test("picking a template fills fields the save path already accepts", async () => {
    const project = await registerProject("Template app");
    await writeTemplate("pair-programmer");
    const server = core();
    const listed = (await resultOf(server, "work.templates.list", {
      projectId: project.id,
    })) as { templates: Array<Record<string, unknown>> };
    const template = listed.templates.find((row) => row.id === "pair-programmer")!;

    // The picker fills the editor; the save is the unchanged `work.agent.save`
    // with the template id recorded as a free string.
    const saved = await resultOf(server, "work.agent.save", {
      projectId: project.id,
      agent: {
        name: template.name,
        role: template.role,
        instructions: template.instructions,
        model: "",
        maxToolCalls: template.maxToolCalls,
        allowedTools: template.allowedTools,
        allowWrite: false,
        allowCommand: false,
        template: template.id,
      },
    });

    const opened = (await resultOf(server, "work.open", { id: project.id })) as {
      project: { agents: Array<Record<string, unknown>> };
    };
    expect(opened.project.agents[0]).toMatchObject({
      id: saved.id,
      name: "Pair programmer",
      role: "pair",
      maxToolCalls: 6,
      allowedTools: ["read_file", "search_files"],
      template: "pair-programmer",
    });
  });
});

describe("work approvals", () => {
  /** A registered project with a real root and one writable/command profile. */
  async function approvalProject(
    permissions: "write" | "commands" = "write",
  ): Promise<{ id: string; root: string }> {
    const root = join(base, "approval-app");
    await mkdir(root, { recursive: true });
    const id = makeProjectId("Approval app");
    unwrap(
      await createProject({ workspace, id, name: "Approval app", folder: root, mode: "chat" }),
    );
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

  test("a proposed create writes nothing; reject keeps it absent", async () => {
    const project = await approvalProject();
    const server = core();
    const path = join(project.root, "notes.md");

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    expect(proposed).toMatchObject({
      path: "notes.md",
      kind: "create",
      baseHash: null,
      stats: { added: 1, removed: 0 },
    });
    expect(proposed.id).toEqual(expect.any(String));
    // The diff is project-relative and never absolute.
    expect(proposed.diff).toContain("--- a/notes.md");
    expect(proposed.diff).toContain("+++ b/notes.md");
    expect(proposed.diff).toContain("+# Notes");
    expect(proposed.diff).not.toContain(project.root);
    expect(proposed.hunks).toHaveLength(1);
    // Proposing is a value: nothing on disk changed.
    expect(existsSync(path)).toBe(false);

    const rejected = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "reject",
    });
    expect(rejected).toEqual({
      decision: "reject",
      applied: false,
      path: "notes.md",
      hunks: [],
      bytes: 0,
    });
    expect(existsSync(path)).toBe(false);

    // A decision consumes the proposal: a second one is "no pending proposal".
    const again = await ask(server, "work.write.decide", {
      id: proposed.id,
      decision: "reject",
    });
    if (!("error" in again)) throw new Error("a consumed proposal must be refused");
    expect(again.error.code).toBe(BOOT_FAILED);
    expect(again.error.retryable).toBe(false);
    expect(again.error.data).toMatchObject({ kind: "write", id: proposed.id });
  });

  test("an approved create writes exactly the proposed bytes", async () => {
    const project = await approvalProject();
    await allowWorkOnDisk();
    const server = core();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Notes\n",
    });
    const approved = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(approved).toEqual({
      decision: "approve",
      applied: true,
      path: "notes.md",
      hunks: [0],
      bytes: 8,
    });
    expect(await readFile(join(project.root, "notes.md"), "utf8")).toBe("# Notes\n");
  });

  test("approving one hunk of an update leaves the other hunk untouched", async () => {
    const project = await approvalProject();
    await allowWorkOnDisk();
    const server = core();
    const path = join(project.root, "notes.md");

    const original = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    await writeFile(path, `${original.join("\n")}\n`, "utf8");

    const next = [...original];
    next[0] = "changed 1";
    next[11] = "changed 12";

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: `${next.join("\n")}\n`,
    });
    expect(proposed.kind).toBe("update");
    expect(proposed.baseHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const hunks = proposed.hunks as Array<{ index: number }>;
    expect(hunks.map((hunk) => hunk.index)).toEqual([0, 1]);

    const approved = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
      hunks: [0],
    });
    expect(approved).toMatchObject({ decision: "approve", applied: true, hunks: [0] });

    const expected = ["changed 1", ...original.slice(1)];
    expect(await readFile(path, "utf8")).toBe(`${expected.join("\n")}\n`);
  });

  test("a path escaping the project root is refused before anything is created", async () => {
    const project = await approvalProject();
    const server = core();

    const response = await ask(server, "work.write.propose", {
      projectId: project.id,
      path: "../escape.md",
      newContent: "x\n",
    });
    if (!("error" in response)) throw new Error("an escaping path must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "write",
      projectId: project.id,
      path: "../escape.md",
    });
    expect(response.error.message).toContain("climbs out of the project root");
    expect(existsSync(join(base, "escape.md"))).toBe(false);
  });

  test("a command is proposed, denied without running, then approved once", async () => {
    const project = await approvalProject("commands");
    await allowWorkOnDisk({ command: true });
    const server = core();
    // `printf` is the requested fixture; Windows gets an equivalent so the
    // behaviour is still exercised there.
    const argv = Bun.which("printf") === null
      ? [process.execPath, "-e", "process.stdout.write('ok')"]
      : ["printf", "ok"];

    const proposed = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv,
      reason: "check the approval path",
    });
    expect(proposed).toMatchObject({
      argv,
      cwd: ".",
      reason: "check the approval path",
    });
    expect(proposed.id).toEqual(expect.any(String));
    expect(proposed.risk).toContain("outside the project");

    const denied = await resultOf(server, "work.command.decide", {
      id: proposed.id,
      decision: "deny",
      reason: "not needed",
    });
    expect(denied).toMatchObject({
      decision: "deny",
      argv,
      cwd: ".",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    });

    const next = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv,
    });
    const approved = await resultOf(server, "work.command.decide", {
      id: next.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({
      decision: "approve",
      argv,
      cwd: ".",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    });
  });

  test("an argv carrying shell syntax is refused as a command, not run", async () => {
    const project = await approvalProject("commands");
    const server = core();

    for (const argv of [
      ["echo", "hi; rm -rf ."],
      ["echo", "$(whoami)"],
      ["echo", "a | b"],
      "echo hi",
    ]) {
      const response = await ask(server, "work.command.propose", {
        projectId: project.id,
        argv,
      });
      if (!("error" in response)) throw new Error("shell syntax must be refused");
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "command", projectId: project.id });
      // The refusal names the token, never a shell line to run.
      expect(response.error.message).toContain("argv");
    }
  });
});

describe("activity log", () => {
  /** A registered project whose default agent may write and run commands. */
  async function activityProject(): Promise<{ id: string; root: string }> {
    const root = join(base, "activity-app");
    await mkdir(root, { recursive: true });
    const id = makeProjectId("Activity app");
    unwrap(await createProject({ workspace, id, name: "Activity app", folder: root, mode: "swarm" }));
    const agentId = makeAgentId("Operator");
    unwrap(
      await createProjectAgent({
        workspace,
        projectId: id,
        id: agentId,
        agent: {
          id: agentId,
          name: "Operator",
          task: "Operate.",
          model: "",
          permissions: "commands",
        },
      }),
    );
    unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
    return { id, root };
  }

  /** The real boot with a deterministic read-only worker, so no provider is touched. */
  function fakeRunnerCore(): CoreServer {
    return createCoreServer({
      boot: async () => {
        const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
        if (!booted.ok) return booted;
        return {
          ok: true as const,
          value: {
            ...booted.value,
            swarmRunner: async () => ({ status: "done" as const, summary: "surveyed the folder" }),
          },
        };
      },
    });
  }

  async function until(
    predicate: () => boolean | Promise<boolean>,
    label: string,
    ms = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await Bun.sleep(5);
    }
  }

  test("decided writes, commands and a swarm record metadata outside the workspace", async () => {
    const project = await activityProject();
    await allowWorkOnDisk({ write: true, command: true });
    const server = fakeRunnerCore();

    const proposed = await resultOf(server, "work.write.propose", {
      projectId: project.id,
      path: "notes.md",
      newContent: "# Activity body\n",
    });
    const approved = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({ decision: "approve", applied: true, path: "notes.md" });
    expect(await readFile(join(project.root, "notes.md"), "utf8")).toBe("# Activity body\n");

    // `printf` is the requested fixture; Windows gets an equivalent.
    const argv = Bun.which("printf") === null
      ? [process.execPath, "-e", "process.stdout.write('ok')"]
      : ["printf", "ok"];
    const command = await resultOf(server, "work.command.propose", {
      projectId: project.id,
      argv,
    });
    const ran = await resultOf(server, "work.command.decide", {
      id: command.id,
      decision: "approve",
    });
    expect(ran).toMatchObject({ decision: "approve", exitCode: 0 });

    const started = (await resultOf(server, "work.swarm.run", {
      projectId: project.id,
      objective: "Survey the project",
      plan: [{ title: "Look around", assignment: "read the folder" }],
    })) as { runId: string; board: SwarmBoard };
    expect(started.runId).toEqual(expect.any(String));

    // The swarm sink is fire-and-forget by design; wait for its final record.
    await until(async () => {
      const listed = await resultOf(server, "activity.list", {
        project: project.id,
        kind: "swarm",
      });
      return (listed.records as ActivityRecord[]).some(
        (record) =>
          record.kind === "swarm" && (record.event === "finished" || record.event === "failed"),
      );
    }, "the swarm activity record");

    const listed = await resultOf(server, "activity.list", { project: project.id });
    expect(listed.empty).toBe(false);
    expect(listed.skipped).toBe(0);
    const records = listed.records as ActivityRecord[];

    const writes = records.filter((record) => record.kind === "write-decision");
    const commands = records.filter((record) => record.kind === "command-decision");
    const swarms = records.filter(
      (record): record is Extract<ActivityRecord, { kind: "swarm" }> => record.kind === "swarm",
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      kind: "write-decision",
      project: project.id,
      path: "notes.md",
      decision: "approve",
      hunks: [0],
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      kind: "command-decision",
      project: project.id,
      decision: "approve",
      exitCode: 0,
    });
    expect(swarms.some((record) => record.event === "started")).toBe(true);
    expect(
      swarms.some((record) => record.event === "finished" || record.event === "failed"),
    ).toBe(true);

    // The log lives in the data dir, never inside the workspace it describes.
    expect(existsSync(join(workspaceRoot, "activity.jsonl"))).toBe(false);
    expect(existsSync(join(dataDir, "activity.jsonl"))).toBe(true);

    // Metadata only: no file body, diff, prompt, stdout or stderr in a record.
    const text = JSON.stringify(records);
    expect(text).not.toContain("Activity body");
    for (const record of records) {
      expect(record).not.toHaveProperty("content");
      expect(record).not.toHaveProperty("diff");
      expect(record).not.toHaveProperty("prompt");
      expect(record).not.toHaveProperty("stdout");
      expect(record).not.toHaveProperty("stderr");
    }
  });
});

describe("work chat", () => {
  /** A registered project with an empty real folder and no chats yet. */
  async function registeredProject(name = "Atlas"): Promise<{ id: string; root: string }> {
    const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await mkdir(root, { recursive: true });
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
    return { id, root };
  }

  function chatsFolder(projectId: string): string {
    return join(workspaceRoot, "work", "projects", projectId, "chats");
  }

  async function writeChat(projectId: string, chatId: string, body: string): Promise<void> {
    const folder = chatsFolder(projectId);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${chatId}.jsonl`), body);
  }

  /** One stored turn pair, in the shape the work chat service writes. */
  function records(question: string, answer: string): string {
    return [
      JSON.stringify({ role: "user", content: question, at: "2026-11-01T09:00:00Z" }),
      JSON.stringify({ role: "assistant", content: answer, at: "2026-11-01T09:00:05Z" }),
      "",
    ].join("\n");
  }

  test("a project with no chats lists none and opens a fresh chat-1", async () => {
    const project = await registeredProject();
    const server = core();

    expect(await resultOf(server, "work.chat.list", { projectId: project.id })).toEqual({ chats: [] });

    const opened = (await resultOf(server, "work.chat.open", { projectId: project.id })) as {
      chatId: string;
      snapshot: Record<string, unknown>;
    };
    // With no model configured the snapshot is idle, not a crash and not an error.
    expect(opened.chatId).toBe("chat-1");
    expect(opened.snapshot).toMatchObject({
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
    });
    expect(opened.snapshot.usage).toMatchObject({ tokens: 0, durationMs: null });
    // Opening a chat reads and writes nothing inside the user's folder.
    expect(await readdir(project.root)).toEqual([]);
  });

  test("resumes the newest stored chat and loads its history without a model", async () => {
    const project = await registeredProject();
    await writeChat(project.id, "chat-1", records("older", "older reply"));
    await writeChat(project.id, "chat-2", records("newest", "newest reply"));
    const server = core();

    expect(await resultOf(server, "work.chat.list", { projectId: project.id })).toEqual({
      chats: ["chat-1", "chat-2"],
    });

    const opened = (await resultOf(server, "work.chat.open", { projectId: project.id })) as {
      chatId: string;
      snapshot: { messages: Array<{ id: string; role: string; text: string; outcome: string }> };
    };
    expect(opened.chatId).toBe("chat-2");
    expect(opened.snapshot.messages).toEqual([
      { id: "history-0", role: "user", text: "newest", outcome: "done" },
      { id: "history-1", role: "assistant", text: "newest reply", outcome: "done" },
    ]);
    // Chat logs live in the workspace, never in the project root.
    expect(await readdir(project.root)).toEqual([]);
  });

  test("an explicit unknown chat is a typed chat error, not a new transcript", async () => {
    const project = await registeredProject();
    await writeChat(project.id, "chat-1", records("first", "answer one"));
    const response = await ask(core(), "work.chat.open", { projectId: project.id, chatId: "chat-9" });
    if (!("error" in response)) throw new Error("an unknown chat must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "chat",
      projectId: project.id,
      chatId: "chat-9",
    });
    expect(existsSync(join(chatsFolder(project.id), "chat-9.jsonl"))).toBe(false);
  });

  test("sending with no model emits done(no-model) and writes no chat file", async () => {
    const project = await registeredProject();
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
      notify: (notification) => notifications.push(notification),
    });
    const opened = (await resultOf(server, "work.chat.open", { projectId: project.id })) as {
      chatId: string;
    };

    const sent = await resultOf(server, "work.chat.send", {
      projectId: project.id,
      chatId: opened.chatId,
      text: "Explain this.",
    });
    expect(sent).toEqual({ turnId: `${project.id}:${opened.chatId}` });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const done = notifications.find((entry) => entry.method === "work.chat.done");
    expect(done?.params).toMatchObject({
      projectId: project.id,
      chatId: opened.chatId,
      kind: "no-model",
    });

    await Bun.sleep(60);
    const state = notifications.find((entry) => entry.method === "work.chat.state");
    expect(state?.params).toMatchObject({
      projectId: project.id,
      chatId: opened.chatId,
      status: "idle",
      blocked: { reason: "no model configured" },
    });

    // Nothing was sent, so nothing was appended.
    expect(existsSync(join(chatsFolder(project.id), `${opened.chatId}.jsonl`))).toBe(false);
    expect(await readdir(project.root)).toEqual([]);
  });

  test("cancelling a chat with nothing in flight is ok", async () => {
    const project = await registeredProject();
    expect(
      await resultOf(core(), "work.chat.cancel", { projectId: project.id, chatId: "chat-1" }),
    ).toEqual({ ok: true });
  });

  test("an unknown project is the project error shape for every work.chat method", async () => {
    const server = core();
    const projectId = "missing-000000";

    for (const [method, params] of [
      ["work.chat.list", { projectId }],
      ["work.chat.open", { projectId }],
      ["work.chat.send", { projectId, chatId: "chat-1", text: "Hi" }],
      ["work.chat.cancel", { projectId, chatId: "chat-1" }],
    ] as const) {
      const response = await ask(server, method, params as unknown as Record<string, unknown>);
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown project`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "project", projectId });
    }
  });

  test("sending into a chat that does not exist is a typed chat error and sends nothing", async () => {
    const project = await registeredProject();
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
      notify: (notification) => notifications.push(notification),
    });

    const response = await ask(server, "work.chat.send", {
      projectId: project.id,
      chatId: "chat-4",
      text: "Hello",
    });
    if (!("error" in response)) throw new Error("an unknown chat must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.data).toMatchObject({
      kind: "chat",
      projectId: project.id,
      chatId: "chat-4",
    });
    expect(existsSync(join(chatsFolder(project.id), "chat-4.jsonl"))).toBe(false);
    expect(notifications).toEqual([]);
  });

  test("a bad shape is -32602 and an empty text starts no turn", async () => {
    const project = await registeredProject();
    const server = core();
    const badCode = async (method: string, params: Record<string, unknown>): Promise<number> => {
      const response = await ask(server, method, params);
      if (!("error" in response)) throw new Error(`${method} should have been refused`);
      return response.error.code;
    };

    expect(await badCode("work.chat.list", {})).toBe(-32602);
    expect(await badCode("work.chat.open", { projectId: project.id, chatId: 4 })).toBe(-32602);
    expect(
      await badCode("work.chat.send", { projectId: project.id, chatId: "chat-1", text: " " }),
    ).toBe(-32602);
    expect(await badCode("work.chat.cancel", { projectId: project.id })).toBe(-32602);
  });
});

describe("work chat proposals", () => {
  /**
   * The real boot, with the chat factory wrapped so the test can call the exact
   * toolbox the controller received. Everything else (workspace, registry,
   * services, proposals map) is the production core, so this is the real path.
   */
  function capturingCore(captured: ChatToolSource[]): CoreServer {
    return createCoreServer({
      boot: async () => {
        const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
        if (!booted.ok) return booted;
        const real = booted.value.createChat;
        return {
          ok: true as const,
          value: {
            ...booted.value,
            createChat: ((
              history: Parameters<typeof real>[0],
              scope: Parameters<typeof real>[1],
              mode: Parameters<typeof real>[2],
              context: Parameters<typeof real>[3],
              tools: Parameters<typeof real>[4],
            ) => {
              if (tools !== undefined) captured.push(tools);
              return real(history, scope, mode, context, tools);
            }) as typeof real,
          },
        };
      },
    });
  }

  type Permissions = "read-only" | "write" | "commands";

  /** A real registered project whose one profile is the default. */
  async function chatProject(permissions: Permissions): Promise<{ id: string; root: string }> {
    const name = `Chat ${permissions}`;
    const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await mkdir(root, { recursive: true });
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder: root, mode: "chat" }));
    const agentId = makeAgentId("Builder");
    unwrap(
      await createProjectAgent({
        workspace,
        projectId: id,
        id: agentId,
        agent: { id: agentId, name: "Builder", task: "Build.", model: "", permissions },
      }),
    );
    unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
    return { id, root };
  }

  async function openedTools(
    server: CoreServer,
    captured: ChatToolSource[],
    projectId: string,
  ): Promise<ChatToolSource> {
    await resultOf(server, "work.chat.open", { projectId });
    const tools = captured.at(-1);
    if (tools === undefined) throw new Error("work.chat.open did not expose a toolbox");
    return tools;
  }

  function parseTool(raw: string): Record<string, unknown> {
    return JSON.parse(raw) as Record<string, unknown>;
  }

  test("a write-capable chat proposes without writing, lists it, then applies on approve", async () => {
    const project = await chatProject("write");
    await allowWorkOnDisk();
    const captured: ChatToolSource[] = [];
    const server = capturingCore(captured);
    const tools = await openedTools(server, captured, project.id);
    expect(tools.specs.map((spec) => spec.name)).toContain("write_file");

    const path = join(project.root, "notes.md");
    const proposed = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "# Notes\n" }),
    );
    expect(proposed).toMatchObject({
      ok: true,
      status: "pending-approval",
      path: "notes.md",
      message: "the user must approve this before it is applied",
    });
    expect(proposed.id).toEqual(expect.any(String));
    // Proposing is a value: the real folder is still empty.
    expect(existsSync(path)).toBe(false);
    expect(await readdir(project.root)).toEqual([]);

    const listed = (await resultOf(server, "work.approvals.list", {
      projectId: project.id,
    })) as { writes: Array<Record<string, unknown>>; commands: unknown[] };
    expect(listed.commands).toEqual([]);
    expect(listed.writes).toHaveLength(1);
    expect(listed.writes[0]).toMatchObject({
      id: proposed.id,
      projectId: project.id,
      path: "notes.md",
      kind: "create",
    });
    expect(listed.writes[0]).not.toHaveProperty("newContent");

    const approved = await resultOf(server, "work.write.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({ decision: "approve", applied: true, path: "notes.md" });
    expect(await readFile(path, "utf8")).toBe("# Notes\n");

    // The pending list is consumed by the decision.
    expect(await resultOf(server, "work.approvals.list", { projectId: project.id })).toEqual({
      writes: [],
      commands: [],
    });
  });

  test("a read-only chat exposes only the read tools and cannot propose", async () => {
    const project = await chatProject("read-only");
    const captured: ChatToolSource[] = [];
    const server = capturingCore(captured);
    const tools = await openedTools(server, captured, project.id);

    expect(tools.specs.map((spec) => spec.name)).toEqual([
      "list_files",
      "read_file",
      "search_files",
    ]);
    const result = parseTool(
      await tools.resolveTool("write_file", { path: "notes.md", content: "x\n" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result.error as { kind: string }).kind).toBe("tool");
    expect(existsSync(join(project.root, "notes.md"))).toBe(false);

    expect(await resultOf(server, "work.approvals.list")).toEqual({
      writes: [],
      commands: [],
    });
  });

  test("a command proposal runs nothing until approve, and a deny never runs it", async () => {
    const project = await chatProject("commands");
    await allowWorkOnDisk({ command: true });
    const captured: ChatToolSource[] = [];
    const server = capturingCore(captured);
    const tools = await openedTools(server, captured, project.id);

    // Deny path: a command that would leave a marker. Nothing may appear.
    const marker = join(project.root, "denied-marker.txt");
    const denied = parseTool(
      await tools.resolveTool("run_command", { argv: ["touch", "denied-marker.txt"] }),
    );
    expect(denied).toMatchObject({
      ok: true,
      status: "pending-approval",
      argv: ["touch", "denied-marker.txt"],
    });
    const listed = (await resultOf(server, "work.approvals.list", {
      projectId: project.id,
    })) as { commands: Array<Record<string, unknown>> };
    expect(listed.commands).toHaveLength(1);
    expect(listed.commands[0]).toMatchObject({
      id: denied.id,
      projectId: project.id,
      argv: ["touch", "denied-marker.txt"],
    });
    expect(existsSync(marker)).toBe(false);

    const rejection = await resultOf(server, "work.command.decide", {
      id: denied.id,
      decision: "deny",
    });
    expect(rejection).toMatchObject({ decision: "deny", exitCode: null, stdout: "" });
    expect(existsSync(marker)).toBe(false);

    // Approve path: the same fixture the explicit approval tests use.
    const argv =
      Bun.which("printf") === null
        ? [process.execPath, "-e", "process.stdout.write('ok')"]
        : ["printf", "ok"];
    const proposed = parseTool(await tools.resolveTool("run_command", { argv }));
    const approved = await resultOf(server, "work.command.decide", {
      id: proposed.id,
      decision: "approve",
    });
    expect(approved).toMatchObject({
      decision: "approve",
      argv,
      exitCode: 0,
      stdout: "ok",
      timedOut: false,
    });
  });
});

describe("work swarms", () => {
  /**
   * A registered swarm project whose default agent may write and run commands.
   *
   * Every worker must still come back read-only: this is the fixture that would
   * expose a widening, because the profile it copies from allows both.
   */
  async function swarmProject(name = "Atlas crew"): Promise<{ id: string; root: string }> {
    const root = join(base, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "main.ts"), "export const start = true\n");
    const id = makeProjectId(name);
    unwrap(await createProject({ workspace, id, name, folder: root, mode: "swarm" }));
    const agentId = makeAgentId("Lead");
    unwrap(
      await createProjectAgent({
        workspace,
        projectId: id,
        id: agentId,
        agent: { id: agentId, name: "Lead", task: "Lead the survey.", model: "", permissions: "commands" },
      }),
    );
    unwrap(await setProjectDefaultAgent({ workspace, projectId: id, id: agentId }));
    return { id, root };
  }

  function reportsFolder(projectId: string): string {
    return join(workspaceRoot, "work", "projects", projectId, "reports");
  }

  async function until(
    predicate: () => boolean | Promise<boolean>,
    label: string,
    ms = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await Bun.sleep(5);
    }
  }

  async function settledBoard(
    server: CoreServer,
    projectId: string,
    runId: string,
  ): Promise<SwarmBoard> {
    let latest: SwarmBoard | undefined;
    await until(async () => {
      const result = await resultOf(server, "work.swarm.board", { projectId, runId });
      latest = result.board as SwarmBoard;
      return latest.status !== "running" && latest.reportPath !== null;
    }, "the swarm to settle");
    if (latest === undefined) throw new Error("the swarm produced no board");
    return latest;
  }

  /**
   * The real boot with the chat factory replaced by one deterministic
   * controller: the production `swarmWorkerRunner` still builds the toolbox and
   * the prompt, and no provider is contacted.
   */
  function answeringCore(captured: ChatToolSource[], answer: string): CoreServer {
    return createCoreServer({
      boot: async () => {
        const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
        if (!booted.ok) return booted;
        const real = booted.value.createChat;
        return {
          ok: true as const,
          value: {
            ...booted.value,
            createChat: ((history: Parameters<typeof real>[0], scope, mode, context, tools) => {
              void history;
              void scope;
              void mode;
              void context;
              if (tools !== undefined) captured.push(tools);
              const state = { messages: [], error: undefined } as unknown as ReturnType<
                ChatController["state"]
              >;
              return {
                send: async (text?: string) => {
                  (state as unknown as { messages: unknown[] }).messages = [
                    { id: "worker-0", role: "user", text: text ?? "", outcome: "done" },
                    { id: "worker-1", role: "assistant", text: answer, outcome: "done" },
                  ];
                  return { kind: "sent", requestId: "swarm-1", outcome: "done" };
                },
                state: () => state,
                cancel: () => {},
                dispose: () => {},
              } as unknown as ChatController;
            }) as typeof real,
          },
        };
      },
    });
  }

  test("a one-task swarm writes its report and hands the worker read-only tools", async () => {
    const project = await swarmProject();
    const captured: ChatToolSource[] = [];
    const server = answeringCore(captured, "The entry point is src/main.ts.\nIt exports start.");

    const started = (await resultOf(server, "work.swarm.run", {
      projectId: project.id,
      objective: "Understand the project layout",
      plan: [{ title: "Trace the entry point", assignment: "read src/main.ts and say where it starts" }],
    })) as { runId: string; board: SwarmBoard };
    expect(started.runId).toEqual(expect.any(String));
    expect(started.board.projectId).toBe(project.id);

    const board = await settledBoard(server, project.id, started.runId);
    expect(board.status).toBe("done");
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]).toMatchObject({
      title: "Trace the entry point",
      status: "done",
      summary: "The entry point is src/main.ts. It exports start.",
    });

    // The report is a real file under this project, with the documented shape.
    const reportPath = join(reportsFolder(project.id), `${started.runId}.md`);
    expect(board.reportPath).toBe(reportPath);
    const report = await readFile(reportPath, "utf8");
    expect(report).toContain(`run: ${started.runId}`);
    expect(report).toContain('objective: "Understand the project layout"');
    expect(report).toContain("status: done");
    expect(report).toContain("- [done] Lead — The entry point is src/main.ts. It exports start.");

    // The profile may write and run commands; the worker still gets three reads.
    expect(captured).toHaveLength(1);
    const specs = captured[0]?.specs ?? [];
    expect(specs.map((spec) => spec.name)).toEqual([...READ_ONLY_TOOL_NAMES]);
    expect(specs.every((spec) => spec.write === false && spec.command === false)).toBe(true);
    expect(captured[0]?.specs.some((spec) => spec.name === "write_file")).toBe(false);
    expect(captured[0]?.specs.some((spec) => spec.name === "run_command")).toBe(false);

    // A worker writes nothing in the project and gets no chat transcript.
    expect(await readdir(project.root)).toEqual(["src"]);
    expect(existsSync(join(workspaceRoot, "work", "projects", project.id, "chats"))).toBe(false);
    // The run is listed for the board surface.
    const runs = (await resultOf(server, "work.swarm.runs", { projectId: project.id })) as {
      runs: SwarmBoard[];
    };
    expect(runs.runs.map((run) => run.runId)).toEqual([started.runId]);
  });

  test("a worker on a workspace with no model reports blocked, not an error", async () => {
    const project = await swarmProject("No model crew");
    const server = core();

    const started = (await resultOf(server, "work.swarm.run", {
      projectId: project.id,
      objective: "Look around",
      plan: [{ title: "Survey", assignment: "list the files" }],
    })) as { runId: string; board: SwarmBoard };

    const board = await settledBoard(server, project.id, started.runId);
    expect(board.status).toBe("failed");
    expect(board.tasks[0]?.status).toBe("blocked");
    expect(board.tasks[0]?.summary).toContain("no model configured");

    const report = await readFile(join(reportsFolder(project.id), `${started.runId}.md`), "utf8");
    expect(report).toContain("status: failed");
    expect(report).toContain("[blocked] Lead — no model configured");
    // Reading the project is all that happened.
    expect(await readdir(project.root)).toEqual(["src"]);
  });
});

describe("skill", () => {
  /** The goal folder the core reads; the shell never receives a path to it. */
  function goalFolder(id: string): string {
    return join(workspaceRoot, "skills", "goals", id);
  }

  test("an empty workspace has no skill sessions", async () => {
    expect(await resultOf(core(), "skill.list")).toEqual({ skills: [] });
  });

  test("skill.create writes the template plan with no model, lists the goal and opens its chapters", async () => {
    // The wizard's Review step with no model configured: the goal is
    // template-built and no provider can be contacted.
    const server = core();

    const created = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
      prior: "I know a little C",
    });
    // The shell gets the three fields it needs, then calls `skill.open`.
    expect(Object.keys(created).sort()).toEqual(["id", "name", "plan"]);
    expect(created).toEqual({
      id: "read-disassembly-output-confidently",
      name: "Read disassembly output confidently",
      plan: "template",
    });

    // It is a real goal folder: the index and both chapter files were written.
    const id = created.id as string;
    expect(existsSync(join(goalFolder(id), "meta.json"))).toBe(true);
    expect(
      existsSync(join(goalFolder(id), "chapters", "01-getting-started.md")),
    ).toBe(true);
    expect(
      existsSync(join(goalFolder(id), "chapters", "01-getting-started-practical.md")),
    ).toBe(true);

    const listed = (await resultOf(server, "skill.list")) as {
      skills: Array<Record<string, unknown>>;
    };
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]).toMatchObject({
      id,
      name: "Read disassembly output confidently",
      stage: { done: 0, total: 0 },
      chapters: { done: 0, total: 1 },
      chats: 0,
      archived: false,
    });
    // The clock is the create call's own `new Date()`, so only its shape is fixed.
    expect(typeof listed.skills[0]!.lastOpened).toBe("string");
    expect((listed.skills[0]!.lastOpened as string).length).toBeGreaterThan(0);

    const opened = (await resultOf(server, "skill.open", { id })) as {
      skill: {
        id: string;
        goal: string;
        prior: string;
        plan: string;
        chapters: Array<{
          id: string;
          title: string;
          guide: string;
          practical: string;
          done: boolean;
        }>;
        stages: Array<{ id: string; title: string; status: string; milestone?: string }>;
      };
    };
    expect(opened.skill).toMatchObject({
      id,
      goal: "Read disassembly output confidently",
      prior: "I know a little C",
      plan: "template",
    });
    expect(opened.skill.chapters).toEqual([
      {
        id: "ch-1",
        title: "Getting started",
        guide: "01-getting-started.md",
        practical: "01-getting-started-practical.md",
        done: false,
      },
    ]);
    // A template course carries chapters only: the stage picker is empty, not
    // an error, because there is no curriculum to pick from.
    expect(opened.skill.stages).toEqual([]);
  });

  test("a configured model writes the chapter plan", async () => {
    // One model call, JSON only. The reply becomes the course; `plan: "model"`
    // tells the shell the outline is generated rather than the template.
    const prompts: string[] = [];
    const plan = [
      {
        title: "Registers and memory",
        guide: "# Lesson: Registers and memory\n\nRead the register table.\n",
        practical: "# Practical: Registers and memory\n\nMap one stack frame.\n",
      },
      {
        title: "Control flow",
        guide: "# Lesson: Control flow\n\nTrace a branch.\n",
        practical: "# Practical: Control flow\n\nTrace a loop by hand.\n",
      },
    ];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return ["Here is the plan:", "```json", JSON.stringify(plan), "```"].join("\n");
    });

    const created = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
      prior: "I know a little C",
    });
    expect(created).toMatchObject({
      id: "read-disassembly-output-confidently",
      name: "Read disassembly output confidently",
      plan: "model",
    });

    // Exactly one provider call, naming the goal and asking for JSON.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Read disassembly output confidently");
    expect(prompts[0]).toContain("I know a little C");
    expect(prompts[0]).toContain("JSON");

    const id = created.id as string;
    // Chapter files are named from the model's titles, in the model's order.
    expect(
      existsSync(join(goalFolder(id), "chapters", "01-registers-and-memory.md")),
    ).toBe(true);
    expect(
      existsSync(join(goalFolder(id), "chapters", "02-control-flow-practical.md")),
    ).toBe(true);

    const opened = (await resultOf(server, "skill.open", { id })) as {
      skill: { plan: string; chapters: Array<{ id: string; title: string; guide: string }> };
    };
    expect(opened.skill.plan).toBe("model");
    expect(opened.skill.chapters.map((chapter) => chapter.title)).toEqual([
      "Registers and memory",
      "Control flow",
    ]);
    expect(opened.skill.chapters.map((chapter) => chapter.id)).toEqual(["ch-1", "ch-2"]);
  });

  test("an unusable model reply falls back to the template without an error", async () => {
    // Malformed JSON is not a failed request: the wizard still gets a course,
    // and `plan: "template"` says where it came from.
    const prompts: string[] = [];
    const server = generatingCore(async (prompt) => {
      prompts.push(prompt);
      return "I cannot write JSON today.";
    });

    const created = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
    });
    expect(created.plan).toBe("template");
    expect(prompts).toHaveLength(1);

    const opened = (await resultOf(server, "skill.open", { id: created.id as string })) as {
      skill: { plan: string; chapters: Array<{ title: string }> };
    };
    expect(opened.skill.plan).toBe("template");
    expect(opened.skill.chapters.map((chapter) => chapter.title)).toEqual(["Getting started"]);
  });

  test("a failed model call falls back to the template without an error", async () => {
    // A provider failure is reported by the chat surface, never by the wizard:
    // creation succeeds with the template and no retry is attempted.
    let calls = 0;
    const server = generatingCore(async () => {
      calls += 1;
      throw new Error("provider unavailable");
    });

    const created = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
    });
    expect(created.plan).toBe("template");
    expect(calls).toBe(1);

    const opened = (await resultOf(server, "skill.open", { id: created.id as string })) as {
      skill: { plan: string; chapters: Array<{ title: string }> };
    };
    expect(opened.skill.plan).toBe("template");
    expect(opened.skill.chapters.map((chapter) => chapter.title)).toEqual(["Getting started"]);
  });

  test("a model plan with a missing field is rejected and the template is written", async () => {
    // A chapter without a practical makes the whole reply unusable: the course
    // falls back rather than writing a mix of model and template chapters.
    const server = generatingCore(async () =>
      JSON.stringify([{ title: "Control flow", guide: "# Lesson\n" }]),
    );

    const created = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
    });
    expect(created.plan).toBe("template");

    const opened = (await resultOf(server, "skill.open", { id: created.id as string })) as {
      skill: { chapters: Array<{ title: string }> };
    };
    expect(opened.skill.chapters.map((chapter) => chapter.title)).toEqual(["Getting started"]);
  });

  test("creating the same goal twice gives each its own folder and id", async () => {
    const server = core();
    const first = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
    });
    const second = await resultOf(server, "skill.create", {
      goal: "Read disassembly output confidently",
    });
    expect(second.id).not.toBe(first.id);
    // The id is derived from the goal, so the second one is the first plus a
    // stable suffix; neither overwrites the other.
    expect(first.id).toBe("read-disassembly-output-confidently");
    expect(second.id).toBe("read-disassembly-output-confidently-2");

    for (const id of [first.id, second.id] as string[]) {
      const opened = (await resultOf(server, "skill.open", { id })) as {
        skill: { id: string; chapters: Array<{ id: string }> };
      };
      expect(opened.skill.id).toBe(id);
      expect(opened.skill.chapters).toHaveLength(1);
    }
    expect((await readdir(join(workspaceRoot, "skills", "goals"))).sort()).toEqual([
      "read-disassembly-output-confidently",
      "read-disassembly-output-confidently-2",
    ]);
  });

  test("an empty goal is -32602 and writes no goal folder", async () => {
    const server = core();
    for (const goal of ["", "   "]) {
      const response = await ask(server, "skill.create", { goal });
      if (!("error" in response)) throw new Error("a blank goal must be refused");
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain("goal");
    }

    // Nothing was created by the refusals, and the manager stays empty.
    expect(await readdir(join(workspaceRoot, "skills", "goals"))).toEqual([]);
    expect(await resultOf(server, "skill.list")).toEqual({ skills: [] });
  });

  test("a storage failure is one typed -32000 and leaves no goal folder", async () => {
    // A goals root that is a file rather than a directory: every write beneath
    // it fails. The refusal is one message in the `skill-create` shape and the
    // blocking path is left exactly as it was — no temp folder, no goal folder.
    const goalsRoot = join(workspaceRoot, "skills", "goals");
    await rm(goalsRoot, { recursive: true, force: true });
    await writeFile(goalsRoot, "not a directory\n");

    const response = await ask(core(), "skill.create", {
      goal: "Read disassembly output confidently",
    });
    if (!("error" in response)) throw new Error("a storage failure must be reported");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "skill-create" });
    expect(typeof (response.error.data as { message: string }).message).toBe("string");
    expect(response.error.message.length).toBeGreaterThan(0);

    await expect(readFile(goalsRoot, "utf8")).resolves.toBe("not a directory\n");
  });

  test("a created course lists with chapter progress and opens with its chapters and chats", async () => {
    // The same action the wizard uses: an index plus the template plan, written
    // atomically under `skills/goals/<id>/`.
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        prior: "I know a little C",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const chat = await createSkillChat({ workspace, goalId: course.id });
    if (!chat.ok) throw new Error(chat.message);
    await writeFile(
      join(goalFolder(course.id), "chats", `${chat.id}.jsonl`),
      [
        JSON.stringify({ role: "user", content: "Where do I start?", at: "2026-11-01T09:05:00Z" }),
        JSON.stringify({
          role: "assistant",
          content: "With the call stack.",
          at: "2026-11-01T09:05:06Z",
        }),
        "",
      ].join("\n"),
    );

    const server = core();
    const listed = (await resultOf(server, "skill.list")) as {
      skills: Array<Record<string, unknown>>;
    };
    expect(listed.skills).toEqual([
      {
        id: course.id,
        name: "Read disassembly output confidently",
        // A course carries chapters, not curriculum stages: the stage pair is
        // zero and the chapter pair is what the row renders.
        stage: { done: 0, total: 0 },
        chapters: { done: 0, total: course.chapters.length },
        lastOpened: "2026-11-01T09:00:00.000Z",
        chats: 1,
        archived: false,
      },
    ]);

    const opened = (await resultOf(server, "skill.open", { id: course.id })) as {
      skill: {
        id: string;
        name: string;
        goal: string;
        prior: string;
        created: string;
        plan: string;
        chapters: Array<{
          id: string;
          title: string;
          guide: string;
          practical: string;
          done: boolean;
        }>;
        chats: Array<{ id: string; title: string; lastUsed: string; messages: number }>;
      };
    };
    expect(opened.skill).toMatchObject({
      id: course.id,
      name: "Read disassembly output confidently",
      goal: "Read disassembly output confidently",
      prior: "I know a little C",
      created: "2026-11-01T09:00:00.000Z",
      plan: "template",
    });
    expect(opened.skill.chapters).toEqual([
      {
        id: "ch-1",
        title: "Getting started",
        guide: "01-getting-started.md",
        practical: "01-getting-started-practical.md",
        done: false,
      },
    ]);
    expect(opened.skill.chats).toEqual([
      {
        id: chat.id,
        title: "Where do I start?",
        lastUsed: "2026-11-01T09:05:06Z",
        messages: 2,
      },
    ]);
  });

  test("opening reads the index only, so lesson bodies are not needed", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    // The chapter files are deliberately gone: a later reader packet reads
    // them, `skill.open` must not.
    await rm(join(goalFolder(course.id), "chapters"), { recursive: true, force: true });

    const opened = (await resultOf(core(), "skill.open", { id: course.id })) as {
      skill: {
        chapters: Array<{
          id: string;
          title: string;
          guide: string;
          practical: string;
          done: boolean;
        }>;
      };
    };
    expect(opened.skill.chapters).toEqual([
      {
        id: "ch-1",
        title: "Getting started",
        guide: "01-getting-started.md",
        practical: "01-getting-started-practical.md",
        done: false,
      },
    ]);
  });

  test("a broken goal is a listed row with its reason and one typed open error", async () => {
    // A folder with no readable meta.json: the manager shows it as broken
    // rather than hiding the user's data or inventing a name.
    await mkdir(join(goalFolder("broken-goal")), { recursive: true });
    const server = core();

    const listed = (await resultOf(server, "skill.list")) as {
      skills: Array<Record<string, unknown>>;
    };
    expect(listed.skills).toHaveLength(1);
    expect(listed.skills[0]).toMatchObject({
      id: "broken-goal",
      name: "broken-goal",
      stage: { done: 0, total: 0 },
      lastOpened: "",
      chats: 0,
      archived: false,
    });
    expect(typeof listed.skills[0]!.broken).toBe("string");

    const response = await ask(server, "skill.open", { id: "broken-goal" });
    if (!("error" in response)) throw new Error("a broken goal must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "skill", id: "broken-goal" });
    // The read itself created nothing in the goal folder.
    expect(await readdir(join(goalFolder("broken-goal")))).toEqual([]);
  });

  test("an unknown skill id is a typed -32000 error, and a blank id is -32602", async () => {
    const server = core();
    const response = await ask(server, "skill.open", { id: "missing-goal" });
    if (!("error" in response)) throw new Error("an unknown skill must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "skill", id: "missing-goal" });

    const blank = await ask(server, "skill.open", { id: "   " });
    if (!("error" in blank)) throw new Error("a blank id must be refused");
    expect(blank.error.code).toBe(-32602);
  });

  test("skill.chapter reads one chapter body and writes nothing", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const folder = goalFolder(course.id);
    const before = (await readdir(folder, { recursive: true })).sort();

    const read = (await resultOf(core(), "skill.chapter", {
      id: course.id,
      chapterId: "ch-1",
    })) as {
      text: string;
      practical: boolean;
      chapter: { id: string; title: string };
    };

    expect(read.practical).toBe(false);
    expect(read.chapter).toEqual({ id: "ch-1", title: "Getting started" });
    // The reply is the file's own bytes, addressed through the index rather
    // than a path supplied by the shell.
    expect(read.text).toBe(await readFile(join(folder, "chapters", "01-getting-started.md"), "utf8"));
    expect(read.text).toContain("# Lesson: Getting started");
    // A read is a read: the folder is byte-for-byte the same set of files.
    expect((await readdir(folder, { recursive: true })).sort()).toEqual(before);
  });

  test("skill.chapter returns the practical when asked, and the lesson otherwise", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const folder = goalFolder(course.id);
    const server = core();

    const practical = (await resultOf(server, "skill.chapter", {
      id: course.id,
      chapterId: "ch-1",
      practical: true,
    })) as { text: string; practical: boolean; chapter: { id: string; title: string } };
    expect(practical.practical).toBe(true);
    expect(practical.chapter).toEqual({ id: "ch-1", title: "Getting started" });
    expect(practical.text).toBe(
      await readFile(join(folder, "chapters", "01-getting-started-practical.md"), "utf8"),
    );
    expect(practical.text).toContain("# Practical: Getting started");

    // `practical: false` is the same read the omitted flag gives.
    const lesson = (await resultOf(server, "skill.chapter", {
      id: course.id,
      chapterId: "ch-1",
      practical: false,
    })) as { text: string; practical: boolean };
    expect(lesson.practical).toBe(false);
    expect(lesson.text).toContain("# Lesson: Getting started");
  });

  test("an unknown chapter is one typed chapter error and reads no file", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const server = core();
    const response = await ask(server, "skill.chapter", {
      id: course.id,
      chapterId: "ch-9",
    });
    if (!("error" in response)) throw new Error("an unknown chapter must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "chapter",
      id: course.id,
      chapterId: "ch-9",
      message: response.error.message,
    });
    expect(response.error.message).toContain('"ch-9"');

    // A blank chapter id is a shape failure, not a lookup.
    const blank = await ask(server, "skill.chapter", { id: course.id, chapterId: "  " });
    if (!("error" in blank)) throw new Error("a blank chapter id must be refused");
    expect(blank.error.code).toBe(-32602);
  });

  test("a course with no chapters directory is one typed error, not a crash", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const folder = goalFolder(course.id);
    // The index still names chapter files, but they are gone: the reader
    // reports the failure once instead of repairing or recreating anything.
    await rm(join(folder, "chapters"), { recursive: true, force: true });
    const server = core();

    const response = await ask(server, "skill.chapter", {
      id: course.id,
      chapterId: "ch-1",
    });
    if (!("error" in response)) throw new Error("a missing chapter body must be an error");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "chapter",
      id: course.id,
      chapterId: "ch-1",
    });
    // Nothing was recreated by the failed read.
    expect((await readdir(folder)).sort()).toEqual(["meta.json"]);

    // The goal page is still readable, so the shell can show the course and
    // the failure together rather than an empty screen.
    const opened = (await resultOf(server, "skill.open", { id: course.id })) as {
      skill: { chapters: Array<{ id: string; title: string }> };
    };
    expect(opened.skill.chapters).toMatchObject([{ id: "ch-1", title: "Getting started" }]);
  });
});

describe("skill sources", () => {
  /** The goal folder the core reads; the shell never receives a path to it. */
  function goalFolder(id: string): string {
    return join(workspaceRoot, "skills", "goals", id);
  }

  async function course(): Promise<string> {
    const created = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        prior: "I know a little C",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    return created.id;
  }

  /** A file the user picked, outside the workspace, exactly as a shell sends it. */
  async function picked(name: string, body: string): Promise<string> {
    const folder = join(base, "input");
    await mkdir(folder, { recursive: true });
    const path = join(folder, name);
    await writeFile(path, body, "utf8");
    return path;
  }

  type SourceRow = {
    name: string;
    storedPath: string;
    kind: string;
    hash: string;
    excerpt: string | null;
    excerptLocation: string | null;
  };

  test("adds picked files, lists them with excerpts, and skips a repeat add", async () => {
    // No model is configured and none is needed: gathering copies files.
    const server = core();
    const id = await course();
    const lecture = await picked("lecture-4.md", "# Lecture 4\n\nBoundary conditions set the limits.\n");
    const notes = await picked("notes.txt", "Energy balance: E = mc^2.\n");

    expect(await resultOf(server, "skill.sources.add", { goalId: id, files: [lecture, notes] })).toEqual(
      { added: 2, skipped: 0 },
    );

    const listed = (await resultOf(server, "skill.sources.list", { goalId: id })) as {
      sources: SourceRow[];
    };
    // Sorted by name, so the list is stable across calls.
    expect(listed.sources.map((row) => row.name)).toEqual(["lecture-4.md", "notes.txt"]);
    for (const row of listed.sources) {
      // Metadata only: no absolute original path and no credential.
      expect(Object.keys(row).sort()).toEqual([
        "excerpt",
        "excerptLocation",
        "hash",
        "kind",
        "name",
        "storedPath",
      ]);
      expect(row.storedPath.startsWith("sources/")).toBe(true);
      expect(row.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof row.excerpt).toBe("string");
      expect(row.excerpt!.length).toBeGreaterThan(0);
      // The citation locator is the copy the goal owns.
      expect(row.excerptLocation).toBe(row.storedPath);
      // The copy really exists inside the goal's `sources/`.
      expect(existsSync(join(goalFolder(id), row.storedPath))).toBe(true);
    }
    expect(listed.sources.map((row) => row.kind)).toEqual(["markdown", "text"]);
    // The originals are never named on the wire.
    expect(JSON.stringify(listed)).not.toContain(join(base, "input"));

    const metaPath = join(goalFolder(id), "meta.json");
    const metaBefore = await readFile(metaPath, "utf8");

    // Identical bytes are stored once: the second add is entirely skipped.
    expect(await resultOf(server, "skill.sources.add", { goalId: id, files: [lecture, notes] })).toEqual(
      { added: 0, skipped: 2 },
    );
    expect(((await resultOf(server, "skill.sources.list", { goalId: id })) as { sources: SourceRow[] }).sources).toEqual(
      listed.sources,
    );
    expect(await readFile(metaPath, "utf8")).toBe(metaBefore);
  });

  test("a goal chat can cite the gathered sources it lists", async () => {
    // The list is the same material the goal chat's toolbox reads: adding a
    // source makes it visible to both surfaces.
    const server = core();
    const id = await course();
    const lecture = await picked("lecture-4.md", "# Lecture 4\n\nBoundary conditions set the limits.\n");
    await resultOf(server, "skill.sources.add", { goalId: id, files: [lecture] });

    const listed = (await resultOf(server, "skill.sources.list", { goalId: id })) as {
      sources: SourceRow[];
    };
    expect(listed.sources).toHaveLength(1);
    const stored = await readFile(join(goalFolder(id), listed.sources[0]!.storedPath), "utf8");
    expect(stored).toBe(await readFile(lecture, "utf8"));
  });

  test("an unknown goal, a blank id and a bad files shape are typed refusals", async () => {
    const server = core();
    const id = await course();
    const file = await picked("notes.txt", "text\n");

    const unknown = await ask(server, "skill.sources.add", { goalId: "missing-goal", files: [file] });
    if (!("error" in unknown)) throw new Error("an unknown goal must be refused");
    expect(unknown.error.code).toBe(BOOT_FAILED);
    expect(unknown.error.retryable).toBe(false);
    expect(unknown.error.data).toMatchObject({ kind: "skill", id: "missing-goal" });

    for (const files of [undefined, [], [123], [""]]) {
      const response = await ask(server, "skill.sources.add", {
        goalId: id,
        ...(files === undefined ? {} : { files }),
      });
      if (!("error" in response)) throw new Error("a bad files shape must be refused");
      expect(response.error.code).toBe(-32602);
    }

    // None of the refusals wrote a row.
    expect(await resultOf(server, "skill.sources.list", { goalId: id })).toEqual({ sources: [] });
  });

  test("a missing file is one typed source error with no partial row", async () => {
    const server = core();
    const id = await course();
    const missing = join(base, "input", "gone.md");

    const response = await ask(server, "skill.sources.add", { goalId: id, files: [missing] });
    if (!("error" in response)) throw new Error("a missing file must be reported");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "source", goalId: id });
    expect(response.error.message.length).toBeGreaterThan(0);

    expect(await resultOf(server, "skill.sources.list", { goalId: id })).toEqual({ sources: [] });
    expect(existsSync(join(goalFolder(id), "sources"))).toBe(false);
  });

  test("reading the list writes nothing", async () => {
    const server = core();
    const id = await course();
    const file = await picked("notes.txt", "text\n");
    await resultOf(server, "skill.sources.add", { goalId: id, files: [file] });

    const folder = goalFolder(id);
    const before = (await readdir(folder, { recursive: true })).sort();
    const metaBefore = await readFile(join(folder, "meta.json"), "utf8");

    await resultOf(server, "skill.sources.list", { goalId: id });

    expect((await readdir(folder, { recursive: true })).sort()).toEqual(before);
    expect(await readFile(join(folder, "meta.json"), "utf8")).toBe(metaBefore);
  });
});

describe("skill chat", () => {
  /** The goal folder the core reads; the shell never receives a path to it. */
  function goalFolder(id: string): string {
    return join(workspaceRoot, "skills", "goals", id);
  }

  function chatsFolder(id: string): string {
    return join(goalFolder(id), "chats");
  }

  /** One stored turn pair, in the shape the skill chat service writes. */
  function records(question: string, answer: string): string {
    return [
      JSON.stringify({ role: "user", content: question, at: "2026-11-01T09:00:00Z" }),
      JSON.stringify({ role: "assistant", content: answer, at: "2026-11-01T09:00:05Z" }),
      "",
    ].join("\n");
  }

  async function course(): Promise<string> {
    const created = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        prior: "I know a little C",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    return created.id;
  }

  test("lists the goal's chats and opens one with its stored history", async () => {
    const id = await course();
    const chat = await createSkillChat({ workspace, goalId: id });
    if (!chat.ok) throw new Error(chat.message);
    await writeFile(join(chatsFolder(id), `${chat.id}.jsonl`), records("Where do I start?", "With the call stack."));
    const server = core();

    const listed = (await resultOf(server, "skill.chat.list", { goalId: id })) as {
      chats: Array<{ id: string; title: string; lastUsed: string; messages: number }>;
    };
    expect(listed.chats).toEqual([
      {
        id: chat.id,
        title: "Where do I start?",
        lastUsed: "2026-11-01T09:00:05Z",
        messages: 2,
      },
    ]);

    // An explicit id opens that chat; the snapshot is the one shape every chat
    // method returns, and with no model it is idle rather than a crash.
    const opened = (await resultOf(server, "skill.chat.open", { goalId: id, chatId: chat.id })) as {
      chatId: string;
      snapshot: {
        status: string;
        model: string | null;
        messages: Array<{ id: string; role: string; text: string; outcome: string }>;
        blocked: unknown;
      };
    };
    expect(opened.chatId).toBe(chat.id);
    expect(opened.snapshot).toMatchObject({ status: "idle", model: null, blocked: null });
    expect(opened.snapshot.messages).toEqual([
      { id: "history-0", role: "user", text: "Where do I start?", outcome: "done" },
      { id: "history-1", role: "assistant", text: "With the call stack.", outcome: "done" },
    ]);

    // An omitted id resumes the newest stored chat instead of starting one.
    const resumed = (await resultOf(server, "skill.chat.open", { goalId: id })) as {
      chatId: string;
    };
    expect(resumed.chatId).toBe(chat.id);
  });

  test("a course with no chats starts chat-1 on open, without a model", async () => {
    const id = await course();
    expect(await resultOf(core(), "skill.chat.list", { goalId: id })).toEqual({ chats: [] });

    const opened = (await resultOf(core(), "skill.chat.open", { goalId: id })) as {
      chatId: string;
      snapshot: Record<string, unknown>;
    };
    expect(opened.chatId).toBe("chat-1");
    expect(opened.snapshot).toMatchObject({
      status: "idle",
      model: null,
      streamed: "",
      messages: [],
      blocked: null,
      error: null,
    });
    expect(opened.snapshot.usage).toMatchObject({ tokens: 0, durationMs: null });
    // The chat is a real file the goal's `meta.json` now lists.
    expect(existsSync(join(chatsFolder(id), "chat-1.jsonl"))).toBe(true);
    expect(await readFile(join(goalFolder(id), "meta.json"), "utf8")).toContain('"chat-1"');
  });

  test("sending with no model emits done(no-model) and appends nothing", async () => {
    const id = await course();
    const chat = await createSkillChat({ workspace, goalId: id });
    if (!chat.ok) throw new Error(chat.message);
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
      notify: (notification) => notifications.push(notification),
    });

    const sent = await resultOf(server, "skill.chat.send", {
      goalId: id,
      chatId: chat.id,
      text: "Explain this.",
    });
    expect(sent).toEqual({ turnId: `${id}:${chat.id}` });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const done = notifications.find((entry) => entry.method === "skill.chat.done");
    expect(done?.params).toMatchObject({ goalId: id, chatId: chat.id, kind: "no-model" });

    await Bun.sleep(60);
    const state = notifications.find((entry) => entry.method === "skill.chat.state");
    expect(state?.params).toMatchObject({
      goalId: id,
      chatId: chat.id,
      status: "idle",
      blocked: { reason: "no model configured" },
    });

    // Nothing was sent, so nothing was appended: the transcript is still empty.
    expect(await readFile(join(chatsFolder(id), `${chat.id}.jsonl`), "utf8")).toBe("");
  });

  test("cancelling a chat with nothing in flight is ok", async () => {
    const id = await course();
    expect(await resultOf(core(), "skill.chat.cancel", { goalId: id, chatId: "chat-1" })).toEqual({
      ok: true,
    });
  });

  test("an unknown goal is the skill error shape for every skill.chat method", async () => {
    const server = core();
    const goalId = "missing-goal";

    for (const [method, params] of [
      ["skill.chat.list", { goalId }],
      ["skill.chat.open", { goalId }],
      ["skill.chat.send", { goalId, chatId: "chat-1", text: "Hi" }],
      ["skill.chat.cancel", { goalId, chatId: "chat-1" }],
    ] as const) {
      const response = await ask(server, method, params as unknown as Record<string, unknown>);
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown goal`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "skill", id: goalId });
    }

    // Nothing was created by the refusals.
    expect(existsSync(join(goalFolder(goalId)))).toBe(false);
  });

  test("an unknown chat is a typed chat error and a bad shape is -32602", async () => {
    const id = await course();
    const chat = await createSkillChat({ workspace, goalId: id });
    if (!chat.ok) throw new Error(chat.message);
    const server = core();

    for (const method of ["skill.chat.open", "skill.chat.send"] as const) {
      const response = await ask(server, method, {
        goalId: id,
        chatId: "chat-9",
        ...(method === "skill.chat.send" ? { text: "Hello" } : {}),
      });
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown chat`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "chat", goalId: id, chatId: "chat-9" });
    }
    expect(existsSync(join(chatsFolder(id), "chat-9.jsonl"))).toBe(false);

    const badCode = async (method: string, params: Record<string, unknown>): Promise<number> => {
      const response = await ask(server, method, params);
      if (!("error" in response)) throw new Error(`${method} should have been refused`);
      return response.error.code;
    };
    expect(await badCode("skill.chat.list", {})).toBe(-32602);
    expect(await badCode("skill.chat.open", { goalId: id, chatId: 4 })).toBe(-32602);
    expect(
      await badCode("skill.chat.send", { goalId: id, chatId: chat.id, text: " " }),
    ).toBe(-32602);
    expect(await badCode("skill.chat.cancel", { goalId: id })).toBe(-32602);
  });

  describe("skill.chat.create", () => {
    /** One streaming fake: a text delta then a terminal `done`. */
    function fakeChat(text: string): ChatService {
      return {
        async *send() {
          yield { type: "text" as const, delta: text };
          yield {
            type: "done" as const,
            text,
            steps: [],
            usage: { input: 3, output: 2, total: 5 },
            durationMs: 4,
          };
        },
        cancel() {},
        active() {
          return [];
        },
      };
    }

    function chatCore(text: string, notifications: CoreNotification[] = []): CoreServer {
      return createCoreServer({
        boot: () =>
          boot({
            workspaceRoot,
            dataDir,
            env: {},
            now: NOW,
            createService: () => fakeChat(text),
          }),
        notify: (notification) => notifications.push(notification),
      });
    }

    /** Config with a model, so the turn reaches the fake service. */
    async function modelConfigured(): Promise<void> {
      await writeFile(join(workspaceRoot, "config.toml"), '[models]\nchat = "custom/fake"\n', "utf8");
    }

    async function waitFor<T>(check: () => T | undefined | null | false, label: string): Promise<T> {
      const deadline = Date.now() + 4_000;
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    test("creates chat-2 and a turn lands only in the new transcript", async () => {
      await modelConfigured();
      const id = await course();
      const first = await createSkillChat({ workspace, goalId: id });
      if (!first.ok) throw new Error(first.message);
      const firstBody = records("first question", "first answer");
      await writeFile(join(chatsFolder(id), `${first.id}.jsonl`), firstBody);

      const notifications: CoreNotification[] = [];
      const server = chatCore("second answer", notifications);

      const created = (await resultOf(server, "skill.chat.create", { goalId: id })) as {
        chatId: string;
        snapshot: Record<string, unknown>;
      };
      expect(created.chatId).toBe("chat-2");
      expect(created.snapshot).toMatchObject({ status: "idle", streamed: "", error: null });
      expect(existsSync(join(chatsFolder(id), "chat-2.jsonl"))).toBe(true);

      // Both chats are recorded in `meta.json`, in creation order.
      const meta = JSON.parse(await readFile(join(goalFolder(id), "meta.json"), "utf8")) as {
        chats: string[];
      };
      expect(meta.chats).toEqual([first.id, "chat-2"]);

      const listed = (await resultOf(server, "skill.chat.list", { goalId: id })) as {
        chats: Array<{ id: string }>;
      };
      expect(listed.chats.map((row) => row.id)).toEqual([first.id, "chat-2"]);

      expect(
        await resultOf(server, "skill.chat.send", {
          goalId: id,
          chatId: "chat-2",
          text: "And this?",
        }),
      ).toEqual({ turnId: `${id}:chat-2` });
      await waitFor(
        () =>
          notifications.some(
            (entry) =>
              entry.method === "skill.chat.done" &&
              (entry.params as { outcome?: string }).outcome === "done",
          ),
        "skill.chat.done",
      );

      // The finished turn is written to the new chat only; `chat-1` is unchanged.
      const second = await readFile(join(chatsFolder(id), "chat-2.jsonl"), "utf8");
      expect(second).toContain("And this?");
      expect(second).toContain("second answer");
      expect(await readFile(join(chatsFolder(id), `${first.id}.jsonl`), "utf8")).toBe(firstBody);
    });

    test("two creates in a row are chat-2 and chat-3", async () => {
      const id = await course();
      const first = await createSkillChat({ workspace, goalId: id });
      if (!first.ok) throw new Error(first.message);
      const server = core();

      const second = (await resultOf(server, "skill.chat.create", { goalId: id })) as {
        chatId: string;
      };
      const third = (await resultOf(server, "skill.chat.create", { goalId: id })) as {
        chatId: string;
      };
      expect([second.chatId, third.chatId]).toEqual(["chat-2", "chat-3"]);

      const meta = JSON.parse(await readFile(join(goalFolder(id), "meta.json"), "utf8")) as {
        chats: string[];
      };
      expect(meta.chats).toEqual([first.id, "chat-2", "chat-3"]);
    });

    test("an unknown goal is the skill error shape and a blank id is -32602", async () => {
      const server = core();
      const unknown = await ask(server, "skill.chat.create", { goalId: "missing-goal" });
      if (!("error" in unknown)) throw new Error("skill.chat.create must refuse an unknown goal");
      expect(unknown.error.code).toBe(BOOT_FAILED);
      expect(unknown.error.retryable).toBe(false);
      expect(unknown.error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
      expect(existsSync(goalFolder("missing-goal"))).toBe(false);

      for (const params of [{}, { goalId: "  " }]) {
        const response = await ask(server, "skill.chat.create", params);
        if (!("error" in response)) throw new Error("skill.chat.create must require a goal id");
        expect(response.error.code).toBe(-32602);
      }
    });
  });
});

describe("skill stages and the goal manager", () => {
  /** A saved curriculum goal with `stage-1` done and `stage-2` active. */
  async function stagedGoal(statement = "read disassembly output confidently") {
    const saved = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(
          validateInput({ statement, level: "beginner", timeBudget: "6 weeks" }),
        ),
        stages: [
          { title: "Registers", milestone: "explain a stack frame" },
          { title: "Control flow", milestone: "trace a loop" },
          { title: "Conventions", milestone: "read a prologue" },
        ],
        created: "2026-11-01T09:00:00.000Z",
      }),
    );
    unwrap(
      await applyTransition({
        workspace,
        goalId: saved.goal.id,
        stageId: "stage-1",
        action: "done",
        now: "2026-11-01T10:00:00.000Z",
      }),
    );
    return saved;
  }

  test("a save reorders, adds, renames and removes stages and keeps every status", async () => {
    const goal = await stagedGoal();
    const server = core();
    const id = goal.goal.id;

    // Reorder: the active stage moves to the front and the done stage follows.
    expect(
      await resultOf(server, "skill.stages.save", {
        goalId: id,
        stages: [
          { id: "stage-2", title: "Control flow", milestone: "trace a loop" },
          { id: "stage-1", title: "Registers", milestone: "explain a stack frame" },
          { id: "stage-3", title: "Conventions", milestone: "read a prologue" },
        ],
      }),
    ).toEqual({
      stages: [
        { id: "stage-2", title: "Control flow", status: "active", milestone: "trace a loop" },
        { id: "stage-1", title: "Registers", status: "done", milestone: "explain a stack frame" },
        { id: "stage-3", title: "Conventions", status: "pending", milestone: "read a prologue" },
      ],
    });

    // Add: an entry without an id is a new stage with a fresh `stage-<n>` id.
    const added = (await resultOf(server, "skill.stages.save", {
      goalId: id,
      stages: [
        { id: "stage-2", title: "Control flow" },
        { id: "stage-1", title: "Registers" },
        { id: "stage-3", title: "Conventions" },
        { title: "Tooling" },
      ],
    })) as { stages: Array<{ id: string; title: string; status: string }> };
    expect(added.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ["stage-2", "active"],
      ["stage-1", "done"],
      ["stage-3", "pending"],
      ["stage-4", "pending"],
    ]);

    // Rename: the saved id keeps its status; a milestone can be dropped.
    expect(
      await resultOf(server, "skill.stages.save", {
        goalId: id,
        stages: [
          { id: "stage-2", title: "Control flow" },
          { id: "stage-1", title: "Registers" },
          { id: "stage-3", title: "Calling conventions" },
          { id: "stage-4", title: "Tooling" },
        ],
      }),
    ).toMatchObject({
      stages: [
        { id: "stage-2", title: "Control flow", status: "active" },
        { id: "stage-1", title: "Registers", status: "done" },
        { id: "stage-3", title: "Calling conventions", status: "pending" },
        { id: "stage-4", title: "Tooling", status: "pending" },
      ],
    });

    // Remove a pending stage: no confirmation is needed, no progress is lost.
    expect(
      await resultOf(server, "skill.stages.save", {
        goalId: id,
        stages: [
          { id: "stage-2", title: "Control flow" },
          { id: "stage-1", title: "Registers" },
          { id: "stage-4", title: "Tooling" },
        ],
      }),
    ).toMatchObject({
      stages: [
        { id: "stage-2", title: "Control flow", status: "active" },
        { id: "stage-1", title: "Registers", status: "done" },
        { id: "stage-4", title: "Tooling", status: "pending" },
      ],
    });

    // What is on disk is what the reply said, and the derived fields agree.
    const meta = JSON.parse(await readFile(join(goal.folder, "meta.json"), "utf8")) as {
      stages: Array<{ id: string; status: string }>;
      progress: Record<string, boolean>;
      complete: boolean;
    };
    expect(meta.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ["stage-2", "active"],
      ["stage-1", "done"],
      ["stage-4", "pending"],
    ]);
    expect(meta.progress).toEqual({ "stage-2": false, "stage-1": true, "stage-4": false });
    expect(meta.complete).toBe(false);

    // The goal page reads the same order, and nothing else about the goal moved.
    const opened = (await resultOf(server, "skill.open", { id })) as {
      skill: { name: string; stages: unknown[] };
    };
    expect(opened.skill.stages).toEqual([
      { id: "stage-2", title: "Control flow", status: "active" },
      { id: "stage-1", title: "Registers", status: "done" },
      { id: "stage-4", title: "Tooling", status: "pending" },
    ]);
    expect(opened.skill.name).toBe("read disassembly output confidently");
  });

  test("removing a done stage is refused until confirmed, then only that stage goes", async () => {
    const goal = await stagedGoal();
    const server = core();
    const id = goal.goal.id;
    const before = await readFile(join(goal.folder, "meta.json"), "utf8");

    const response = await ask(server, "skill.stages.save", {
      goalId: id,
      stages: [
        { id: "stage-2", title: "Control flow" },
        { id: "stage-3", title: "Conventions" },
      ],
    });
    if (!("error" in response)) throw new Error("an unconfirmed done-stage removal must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "stage", goalId: id });
    expect(response.error.message).toContain("“Registers”");
    // A refusal leaves the file byte-identical.
    await expect(readFile(join(goal.folder, "meta.json"), "utf8")).resolves.toBe(before);

    expect(
      await resultOf(server, "skill.stages.save", {
        goalId: id,
        confirmed: true,
        stages: [
          { id: "stage-3", title: "Conventions" },
          { id: "stage-2", title: "Control flow" },
        ],
      }),
    ).toEqual({
      stages: [
        { id: "stage-3", title: "Conventions", status: "pending" },
        { id: "stage-2", title: "Control flow", status: "active" },
      ],
    });
  });

  test("editing stages on a course goal preserves its chapter index", async () => {
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        prior: "I know a little C",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const folder = join(workspaceRoot, "skills", "goals", course.id);
    const server = core();

    expect(
      await resultOf(server, "skill.stages.save", {
        goalId: course.id,
        stages: [{ title: "Registers" }, { title: "Control flow", milestone: "trace a loop" }],
      }),
    ).toEqual({
      stages: [
        { id: "stage-1", title: "Registers", status: "pending" },
        { id: "stage-2", title: "Control flow", status: "pending", milestone: "trace a loop" },
      ],
    });

    // The metadata writer replaces `stages` and the derived fields only: a
    // course keeps its chapter index, plan source and prior knowledge.
    const meta = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.chapters).toMatchObject([{ id: "ch-1", title: "Getting started" }]);
    expect(meta.plan).toBe("template");
    expect(meta.prior).toBe("I know a little C");
    expect(existsSync(join(folder, "chapters", "01-getting-started.md"))).toBe(true);

    const opened = (await resultOf(server, "skill.open", { id: course.id })) as {
      skill: { chapters: unknown[]; stages: unknown[] };
    };
    expect(opened.skill.chapters).toHaveLength(1);
    expect(opened.skill.stages).toHaveLength(2);
  });

  test("archive moves the goal to the configured folder and the manager stops listing it", async () => {
    const goal = await stagedGoal();
    const sibling = await stagedGoal("read cachegrind output");
    // A chat proves the archive carries no conversation.
    const chat = await createSkillChat({ workspace, goalId: goal.goal.id });
    if (!chat.ok) throw new Error(chat.message);
    expect(existsSync(join(goal.folder, "chats", `${chat.id}.jsonl`))).toBe(true);
    const siblingMeta = await readFile(join(sibling.folder, "meta.json"), "utf8");

    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder: archiveRoot } }));
    const server = core();

    expect(await resultOf(server, "skill.archive", { goalId: goal.goal.id })).toEqual({
      action: "archive",
      backend: "folder",
    });

    // The live folder moved; the archived copy is the goal without its chats.
    expect(existsSync(goal.folder)).toBe(false);
    const archived = join(archiveRoot, "skills", "goal", goal.goal.id);
    expect(existsSync(join(archived, "meta.json"))).toBe(true);
    expect(existsSync(join(archived, "curriculum.md"))).toBe(true);
    expect(existsSync(join(archived, "chats"))).toBe(false);

    // The manager no longer lists it, and the archive picker does.
    expect(((await resultOf(server, "skill.list")).skills as Array<{ id: string }>).map((row) => row.id)).toEqual([
      sibling.goal.id,
    ]);
    expect(((await resultOf(server, "archive.list")).rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: goal.goal.id,
      side: "skills",
      kind: "goal",
      backend: "folder",
    });

    // Nothing else in the workspace changed.
    expect(existsSync(sibling.folder)).toBe(true);
    await expect(readFile(join(sibling.folder, "meta.json"), "utf8")).resolves.toBe(siblingMeta);
    expect(existsSync(join(workspaceRoot, "exports", `goal-${goal.goal.id}.zip`))).toBe(false);
  });

  test("archive with no usable backend is refused before the goal is read", async () => {
    const goal = await stagedGoal();
    const server = core();

    const response = await ask(server, "skill.archive", { goalId: goal.goal.id });
    if (!("error" in response)) throw new Error("an unconfigured archive must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "archive", id: goal.goal.id });
    expect(response.error.message).toContain("archive folder");

    // The live goal is untouched: a refusal never archives in place of a failure.
    expect(existsSync(join(goal.folder, "meta.json"))).toBe(true);
  });

  test("export writes one zip inside exports and leaves the live goal alone", async () => {
    const goal = await stagedGoal();
    const chat = await createSkillChat({ workspace, goalId: goal.goal.id });
    if (!chat.ok) throw new Error(chat.message);
    const server = core();
    const metaBefore = await readFile(join(goal.folder, "meta.json"), "utf8");

    const exported = await resultOf(server, "skill.export", { goalId: goal.goal.id });
    expect(Object.keys(exported).sort()).toEqual(["action", "path"]);
    expect(exported.action).toBe("export");
    // There is no destination parameter: the path is the workspace's own.
    expect(exported.path).toBe(join(workspaceRoot, "exports", `goal-${goal.goal.id}.zip`));
    expect(existsSync(exported.path as string)).toBe(true);

    const entries = listZip(new Uint8Array(await Bun.file(exported.path as string).arrayBuffer()));
    expect(entries).toContain("meta.json");
    expect(entries).toContain("curriculum.md");
    // Conversations are never exported.
    expect(entries.some((entry) => entry.startsWith("chats/"))).toBe(false);

    // Export is additive.
    await expect(readFile(join(goal.folder, "meta.json"), "utf8")).resolves.toBe(metaBefore);
    expect(await readdir(join(workspaceRoot, "exports"))).toEqual([`goal-${goal.goal.id}.zip`]);
  });

  test("remove deletes only the live folder, not the archive or a sibling goal", async () => {
    const goal = await stagedGoal();
    const sibling = await stagedGoal("read cachegrind output");
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    // An archived copy of the same id exists while the live folder stays: the
    // delete must remove the live folder only.
    const backend = unwrap(openFolderArchive({ archiveRoot, workspaceRoot: workspace.root }));
    unwrap(
      await backend.put(
        { side: "skills", id: goal.goal.id, backend: "folder", kind: "goal" },
        goal.folder,
      ),
    );
    // The picker reads the configured folder, so select it before listing.
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder: archiveRoot } }));
    const server = core();

    expect(await resultOf(server, "skill.remove", { goalId: goal.goal.id })).toEqual({
      action: "delete",
    });

    expect(existsSync(goal.folder)).toBe(false);
    expect(existsSync(join(archiveRoot, "skills", "goal", goal.goal.id, "meta.json"))).toBe(true);
    expect(existsSync(join(sibling.folder, "meta.json"))).toBe(true);
    expect(((await resultOf(server, "skill.list")).skills as Array<{ id: string }>).map((row) => row.id)).toEqual([
      sibling.goal.id,
    ]);
    expect(((await resultOf(server, "archive.list")).rows as Array<Record<string, unknown>>).map((row) => row.id)).toEqual([
      goal.goal.id,
    ]);
  });

  test("an unknown goal is the shared skill shape for all four methods", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder: archiveRoot } }));
    const server = core();
    const missing = "missing-goal";

    for (const method of [
      "skill.archive",
      "skill.remove",
      "skill.export",
    ] as const) {
      const response = await ask(server, method, { goalId: missing });
      if (!("error" in response)) throw new Error(`${method} must refuse an unknown goal`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "skill", id: missing });
    }

    const staged = await ask(server, "skill.stages.save", {
      goalId: missing,
      stages: [{ title: "Registers" }],
    });
    if (!("error" in staged)) throw new Error("skill.stages.save must refuse an unknown goal");
    expect(staged.error.data).toMatchObject({ kind: "skill", id: missing });

    // A blank id is a bad request, not a failure that boots a workspace.
    for (const method of [
      "skill.stages.save",
      "skill.archive",
      "skill.remove",
      "skill.export",
    ] as const) {
      const response = await ask(server, method, { goalId: "   ", stages: [] });
      if (!("error" in response)) throw new Error(`${method} must refuse a blank goal id`);
      expect(response.error.code).toBe(-32602);
    }

    // No verb invented a folder, an archive row or an export.
    expect(existsSync(join(archiveRoot, "skills", "goal", missing))).toBe(false);
    expect(existsSync(join(workspaceRoot, "exports", `goal-${missing}.zip`))).toBe(false);
    expect(await resultOf(server, "skill.list")).toEqual({ skills: [] });
  });
});

describe("mcp.list", () => {
  test("a fresh workspace has no servers and no policy cells", async () => {
    const listed = await resultOf(core(), "mcp.list");
    // `plugins.policy` starts empty; the core never invents a cell for a server
    // that does not exist (`DEFAULT_PLUGIN_POLICY` is the policy engine's job).
    expect(listed).toEqual({ servers: [], policy: {} });

    // Nothing was configured, so there is nothing to spawn. Reading the list
    // did not write a server row into the workspace config either.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).not.toContain("[plugins.servers.");
  });

  test("mcp.refresh with no configured servers returns no rows", async () => {
    // A fresh workspace has zero servers, so refresh has nothing to connect and
    // must not leave a phantom row behind.
    const refreshed = await resultOf(core(), "mcp.refresh");
    expect(refreshed).toEqual({ servers: [] });
    expect(await resultOf(core(), "mcp.list")).toEqual({ servers: [], policy: {} });
  });

  test("mcp.policy.get is the same read-only matrix as mcp.list", async () => {
    const server = core();
    const listed = await resultOf(server, "mcp.list");
    expect(await resultOf(server, "mcp.policy.get")).toEqual({ policy: listed.policy });
  });
});

describe("mcp.policy.set", () => {
  /** Configure one disabled server, so the policy layer has a real target. */
  async function withServer(name = "notes"): Promise<void> {
    unwrap(
      await patchConfig(workspace.paths, {
        plugins: {
          servers: {
            [name]: { transport: "stdio", command: "mcp-notes", args: [], enabled: false },
          },
        },
      }),
    );
  }

  test("writes one cell to config.toml and reports the new matrix", async () => {
    await withServer();
    const server = policyCore();

    const written = await resultOf(server, "mcp.policy.set", {
      command: "lockin",
      server: "notes",
      value: "off",
    });
    expect(written).toEqual({ policy: { lockin: { notes: "off" } } });

    // The write is in the config file, not only in the process: a restart reads
    // the same cell back.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toContain("[plugins.policy.lockin]");
    expect(config).toMatch(/\[plugins\.policy\.lockin\][^[]*notes = "off"/s);

    // And the read path reflects it immediately, without a second boot.
    expect(await resultOf(server, "mcp.policy.get")).toEqual({
      policy: { lockin: { notes: "off" } },
    });
    const listed = await resultOf(server, "mcp.list");
    expect(listed.policy).toEqual({ lockin: { notes: "off" } });
  });

  test("a second write keeps the first cell", async () => {
    await withServer();
    const server = policyCore();
    await resultOf(server, "mcp.policy.set", { command: "lockin", server: "notes", value: "off" });
    const second = await resultOf(server, "mcp.policy.set", {
      command: "chill",
      server: "notes",
      value: "explicit",
    });
    expect(second).toEqual({
      policy: { lockin: { notes: "off" }, chill: { notes: "explicit" } },
    });
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toContain("[plugins.policy.lockin]");
    expect(config).toContain("[plugins.policy.chill]");
  });

  test("the value survives a fresh boot", async () => {
    await withServer();
    await resultOf(policyCore(), "mcp.policy.set", {
      command: "skill",
      server: "notes",
      value: "off",
    });
    expect(await resultOf(policyCore(), "mcp.policy.get")).toEqual({
      policy: { skill: { notes: "off" } },
    });
  });

  test("an unconfigured server is refused and config.toml is byte-identical", async () => {
    const server = policyCore();
    // Boot writes the documented defaults; read them after, not before.
    expect(await resultOf(server, "mcp.policy.get")).toEqual({ policy: {} });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    const response = await ask(server, "mcp.policy.set", {
      command: "chill",
      server: "ghost",
      value: "off",
    });
    if (!("error" in response)) throw new Error("an unknown server must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "plugin",
      command: "chill",
      server: "ghost",
    });
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
  });

  test('"on" is refused for flashcards and study-guide without a write', async () => {
    await withServer();
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    const server = policyCore();
    for (const command of ["flashcards", "study-guide"] as const) {
      const response = await ask(server, "mcp.policy.set", {
        command,
        server: "notes",
        value: "on",
      });
      if (!("error" in response)) throw new Error(`${command} must refuse "on"`);
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain(`${command} never calls plugins`);
    }
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
    // Nothing was invented: the matrix is still the boot-time empty one.
    expect(await resultOf(server, "mcp.policy.get")).toEqual({ policy: {} });
  });

  test("a value outside the union is -32602 and never reaches the config", async () => {
    await withServer();
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    const response = await ask(policyCore(), "mcp.policy.set", {
      command: "chill",
      server: "notes",
      value: "always",
    });
    if (!("error" in response)) throw new Error("an unknown value must be refused");
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain("on, explicit, off");
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
  });
});

/**
 * The per-call permission gate, through a real chat turn.
 *
 * A fake MCP host stands in for the server — no process, no network, no key —
 * and a fake `ChatService` is the model: it calls the write tool the request
 * offered and records the tool result. Everything between them is production:
 * the real workspace, the real boot, the real chat controller, the real plugin
 * runtime and the protocol's own gate.
 */
describe("plugin write permission", () => {
  type Turn = { started: boolean; result?: string };
  type HostCall = { id: string; tool: string; input: Record<string, unknown> };

  const TOOLS: McpTool[] = [
    {
      name: "read_note",
      description: "Read one note.",
      readOnly: true,
      destructive: false,
      label: "external explanation",
    },
    {
      name: "write_note",
      description: "Replace a note.",
      readOnly: false,
      destructive: true,
      label: "external explanation",
    },
  ];

  function fakeHost(): { host: McpHost; calls: HostCall[] } {
    const calls: HostCall[] = [];
    const alive = new Set<string>();
    const host: McpHost = {
      async connect(id) {
        alive.add(id);
        return { ok: true, value: { id, pid: null, alive: true, calls: 0, stderr: [] } };
      },
      async listTools() {
        return { ok: true, value: [...TOOLS] };
      },
      async call(id, tool, input) {
        calls.push({ id, tool, input });
        return {
          ok: true,
          value: {
            text: `wrote ${String(input["body"])} to ${String(input["path"])}`,
            isError: false,
            ms: 1,
            label: "external explanation",
          },
        };
      },
      async close(id) {
        if (id === undefined) alive.clear();
        else alive.delete(id);
      },
      state(id) {
        return { id, pid: null, alive: alive.has(id), calls: 0, stderr: [] };
      },
      pidOf() {
        return null;
      },
      stderrOf() {
        return [];
      },
      servers() {
        return [];
      },
    };
    return { host, calls };
  }

  function waitFor<T>(check: () => T | undefined | null | false, label: string): Promise<T> {
    const deadline = Date.now() + 4_000;
    return (async () => {
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })();
  }

  /**
   * The real boot, with the plugin runtime replaced by one over the fake host.
   *
   * `createChat` is wrapped so the controller's toolbox includes the runtime's
   * plugin tools: that is the same merge boot does at send time, with the gate
   * the protocol installed on the runtime after boot.
   */
  function permissionCore(state: {
    notifications: CoreNotification[];
    turns: Turn[];
    host: McpHost;
  }): CoreServer {
    const service: ChatService = {
      async *send(request: ChatRequest) {
        const turn: Turn = { started: false };
        state.turns.push(turn);
        if (
          request.resolveTool !== undefined &&
          request.tools?.some((spec) => spec.name === "write_note" && spec.write)
        ) {
          turn.started = true;
          turn.result = await request.resolveTool("write_note", {
            path: "notes.md",
            body: "hello",
          });
        }
        yield { type: "text" as const, delta: "done" };
        yield {
          type: "usage" as const,
          tokens: { input: 4, output: 1, total: 5 },
        };
        yield {
          type: "done" as const,
          text: "done",
          steps: [],
          usage: { input: 4, output: 1, total: 5 },
          durationMs: 1,
        };
      },
      cancel() {},
      active() {
        return [];
      },
    };

    return createCoreServer({
      notify: (notification) => state.notifications.push(notification),
      boot: async () => {
        const booted = await boot({
          workspaceRoot,
          dataDir,
          env: {},
          now: NOW,
          createService: () => service,
        });
        if (!booted.ok) return booted;
        const runtime: PluginRuntime = createPluginRuntime(
          [{ id: "notes", command: "fake-mcp", args: [], enabled: true }],
          { host: state.host },
        );
        await runtime.start();
        const real = booted.value.createChat;
        return {
          ok: true as const,
          value: {
            ...booted.value,
            pluginRuntime: runtime,
            createChat: ((
              history: Parameters<typeof real>[0],
              scope: Parameters<typeof real>[1],
              mode: Parameters<typeof real>[2],
              context: Parameters<typeof real>[3],
              tools: Parameters<typeof real>[4],
            ) => {
              const plugin = runtime.sourceFor(mode ?? "chill");
              return real(
                history,
                scope,
                mode,
                context,
                mergeToolSources(tools ?? null, plugin) ?? undefined,
              );
            }) as typeof real,
          },
        };
      },
    });
  }

  /** A real registered project, a fake model and a model configured before boot. */
  async function project(): Promise<{ id: string; chatId: string; server: CoreServer; state: {
    notifications: CoreNotification[];
    turns: Turn[];
    host: McpHost;
    calls: HostCall[];
  } }> {
    await writeFile(
      join(workspaceRoot, "config.toml"),
      '[models]\nchat = "custom/fake"\n',
      "utf8",
    );
    const root = join(base, "plugin-project");
    await mkdir(root, { recursive: true });
    const id = makeProjectId("Plugin project");
    unwrap(await createProject({ workspace, id, name: "Plugin project", folder: root, mode: "chat" }));

    const { host, calls } = fakeHost();
    const state = { notifications: [] as CoreNotification[], turns: [] as Turn[], host, calls };
    const server = permissionCore(state);
    const opened = (await resultOf(server, "work.chat.open", { projectId: id })) as {
      chatId: string;
    };
    return { id, chatId: opened.chatId, server, state };
  }

  test("a chat write call waits for mcp.confirm and runs exactly once", async () => {
    const { id, chatId, server, state } = await project();

    await resultOf(server, "work.chat.send", {
      projectId: id,
      chatId,
      text: "Write the note.",
    });

    const permission = await waitFor(
      () => state.notifications.filter((entry) => entry.method === "mcp.permission").at(-1),
      "mcp.permission",
    );
    expect(permission.params).toMatchObject({
      server: "notes",
      tool: "write_note",
      write: true,
      input: { path: "notes.md", body: "hello" },
    });
    const requestId = permission.params?.["requestId"];
    expect(typeof requestId).toBe("string");

    // The turn is holding on the prompt: the host has not been called and the
    // model has no tool result yet.
    await waitFor(() => state.turns.at(-1)?.started === true, "the tool call");
    expect(state.calls).toHaveLength(0);
    expect(state.turns.at(-1)?.result).toBeUndefined();

    expect(
      await resultOf(server, "mcp.confirm", { requestId, allow: true }),
    ).toEqual({ ok: true });

    await waitFor(
      () => state.notifications.filter((entry) => entry.method === "work.chat.done").length >= 1,
      "work.chat.done",
    );
    expect(state.calls).toHaveLength(1);
    expect(state.turns.at(-1)?.result).toBe("wrote hello to notes.md");
  });

  test("a second write asks again; a denial runs nothing and reports the typed error", async () => {
    const { id, chatId, server, state } = await project();

    // First turn: approve so there is a real call to leave behind.
    await resultOf(server, "work.chat.send", { projectId: id, chatId, text: "Write it." });
    const first = await waitFor(
      () => state.notifications.filter((entry) => entry.method === "mcp.permission").at(-1),
      "the first prompt",
    );
    await resultOf(server, "mcp.confirm", {
      requestId: first.params?.["requestId"],
      allow: true,
    });
    await waitFor(
      () => state.notifications.filter((entry) => entry.method === "work.chat.done").length >= 1,
      "the first done",
    );
    expect(state.calls).toHaveLength(1);

    // Second turn: the approval is not remembered, so a new prompt appears.
    const promptsBefore = state.notifications.filter(
      (entry) => entry.method === "mcp.permission",
    ).length;
    await resultOf(server, "work.chat.send", { projectId: id, chatId, text: "Again." });
    const second = await waitFor(
      () =>
        state.notifications.filter((entry) => entry.method === "mcp.permission").length >
          promptsBefore
          ? state.notifications.filter((entry) => entry.method === "mcp.permission").at(-1)
          : undefined,
      "the second prompt",
    );
    expect(second.params?.["requestId"]).not.toBe(first.params?.["requestId"]);

    await resultOf(server, "mcp.confirm", {
      requestId: second.params?.["requestId"],
      allow: false,
    });
    await waitFor(
      () => state.notifications.filter((entry) => entry.method === "work.chat.done").length >= 2,
      "the second done",
    );
    // A denial is a tool result, not a turn failure, and the plugin never ran.
    expect(state.calls).toHaveLength(1);
    expect(JSON.parse(state.turns.at(-1)?.result ?? "{}")).toEqual({
      ok: false,
      error: { kind: "permission", message: "the user declined this plugin write" },
    });
    expect(state.notifications.some((entry) => entry.method === "work.chat.error")).toBe(false);
  });
});

describe("keybinds", () => {
  test("a fresh workspace has no overrides; the defaults live in the UI", async () => {
    const server = keybindCore();
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: {},
      fixedKeybinds: {},
    });
    // Nothing was invented: the config carries no binding the user did not set.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).not.toContain('navigator = "');
  });

  test("a leader binding and a fixed key land in config.toml and read back", async () => {
    const server = keybindCore();
    const leader = await resultOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+e",
    });
    expect(leader).toEqual({ keybinds: { navigator: "space+e" }, fixedKeybinds: {} });

    const fixed = await resultOf(server, "keybinds.set", {
      action: "quit",
      binding: "ctrl+q",
      fixed: true,
    });
    expect(fixed).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: { quit: "ctrl+q" },
    });

    // Both tables are in the file, in their own sections.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toMatch(/\[ui\.keybinds\][^[]*navigator = "space\+e"/s);
    expect(config).toMatch(/\[ui\.fixed_keybinds\][^[]*quit = "ctrl\+q"/s);

    // And the read path reflects the write without a second boot.
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: { quit: "ctrl+q" },
    });

    // A restart reads the same overrides: the config file is the truth.
    expect(await resultOf(keybindCore(), "keybinds.get")).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: { quit: "ctrl+q" },
    });
  });

  test("a duplicate in another action is refused and config.toml is byte-identical", async () => {
    const server = keybindCore();
    await resultOf(server, "keybinds.set", { action: "work-swarms", binding: "space+x" });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    const response = await ask(server, "keybinds.set", {
      action: "navigator",
      binding: "space+x",
    });
    if (!("error" in response)) throw new Error("a duplicate binding must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "keybind",
      action: "navigator",
      binding: "space+x",
      conflict: "work-swarms",
      message: "Space x is already bound to work-swarms.",
    });
    expect(response.error.message).toBe("Space x is already bound to work-swarms.");

    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: { "work-swarms": "space+x" },
      fixedKeybinds: {},
    });
  });

  test("a duplicate across the two tables is refused too", async () => {
    const server = keybindCore();
    await resultOf(server, "keybinds.set", { action: "insert", binding: "i", fixed: true });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    const response = await ask(server, "keybinds.set", {
      action: "add-sources",
      binding: "i",
    });
    if (!("error" in response)) throw new Error("a cross-table duplicate must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.data).toEqual({
      kind: "keybind",
      action: "add-sources",
      binding: "i",
      conflict: "insert",
      message: "i is already bound to insert.",
    });
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
  });

  test("a null binding clears the override, and the clear survives a restart", async () => {
    const server = keybindCore();
    await resultOf(server, "keybinds.set", { action: "navigator", binding: "space+e" });

    const cleared = await resultOf(server, "keybinds.set", {
      action: "navigator",
      binding: null,
    });
    expect(cleared).toEqual({ keybinds: {}, fixedKeybinds: {} });

    // The file records the action as unset rather than keeping the old chord.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toMatch(/\[ui\.keybinds\][^[]*navigator = ""/s);

    // A fresh boot sees no override, so the registry default applies again.
    expect(await resultOf(keybindCore(), "keybinds.get")).toEqual({
      keybinds: {},
      fixedKeybinds: {},
    });
  });

  test("an invalid form is -32602 and writes nothing", async () => {
    const server = keybindCore();
    expect(await resultOf(server, "keybinds.get")).toEqual({ keybinds: {}, fixedKeybinds: {} });
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    const response = await ask(server, "keybinds.set", {
      action: "navigator",
      binding: "ctrl+shift+k",
    });
    if (!("error" in response)) throw new Error("an unsupported form must be refused");
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain("not a binding");
    expect(response.error.message).toContain("space+<key>");
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
  });
});

describe("decision.get and decision.set", () => {
  test("a fresh workspace is off, empty and rules-only", async () => {
    expect(await resultOf(core(), "decision.get")).toEqual({
      enabled: false,
      model: "",
      rulesOnly: true,
      localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
    });
  });

  test("enabling without a model writes [decision_layer] and echoes it", async () => {
    const server = decisionCore();
    expect(await resultOf(server, "decision.get")).toEqual({
      enabled: false,
      model: "",
      rulesOnly: true,
      localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
    });

    const written = await resultOf(server, "decision.set", { enabled: true });
    expect(written).toEqual({
      enabled: true,
      model: "",
      rulesOnly: true,
      localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
    });

    // The write is in the config file, not only in the process.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toContain("[decision_layer]");
    expect(config).toMatch(/\[decision_layer\][^[]*enabled = true/s);
    expect(config).toMatch(/\[decision_layer\][^[]*model = ""/s);

    // And the read path reflects it immediately, without a second boot.
    expect(await resultOf(server, "decision.get")).toEqual(written);
  });

  test("a non-empty model is refused and config.toml is byte-identical", async () => {
    const server = decisionCore();
    // Boot writes the documented defaults; read them after, not before.
    await resultOf(server, "decision.get");
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    const response = await ask(server, "decision.set", {
      enabled: true,
      model: "local-ranker-1b",
    });
    if (!("error" in response)) throw new Error("a non-empty model must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe(DECISION_RULES_ONLY_REFUSAL);
    expect(response.error.data).toEqual({
      kind: "decision",
      message: DECISION_RULES_ONLY_REFUSAL,
    });

    // Nothing was written, and the stored state is still off.
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
    expect(await resultOf(server, "decision.get")).toEqual({
      enabled: false,
      model: "",
      rulesOnly: true,
      localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
    });
  });

  test("the values survive a fresh boot", async () => {
    await resultOf(decisionCore(), "decision.set", { enabled: true });
    expect(await resultOf(decisionCore(), "decision.get")).toEqual({
      enabled: true,
      model: "",
      rulesOnly: true,
      localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
    });
  });

  test("a bad shape is -32602 and never reaches the config", async () => {
    const server = decisionCore();
    await resultOf(server, "decision.get");
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");

    const response = await ask(server, "decision.set", { enabled: "yes" });
    if (!("error" in response)) throw new Error("a non-boolean enabled must be refused");
    expect(response.error.code).toBe(-32602);
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
  });
});

describe("a workspace that cannot be opened", () => {
  test("is a -32000 boot error, not a crash, and ping still answers", async () => {
    const legacy = join(base, "old-lockedin");
    await mkdir(join(legacy, "school", "sessions"), { recursive: true });
    await writeFile(join(legacy, "config.toml"), "[ui]\ntheme = 'lockedin'\n");

    const server = core(legacy);
    const response = await ask(server, "workspace.info");
    if (!("error" in response)) throw new Error("a legacy folder must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "boot",
      path: legacy,
    });
    const data = response.error.data as { message: string; next: string };
    expect(data.message).toContain("old LockedIn");
    expect(data.next).toContain("LOCKEDIN_WORKSPACE");

    // The refusal created nothing in the old folder.
    expect(existsSync(join(legacy, "workspace.json"))).toBe(false);

    expect(await server.handle(request('{"jsonrpc":"2.0","id":2,"method":"ping"}'))).toMatchObject({
      id: 2,
      result: { pong: true },
    });
  });
});

describe("session.instructions", () => {
  /** A text-only session: no instruction file, no sources. */
  async function textSession(prompt = "Study the boundary conditions."): Promise<{
    id: string;
    folder: string;
  }> {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt,
        steps: false,
      }),
    );
    return { id: created.session.id, folder: created.folder };
  }

  test("get returns the prompt and no provenance for a text-only session", async () => {
    const session = await textSession();
    expect(await resultOf(core(), "session.instructions.get", { id: session.id })).toEqual({
      prompt: "Study the boundary conditions.",
    });
  });

  test("save rewrites prompt.md and get reads the new text back", async () => {
    const session = await textSession();
    const edited = "# Assignment instructions\n\nDerive the energy balance.\n";
    const server = core();

    const saved = await resultOf(server, "session.instructions.save", {
      id: session.id,
      text: edited,
    });
    expect(saved).toEqual({ prompt: edited });

    // The reply is the bytes the service wrote, not a second in-memory value.
    await expect(readFile(join(session.folder, SESSION_FILES.prompt), "utf8")).resolves.toBe(edited);
    expect(await resultOf(server, "session.instructions.get", { id: session.id })).toEqual({
      prompt: edited,
    });

    const meta = JSON.parse(
      await readFile(join(session.folder, SESSION_FILES.meta), "utf8"),
    ) as { prompt: string };
    expect(meta.prompt).toBe(edited);

    // An empty string is the service's rule for clearing the prompt.
    expect(
      await resultOf(server, "session.instructions.save", { id: session.id, text: "" }),
    ).toEqual({ prompt: "" });
    await expect(readFile(join(session.folder, SESSION_FILES.prompt), "utf8")).resolves.toBe("");
  });

  test("import copies the file into sources, extracts its text and records provenance", async () => {
    const session = await textSession("Old written instructions.");
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const original = join(inputs, "assignment.md");
    const body = "# Unit 4 assignment\n\nComplete problems 1–5.\n";
    await writeFile(original, body);

    const imported = (await resultOf(core(), "session.instructions.import", {
      id: session.id,
      file: original,
    })) as {
      prompt: string;
      instructions: {
        name: string;
        storedPath: string;
        hash: string;
        kind: string;
        extractedAt: string;
        characters?: number;
        pages?: number;
      };
      added: boolean;
    };

    const extracted = body.replace(/\n+$/, "");
    expect(imported.prompt).toBe(extracted);
    expect(imported.added).toBe(true);
    expect(imported.instructions).toMatchObject({
      name: "assignment.md",
      kind: "markdown",
      characters: extracted.length,
      hash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    });
    expect(imported.instructions.storedPath.startsWith("sources/")).toBe(true);
    expect(Number.isNaN(new Date(imported.instructions.extractedAt).getTime())).toBe(false);

    // The prompt and the copied original are both on disk, and the provenance
    // in meta.json points at that copy rather than at the user's file.
    await expect(readFile(join(session.folder, SESSION_FILES.prompt), "utf8")).resolves.toBe(extracted);
    await expect(
      readFile(join(session.folder, imported.instructions.storedPath), "utf8"),
    ).resolves.toBe(body);

    const meta = JSON.parse(
      await readFile(join(session.folder, SESSION_FILES.meta), "utf8"),
    ) as {
      instructions_source: Record<string, unknown>;
      sources: Array<{ stored_path: string; hash: string }>;
    };
    expect(meta.instructions_source).toMatchObject({
      name: "assignment.md",
      stored_path: imported.instructions.storedPath,
      hash: imported.instructions.hash,
      kind: "markdown",
      characters: extracted.length,
      extracted_at: imported.instructions.extractedAt,
    });
    expect(meta.sources.map((source) => source.hash)).toContain(imported.instructions.hash);

    // Importing the same bytes again reuses the source copy.
    const again = await resultOf(core(), "session.instructions.import", {
      id: session.id,
      file: original,
    });
    expect(again.added).toBe(false);
    const after = JSON.parse(
      await readFile(join(session.folder, SESSION_FILES.meta), "utf8"),
    ) as { sources: unknown[] };
    expect(after.sources).toHaveLength(meta.sources.length);
  });

  test("reextract restores the copied original after a manual edit", async () => {
    const session = await textSession("Old written instructions.");
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const original = join(inputs, "assignment.md");
    const body = "# Assignment\n\nExplain the boundary conditions.\n";
    await writeFile(original, body);
    const server = core();

    const imported = (await resultOf(server, "session.instructions.import", {
      id: session.id,
      file: original,
    })) as { prompt: string; instructions: { hash: string } };

    await resultOf(server, "session.instructions.save", {
      id: session.id,
      text: "A manual rewrite that replaced the extracted text.",
    });

    const extracted = (await resultOf(server, "session.instructions.reextract", {
      id: session.id,
    })) as {
      prompt: string;
      instructions: { name: string; hash: string; kind: string; storedPath: string };
    };

    expect(extracted.prompt).toBe(imported.prompt);
    expect(extracted.instructions.hash).toBe(imported.instructions.hash);
    await expect(readFile(join(session.folder, SESSION_FILES.prompt), "utf8")).resolves.toBe(
      imported.prompt,
    );
  });

  test("a failed import is one typed message and leaves the prompt and metadata unchanged", async () => {
    const session = await textSession();
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    const image = join(inputs, "diagram.png");
    await writeFile(image, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));

    const promptPath = join(session.folder, SESSION_FILES.prompt);
    const metaPath = join(session.folder, SESSION_FILES.meta);
    const promptBefore = await readFile(promptPath, "utf8");
    const metaBefore = await readFile(metaPath, "utf8");

    const response = await ask(core(), "session.instructions.import", {
      id: session.id,
      file: image,
    });
    if (!("error" in response)) throw new Error("an image instructions file must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toContain("image");
    expect(response.error.data).toMatchObject({ kind: "instructions", id: session.id });

    // Nothing partial survives: the old prompt, metadata and sources are intact.
    await expect(readFile(promptPath, "utf8")).resolves.toBe(promptBefore);
    await expect(readFile(metaPath, "utf8")).resolves.toBe(metaBefore);
    await expect(readdir(join(session.folder, "sources"))).resolves.toEqual([]);
  });

  test("an unknown session is the session shape for every instruction method", async () => {
    const missing = "2026-12-31-0000-missing";
    const server = core();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["session.instructions.get", { id: missing }],
      ["session.instructions.save", { id: missing, text: "Study." }],
      ["session.instructions.import", { id: missing, file: join(base, "missing.md") }],
      ["session.instructions.reextract", { id: missing }],
    ];

    for (const [method, params] of calls) {
      const response = await ask(server, method, params);
      if (!("error" in response)) throw new Error(`${method} must fail for an unknown session`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "session", id: missing });
    }
  });
});

describe("review.queue", () => {
  type QueueItem = {
    id: string;
    kind: "step" | "card" | "stage" | "memory";
    label: string;
    context: string;
    contextId: string;
    reason: string;
    priority: number;
    count: number;
    origin: string;
  };
  type Queue = {
    items: QueueItem[];
    nudge: {
      intensity: string;
      threshold: number;
      due: string[];
      suggestions: Array<{ itemId: string; message: string }>;
    };
    coverage: unknown[];
    counts: { total: number; byKind: Record<QueueItem["kind"], number> };
    diagnostics: Array<{ kind: string; path: string; message: string; next: string }>;
    intensity: string;
  };

  const STEPS =
    "# Assignment steps\n\n> 1 of 2 steps done\n\n## Understand\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n";

  /**
   * Seed the two sides the queue reads: a school session with one unchecked
   * step and one missed card, and a skills goal with two unfinished stages.
   * Seeding goes through the real services, so the bytes are the app's own.
   */
  async function seed(): Promise<{ sessionId: string; goalId: string; goalName: string }> {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    const sessionId = created.session.id;
    await writeFile(join(created.folder, SESSION_FILES.steps), STEPS);

    const outputs = join(workspace.paths.root, "school", "outputs", sessionId);
    await mkdir(outputs, { recursive: true });
    await writeFile(
      join(outputs, "flashcards.md"),
      [
        "# Flashcards — Physics",
        "",
        "## Card 1",
        "",
        "Q: What does the learning rate control?",
        "A: The step size.",
        "M: yes",
        "K: no",
        "",
      ].join("\n"),
    );

    const stages: StageDraft[] = [
      { title: "Registers", milestone: "explain a stack frame" },
      { title: "Control flow", milestone: "trace a loop" },
      { title: "Conventions", milestone: "read a prologue" },
    ];
    const goal = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(
          validateInput({
            statement: "read disassembly output confidently",
            level: "beginner",
            timeBudget: "6 weeks",
          }),
        ),
        stages,
        created: "2026-11-01T09:00:00.000Z",
      }),
    );
    return { sessionId, goalId: goal.goal.id, goalName: goal.goal.name };
  }

  async function queueOf(
    server: CoreServer,
    params?: Record<string, unknown>,
  ): Promise<Queue> {
    const result = await resultOf(server, "review.queue", params);
    return result.queue as Queue;
  }

  test("an empty workspace returns an empty queue, not an error", async () => {
    expect(await queueOf(core())).toEqual({
      items: [],
      nudge: { intensity: "balanced", threshold: 3, due: [], suggestions: [] },
      coverage: [],
      counts: { total: 0, byKind: { step: 0, card: 0, stage: 0, memory: 0 } },
      diagnostics: [],
      intensity: "balanced",
    });
  });

  test("coverage carries one real report per readable school session", async () => {
    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n");
    await writeFile(join(inputs, "reading-notes.md"), "# Reading notes\n\nA summary.\n");
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
        files: [join(inputs, "lecture-4.md"), join(inputs, "reading-notes.md")],
      }),
    );
    await writeFile(
      join(created.folder, SESSION_FILES.steps),
      "# Assignment steps\n\n> 0 of 1 steps done\n\n- [ ] Read lecture-4.md\n",
    );

    const server = core();
    const queue = await queueOf(server);
    expect(queue.coverage).toHaveLength(1);
    const [row] = queue.coverage as Array<{
      sessionId: string;
      name: string;
      report: {
        total: number;
        referencedCount: number;
        sources: Array<{ name: string; referenced: boolean }>;
        unreferenced: Array<{ name: string }>;
      };
    }>;
    expect(row).toMatchObject({ sessionId: created.session.id, name: "Physics — Unit 4" });
    expect(row!.report.total).toBe(2);
    expect(row!.report.referencedCount).toBe(1);
    expect(row!.report.sources.map((entry) => entry.name)).toEqual([
      "lecture-4.md",
      "reading-notes.md",
    ]);
    expect(row!.report.unreferenced.map((entry) => entry.name)).toEqual(["reading-notes.md"]);

    // Coverage is school-side material, so a skills-only projection has none.
    expect((await queueOf(server, { side: "skills" })).coverage).toEqual([]);
  });

  test("unchecked steps, a missed card and unfinished stages are all in the queue", async () => {
    const { sessionId, goalId, goalName } = await seed();
    const queue = await queueOf(core());

    // Missed cards first, then steps, then stages (domain order).
    expect(queue.items.map((item) => item.kind)).toEqual([
      "card",
      "step",
      "stage",
      "stage",
      "stage",
    ]);
    expect(queue.counts).toEqual({
      total: 5,
      byKind: { card: 1, step: 1, stage: 3, memory: 0 },
    });
    expect(queue.diagnostics).toEqual([]);
    expect(queue.intensity).toBe("balanced");

    const step = queue.items.find((item) => item.kind === "step")!;
    expect(step).toMatchObject({
      id: `step:${sessionId}:1`,
      label: "Derive the energy balance",
      context: "Physics — Unit 4",
      contextId: sessionId,
      reason: "unchecked",
      origin: "steps",
      count: 0,
    });

    const card = queue.items.find((item) => item.kind === "card")!;
    expect(card).toMatchObject({
      label: "What does the learning rate control?",
      contextId: sessionId,
      reason: "missed",
      origin: "flashcards",
    });

    const stages = queue.items.filter((item) => item.kind === "stage");
    expect(stages.map((item) => item.label)).toEqual([
      "Registers",
      "Control flow",
      "Conventions",
    ]);
    for (const stage of stages) {
      expect(stage).toMatchObject({ contextId: goalId, context: goalName, origin: "curriculum" });
    }
  });

  test("the side filter projects one wall at a time and recomputes the counts", async () => {
    const { sessionId, goalId } = await seed();
    const server = core();

    const all = await queueOf(server);
    expect(await queueOf(server, { side: "all" })).toEqual(all);

    // The school side is steps, flashcards and session memory; no skills stage
    // may leak across the wall.
    const school = await queueOf(server, { side: "school" });
    expect(school.items.map((item) => item.kind)).toEqual(["card", "step"]);
    expect(school.counts).toEqual({
      total: 2,
      byKind: { card: 1, step: 1, stage: 0, memory: 0 },
    });
    expect(school.items.every((item) => item.contextId === sessionId)).toBe(true);

    // The skills side is the curriculum only.
    const skills = await queueOf(server, { side: "skills" });
    expect(skills.items.map((item) => item.kind)).toEqual(["stage", "stage", "stage"]);
    expect(skills.counts).toEqual({
      total: 3,
      byKind: { card: 0, step: 0, stage: 3, memory: 0 },
    });
    expect(skills.items.every((item) => item.contextId === goalId)).toBe(true);
    // The nudge ids describe the projected items, never the hidden ones.
    expect(skills.nudge.due).toEqual([]);
    expect(skills.nudge.suggestions).toEqual([]);
    // Coverage is school material: both the all and school views carry the same
    // reports, and the skills view carries none.
    expect(school.coverage).toEqual(all.coverage);
    expect(skills.coverage).toEqual([]);
  });

  test("a broken folder is a diagnostic and the rest of the queue still renders", async () => {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    await writeFile(join(created.folder, SESSION_FILES.steps), STEPS);

    // A folder whose metadata cannot be parsed: one broken session, no crash.
    const broken = join(workspace.paths.schoolSessions, "2026-10-01-0900-broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, SESSION_FILES.meta), "{ this is not json");

    const queue = await queueOf(core());
    expect(queue.items.map((item) => item.kind)).toEqual(["step"]);
    expect(queue.counts.total).toBe(1);
    expect(queue.diagnostics).toHaveLength(1);
    expect(queue.diagnostics[0]).toMatchObject({ kind: "review", path: broken });
    expect(queue.diagnostics[0]!.message).toContain("2026-10-01-0900-broken");
    expect(queue.diagnostics[0]!.next.length).toBeGreaterThan(0);
    // The broken folder is a school-side problem only.
    expect((await queueOf(core(), { side: "skills" })).diagnostics).toEqual([]);
    // Coverage skips the folder it cannot read: one report, for the good session.
    expect(queue.coverage).toHaveLength(1);
  });
});

describe("review.mark", () => {
  type MarkedItem = {
    id: string;
    kind: "step" | "card" | "stage" | "memory";
    label: string;
    contextId: string;
    reason: string;
    count: number;
  };
  type MarkedQueue = {
    items: MarkedItem[];
    counts: { total: number; byKind: Record<string, number> };
    nudge: { due: string[] };
  };

  const STEPS =
    "# Assignment steps\n\n> 1 of 2 steps done\n\n## Understand\n\n- [x] Read section 4.2\n- [ ] Derive the energy balance\n";

  /** Card 1 starts missed, card 2 untouched, so both marks have a real target. */
  const DECK = [
    "# Flashcards — Physics",
    "",
    "## Card 1",
    "",
    "Q: What does the learning rate control?",
    "A: The step size.",
    "M: yes",
    "K: no",
    "",
    "## Card 2",
    "",
    "Q: What is a batch?",
    "A: A group of examples.",
    "M: no",
    "K: no",
    "",
  ].join("\n");

  /** One session with two steps and a deck, plus one three-stage goal. */
  async function seed(): Promise<{ sessionId: string; folder: string; goalId: string; deck: string }> {
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );
    await writeFile(join(created.folder, SESSION_FILES.steps), STEPS);

    const deck = join(workspace.paths.root, "school", "outputs", created.session.id, "flashcards.md");
    await mkdir(join(workspace.paths.root, "school", "outputs", created.session.id), {
      recursive: true,
    });
    await writeFile(deck, DECK);

    const stages: StageDraft[] = [
      { title: "Registers", milestone: "explain a stack frame" },
      { title: "Control flow", milestone: "trace a loop" },
      { title: "Conventions", milestone: "read a prologue" },
    ];
    const goal = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(
          validateInput({
            statement: "read disassembly output confidently",
            level: "beginner",
            timeBudget: "6 weeks",
          }),
        ),
        stages,
        created: "2026-11-01T09:00:00.000Z",
      }),
    );
    return { sessionId: created.session.id, folder: created.folder, goalId: goal.goal.id, deck };
  }

  async function marked(
    server: CoreServer,
    itemId: string,
    result: "known" | "missed",
  ): Promise<MarkedQueue> {
    const reply = await resultOf(server, "review.mark", { itemId, result });
    return reply.queue as MarkedQueue;
  }

  test("a known step is checked through the steps service and leaves the queue", async () => {
    const { sessionId, folder } = await seed();
    const server = core();
    const before = (await resultOf(server, "review.queue")).queue as MarkedQueue;

    const queue = await marked(server, `step:${sessionId}:1`, "known");

    // The reply is the new snapshot, not a patch the shell has to apply.
    expect(queue.items.some((item) => item.id === `step:${sessionId}:1`)).toBe(false);
    expect(queue.counts.total).toBe(before.counts.total - 1);

    // The file is the truth: one bracket and the progress line changed.
    const steps = await readFile(join(folder, SESSION_FILES.steps), "utf8");
    expect(steps).toContain("- [x] Derive the energy balance");
    expect(steps).toContain("> 2 of 2 steps done");

    // Marking the same checked step known again is a no-op success.
    await marked(server, `step:${sessionId}:1`, "known");
    await expect(readFile(join(folder, SESSION_FILES.steps), "utf8")).resolves.toBe(steps);
  });

  test("a missed step appends one progress line and leaves the Markdown untouched", async () => {
    const { sessionId, folder } = await seed();
    const server = core();

    const queue = await marked(server, `step:${sessionId}:1`, "missed");
    const step = queue.items.find((item) => item.id === `step:${sessionId}:1`);
    expect(step).toMatchObject({ kind: "step", reason: "unchecked", count: 1 });

    // The document never moves on a miss; only telemetry is appended.
    await expect(readFile(join(folder, SESSION_FILES.steps), "utf8")).resolves.toBe(STEPS);
    const lines = (await readFile(join(folder, SESSION_FILES.progress), "utf8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "review", index: 1, result: "missed" });
    expect(typeof (JSON.parse(lines[0]!) as { at?: unknown }).at).toBe("string");

    // A second miss is a second line, not a rewritten file.
    await marked(server, `step:${sessionId}:1`, "missed");
    const after = (await readFile(join(folder, SESSION_FILES.progress), "utf8"))
      .trim()
      .split("\n");
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(lines[0]!);
  });

  test("a known card rewrites M/K and a missed card marks the other card", async () => {
    const { sessionId, deck } = await seed();
    const server = core();

    const knownQueue = await marked(server, `card:${sessionId}:card-1`, "known");
    expect(knownQueue.items.some((item) => item.id === `card:${sessionId}:card-1`)).toBe(false);
    const afterKnown = await readFile(deck, "utf8");
    expect(afterKnown).toContain("M: no\nK: yes");
    // The rest of the deck is still there: one card changed, not the file shape.
    expect(afterKnown).toContain("## Card 2");

    const missedQueue = await marked(server, `card:${sessionId}:card-2`, "missed");
    const card = missedQueue.items.find((item) => item.id === `card:${sessionId}:card-2`);
    expect(card).toMatchObject({ kind: "card", reason: "missed" });
    const afterMissed = await readFile(deck, "utf8");
    expect(afterMissed).toContain("## Card 2\n\nQ: What is a batch?\nA: A group of examples.\nM: yes\nK: no");

    // No temp file survives an atomic replace.
    expect(
      (await readdir(join(workspace.paths.root, "school", "outputs", sessionId))).filter((name) =>
        name.includes(".tmp-"),
      ),
    ).toEqual([]);
  });

  test("a known stage completes it; a missed stage is an acknowledged no-op", async () => {
    const { goalId } = await seed();
    const server = core();

    const knownQueue = await marked(server, `stage:${goalId}:stage-1`, "known");
    expect(knownQueue.items.some((item) => item.id === `stage:${goalId}:stage-1`)).toBe(false);

    const meta = JSON.parse(
      await readFile(join(workspace.paths.goals, goalId, "meta.json"), "utf8"),
    ) as { stages: Array<{ id: string; status: string }> };
    expect(meta.stages.find((stage) => stage.id === "stage-1")?.status).toBe("done");
    // The curriculum promoted the next pending stage: exactly one is active.
    expect(meta.stages.filter((stage) => stage.status === "active")).toHaveLength(1);

    const before = await readFile(join(workspace.paths.goals, goalId, "meta.json"), "utf8");
    const missedQueue = await marked(server, `stage:${goalId}:stage-2`, "missed");
    expect(missedQueue.items.some((item) => item.id === `stage:${goalId}:stage-2`)).toBe(true);
    // No stage miss store exists yet, so a miss writes nothing at all.
    await expect(
      readFile(join(workspace.paths.goals, goalId, "meta.json"), "utf8"),
    ).resolves.toBe(before);
  });

  test("unknown ids, a missing deck and session memory are typed refusals, never writes", async () => {
    const { sessionId, goalId, folder, deck } = await seed();
    const server = core();
    const stepsBefore = await readFile(join(folder, SESSION_FILES.steps), "utf8");
    const deckBefore = await readFile(deck, "utf8");

    const cases: Array<{ itemId: string; result: "known" | "missed" }> = [
      { itemId: `step:${sessionId}:99`, result: "known" },
      { itemId: `card:${sessionId}:card-99`, result: "known" },
      { itemId: `stage:${goalId}:stage-99`, result: "known" },
      { itemId: "step:2026-12-31-0000-missing:0", result: "known" },
      { itemId: `memory:${sessionId}:${sessionId}-0`, result: "known" },
    ];
    for (const params of cases) {
      const response = await ask(server, "review.mark", params);
      if (!("error" in response)) throw new Error(`${params.itemId} must be refused`);
      expect(response.error.code).toBe(BOOT_FAILED);
      expect(response.error.retryable).toBe(false);
      expect(response.error.data).toMatchObject({ kind: "review", itemId: params.itemId });
    }

    // Memory says why, in the message the shell shows.
    const memory = await ask(server, "review.mark", {
      itemId: `memory:${sessionId}:${sessionId}-0`,
      result: "known",
    });
    if (!("error" in memory)) throw new Error("memory must be refused");
    expect(memory.error.message).toContain("read-only");

    // A session that never built a deck is the same typed refusal, not a crash.
    const bare = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-02T09:00:00Z",
        name: "No deck yet",
        prompt: "Study.",
        steps: false,
      }),
    );
    const noDeck = await ask(server, "review.mark", {
      itemId: `card:${bare.session.id}:card-1`,
      result: "known",
    });
    if (!("error" in noDeck)) throw new Error("a session with no deck must be refused");
    expect(noDeck.error.code).toBe(BOOT_FAILED);
    expect(noDeck.error.retryable).toBe(false);
    expect(noDeck.error.data).toMatchObject({ kind: "review" });
    expect(noDeck.error.message).toContain("deck");

    // Nothing on the refusal path touched a file.
    await expect(readFile(join(folder, SESSION_FILES.steps), "utf8")).resolves.toBe(stepsBefore);
    await expect(readFile(deck, "utf8")).resolves.toBe(deckBefore);
  });

  test("the reply is the queue after the mark, with the nudge recomputed", async () => {
    const { sessionId } = await seed();
    const server = core();

    // Three recorded misses cross the balanced threshold (3) for that step.
    for (let at = 0; at < 3; at++) await marked(server, `step:${sessionId}:1`, "missed");
    const queue = (await resultOf(server, "review.queue")).queue as MarkedQueue;
    expect(queue.nudge.due).toContain(`step:${sessionId}:1`);

    // Marking it known clears the step and therefore the nudge entry.
    const after = await marked(server, `step:${sessionId}:1`, "known");
    expect(after.items.some((item) => item.id === `step:${sessionId}:1`)).toBe(false);
    expect(after.nudge.due).not.toContain(`step:${sessionId}:1`);
  });
});

describe("archive.list", () => {
  /** A session with one copied source, ready to be archived. */
  async function physicsSession() {
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
    return { id: created.session.id, folder: created.folder, lecture };
  }

  /** Boot a core whose config selects a folder archive at `archiveRoot`. */
  async function archiveCore(archiveRoot: string): Promise<CoreServer> {
    unwrap(
      await patchConfig(workspace.paths, {
        archive: { backend: "folder", folder: archiveRoot },
      }),
    );
    return core();
  }

  test("an unconfigured folder archive is an empty success", async () => {
    // First run has no `archive.folder`: there is nowhere to look, which is an
    // empty picker, not a failure.
    expect(await resultOf(core(), "archive.list")).toEqual({ rows: [] });
  });

  test("an empty configured archive folder is an empty success", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
  });

  test("lists an archived session row and changes nothing", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);

    expect(await resultOf(server, "session.archive", { id: session.id })).toEqual({
      action: "archive",
      backend: "folder",
    });

    const archivedFolder = join(archiveRoot, "school", "session", session.id);
    const metaBefore = await readFile(join(archivedFolder, SESSION_FILES.meta), "utf8");

    const first = await resultOf(server, "archive.list");
    const rows = first.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: session.id,
      side: "school",
      name: "Physics — Unit 4",
      backend: "folder",
      kind: "session",
    });
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "backend",
      "date",
      "id",
      "kind",
      "name",
      "side",
      "sizeBytes",
    ]);
    expect(typeof rows[0]!.date).toBe("string");
    expect(Number.isNaN(Date.parse(rows[0]!.date as string))).toBe(false);
    expect(typeof rows[0]!.sizeBytes).toBe("number");

    // Read-only: a second listing is byte-for-byte the same reply and the
    // archived copy is untouched.
    expect(await resultOf(server, "archive.list")).toEqual(first);
    await expect(readFile(join(archivedFolder, SESSION_FILES.meta), "utf8")).resolves.toBe(
      metaBefore,
    );
    // No restore happened: the live manager is still empty and the archived
    // copy and the user's own file are both where they were.
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
    expect(existsSync(archivedFolder)).toBe(true);
    expect(existsSync(session.lecture)).toBe(true);
    // A school archive does not invent a skills row.
    expect(rows.every((row) => row.side === "school")).toBe(true);
  });

  test("a GitHub backend that cannot be built is one archive refusal", async () => {
    // Backend is configuration; a GitHub backend with no repo (and therefore no
    // token to use) is refused before anything is read or written.
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "github" } }));
    const server = core();

    const response = await ask(server, "archive.list");
    if (!("error" in response)) throw new Error("an unconfigured GitHub archive must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      message: response.error.message,
    });
    expect(response.error.message).toContain("GitHub archive repository");
    // Nothing was listed, moved or written: the live manager is unchanged.
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });
});

describe("archive.restore", () => {
  /** A session with steps, one stored chat turn and one copied source. */
  async function physicsSession() {
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
    // The archive keeps the steps and drops the chat; a restore must say so.
    const steps =
      "# Assignment steps\n\n> 0 of 1 steps done\n\n## Solve\n\n- [ ] Derive the energy balance\n";
    await writeFile(join(created.folder, SESSION_FILES.steps), steps);
    await writeFile(
      join(created.folder, SESSION_FILES.chat),
      `${JSON.stringify({ role: "user", content: "Hi", at: "2026-11-01T09:10:00Z" })}\n`,
    );
    return { id: created.session.id, folder: created.folder, lecture, steps };
  }

  /** Boot a core whose config selects a folder archive at `archiveRoot`. */
  async function archiveCore(folder: string): Promise<CoreServer> {
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder } }));
    return core();
  }

  test("restores an archived session with its sources and steps and no chat", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);

    expect(await resultOf(server, "session.archive", { id: session.id })).toEqual({
      action: "archive",
      backend: "folder",
    });
    const archivedFolder = join(archiveRoot, "school", "session", session.id);
    const archivedRows = (await resultOf(server, "archive.list")).rows as Record<string, unknown>[];
    expect(archivedRows.map((row) => row.id)).toEqual([session.id]);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });

    expect(await resultOf(server, "archive.restore", { id: session.id, side: "school" })).toEqual({
      action: "restore",
      side: "school",
      id: session.id,
    });

    // The session is live again, with the same id and its copied source.
    expect(existsSync(session.folder)).toBe(true);
    expect(await readdir(join(session.folder, "sources"))).toHaveLength(1);
    const listed = (await resultOf(server, "session.list")) as { sessions: Array<{ id: string }> };
    expect(listed.sessions.map((row) => row.id)).toEqual([session.id]);

    // `archived` is back to false, and no `chat_archived` claim survives.
    const meta = JSON.parse(await readFile(join(session.folder, SESSION_FILES.meta), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.archived).toBe(false);
    expect(meta.chat_archived).toBeUndefined();
    // Steps came back byte for byte; chat history did not come back at all.
    await expect(readFile(join(session.folder, SESSION_FILES.steps), "utf8")).resolves.toBe(
      session.steps,
    );
    expect(existsSync(join(session.folder, SESSION_FILES.chat))).toBe(false);

    // The archived copy is gone, the picker agrees, and the original file stays.
    expect(existsSync(archivedFolder)).toBe(false);
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
    expect(existsSync(session.lecture)).toBe(true);

    // The reopen path sees the restored session, not a rebuilt one.
    const opened = (await resultOf(server, "session.open", { id: session.id })) as {
      session: { id: string; archived: boolean };
    };
    expect(opened.session.id).toBe(session.id);
    expect(opened.session.archived).toBe(false);

    // Staged-and-renamed, so no temp folder survives either side.
    const liveLeftovers = (await readdir(join(workspaceRoot, "school", "sessions"))).filter((name) =>
      name.startsWith(".tmp-"),
    );
    expect(liveLeftovers).toEqual([]);
  });

  test("an id that is not archived is one typed restore error and nothing moves", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const missing = "2026-12-31-0000-missing";

    const response = await ask(server, "archive.restore", { id: missing, side: "school" });
    if (!("error" in response)) throw new Error("an unknown archived id must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "session-action",
      id: missing,
      action: "restore",
    });
    expect(response.error.message).toContain("no archived session");

    // The live session and the archive are both exactly where they were.
    expect(existsSync(session.folder)).toBe(true);
    expect(await resultOf(server, "session.list")).toMatchObject({ sessions: [{ id: session.id }] });
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
  });

  test("a school row asked for on the skills side is one typed archive refusal", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);

    expect(await resultOf(server, "session.archive", { id: session.id })).toEqual({
      action: "archive",
      backend: "folder",
    });
    const archivedFolder = join(archiveRoot, "school", "session", session.id);

    // The archive holds this id on the school side only. A skills restore is a
    // goal restore and never falls back to the school row: it is refused by the
    // backend with one line naming the id.
    const response = await ask(server, "archive.restore", { id: session.id, side: "skills" });
    if (!("error" in response)) throw new Error("a cross-side restore must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      id: session.id,
      side: "skills",
      message: response.error.message,
    });

    // The school archive is untouched and the manager is still empty.
    expect(existsSync(archivedFolder)).toBe(true);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
    expect(existsSync(join(workspace.paths.goals, session.id))).toBe(false);
  });

  test("a restore with no folder archive configured is one refusal and keeps the copy", async () => {
    const session = await physicsSession();
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const archiver = await archiveCore(archiveRoot);
    expect(await resultOf(archiver, "session.archive", { id: session.id })).toEqual({
      action: "archive",
      backend: "folder",
    });
    const archivedFolder = join(archiveRoot, "school", "session", session.id);

    // The same workspace, now with the folder setting cleared.
    const unconfigured = await archiveCore("");
    const response = await ask(unconfigured, "archive.restore", { id: session.id, side: "school" });
    if (!("error" in response)) throw new Error("a restore with no folder must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({ kind: "archive", id: session.id, side: "school" });
    expect(response.error.message).toContain("archive folder");

    // A refusal moves nothing: the archived copy stays and no live copy appears.
    expect(existsSync(archivedFolder)).toBe(true);
    expect(existsSync(session.folder)).toBe(false);
    expect(await resultOf(unconfigured, "session.list")).toEqual({ sessions: [] });
    expect((await resultOf(unconfigured, "archive.list")).rows).toEqual([]);
  });
});

describe("archive.restore goals", () => {
  /** Boot a core whose config selects a folder archive at `archiveRoot`. */
  async function archiveCore(folder: string): Promise<CoreServer> {
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder } }));
    return core();
  }

  /** A saved curriculum goal, archived through the same action the TUI uses. */
  async function archivedGoal(archiveRoot: string) {
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
    const archived = await runGoalAction({
      workspace,
      id: saved.goal.id,
      action: "archive",
      archiveRoot,
    });
    expect(archived).toEqual({ ok: true, action: "archive", backend: "folder" });
    return saved;
  }

  test("restores an archived goal under skills/goals and drops the archive row", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const goal = await archivedGoal(archiveRoot);

    // Archived: the live folder is gone and both reads agree it is in the archive.
    expect(existsSync(goal.folder)).toBe(false);
    const archivedRows = (await resultOf(server, "archive.list")).rows as Record<string, unknown>[];
    expect(archivedRows.map((row) => row.id)).toEqual([goal.goal.id]);
    expect(archivedRows[0]).toMatchObject({
      id: goal.goal.id,
      side: "skills",
      kind: "goal",
      backend: "folder",
    });
    expect(await resultOf(server, "skill.list")).toEqual({ skills: [] });

    expect(
      await resultOf(server, "archive.restore", { id: goal.goal.id, side: "skills" }),
    ).toEqual({ action: "restore", side: "skills", id: goal.goal.id });

    // Live again, opened by the same id, with its metadata and stages intact.
    expect(existsSync(goal.folder)).toBe(true);
    const skills = (await resultOf(server, "skill.list")).skills as Array<Record<string, unknown>>;
    expect(skills.map((row) => row.id)).toEqual([goal.goal.id]);
    const meta = JSON.parse(await readFile(join(goal.folder, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(meta.archived).toBe(false);
    expect((meta.stages as unknown[]).length).toBe(3);
    // The archive manifest is archive-only metadata; a live goal never carries it.
    expect(existsSync(join(goal.folder, "archive.json"))).toBe(false);

    // A restore is a move: the archived copy and its picker row are gone.
    expect(existsSync(join(archiveRoot, "skills", "goal", goal.goal.id))).toBe(false);
    expect((await resultOf(server, "archive.list")).rows).toEqual([]);
  });

  test("restores an archived course goal and leaves its metadata byte-identical", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const course = unwrap(
      await createSkillCourse({
        workspace,
        goal: "Read disassembly output confidently",
        prior: "I know a little C",
        created: "2026-11-01T09:00:00Z",
      }),
    );
    const folder = join(workspaceRoot, "skills", "goals", course.id);
    const metaBefore = await readFile(join(folder, "meta.json"), "utf8");

    const archived = await runGoalAction({
      workspace,
      id: course.id,
      action: "archive",
      archiveRoot,
    });
    expect(archived).toEqual({ ok: true, action: "archive", backend: "folder" });
    expect(existsSync(folder)).toBe(false);

    expect(await resultOf(server, "archive.restore", { id: course.id, side: "skills" })).toEqual({
      action: "restore",
      side: "skills",
      id: course.id,
    });

    // The course shape comes back whole: chapter files on disk, the same meta.
    expect(existsSync(join(folder, "chapters"))).toBe(true);
    await expect(readFile(join(folder, "meta.json"), "utf8")).resolves.toBe(metaBefore);
    const skills = (await resultOf(server, "skill.list")).skills as Array<Record<string, unknown>>;
    expect(skills.map((row) => row.id)).toEqual([course.id]);
    expect(skills[0]!.chapters).toEqual({ done: 0, total: 1 });
    expect((await resultOf(server, "archive.list")).rows).toEqual([]);
  });

  test("a goal that is already open is refused and nothing moves", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const goal = await archivedGoal(archiveRoot);

    // Recreate the live folder with a marker file while the archive still holds
    // the real copy: a second restore must not overwrite it.
    await mkdir(goal.folder, { recursive: true });
    await writeFile(join(goal.folder, "marker.txt"), "live\n");

    const response = await ask(server, "archive.restore", {
      id: goal.goal.id,
      side: "skills",
    });
    if (!("error" in response)) throw new Error("an already-open goal must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      id: goal.goal.id,
      side: "skills",
      message: response.error.message,
    });
    expect(response.error.message).toContain(goal.goal.id);

    // Both copies are exactly where they were; the marker was not replaced.
    await expect(readFile(join(goal.folder, "marker.txt"), "utf8")).resolves.toBe("live\n");
    expect(existsSync(join(archiveRoot, "skills", "goal", goal.goal.id))).toBe(true);
    expect(
      ((await resultOf(server, "archive.list")).rows as Record<string, unknown>[]).map(
        (row) => row.id,
      ),
    ).toEqual([goal.goal.id]);
  });
});

describe("archive.remove", () => {
  /** Boot a core whose config selects a folder archive at `archiveRoot`. */
  async function archiveCore(folder: string): Promise<CoreServer> {
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "folder", folder } }));
    return core();
  }

  test("deletes only the archived session and leaves the live copy alone", async () => {
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

    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    // Archive a copy **while the live folder stays**: remove must delete the
    // archive row only, never the live session.
    const backend = unwrap(
      openFolderArchive({ archiveRoot, workspaceRoot: workspace.root }),
    );
    unwrap(
      await backend.put(
        { side: "school", id: sessionId, backend: "folder", kind: "session" },
        created.folder,
      ),
    );
    const server = await archiveCore(archiveRoot);
    const liveMeta = await readFile(join(created.folder, SESSION_FILES.meta), "utf8");
    const archivedFolder = join(archiveRoot, "school", "session", sessionId);
    expect(existsSync(archivedFolder)).toBe(true);

    expect(await resultOf(server, "archive.remove", { id: sessionId, side: "school" })).toEqual({
      action: "delete",
      side: "school",
      id: sessionId,
    });

    // The archive row and folder are gone; the live session is byte-identical.
    expect(existsSync(archivedFolder)).toBe(false);
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
    expect(existsSync(created.folder)).toBe(true);
    await expect(readFile(join(created.folder, SESSION_FILES.meta), "utf8")).resolves.toBe(liveMeta);
    expect(
      ((await resultOf(server, "session.list")).sessions as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([sessionId]);
  });

  test("deletes only the archived goal and leaves the live goal alone", async () => {
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
    const goalId = saved.goal.id;

    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const backend = unwrap(
      openFolderArchive({ archiveRoot, workspaceRoot: workspace.root }),
    );
    unwrap(
      await backend.put(
        { side: "skills", id: goalId, backend: "folder", kind: "goal" },
        saved.folder,
      ),
    );
    const server = await archiveCore(archiveRoot);
    const metaBefore = await readFile(join(saved.folder, "meta.json"), "utf8");

    expect(await resultOf(server, "archive.remove", { id: goalId, side: "skills" })).toEqual({
      action: "delete",
      side: "skills",
      id: goalId,
    });

    expect(existsSync(join(archiveRoot, "skills", "goal", goalId))).toBe(false);
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
    expect(existsSync(saved.folder)).toBe(true);
    await expect(readFile(join(saved.folder, "meta.json"), "utf8")).resolves.toBe(metaBefore);
    expect(
      ((await resultOf(server, "skill.list")).skills as Array<{ id: string }>).map((row) => row.id),
    ).toEqual([goalId]);
  });

  test("an id that is not archived is one typed refusal and nothing moves", async () => {
    const archiveRoot = join(base, "archive");
    await mkdir(archiveRoot, { recursive: true });
    const server = await archiveCore(archiveRoot);
    const missing = "2026-12-31-0000-missing";

    const response = await ask(server, "archive.remove", { id: missing, side: "skills" });
    if (!("error" in response)) throw new Error("an unknown archived id must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toEqual({
      kind: "archive",
      id: missing,
      side: "skills",
      message: response.error.message,
    });
    expect(response.error.message).toContain(missing);
    expect(await resultOf(server, "archive.list")).toEqual({ rows: [] });
    expect(await resultOf(server, "skill.list")).toEqual({ skills: [] });
  });
});

describe("archive.restore and archive.remove on the GitHub backend", () => {
  /**
   * A fake GitHub backend over a local folder, injected through the boot seam.
   *
   * The real adapter's HTTP is covered by its own unit suite; here the remote
   * is `base/remote`, so the protocol's contract — destination confinement,
   * metadata normalisation, rollback and the move — runs against the real
   * workspace with no network. `remove` returns `removed: false` for a missing
   * item, exactly like the adapter.
   */
  function githubBackend(remoteRoot: string) {
    const calls: string[] = [];
    const remote = (ref: { side: string; id: string; kind?: string }): string =>
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
        calls.push(`restore:${ref.side}:${ref.id}`);
        const source = remote(ref);
        if (!existsSync(source)) {
          return {
            ok: false as const,
            error: {
              kind: "storage" as const,
              path: source,
              message: `There is no archived “${ref.id}” on the ${ref.side} side.`,
              next: "Push the item first, or pick another entry.",
            },
          };
        }
        await cp(source, destination, { recursive: true });
        return ok({ ref, path: destination, files: 1 });
      },
      async remove(ref) {
        calls.push(`remove:${ref.side}:${ref.id}`);
        const target = remote(ref);
        if (!existsSync(target)) return ok({ removed: false, path: target, files: 0 });
        await rm(target, { recursive: true, force: true });
        return ok({ removed: true, path: target, files: 1 });
      },
    };
    return { backend, calls };
  }

  /** The real boot with Settings selecting GitHub and the fake injected. */
  async function githubCore(): Promise<{ server: CoreServer; calls: string[] }> {
    unwrap(await patchConfig(workspace.paths, { archive: { backend: "github" } }));
    const remoteRoot = join(base, "remote");
    await mkdir(remoteRoot, { recursive: true });
    const { backend, calls } = githubBackend(remoteRoot);
    const server = createCoreServer({
      boot: async () => {
        const booted = await boot({ workspaceRoot, dataDir, env: {}, now: NOW });
        if (!booted.ok) return booted;
        return {
          ok: true,
          value: {
            ...booted.value,
            createGithubArchive: async () => ok(backend),
          } as typeof booted.value,
        };
      },
    });
    return { server, calls };
  }

  /** A real session moved into the fake remote (the live folder is removed). */
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
    const steps =
      "# Assignment steps\n\n> 0 of 1 steps done\n\n## Solve\n\n- [ ] Derive the energy balance\n";
    await writeFile(join(created.folder, SESSION_FILES.steps), steps);
    await writeFile(
      join(created.folder, SESSION_FILES.chat),
      `${JSON.stringify({ role: "user", content: "Hi", at: "2026-11-01T09:10:00Z" })}\n`,
    );

    const archived = join(base, "remote", "school", "session", created.session.id);
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
    return { id: created.session.id, folder: created.folder, lecture, steps, archived };
  }

  test("restores a school session from GitHub as a move, without a chat", async () => {
    const session = await archivedSession();
    const { server, calls } = await githubCore();

    expect(await resultOf(server, "archive.restore", { id: session.id, side: "school" })).toEqual({
      action: "restore",
      side: "school",
      id: session.id,
    });
    expect(calls).toEqual([`restore:school:${session.id}`, `remove:school:${session.id}`]);

    // Live again through the real manager, with its steps and no chat.
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

    // The remote copy is gone; the user's original file was never touched.
    expect(existsSync(session.archived)).toBe(false);
    expect(existsSync(session.lecture)).toBe(true);
    expect(
      ((await resultOf(server, "session.list")).sessions as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([session.id]);
  });

  test("a download that cannot be normalised leaves the archive and no live copy", async () => {
    const session = await archivedSession();
    await writeFile(join(session.archived, SESSION_FILES.meta), "not json\n");
    const { server, calls } = await githubCore();

    const response = await ask(server, "archive.restore", { id: session.id, side: "school" });
    if (!("error" in response)) throw new Error("a corrupt restored session must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "session-action",
      id: session.id,
      action: "restore",
    });

    // The copy was rolled back and the remote delete was never attempted.
    expect(calls).toEqual([`restore:school:${session.id}`]);
    expect(existsSync(session.folder)).toBe(false);
    expect(existsSync(session.archived)).toBe(true);
    expect(await resultOf(server, "session.list")).toEqual({ sessions: [] });
  });

  test("archive.remove deletes only the remote school copy", async () => {
    const session = await archivedSession();
    // Put the live copy back: remove must delete the archive row only.
    await cp(session.archived, session.folder, { recursive: true });
    const liveMeta = await readFile(join(session.folder, SESSION_FILES.meta), "utf8");
    const { server, calls } = await githubCore();

    expect(await resultOf(server, "archive.remove", { id: session.id, side: "school" })).toEqual({
      action: "delete",
      side: "school",
      id: session.id,
    });
    expect(calls).toEqual([`remove:school:${session.id}`]);
    expect(existsSync(session.archived)).toBe(false);
    expect(existsSync(session.folder)).toBe(true);
    await expect(readFile(join(session.folder, SESSION_FILES.meta), "utf8")).resolves.toBe(liveMeta);
  });
});

describe("skill lessons", () => {
  const LESSON_STAGES: StageDraft[] = [
    { title: "Registers", milestone: "explain a stack frame" },
    { title: "Control flow", milestone: "trace a loop" },
    { title: "Conventions", milestone: "read a prologue" },
  ];

  /** The goal folder the core reads; the shell never receives a path to it. */
  function goalFolder(id: string): string {
    return join(workspaceRoot, "skills", "goals", id);
  }

  async function seededGoal(): Promise<string> {
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
        stages: LESSON_STAGES,
        created: "2026-11-01T09:00:00.000Z",
      }),
    );
    return saved.goal.id;
  }

  /** One gathered source with a saved excerpt, the material a lesson may cite. */
  async function addSource(goalId: string): Promise<void> {
    unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: "2026-11-01T09:00:00.000Z" }, [
        {
          kind: "text",
          name: "intel",
          text: "Registers hold working state across calls.",
        },
      ]),
    );
  }

  const VALID_DRAFT = JSON.stringify({
    exercise: ["[src: intel.md] Registers hold working state across calls."],
    hints: ["(agent explanation) Start from the prologue and work down."],
    checkpoint: ["[src: intel.md] Name the registers a call saves."],
  });

  test("skill.open lists the goal's stages so the reader can pick one", async () => {
    const id = await seededGoal();
    const server = core();

    const opened = (await resultOf(server, "skill.open", { id })) as {
      skill: {
        id: string;
        name: string;
        goal: string;
        created: string;
        plan: string;
        chapters: unknown[];
        stages: Array<{ id: string; title: string; status: string; milestone?: string }>;
      };
    };

    // The stage ids are the ones the lesson methods accept, in curriculum
    // order, and each carries the milestone that was saved with it.
    expect(opened.skill.stages).toEqual([
      { id: "stage-1", title: "Registers", status: "active", milestone: "explain a stack frame" },
      { id: "stage-2", title: "Control flow", status: "pending", milestone: "trace a loop" },
      { id: "stage-3", title: "Conventions", status: "pending", milestone: "read a prologue" },
    ]);
    // A curriculum goal has no chapter index: the page is stages and chats.
    expect(opened.skill.chapters).toEqual([]);
    expect(opened.skill).toMatchObject({
      id,
      goal: "read disassembly output confidently",
      plan: "template",
      created: "2026-11-01T09:00:00.000Z",
    });

    // Every id the page reports is one `skill.lesson.read` resolves: a stage
    // with no lesson yet is the empty state, not an unknown stage.
    for (const stage of opened.skill.stages) {
      expect(await resultOf(server, "skill.lesson.read", { goalId: id, stageId: stage.id })).toEqual({
        markdown: "",
        exists: false,
      });
    }
  });

  test("builds one stage's lesson from the goal's sources and reads it back", async () => {
    const id = await seededGoal();
    await addSource(id);

    let promptSeen = "";
    const server = generatingCore(async (prompt) => {
      promptSeen = prompt;
      return VALID_DRAFT;
    });

    const built = (await resultOf(server, "skill.lesson.build", {
      goalId: id,
      stageId: "stage-2",
    })) as {
      path: string;
      markdown: string;
      status: string;
      citations: Array<{ name: string; location: string; excerpt: string }>;
    };

    // The prompt carries the source name and its saved excerpt, so the model
    // can cite the same name the trust check will resolve.
    expect(promptSeen).toContain("intel.md");
    expect(promptSeen).toContain("Registers hold working state across calls.");

    // The path is goal-relative, never a machine path.
    expect(built.path).toBe("lessons/02-control-flow.md");
    expect(built.status).toBe("draft");
    expect(built.markdown).toContain("## Exercise");
    expect(built.markdown).toContain("## Hints");
    expect(built.markdown).toContain("## Checkpoint");
    expect(built.markdown).not.toContain("## Solution");
    expect(built.markdown).toContain("status: draft");

    expect(built.citations).toHaveLength(1);
    expect(built.citations[0]!.name).toBe("intel.md");
    expect(built.citations[0]!.location.startsWith("sources/")).toBe(true);
    expect(built.citations[0]!.excerpt).toContain("Registers hold working state");

    // The file on disk is exactly the document the reply carried.
    const file = join(goalFolder(id), built.path);
    expect(await readFile(file, "utf8")).toBe(built.markdown);
    expect(JSON.stringify(built)).not.toContain(goalFolder(id));

    expect(await resultOf(server, "skill.lesson.read", { goalId: id, stageId: "stage-2" })).toEqual({
      markdown: built.markdown,
      exists: true,
    });

    // Reading a stage that was never built is an empty state, not an error.
    expect(await resultOf(server, "skill.lesson.read", { goalId: id, stageId: "stage-1" })).toEqual({
      markdown: "",
      exists: false,
    });
  });

  test("a malformed draft is one typed lesson error and writes nothing", async () => {
    const id = await seededGoal();
    await addSource(id);
    const server = generatingCore(async () => JSON.stringify({ exercise: "not a list" }));

    const response = await ask(server, "skill.lesson.build", { goalId: id, stageId: "stage-1" });
    if (!("error" in response)) throw new Error("a malformed draft must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "lesson",
      goalId: id,
      stageId: "stage-1",
    });
    expect(response.error.message.length).toBeGreaterThan(0);
    expect(existsSync(join(goalFolder(id), "lessons"))).toBe(false);
  });

  test("a goal with no citable source is refused before the model is called", async () => {
    const id = await seededGoal();
    let calls = 0;
    const server = generatingCore(async () => {
      calls += 1;
      return VALID_DRAFT;
    });

    const response = await ask(server, "skill.lesson.build", { goalId: id, stageId: "stage-1" });
    if (!("error" in response)) throw new Error("a goal with no sources must be refused");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.message).toBe("this goal has no source this lesson can cite");
    expect(response.error.data).toEqual({
      kind: "lesson",
      goalId: id,
      stageId: "stage-1",
      message: "this goal has no source this lesson can cite",
    });
    expect(calls).toBe(0);
    expect(existsSync(join(goalFolder(id), "lessons"))).toBe(false);
  });

  test("rebuilding a ready lesson asks first and leaves the file byte-identical", async () => {
    const id = await seededGoal();
    await addSource(id);
    const server = generatingCore(async () => VALID_DRAFT);

    const built = (await resultOf(server, "skill.lesson.build", {
      goalId: id,
      stageId: "stage-2",
    })) as { path: string; markdown: string };
    const file = join(goalFolder(id), built.path);
    await writeFile(file, built.markdown.replace("status: draft", "status: ready"), "utf8");
    const promoted = await readFile(file, "utf8");

    const response = await ask(server, "skill.lesson.build", { goalId: id, stageId: "stage-2" });
    if (!("error" in response)) throw new Error("a ready lesson must ask before it is replaced");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.retryable).toBe(false);
    expect(response.error.data).toMatchObject({
      kind: "confirm",
      goalId: id,
      stageId: "stage-2",
      status: "ready",
    });
    expect(await readFile(file, "utf8")).toBe(promoted);
  });

  test("an unknown stage is a typed stage error and an unknown goal is a skill error", async () => {
    const id = await seededGoal();
    const server = core();

    const stage = await ask(server, "skill.lesson.read", { goalId: id, stageId: "stage-9" });
    if (!("error" in stage)) throw new Error("an unknown stage must be refused");
    expect(stage.error.data).toMatchObject({ kind: "stage", goalId: id, stageId: "stage-9" });

    const goal = await ask(server, "skill.lesson.read", {
      goalId: "missing-goal",
      stageId: "stage-1",
    });
    if (!("error" in goal)) throw new Error("an unknown goal must be refused");
    expect(goal.error.data).toMatchObject({ kind: "skill", id: "missing-goal" });
  });
});

describe("knowledge.search / knowledge.tree", () => {
  /** Digest of every relative path and its bytes under one folder. */
  async function hashTree(root: string): Promise<string> {
    const hash = createHash("sha256");
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        hash.update(path.slice(root.length));
        if (entry.isDirectory()) await walk(path);
        else hash.update(await readFile(path));
      }
    };
    await walk(root);
    return hash.digest("hex");
  }

  async function writeVaultNote(input: {
    side: "school" | "skills";
    folder: string;
    slug: string;
    title: string;
    body: string;
    topics?: string[];
  }): Promise<string> {
    const vault = input.side === "school" ? workspace.paths.schoolVault : workspace.paths.skillVault;
    const file = join(vault, input.folder, `${input.slug}.md`);
    await mkdir(join(vault, input.folder), { recursive: true });
    const topics =
      input.topics === undefined || input.topics.length === 0
        ? ""
        : `topics:\n${input.topics.map((topic) => `  - ${topic}`).join("\n")}\n`;
    await writeFile(
      file,
      [
        "---",
        `id: ${input.slug}`,
        `side: ${input.side}`,
        `type: ${input.side === "school" ? "concept" : "knowledge"}`,
        `title: ${input.title}`,
        ...topics.split("\n").filter((line) => line !== ""),
        "---",
        "",
        input.body,
        "",
      ].join("\n"),
      "utf8",
    );
    return file;
  }

  type ReadResult = { hit: KnowledgeHit; body: string; truncated: boolean };

  async function readOf(server: CoreServer, id: string): Promise<ReadResult> {
    return (await resultOf(server, "knowledge.read", { id })) as unknown as ReadResult;
  }

  /**
   * One item of every kind, all containing the word “boundary”, so a single
   * query must find each kind exactly once (notes appear once per side).
   */
  async function seed(): Promise<{ sessionId: string; goalId: string; projectId: string }> {
    await writeVaultNote({
      side: "school",
      folder: "concepts",
      slug: "boundary-conditions",
      title: "Boundary conditions",
      body: "Boundary conditions set the integral limits.",
      topics: ["Physics/Mechanics"],
    });
    await writeVaultNote({
      side: "skills",
      folder: "knowledge",
      slug: "boundary-registers",
      title: "Boundary registers",
      body: "A boundary register check reads the frame.",
      topics: ["Physics/Thermodynamics"],
    });

    const inputs = join(base, "input");
    await mkdir(inputs, { recursive: true });
    await writeFile(
      join(inputs, "boundary-lecture.md"),
      "# Lecture\n\nThe boundary layer grows along the plate.\n",
      "utf8",
    );
    const created = unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Boundary session",
        prompt: "Study the boundary layer.",
        files: [join(inputs, "boundary-lecture.md")],
        steps: false,
      }),
    );
    await writeFile(
      join(created.folder, SESSION_FILES.memory),
      "# Key points\n\n- Boundary conditions set the limits\n",
      "utf8",
    );

    const goal = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(
          validateInput({
            statement: "boundary layer analysis",
            level: "beginner",
            timeBudget: "2 weeks",
          }),
        ),
        stages: [
          { title: "Boundary basics", milestone: "name the layer" },
          { title: "Boundary growth", milestone: "trace the profile" },
          { title: "Boundary separation", milestone: "predict the breakaway" },
        ] satisfies StageDraft[],
        created: "2026-11-01T09:00:00.000Z",
      }),
    );

    const project = unwrap(
      await createProject({
        workspace,
        id: makeProjectId("Boundary Lab"),
        name: "Boundary Lab",
        folder: join(base, "boundary-project"),
        mode: "chat",
      }),
    );

    await writeFile(
      join(workspace.paths.archiveIndex, "school.json"),
      `${JSON.stringify(
        {
          backends: ["folder"],
          entries: [
            {
              id: "2026-10-01-0900-boundary-notes",
              kind: "session",
              title: "Boundary notes",
              tags: ["boundary"],
              archivedAt: "2026-10-01T09:00:00.000Z",
              sizeBytes: 32,
              backend: "folder",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return { sessionId: created.session.id, goalId: goal.goal.id, projectId: project.id };
  }

  test("finds every kind, labels the side and keeps paths relative", async () => {
    await seed();
    const hits = (await resultOf(core(), "knowledge.search", { query: "  boundary  " }))
      .hits as KnowledgeHit[];

    const byKind = new Map<string, KnowledgeHit[]>();
    for (const hit of hits) {
      byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
    }

    // Two note rows: one per side of the wall.
    expect(byKind.get("note")).toHaveLength(2);
    for (const kind of ["memory", "source", "session", "goal", "project", "archive"] as const) {
      expect(byKind.get(kind)).toHaveLength(1);
    }

    const kinds = new Set<string>(hits.map((hit) => hit.kind));
    // Process history is not knowledge: no activity or lesson rows.
    expect(kinds.has("activity")).toBe(false);
    expect(kinds.has("lesson")).toBe(false);

    for (const hit of hits) {
      expect(hit.path.startsWith("/")).toBe(false);
      expect(hit.path.includes("\\")).toBe(false);
      expect(hit.path.includes(workspaceRoot)).toBe(false);
      expect(hit.excerpt.length).toBeLessThanOrEqual(160);
      expect(hit.score).toBeGreaterThanOrEqual(1);
      expect(hit.score).toBeLessThanOrEqual(3);
    }

    // Memory is history, labelled as its own kind, never a source row.
    const memory = byKind.get("memory")![0]!;
    expect(memory.title).toContain("session memory");
    expect(memory.path.endsWith("memory.md")).toBe(true);

    // Archive rows come from the local index cache.
    expect(byKind.get("archive")![0]!.path).toBe("archive-index/school.json");
  });

  test("scope is a projection: school and skills never cross the wall", async () => {
    await seed();
    const server = core();

    const all = (await resultOf(server, "knowledge.search", { query: "boundary" }))
      .hits as KnowledgeHit[];
    expect(new Set(all.map((hit) => hit.side))).toEqual(new Set(["school", "skills", "work"]));

    const school = (await resultOf(server, "knowledge.search", { query: "boundary", scope: "school" }))
      .hits as KnowledgeHit[];
    expect(school.length).toBeGreaterThan(0);
    expect(school.every((hit) => hit.side === "school")).toBe(true);
    expect(school.some((hit) => hit.kind === "goal" || hit.kind === "project")).toBe(false);

    const skills = (await resultOf(server, "knowledge.search", { query: "boundary", scope: "skills" }))
      .hits as KnowledgeHit[];
    expect(skills.map((hit) => hit.kind).sort()).toEqual(["goal", "note"]);
    expect(skills.every((hit) => hit.side === "skills")).toBe(true);
    expect(skills.some((hit) => hit.path.startsWith("school/"))).toBe(false);

    const work = (await resultOf(server, "knowledge.search", { query: "boundary", scope: "work" }))
      .hits as KnowledgeHit[];
    expect(work.map((hit) => hit.kind)).toEqual(["project"]);

    // The cap is a limit, never a truncation of a smaller result.
    expect(all.length).toBeLessThanOrEqual(50);
  });

  test("the topic tree groups by first-level topic from note frontmatter", async () => {
    await seed();
    const groups = (await resultOf(core(), "knowledge.tree")).groups as KnowledgeTopicGroup[];

    const physics = groups.find((group) => group.topic === "Physics");
    expect(physics).toBeDefined();
    // Sorted by full topic path: Mechanics before Thermodynamics.
    expect(physics!.notes.map((note) => note.title)).toEqual([
      "Boundary conditions",
      "Boundary registers",
    ]);
    expect(physics!.notes.map((note) => note.path)).toEqual([
      "school/vault/concepts/boundary-conditions.md",
      "skills/vault/knowledge/boundary-registers.md",
    ]);

    // A side filter still reads only that side.
    const school = (await resultOf(core(), "knowledge.tree", { side: "school" }))
      .groups as KnowledgeTopicGroup[];
    expect(school.flatMap((group) => group.notes.map((note) => note.path))).toEqual([
      "school/vault/concepts/boundary-conditions.md",
    ]);
  });

  test("search and tree write nothing to the workspace", async () => {
    await seed();
    const server = core();
    // Boot once first, so a first-run config write is not mistaken for search.
    await resultOf(server, "workspace.info");
    const before = await hashTree(workspaceRoot);

    await resultOf(server, "knowledge.search", { query: "boundary" });
    await resultOf(server, "knowledge.search", { query: "boundary", scope: "school" });
    await resultOf(server, "knowledge.tree");
    await resultOf(server, "knowledge.tree", { side: "skills" });

    expect(await hashTree(workspaceRoot)).toBe(before);
  });

  test("an empty workspace is an empty result, never an error", async () => {
    const server = core();
    expect(await resultOf(server, "knowledge.search", { query: "nothing" })).toEqual({ hits: [] });
    expect(await resultOf(server, "knowledge.tree")).toEqual({ groups: [] });
  });

  test("knowledge.read opens every kind and returns content, not JSON", async () => {
    await seed();
    const server = core();
    const hits = (await resultOf(server, "knowledge.search", { query: "boundary" }))
      .hits as KnowledgeHit[];
    const one = (kind: string): KnowledgeHit => {
      const hit = hits.find((entry) => entry.kind === kind);
      if (hit === undefined) throw new Error(`no ${kind} hit`);
      return hit;
    };

    // Note: the Markdown body with the frontmatter stripped, nothing else changed.
    const noteHit = hits.find((hit) => hit.kind === "note" && hit.side === "school")!;
    const note = await readOf(server, noteHit.id);
    expect(note.hit.kind).toBe("note");
    expect(note.hit.id).toBe(noteHit.id);
    expect(note.truncated).toBe(false);
    expect(note.body).toContain("Boundary conditions set the integral limits.");
    expect(note.body).not.toContain("title:");
    expect(note.body).not.toContain("id: boundary-conditions");
    expect(note.body.trimStart().startsWith("---")).toBe(false);

    // Memory: labelled session memory as a bullet list with an updated line.
    const memory = await readOf(server, one("memory").id);
    expect(memory.hit.kind).toBe("memory");
    expect(memory.hit.side).toBe("school");
    expect(memory.body).toContain("Session memory");
    expect(memory.body).toContain("history, not a source");
    expect(memory.body).toMatch(/^Updated: /m);
    expect(memory.body).toContain("- Boundary conditions set the limits");

    // Source: the copied source's extracted text, never its hash or metadata.
    const source = await readOf(server, one("source").id);
    expect(source.hit.kind).toBe("source");
    expect(source.body).toContain("The boundary layer grows along the plate.");
    expect(source.body).not.toContain("sha256:");

    // Session / goal / project: a short Markdown summary, never the JSON blob.
    const session = await readOf(server, one("session").id);
    expect(session.hit.kind).toBe("session");
    expect(session.body).toContain("# Boundary session");
    expect(session.body).toContain("- Kind: lock-in session");
    expect(session.body).toContain("- Sources: 1");
    expect(session.body).toContain("- Archived: no");
    expect(session.body).not.toContain('"schema"');

    const goal = await readOf(server, one("goal").id);
    expect(goal.hit.kind).toBe("goal");
    expect(goal.hit.side).toBe("skills");
    expect(goal.body).toContain("- Kind: skill session");
    expect(goal.body).toContain("- Stages: 0 of 3");
    expect(goal.body).toContain("- Chats: 0");
    expect(goal.body).not.toContain('"schema"');

    const project = await readOf(server, one("project").id);
    expect(project.hit.kind).toBe("project");
    expect(project.hit.side).toBe("work");
    expect(project.body).toContain("# Boundary Lab");
    expect(project.body).toContain("- Kind: work project");
    expect(project.body).toContain("- Mode: chat");
    expect(project.body).toContain("- Agents: 0");
    expect(project.body).toContain("- Tasks: 0");
    expect(project.body).not.toContain('"schema"');
    expect(project.body).not.toContain(base);

    const archive = await readOf(server, one("archive").id);
    expect(archive.hit.kind).toBe("archive");
    expect(archive.body).toContain("# Boundary notes");
    expect(archive.body).toContain("- Kind: session");
    expect(archive.body).toContain("- Tags: boundary");
    expect(archive.body).toContain("32 bytes");

    // A hit's `path` stays workspace-relative and no body carries a machine path.
    for (const result of [note, memory, source, session, goal, project, archive]) {
      expect(result.hit.path.startsWith("/")).toBe(false);
      expect(result.hit.path.includes(workspaceRoot)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(workspaceRoot);
    }
  });

  test("knowledge.read accepts a note path straight from the topic tree", async () => {
    await seed();
    const server = core();
    const groups = (await resultOf(server, "knowledge.tree", { side: "school" }))
      .groups as KnowledgeTopicGroup[];
    const path = groups[0]!.notes[0]!.path;

    const read = await readOf(server, path);
    expect(read.hit.kind).toBe("note");
    expect(read.hit.id).toBe(`note:school:${path}`);
    expect(read.hit.path).toBe(path);
    expect(read.body).toContain("Boundary conditions set the integral limits.");
  });

  test("knowledge.read writes nothing to the workspace", async () => {
    await seed();
    const server = core();
    // Boot once first, so a first-run config write is not mistaken for a read.
    await resultOf(server, "workspace.info");
    const before = await hashTree(workspaceRoot);

    const hits = (await resultOf(server, "knowledge.search", { query: "boundary" }))
      .hits as KnowledgeHit[];
    for (const hit of hits) {
      await readOf(server, hit.id);
    }

    expect(await hashTree(workspaceRoot)).toBe(before);
  });
});

describe("achievements.list", () => {
  type AchievementReply = {
    achievements: Array<{
      id: string;
      name: string;
      task: string;
      category: string;
      metric: string;
      target: number;
      value: number;
      progress: number;
      unlocked: boolean;
      difficulty: string;
      awardedAt?: string;
    }>;
    earned: number;
    total: number;
    warning: string | null;
  };

  /** Digest of every relative path and its bytes under one folder. */
  async function hashTree(root: string): Promise<string> {
    const hash = createHash("sha256");
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        hash.update(path.slice(root.length));
        if (entry.isDirectory()) await walk(path);
        else hash.update(await readFile(path));
      }
    };
    await walk(root);
    return hash.digest("hex");
  }

  async function achievementsOf(server: CoreServer): Promise<AchievementReply> {
    return (await resultOf(server, "achievements.list")) as AchievementReply;
  }

  test("lists the catalogue and awards an earned achievement in the data dir only", async () => {
    unwrap(
      await createLockInSession({
        workspace,
        created: "2026-11-01T09:00:00Z",
        name: "Physics — Unit 4",
        prompt: "Study the boundary conditions.",
      }),
    );

    const server = core();
    // Boot first: a first-run config write must not be mistaken for this read.
    await resultOf(server, "workspace.info");
    const before = await hashTree(workspaceRoot);

    const reply = await achievementsOf(server);
    expect(reply.achievements.map((row) => row.id)).toEqual(
      ACHIEVEMENTS.map((achievement) => achievement.id),
    );
    expect(reply.total).toBe(ACHIEVEMENTS.length);
    expect(reply.earned).toBeGreaterThanOrEqual(1);
    expect(reply.earned).toBe(reply.achievements.filter((row) => row.unlocked).length);

    // A session exists, so the `sessions` counter is at least one and `open-book`
    // is genuinely earned — the one achievement this test seeds.
    const openBook = reply.achievements.find((row) => row.id === "open-book")!;
    expect(openBook.metric).toBe("sessions");
    expect(openBook.progress).toBeGreaterThanOrEqual(1);
    expect(openBook.value).toBe(1);
    expect(openBook.unlocked).toBe(true);
    expect(openBook.awardedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The one write this read can make: award dates in the data directory.
    const awardsFile = join(dataDir, AWARDS_FILE);
    expect(existsSync(awardsFile)).toBe(true);
    const awards = JSON.parse(await readFile(awardsFile, "utf8")) as Record<string, string>;
    expect(awards[openBook.id]).toBe(openBook.awardedAt!);

    // The workspace itself is byte-identical afterwards.
    expect(await hashTree(workspaceRoot)).toBe(before);
  });

  test("a second call is stable", async () => {
    const server = core();
    await resultOf(server, "workspace.info");
    const first = await achievementsOf(server);
    const second = await achievementsOf(server);
    expect(second).toEqual(first);
  });

  test("an empty workspace still lists the whole catalogue", async () => {
    const reply = await achievementsOf(core());
    expect(reply.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(reply.total).toBe(ACHIEVEMENTS.length);
    expect(reply.warning).toBeNull();
    for (const row of reply.achievements) {
      expect(row.progress).toBeGreaterThanOrEqual(0);
      expect(row.value).toBeLessThanOrEqual(row.target);
    }
  });
});

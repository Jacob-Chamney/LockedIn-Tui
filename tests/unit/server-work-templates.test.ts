/**
 * `work.templates.list` — the agent editor's template picker.
 *
 * The method is a read: it lists the built-in three plus whatever the workspace
 * holds in `work/templates/`, and it writes nothing. These cases use the injected
 * boot seam, so no project needs to exist and no provider is ever built. The
 * real workspace round trip (a template file on disk, a registered project) is
 * covered by `tests/integration/server-data.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTemp } from "../helpers/cleanup";
import type { BootFailure } from "../../src/app/boot";
import { type Result } from "../../src/domain/markdown";
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

/** A workspace root that does not exist: no template folder, no projects. */
const ABSENT_ROOT = join(TEMP_BASE, "lockedin-unit-work-templates-absent");

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await removeTemp(roots.pop() as string);
});

/** A real, empty workspace root so template files can be written. */
async function templateRoot(): Promise<string> {
  const root = await mkdtemp(join(TEMP_BASE, "server-work-templates-"));
  roots.push(root);
  await mkdir(join(root, "work", "templates"), { recursive: true });
  return root;
}

/**
 * The minimal service surface this read touches: `paths.root` for the template
 * folder and `paths.workProjects` for the project lookup.
 */
function fakeServices(root: string = ABSENT_ROOT): CoreServices {
  return {
    workspace: {
      root,
      paths: {
        root,
        schoolSessions: join(root, "school", "sessions"),
        workProjects: join(root, "work", "projects"),
      },
    },
    settings: {
      chatModel: "",
      dataDir: join(root, "data"),
      historyLimit: 20,
    },
  } as unknown as CoreServices;
}

/** A core whose boot resolves to `services`, counting how often it is called. */
function fakeCore(root: string = ABSENT_ROOT) {
  const counter = { calls: 0 };
  const server = createCoreServer({
    boot: async () => {
      counter.calls += 1;
      return { ok: true, value: fakeServices(root) } as Result<CoreServices, BootFailure>;
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

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if (!("result" in response)) {
    throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
  }
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

type TemplateRow = {
  id: string;
  name: string;
  role: string;
  summary: string;
  source: string;
  instructions: string;
  maxToolCalls: number;
  allowedTools: string[];
};

async function templatesOf(
  server: ReturnType<typeof createCoreServer>,
  params?: Record<string, unknown>,
): Promise<TemplateRow[]> {
  const result = await resultOf(server, "work.templates.list", params);
  return result.templates as TemplateRow[];
}

/** A complete project template file, as `saveProjectTemplate` writes one. */
function templatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
  };
}

describe("work.templates.list capabilities", () => {
  test("the handshake advertises the method", async () => {
    const { server } = fakeCore();
    const handshake = await resultOf(server, "initialize", {
      protocol: 1,
      client: "flutter",
    });
    expect(handshake.capabilities).toContain("work.templates.list");
    expect(CAPABILITIES).toContain("work.templates.list");
  });
});

describe("work.templates.list built-ins", () => {
  test("a workspace with no template folder lists the three built-ins", async () => {
    const { server } = fakeCore();
    const templates = await templatesOf(server);

    expect(templates.map((template) => template.id)).toEqual([
      "reviewer",
      "implementer",
      "researcher",
    ]);
    // Built-ins first, each labelled with where it came from; colour is never the
    // only signal, so the row says the word.
    for (const template of templates) expect(template.source).toBe("built-in");
    expect(templates[0]).toEqual({
      id: "reviewer",
      name: "Reviewer",
      role: "reviewer",
      summary:
        "Review the work for correctness, regressions, security issues and missing tests. Report findings and cite file paths; do not change files.",
      source: "built-in",
      instructions:
        "Review the work for correctness, regressions, security issues and missing tests. Report findings and cite file paths; do not change files.",
      maxToolCalls: 8,
      allowedTools: ["list_files", "read_file", "search_files"],
    });
    // A template seeds a profile; it never grants command access.
    expect(templates.map((template) => template.id)).not.toContain("command");
  });

  test("every row fits the documented summary rule: one line, at most 160 characters", async () => {
    const { server } = fakeCore();
    for (const template of await templatesOf(server)) {
      expect(template.summary.includes("\n")).toBe(false);
      expect(template.summary.length).toBeLessThanOrEqual(160);
      expect(template.summary.length).toBeGreaterThan(0);
      expect(template.maxToolCalls).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(template.allowedTools)).toBe(true);
    }
  });

  test("no parameters is an implicit absent project, not a malformed request", async () => {
    const { server } = fakeCore();
    const templates = await templatesOf(server, {});
    expect(templates).toHaveLength(3);
    // An explicit null is the same "not supplied" case.
    expect(await templatesOf(server, { projectId: null })).toHaveLength(3);
  });

  test("listing a template folder that does not exist writes nothing", async () => {
    const root = join(ABSENT_ROOT, "never-created");
    const { server } = fakeCore(root);
    await templatesOf(server);
    expect(existsSync(join(root, "work"))).toBe(false);
    expect(existsSync(root)).toBe(false);
  });
});

describe("work.templates.list project templates", () => {
  test("a usable template file is listed after the built-ins and labelled project", async () => {
    const root = await templateRoot();
    await writeFile(
      join(root, "work", "templates", "pair-programmer.json"),
      JSON.stringify(templatePayload()),
      "utf8",
    );

    const { server } = fakeCore(root);
    const templates = await templatesOf(server);

    expect(templates.map((template) => template.id)).toEqual([
      "reviewer",
      "implementer",
      "researcher",
      "pair-programmer",
    ]);
    expect(templates[3]).toEqual({
      id: "pair-programmer",
      name: "Pair programmer",
      role: "pair",
      summary: "Work one small step at a time and explain each edit.",
      source: "project",
      instructions: "Work one small step at a time and explain each edit.",
      maxToolCalls: 6,
      allowedTools: ["read_file", "search_files"],
    });
  });

  test("a broken file and a built-in shadow are skipped, not fatal and not rows", async () => {
    const root = await templateRoot();
    await writeFile(join(root, "work", "templates", "broken.json"), "{ not json", "utf8");
    await writeFile(
      join(root, "work", "templates", "reviewer.json"),
      JSON.stringify(templatePayload({ name: "Impostor" })),
      "utf8",
    );
    await writeFile(join(root, "work", "templates", "notes.md"), "not a template", "utf8");

    const { server } = fakeCore(root);
    const response = await ask(server, "work.templates.list");
    if (!("result" in response)) throw new Error("a broken template must not fail the list");
    const templates = response.result.templates as TemplateRow[];

    // The three shipped ids keep their meaning; a project file cannot shadow one.
    expect(templates.map((template) => template.id)).toEqual([
      "reviewer",
      "implementer",
      "researcher",
    ]);
    expect(templates[0].name).toBe("Reviewer");
  });
});

describe("work.templates.list validation", () => {
  test("a non-string projectId is -32602 and never boots", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "work.templates.list", { projectId: 7 });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("projectId must be a string");
    expect(counter.calls).toBe(0);
  });

  test("a blank projectId is -32602 and never boots", async () => {
    const { server, counter } = fakeCore();
    const error = await errorOf(server, "work.templates.list", { projectId: "   " });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("non-empty");
    expect(counter.calls).toBe(0);
  });

  test("an unregistered projectId is the shared project shape", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "work.templates.list", {
      projectId: "missing-000000",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({
      kind: "project",
      projectId: "missing-000000",
    });
    // One sentence the shell can show; never a stack trace or raw JSON.
    expect(error.message).not.toContain("\n");
  });

  test("a boot refusal is reported once and the method fails closed", async () => {
    const server = createCoreServer({
      boot: async () => ({
        ok: false,
        error: {
          kind: "boot",
          path: ABSENT_ROOT,
          message: "this folder belongs to an older version",
          next: "pass --workspace",
        },
      } as Result<CoreServices, BootFailure>),
    });
    const error = await errorOf(server, "work.templates.list");
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("older version");
  });
});

/**
 * `session.mistake.*` — the transport half of the misconception ledger and the
 * knowledge graduation path.
 *
 * This is the end-to-end proof that an entry recorded inside a session becomes
 * a **school knowledge note** that `knowledge.search` and `knowledge.read`
 * return, with its provenance intact. The workspace and session are real; no
 * provider, network or keychain is involved.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import type { SettingsView } from "../../src/types/settings";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServer,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { createLockInSession } from "../../src/services/lockin/create";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

function view(dataDir: string): SettingsView {
  return {
    username: "friend",
    theme: "lockedin",
    chatModel: "",
    baseUrl: "",
    maxToolCalls: 8,
    maxTokensPerRequest: 16000,
    responseStyle: "normal",
    tutorPolicy: "direct",
    budgetUsd: 0,
    period: "day",
    warnAt: 0.8,
    pauseAtLimit: false,
    dataDir,
    archiveBackend: "folder",
    archiveFolder: "",
    archiveGithubRepo: "",
    archiveGithubBranch: "main",
    archiveGithubConsent: false,
    historyLimit: 20,
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
  };
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspace: Workspace;
let sessionId: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-mistakes-"));
  workspace = unwrap(await createWorkspace(join(base, "workspace")));
  const input = join(base, "lecture-4.md");
  await writeFile(input, "# Unit 4\n\nBoundary conditions.\n");
  const created = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T14:30:00Z",
      name: "Physics — Unit 4",
      files: [input],
    }),
  );
  sessionId = created.session.id;
});

afterEach(async () => {
  await removeTemp(base);
});

function makeServer(): CoreServer {
  const services = {
    workspace,
    settings: view(join(base, "data")),
  } as unknown as CoreServices;
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

describe("session.mistake capabilities", () => {
  test("the handshake advertises all three methods", () => {
    const capabilities: readonly string[] = CAPABILITIES;
    for (const capability of [
      "session.mistake.list",
      "session.mistake.record",
      "session.mistake.promote",
    ]) {
      expect(capabilities).toContain(capability);
    }
  });
});

describe("session.mistake.list", () => {
  test("an empty ledger is an empty list", async () => {
    const result = await resultOf(makeServer(), "session.mistake.list", { id: sessionId });
    expect(result.entries).toEqual([]);
  });

  test("a missing or blank id is invalid params", async () => {
    for (const params of [{}, { id: "  " }, { id: 7 }]) {
      const error = await errorOf(makeServer(), "session.mistake.list", params);
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("session id");
    }
  });

  test("an unknown session is the shared session shape", async () => {
    const error = await errorOf(makeServer(), "session.mistake.list", {
      id: "2026-12-31-0000-missing",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "session" });
    expect(error.retryable).toBe(false);
  });
});

describe("session.mistake.record", () => {
  test("appends and returns the whole ledger", async () => {
    const server = makeServer();
    const result = await resultOf(server, "session.mistake.record", {
      id: sessionId,
      text: "  Energy is conserved per object. ",
      step: "Derive the energy balance",
    });
    expect(result.entries).toEqual([
      {
        index: 0,
        text: "Energy is conserved per object.",
        step: "Derive the energy balance",
        note: null,
      },
    ]);
  });

  test("a blank or non-string text is refused", async () => {
    const blank = await errorOf(makeServer(), "session.mistake.record", {
      id: sessionId,
      text: "   ",
    });
    expect(blank.code).toBe(BOOT_FAILED);
    expect(blank.data).toMatchObject({ kind: "mistake" });
    expect(blank.message).toContain("some text");

    const wrong = await errorOf(makeServer(), "session.mistake.record", {
      id: sessionId,
      text: 7,
    });
    expect(wrong.code).toBe(-32602);
  });

  test("a non-string step is invalid params", async () => {
    const error = await errorOf(makeServer(), "session.mistake.record", {
      id: sessionId,
      text: "a mistake",
      step: 3,
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("step");
  });
});

describe("session.mistake.promote", () => {
  beforeEach(async () => {
    const server = makeServer();
    await resultOf(server, "session.mistake.record", {
      id: sessionId,
      text: "Energy is conserved per object.",
      step: "Derive the energy balance",
    });
  });

  test("writes a labelled school note that knowledge search and read return", async () => {
    const server = makeServer();
    const promoted = await resultOf(server, "session.mistake.promote", {
      id: sessionId,
      index: 0,
      correction: "Energy is conserved for a closed system.",
    });
    expect(promoted.already).toBe(false);
    const note = promoted.note as { path: string; title: string; created: string };
    expect(note.path).toStartWith("school/vault/knowledge/");
    expect(note.title).toBe("Energy is conserved per object.");

    // The note is now part of the knowledge base, labelled with its side.
    const search = await resultOf(server, "knowledge.search", { query: "conserved" });
    const hits = search.hits as Array<Record<string, unknown>>;
    const hit = hits.find((entry) => entry.path === note.path);
    expect(hit).toBeDefined();
    expect(hit).toMatchObject({ kind: "note", side: "school" });

    // And it opens like any other note, with the provenance sentence intact.
    const read = await resultOf(server, "knowledge.read", { id: hit!.id });
    expect(read.body as string).toContain("not one of the session's sources");
    expect(read.body as string).toContain("Energy is conserved for a closed system.");
  });

  test("marks the entry promoted and does not write a second note", async () => {
    const server = makeServer();
    const first = await resultOf(server, "session.mistake.promote", { id: sessionId, index: 0 });
    const again = await resultOf(server, "session.mistake.promote", { id: sessionId, index: 0 });
    expect(again.already).toBe(true);
    expect((again.note as { path: string }).path).toBe((first.note as { path: string }).path);

    const listed = await resultOf(server, "session.mistake.list", { id: sessionId });
    const entries = listed.entries as Array<Record<string, unknown>>;
    expect((entries[0]?.note as { path: string }).path).toBe(
      (first.note as { path: string }).path,
    );
  });

  test("an unknown index is a typed refusal", async () => {
    const error = await errorOf(makeServer(), "session.mistake.promote", {
      id: sessionId,
      index: 4,
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "mistake" });
    expect(error.message).toContain("there is no mistake at index 4");
  });

  test("a malformed index or correction is invalid params", async () => {
    for (const params of [
      { id: sessionId, index: -1 },
      { id: sessionId, index: 1.5 },
      { id: sessionId, index: "0" },
      { id: sessionId, index: 0, correction: 4 },
      { id: sessionId, index: 0, title: 4 },
    ]) {
      const error = await errorOf(makeServer(), "session.mistake.promote", params);
      expect(error.code).toBe(-32602);
    }
  });
});

describe("session.mistake.correct", () => {
  beforeEach(async () => {
    const server = makeServer();
    await resultOf(server, "session.mistake.record", {
      id: sessionId,
      text: "Energy is conserved per object.",
      step: "Derive the energy balance",
    });
    await resultOf(server, "session.mistake.promote", { id: sessionId, index: 0 });
  });

  test("writes the correction and settles the note", async () => {
    const server = makeServer();
    const reply = await resultOf(server, "session.mistake.correct", {
      id: sessionId,
      index: 0,
      correction: "Energy is conserved for a closed system.",
    });
    const note = reply.note as { status: string; path: string };
    expect(note.status).toBe("corrected");

    const listed = await resultOf(server, "session.mistake.list", { id: sessionId });
    const entries = listed.entries as Array<Record<string, unknown>>;
    expect((entries[0]?.note as { status: string }).status).toBe("corrected");

    const read = await resultOf(server, "knowledge.read", {
      id: `note:school:${note.path}`,
    });
    expect(read.body as string).toContain("Energy is conserved for a closed system.");
    expect(read.body as string).not.toContain("Not written yet.");

    // A corrected note is settled, so it is no longer an actionable review item.
    const queue = await resultOf(server, "review.queue");
    const items = (queue.queue as { items: Array<Record<string, unknown>> }).items;
    expect(items.some((item) => item.kind === "mistake")).toBe(false);
  });

  test("a later correction replaces the earlier one", async () => {
    const server = makeServer();
    await resultOf(server, "session.mistake.correct", {
      id: sessionId,
      index: 0,
      correction: "First answer.",
    });
    await resultOf(server, "session.mistake.correct", {
      id: sessionId,
      index: 0,
      correction: "Second answer.",
    });
    const listed = await resultOf(server, "session.mistake.list", { id: sessionId });
    const entries = listed.entries as Array<Record<string, unknown>>;
    const path = (entries[0]?.note as { path: string }).path;
    const read = await resultOf(server, "knowledge.read", { id: `note:school:${path}` });
    expect(read.body as string).toContain("Second answer.");
    expect(read.body as string).not.toContain("First answer.");
  });

  test("a blank correction is a typed refusal", async () => {
    const error = await errorOf(makeServer(), "session.mistake.correct", {
      id: sessionId,
      index: 0,
      correction: "   ",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "mistake" });
    expect(error.message).toContain("some text");
  });

  test("a malformed request is invalid params", async () => {
    for (const params of [
      { id: sessionId, index: 0 },
      { id: sessionId, index: -1, correction: "x" },
      { id: sessionId, index: 0, correction: 7 },
      { id: "  ", index: 0, correction: "x" },
    ]) {
      const error = await errorOf(makeServer(), "session.mistake.correct", params);
      expect(error.code).toBe(-32602);
    }
  });

  test("the handshake advertises the method", () => {
    expect(CAPABILITIES as readonly string[]).toContain("session.mistake.correct");
  });
});

/**
 * `session.document`: the generated study documents of one lock-in session.
 *
 * The boot seam is injected and the session folder is a throwaway directory, so
 * no case here creates a real workspace, contacts a provider or starts a chat
 * turn. The real-workspace behaviour — sources, files on disk, atomic replace —
 * is covered by `tests/integration/server-data.test.ts`.
 *
 * The contract under test:
 * - the kind is one of `contract`, `contradictions`, `check`; anything else is
 *   `-32602` and never boots the app;
 * - `attempt` is a string and only applies to `check`;
 * - an unknown session is the shared session error shape;
 * - with no model there is no completion, so the reply is the one Settings
 *   sentence and nothing is written.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

/** A valid `meta.json` for `physics-4`, with no sources: the prompt is the context. */
const META = {
  schema: 1,
  id: "2026-11-01-0900-physics-4",
  name: "Physics — Unit 4",
  created: "2026-11-01T09:00:00Z",
  prompt: "Study the boundary conditions.",
  sources: [],
};

let base: string;
let sessionsDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "session-documents-"));
  sessionsDir = join(base, "school", "sessions");
  await mkdir(join(sessionsDir, META.id), { recursive: true });
  // The session context lists `sources/`; an absent folder reads as a storage
  // failure rather than an empty set, so the folder exists and is empty here.
  await mkdir(join(sessionsDir, META.id, "sources"), { recursive: true });
  await writeFile(join(sessionsDir, META.id, SESSION_FILES.meta), `${JSON.stringify(META, null, 2)}\n`);
  await writeFile(
    join(sessionsDir, META.id, SESSION_FILES.prompt),
    "Explain whether the boundary conditions change the integral limits.\n",
  );
});

afterEach(async () => {
  await removeTemp(base);
});

/**
 * The slice of a booted app the protocol reads, with the directories this test
 * points at its own temp workspace. Nothing here is a real workspace: the
 * session folder above is all `session.document` resolves.
 */
function fakeServices(
  overrides: { generate?: ((prompt: string) => Promise<string>) | undefined } = {},
): CoreServices {
  return {
    workspace: {
      root: base,
      paths: {
        root: base,
        schoolSessions: sessionsDir,
        dataDir: join(base, "data"),
        schoolVault: join(base, "school", "vault"),
        goals: join(base, "skills", "goals"),
        skillVault: join(base, "skills", "vault"),
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
  return { server, counter };
}

function request(params: Record<string, unknown>): JsonRpcRequest {
  const parsed = parseRequest(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.document", params }),
  );
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle(request(params));
  if (response === null) throw new Error("expected a response");
  return response;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  params: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, params);
  if (!("error" in response)) throw new Error("session.document should have failed");
  return response.error;
}

describe("session.document capability", () => {
  test("is advertised in the handshake", () => {
    expect(CAPABILITIES).toContain("session.document");
  });
});

describe("session.document validation", () => {
  test("a bad shape is -32602 and never boots the app", async () => {
    const { server, counter } = fakeCore();

    for (const params of [
      {},
      { id: "", kind: "contract" },
      { id: "   ", kind: "contract" },
      { id: META.id },
      { id: META.id, kind: "" },
      { id: META.id, kind: "study-guide" },
      { id: META.id, kind: 7 },
      { id: META.id, kind: "contract", attempt: 5 },
      // `attempt` belongs to `check`; dropping it silently would be a lie.
      { id: META.id, kind: "contract", attempt: "my answer" },
      { id: META.id, kind: "contradictions", attempt: "my answer" },
    ]) {
      const error = await errorOf(server, params);
      expect(error.code).toBe(-32602);
    }

    expect(counter.calls).toBe(0);
    // Nothing was written by the refusals.
    expect(existsSync(join(sessionsDir, META.id, SESSION_FILES.contract))).toBe(false);
  });

  test("the unknown-kind message names the accepted set", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, { id: META.id, kind: "study-guide" });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("contract");
    expect(error.message).toContain("contradictions");
    expect(error.message).toContain("check");
  });

  test("a blank attempt on check is no attempt, so the shape is accepted", async () => {
    // The request still reaches the workspace; without a model it is the
    // generation refusal, not a shape failure.
    const { server } = fakeCore();
    const error = await errorOf(server, { id: META.id, kind: "check", attempt: "   " });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toMatchObject({ kind: "generation", id: META.id });
  });

  test("an unknown session is the shared session error shape", async () => {
    const { server } = fakeCore();
    const id = "2026-12-31-0000-missing";
    const error = await errorOf(server, { id, kind: "contract" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "session", id });
  });
});

describe("session.document without a model", () => {
  test("is one Settings sentence, and writes no document", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, { id: META.id, kind: "contract" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("link a model in Settings → Providers");
    expect(error.data).toEqual({
      kind: "generation",
      id: META.id,
      message: "link a model in Settings → Providers",
    });

    // The session folder gained no document at all.
    expect(existsSync(join(sessionsDir, META.id, SESSION_FILES.contract))).toBe(false);
    expect(existsSync(join(sessionsDir, META.id, SESSION_FILES.contradictions))).toBe(false);
    expect(existsSync(join(sessionsDir, META.id, SESSION_FILES.check))).toBe(false);
  });
});

describe("session.document shape", () => {
  test("returns the document text and its session-relative name", async () => {
    const seen: string[] = [];
    const { server } = fakeCore(
      fakeServices({
        generate: async (prompt) => {
          seen.push(prompt);
          return "# Done when\n\n- [ ] The boundary conditions are stated.\n";
        },
      }),
    );

    const response = await ask(server, { id: META.id, kind: "contract" });
    if ("error" in response) throw new Error(response.error.message);
    expect(Object.keys(response.result).sort()).toEqual(["name", "text"]);
    expect(response.result).toEqual({
      text: "# Done when\n\n- [ ] The boundary conditions are stated.",
      name: SESSION_FILES.contract,
    });

    // The completion saw the session's own instructions, and the reply is the
    // exact bytes the service wrote: trimmed text plus one newline.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("boundary conditions");
    await expect(
      readFile(join(sessionsDir, META.id, SESSION_FILES.contract), "utf8"),
    ).resolves.toBe(`${response.result.text}\n`);

    // A document is not a chat turn: the transcript is still absent.
    expect(existsSync(join(sessionsDir, META.id, SESSION_FILES.chat))).toBe(false);
    expect((await readdir(join(sessionsDir, META.id))).sort()).toEqual([
      SESSION_FILES.contract,
      SESSION_FILES.meta,
      SESSION_FILES.prompt,
      "sources",
    ]);
  });

  test("check forwards the attempt to the completion", async () => {
    const seen: string[] = [];
    const { server } = fakeCore(
      fakeServices({
        generate: async (prompt) => {
          seen.push(prompt);
          return "The setup is right; one gap remains.";
        },
      }),
    );

    const response = await ask(server, {
      id: META.id,
      kind: "check",
      attempt: "  I integrated from 0 to 4.  ",
    });
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result.name).toBe(SESSION_FILES.check);
    expect(seen[0]).toContain("Learner attempt:\nI integrated from 0 to 4.");
  });

  test("a failed completion is one typed message and leaves the old document", async () => {
    const documentPath = join(sessionsDir, META.id, SESSION_FILES.contract);
    await writeFile(documentPath, "# Done when\n\n- [x] Keep me exactly as written\n");

    const { server } = fakeCore(
      fakeServices({
        generate: async () => {
          throw new Error("upstream overloaded at 503");
        },
      }),
    );

    const error = await errorOf(server, { id: META.id, kind: "contract" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("overloaded");
    expect(error.data).toMatchObject({ kind: "generation", id: META.id });

    // The previous document survives byte for byte; nothing partial is written.
    await expect(readFile(documentPath, "utf8")).resolves.toBe(
      "# Done when\n\n- [x] Keep me exactly as written\n",
    );
    expect((await readdir(join(sessionsDir, META.id))).sort()).toEqual([
      SESSION_FILES.contract,
      SESSION_FILES.meta,
      SESSION_FILES.prompt,
      "sources",
    ]);
  });
});

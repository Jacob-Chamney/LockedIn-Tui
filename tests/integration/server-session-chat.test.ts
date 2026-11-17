/**
 * A real session chat over the JSON-RPC core.
 *
 * The provider is a fake ChatService injected through `boot`, so the test stays
 * offline while exercising the real session loader, source toolbox, controller,
 * history port and event projection.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { boot } from "../../src/app/boot";
import { SESSION_FILES } from "../../src/domain/session";
import { createLockInSession } from "../../src/services/lockin/create";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import {
  createCoreServer,
  type CoreNotification,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import type { ChatRequest, ChatService } from "../../src/llm/chat";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : "/tmp";
const NOW = () => new Date("2026-11-01T12:00:00Z");

let base: string;
let workspaceRoot: string;
let dataDir: string;
let workspace: Workspace;
let sourcePath: string;
let sessionId: string;
let sessionFolder: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-session-chat-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  const createdWorkspace = await createWorkspace(workspaceRoot, { dataDir });
  if (!createdWorkspace.ok) throw new Error("workspace create failed");
  workspace = createdWorkspace.value;

  sourcePath = join(base, "notes.md");
  await writeFile(sourcePath, "The mitochondria is the powerhouse of the cell.\n", "utf8");

  const created = await createLockInSession({
    workspace,
    created: "2026-11-01T09:00:00Z",
    name: "Biology — Cells",
    prompt: "Summarise the notes.",
    files: [sourcePath],
    steps: false,
  });
  if (!created.ok) throw new Error(created.error.message);
  sessionId = created.value.session.id;
  sessionFolder = created.value.folder;
  await writeFile(
    join(sessionFolder, SESSION_FILES.steps),
    "# Steps\n\n- [x] Read the notes\n- [ ] Explain the powerhouse\n",
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "config.toml"),
    '[models]\nchat = "custom/fake"\n',
    "utf8",
  );
});

afterEach(async () => {
  await removeTemp(base);
});

function fakeService(seen: ChatRequest[]): ChatService {
  return {
    async *send(request: ChatRequest) {
      seen.push(request);
      yield { type: "text" as const, delta: "The mitochondria is the powerhouse." };
      yield {
        type: "usage" as const,
        tokens: { input: 21, output: 6, total: 27 },
      };
      yield {
        type: "done" as const,
        text: "The mitochondria is the powerhouse.",
        steps: [],
        usage: { input: 21, output: 6, total: 27 },
        durationMs: 12,
      };
    },
    cancel() {},
    active() {
      return [];
    },
  };
}

function core(seen: ChatRequest[]) {
  return createCoreServer({
    boot: () =>
      boot({
        workspaceRoot,
        dataDir,
        env: {},
        now: NOW,
        createService: () => fakeService(seen),
      }),
  });
}

let nextId = 1;
async function ask(
  server: ReturnType<typeof core>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: nextId++,
    method,
    ...(params === undefined ? {} : { params }),
  });
  if (response === null) throw new Error("expected a response");
  return response;
}

describe("session-bound chat", () => {
  test("opens a session with its prompt, sources and steps", async () => {
    const server = core([]);
    const response = await ask(server, "session.open", { id: sessionId });
    expect(response).toMatchObject({
      result: {
        session: {
          id: sessionId,
          name: "Biology — Cells",
          prompt: "Summarise the notes.",
          steps: { done: 1, total: 2, exists: true },
        },
      },
    });
    const result = (response as unknown as { result: { session: { sources: Array<{ name: string; storedPath: string }> } } }).result;
    expect(result.session.sources).toHaveLength(1);
    expect(result.session.sources[0]).toMatchObject({ name: "notes.md" });
    expect(result.session.sources[0]?.storedPath).toContain("sources/");
  });

  test("sends a source-bound turn, streams state and persists chat.jsonl", async () => {
    const seen: ChatRequest[] = [];
    const notifications: CoreNotification[] = [];
    const server = createCoreServer({
      boot: () =>
        boot({
          workspaceRoot,
          dataDir,
          env: {},
          now: NOW,
          createService: () => fakeService(seen),
        }),
      notify: (notification) => notifications.push(notification),
    });

    const snapshot = await ask(server, "session.chat.snapshot", { id: sessionId });
    expect(snapshot).toMatchObject({ result: { status: "idle", messages: [] } });

    const sent = await ask(server, "session.chat.send", { id: sessionId, text: "what is the powerhouse?" });
    expect(sent).toMatchObject({ result: { turnId: sessionId } });

    const deadline = Date.now() + 5000;
    const stateWithAnswer = () =>
      notifications.some((entry) => {
        if (entry.method !== "session.chat.state") return false;
        const messages = (entry.params as { messages?: unknown })?.messages;
        return JSON.stringify(messages ?? "").includes("The mitochondria is the powerhouse.");
      });
    while (
      Date.now() < deadline &&
      (!notifications.some((entry) => entry.method === "session.chat.done") ||
        !stateWithAnswer())
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const states = notifications.filter((entry) => entry.method === "session.chat.state");
    const last = states.at(-1)?.params as
      | { sessionId: string; messages: Array<{ role: string; text: string }>; usage: { tokens: number } }
      | undefined;
    expect(last?.sessionId).toBe(sessionId);
    expect(last?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "what is the powerhouse?" }),
        expect.objectContaining({ role: "assistant", text: "The mitochondria is the powerhouse." }),
      ]),
    );
    expect(last?.usage.tokens).toBe(27);

    const done = notifications.find((entry) => entry.method === "session.chat.done");
    expect(done?.params).toMatchObject({ sessionId, kind: "sent", outcome: "done" });

    // The source text reached the model request through the session toolbox
    // context, not through a Chill transcript.
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0]?.messages)).toContain("mitochondria");

    const transcript = await readFile(join(sessionFolder, SESSION_FILES.chat), "utf8");
    expect(transcript).toContain("what is the powerhouse?");
    expect(transcript).toContain("The mitochondria is the powerhouse.");
  });
});

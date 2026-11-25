/**
 * `session.figure.*`: the crop is confined to the session, the render is
 * injected, and the PNG is served as base64.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";
import type { RenderInput } from "../../src/services/lockin/figures";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const SESSION_ID = "2026-11-01-0900-physics";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

let root: string;
let sessions: string;
let folder: string;

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "server-figures-"));
  sessions = join(root, "school", "sessions");
  folder = join(sessions, SESSION_ID);
  await mkdir(join(folder, "sources"), { recursive: true });
  await writeFile(join(folder, "sources", "lecture.pdf"), "%PDF-1.4\n%%EOF\n");
  await writeFile(
    join(folder, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: SESSION_ID,
      name: "Physics",
      created: "2026-11-01T09:00:00Z",
      prompt: "",
      sources: [
        {
          original_path: "/input/lecture.pdf",
          stored_path: "sources/lecture.pdf",
          name: "lecture.pdf",
          hash: `sha256:${"a".repeat(64)}`,
          kind: "pdf",
        },
      ],
      archived: false,
    }),
  );
});

afterEach(async () => {
  await removeTemp(root);
});

function services(
  render: (input: RenderInput) => Promise<Result<Uint8Array, { kind: string; message: string }>> = async () =>
    ({ ok: true, value: PNG }),
): CoreServices {
  return {
    workspace: { root, paths: { schoolSessions: sessions } },
    settings: { dataDir: join(root, "data") },
    renderFigure: render as never,
  } as unknown as CoreServices;
}

function core(
  render?: (input: RenderInput) => Promise<Result<Uint8Array, { kind: string; message: string }>>,
) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services(render) }) as Result<CoreServices, BootFailure>,
  });
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const parsed = parseRequest(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
  );
  if ("error" in parsed) throw new Error(parsed.error.message);
  const response = await server.handle(parsed as JsonRpcRequest);
  if (response === null) throw new Error("expected a response");
  return response;
}

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method}: ${response.error.message}`);
  return response.result as Record<string, unknown>;
}

describe("session figures", () => {
  test("extract stores a figure, read serves its PNG, annotate and remove work", async () => {
    let rendered: RenderInput | null = null;
    const server = core(async (input) => {
      rendered = input;
      return { ok: true, value: PNG };
    });

    const extracted = await resultOf(server, "session.figure.extract", {
      id: SESSION_ID,
      page: 2,
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      caption: "Figure 2",
    });
    const figure = extracted.figure as Record<string, unknown>;
    expect(figure.id).toBe("figure-1");
    expect(figure.page).toBe(2);
    expect(rendered).not.toBeNull();
    expect(rendered!.dpi).toBe(110);
    expect(rendered!.sourcePath).toContain("sources/lecture.pdf");

    const listed = await resultOf(server, "session.figure.list", { id: SESSION_ID });
    expect((listed.figures as unknown[]).length).toBe(1);

    const read = await resultOf(server, "session.figure.read", {
      id: SESSION_ID,
      figureId: "figure-1",
    });
    expect(read.mediaType).toBe("image/png");
    expect(Buffer.from(read.base64 as string, "base64")[0]).toBe(0x89);

    const annotated = await resultOf(server, "session.figure.annotate", {
      id: SESSION_ID,
      figureId: "figure-1",
      note: "the slope is the rate",
    });
    expect((annotated.figure as Record<string, unknown>).note).toBe("the slope is the rate");

    const removed = await resultOf(server, "session.figure.remove", {
      id: SESSION_ID,
      figureId: "figure-1",
    });
    expect(removed.removed).toBe(true);
  });

  test("a partial crop or a bad page is a shape error", async () => {
    const server = core();
    for (const params of [
      { id: SESSION_ID, page: 1, x: 10 },
      { id: SESSION_ID, page: 0 },
      { id: SESSION_ID, page: 1, dpi: 300 },
    ]) {
      const response = await ask(server, "session.figure.extract", params);
      if (!("error" in response)) throw new Error("should have failed");
      expect(response.error.code).toBe(-32602);
    }
  });

  test("a tool-missing render is one actionable refusal", async () => {
    const server = core(async () => ({
      ok: false,
      error: {
        kind: "tool-missing",
        message: "figures need `pdftoppm` (poppler); install poppler-utils",
      },
    }));
    const response = await ask(server, "session.figure.extract", {
      id: SESSION_ID,
      page: 1,
    });
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.message).toContain("poppler");
    expect(response.error.retryable).toBe(false);
  });

  test("a session without a PDF says what to add", async () => {
    await writeFile(
      join(folder, "meta.json"),
      JSON.stringify({
        schema: 1,
        id: SESSION_ID,
        name: "Physics",
        created: "2026-11-01T09:00:00Z",
        prompt: "",
        sources: [],
        archived: false,
      }),
    );
    const response = await ask(core(), "session.figure.extract", {
      id: SESSION_ID,
      page: 1,
    });
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.message).toContain("add a PDF");
  });
});

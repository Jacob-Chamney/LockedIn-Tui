/**
 * `update.info` / `update.check`.
 *
 * The desktop shell shows the running version and asks the public release feed
 * whether a newer build exists. A check is explicit, read-only and never
 * retried; this suite drives the transport over an injected result, so it needs
 * no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
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
import type { UpdateCheck } from "../../src/services/update";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-update-"));
});

afterEach(async () => {
  await removeTemp(base);
});

function services(updateCheck?: () => Promise<UpdateCheck>): CoreServices {
  return {
    workspace: { root: join(base, "workspace"), paths: {} },
    settings: { dataDir: join(base, "data") },
    ...(updateCheck === undefined ? {} : { updateCheck }),
  } as unknown as CoreServices;
}

function core(updateCheck?: () => Promise<UpdateCheck>) {
  return createCoreServer({
    boot: async () =>
      ({ ok: true, value: services(updateCheck) }) as Result<CoreServices, BootFailure>,
  });
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const parsed: JsonRpcRequest = parseRequest(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
  ) as JsonRpcRequest;
  const response = await server.handle(parsed);
  if (response === null) throw new Error("expected a response");
  return response;
}

describe("update", () => {
  test("info reports the running version and repository without booting", async () => {
    // No boot seam at all: the method must answer before a workspace exists.
    const server = createCoreServer({
      boot: async () =>
        ({ ok: false, error: { kind: "boot", path: "", message: "no", next: "" } }) as Result<
          CoreServices,
          BootFailure
        >,
    });
    const response = await ask(server, "update.info");
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result.current).toMatch(/^\d{4}\.\d+\.\d+$/);
    expect(response.result.repo).toBe("Jacob-Chamney/LockedIn-Tui");
  });

  test("an available update carries the release page, not a download", async () => {
    const server = core(async () => ({
      kind: "available",
      current: "2026.11.12",
      info: {
        version: "2026.12.1",
        asset: "lockedin-2026.12.1-bun-linux-x64",
        assetUrl: "https://github.com/a/b/releases/download/v1/x",
        checksumUrl: "https://github.com/a/b/releases/download/v1/SHA256SUMS",
        releaseUrl: "https://github.com/a/b/releases/tag/v2026.12.1",
      },
    }));
    const response = await ask(server, "update.check");
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result).toEqual({
      current: "2026.11.12",
      kind: "available",
      version: "2026.12.1",
      asset: "lockedin-2026.12.1-bun-linux-x64",
      url: "https://github.com/a/b/releases/tag/v2026.12.1",
    });
  });

  test("the latest release reports current with its version", async () => {
    const server = core(async () => ({
      kind: "current",
      current: "2026.11.12",
      latest: "2026.11.12",
    }));
    const response = await ask(server, "update.check");
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result).toEqual({
      current: "2026.11.12",
      kind: "current",
      latest: "2026.11.12",
    });
  });

  test("an unreachable feed is an unavailable success, not an error", async () => {
    const server = core(async () => ({
      kind: "unavailable",
      current: "2026.11.12",
      message: "no published release yet",
    }));
    const response = await ask(server, "update.check");
    if ("error" in response) throw new Error(response.error.message);
    expect(response.result.kind).toBe("unavailable");
    expect(response.result.message).toContain("no published release");
  });

  test("a thrown check is one readable refusal", async () => {
    const server = core(async () => {
      throw new Error("the request timed out");
    });
    const response = await ask(server, "update.check");
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.message).toContain("timed out");
    expect(response.error.retryable).toBe(false);
  });

  test("a build with no check seam says so instead of hanging", async () => {
    const server = core();
    const response = await ask(server, "update.check");
    if (!("error" in response)) throw new Error("should have failed");
    expect(response.error.code).toBe(BOOT_FAILED);
    expect(response.error.message).toContain("not available");
  });
});

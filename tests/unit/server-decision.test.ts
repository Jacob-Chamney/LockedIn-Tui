/**
 * `decision.get` / `decision.set`: the optional decision layer over the wire.
 *
 * The layer is off by default and rules-only in this build, and the local model
 * it could rank search results with is not shipped (`docs/product.md` §10.4).
 * Every case uses an injected boot and an injected `saveDecision`, so no test
 * creates a workspace, writes a config file or contacts a provider.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  CAPABILITIES,
  DECISION_LOCAL_MODEL_REASON,
  DECISION_RULES_ONLY_REFUSAL,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type DecisionSettings,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

type FakeOptions = {
  /** The booted `decision_layer` values; defaults are off and empty. */
  decision?: DecisionSettings;
  /** `false` boots without a config at all, like a build with no snapshot. */
  config?: boolean;
  saveDecision?: (
    input: DecisionSettings,
  ) => Promise<Result<DecisionSettings, { message: string }>>;
};

/** The smallest booted app these methods need; nothing reads the disk. */
function fakeServices(options: FakeOptions = {}): CoreServices {
  const decision = options.decision ?? { enabled: false, model: "" };
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-unit-decision-workspace"),
      paths: { schoolSessions: join(tmpdir(), "lockedin-unit-decision-no-sessions") },
    },
    settings: { dataDir: join(tmpdir(), "lockedin-unit-decision-no-data") },
    ...(options.config === false ? {} : { config: { decision_layer: decision } }),
    ...(options.saveDecision === undefined ? {} : { saveDecision: options.saveDecision }),
  } as unknown as CoreServices;
}

function fakeCore(services: CoreServices) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
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
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
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

const OFF_VIEW = {
  enabled: false,
  model: "",
  rulesOnly: true,
  localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
};

describe("decision.get", () => {
  test("defaults are off, empty and rules-only", async () => {
    const server = fakeCore(fakeServices());
    expect(await resultOf(server, "decision.get")).toEqual(OFF_VIEW);
  });

  test("a boot with no config still reports the documented defaults", async () => {
    const server = fakeCore(fakeServices({ config: false }));
    expect(await resultOf(server, "decision.get")).toEqual(OFF_VIEW);
  });

  test("the default reason says no local runtime is bundled", () => {
    expect(DECISION_LOCAL_MODEL_REASON).toContain("No local model runtime is bundled");
    expect(DECISION_LOCAL_MODEL_REASON).toContain("rules only");
  });

  test("the capability list advertises both methods", () => {
    expect(CAPABILITIES).toContain("decision.get");
    expect(CAPABILITIES).toContain("decision.set");
  });
});

describe("decision.set", () => {
  test("enabling without a model persists and echoes the rules-only view", async () => {
    const writes: DecisionSettings[] = [];
    const server = fakeCore(
      fakeServices({
        saveDecision: async (input) => {
          writes.push(input);
          return { ok: true, value: input };
        },
      }),
    );

    const written = await resultOf(server, "decision.set", { enabled: true });
    expect(written).toEqual({ ...OFF_VIEW, enabled: true });
    expect(writes).toEqual([{ enabled: true, model: "" }]);

    // The write is reflected without a second boot or a config re-read.
    expect(await resultOf(server, "decision.get")).toEqual({ ...OFF_VIEW, enabled: true });
  });

  test("a non-empty model is refused and nothing is saved", async () => {
    let writes = 0;
    const server = fakeCore(
      fakeServices({
        saveDecision: async (input) => {
          writes += 1;
          return { ok: true, value: input };
        },
      }),
    );

    const error = await errorOf(server, "decision.set", {
      enabled: true,
      model: "llama3.2:3b",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(DECISION_RULES_ONLY_REFUSAL);
    expect(error.data).toEqual({ kind: "decision", message: DECISION_RULES_ONLY_REFUSAL });
    expect(writes).toBe(0);
    // The refusal left the stored values alone.
    expect(await resultOf(server, "decision.get")).toEqual(OFF_VIEW);
  });

  test("enabling while a stored model is present is refused by the same rule", async () => {
    let writes = 0;
    const server = fakeCore(
      fakeServices({
        decision: { enabled: false, model: "hand-edited" },
        saveDecision: async (input) => {
          writes += 1;
          return { ok: true, value: input };
        },
      }),
    );

    const error = await errorOf(server, "decision.set", { enabled: true });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "decision" });
    expect(writes).toBe(0);
    // A hand-edited config value is reported honestly, never run.
    expect(await resultOf(server, "decision.get")).toEqual({
      ...OFF_VIEW,
      model: "hand-edited",
    });
  });

  test("disabling writes an empty model and keeps the layer off", async () => {
    const writes: DecisionSettings[] = [];
    const server = fakeCore(
      fakeServices({
        decision: { enabled: true, model: "" },
        saveDecision: async (input) => {
          writes.push(input);
          return { ok: true, value: input };
        },
      }),
    );
    expect(await resultOf(server, "decision.set", { enabled: false })).toEqual(OFF_VIEW);
    expect(writes).toEqual([{ enabled: false, model: "" }]);
  });

  test("bad shapes are -32602 and never reach the writer", async () => {
    let writes = 0;
    const server = fakeCore(
      fakeServices({
        saveDecision: async (input) => {
          writes += 1;
          return { ok: true, value: input };
        },
      }),
    );

    const enabled = await errorOf(server, "decision.set", { enabled: "yes" });
    expect(enabled.code).toBe(-32602);
    expect(enabled.message).toContain("enabled must be true or false");

    const model = await errorOf(server, "decision.set", { model: 5 });
    expect(model.code).toBe(-32602);
    expect(model.message).toContain("model must be a string");

    expect(writes).toBe(0);
  });

  test("a write failure is the config shape and keeps the previous view", async () => {
    const server = fakeCore(
      fakeServices({
        saveDecision: async () => ({ ok: false, error: { message: "config.toml is read-only" } }),
      }),
    );

    const error = await errorOf(server, "decision.set", { enabled: true });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("config.toml is read-only");
    expect(error.data).toEqual({ kind: "config", message: "config.toml is read-only" });
    expect(await resultOf(server, "decision.get")).toEqual(OFF_VIEW);
  });

  test("no writer is -32601", async () => {
    const server = fakeCore(fakeServices());
    const error = await errorOf(server, "decision.set", { enabled: true });
    expect(error.code).toBe(-32601);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("not available in this build");
  });

  test("an empty body is a no-op success, not a write", async () => {
    let writes = 0;
    const server = fakeCore(
      fakeServices({
        saveDecision: async (input) => {
          writes += 1;
          return { ok: true, value: input };
        },
      }),
    );
    expect(await resultOf(server, "decision.set")).toEqual(OFF_VIEW);
    expect(writes).toBe(0);
  });

  test("settings.patch refuses a decision_layer key, so this is the only writer", async () => {
    const server = fakeCore(fakeServices());
    const error = await errorOf(server, "settings.patch", {
      patch: { decision_layer: { enabled: true, model: "llama3" } },
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("use decision.set");
  });
});

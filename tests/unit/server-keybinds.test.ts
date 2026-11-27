/**
 * `keybinds.get` / `keybinds.set`: the storage half of the keymap registry.
 *
 * Every case injects a fake boot and a fake `saveKeybinds`, so nothing here
 * writes a config file or boots a workspace. The real `patchConfig` path is
 * covered by `tests/integration/server-data.test.ts`.
 *
 * The core owns no key catalogue: it validates the binding *form*, refuses a
 * duplicate across both tables and stores what the UI asked for. The default
 * action table stays in the UI, which is why an empty config reads `{}`.
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
  type KeybindMaps,
  type KeybindWrite,
} from "../../src/server/protocol";

type SaveKeybinds = NonNullable<CoreServices["saveKeybinds"]>;

function fakeServices(
  overrides: {
    keybinds?: Record<string, string>;
    fixedKeybinds?: Record<string, string>;
    saveKeybinds?: SaveKeybinds;
  } = {},
): CoreServices {
  return {
    workspace: {
      root: join(tmpdir(), "lockedin-keybinds-workspace"),
      paths: {
        schoolSessions: join(tmpdir(), "lockedin-keybinds-no-sessions"),
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
      dataDir: join(tmpdir(), "lockedin-keybinds-no-data"),
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
    config: {
      ui: {
        keybinds: overrides.keybinds ?? {},
        fixed_keybinds: overrides.fixedKeybinds ?? {},
      },
    },
    ...(overrides.saveKeybinds === undefined ? {} : { saveKeybinds: overrides.saveKeybinds }),
  } as unknown as CoreServices;
}

/**
 * A `saveKeybinds` fake that records calls and echoes the tables back.
 *
 * It behaves like the real config write where it matters: an empty binding is
 * the stored form of a cleared action, and it is returned as stored so the
 * protocol's reply is "what is on disk", not its own guess.
 */
function fakeSaveKeybinds(
  options: {
    fail?: string;
    transform?: (input: KeybindWrite) => KeybindMaps;
  } = {},
): { saveKeybinds: SaveKeybinds; calls: KeybindWrite[] } {
  const calls: KeybindWrite[] = [];
  const saveKeybinds = async (
    input: KeybindWrite,
  ): Promise<Result<KeybindMaps, { message: string }>> => {
    calls.push(structuredClone(input));
    if (options.fail !== undefined) {
      return { ok: false as const, error: { message: options.fail } };
    }
    const value: KeybindMaps = options.transform
      ? options.transform(input)
      : {
          keybinds: { ...input.keybinds },
          fixedKeybinds: { ...input.fixedKeybinds },
        };
    return { ok: true as const, value };
  };
  return { saveKeybinds, calls };
}

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
  const response = await server.handle(
    request(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    ),
  );
  if (response === null) throw new Error("expected a response");
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

describe("keybinds capabilities", () => {
  test("the handshake advertises both halves exactly once", async () => {
    const { server } = fakeCore();
    const result = await resultOf(server, "initialize");
    expect(result.capabilities).toEqual([...CAPABILITIES]);
    expect(result.capabilities as string[]).toContain("keybinds.get");
    expect(result.capabilities as string[]).toContain("keybinds.set");
    expect([...CAPABILITIES].filter((name) => name === "keybinds.get")).toHaveLength(1);
    expect([...CAPABILITIES].filter((name) => name === "keybinds.set")).toHaveLength(1);
  });
});

describe("keybinds.get", () => {
  test("an empty config is an empty pair, not an invented default table", async () => {
    const { server } = fakeCore();
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: {},
      fixedKeybinds: {},
    });
  });

  test("echoes the stored tables verbatim", async () => {
    const { server } = fakeCore(
      fakeServices({
        keybinds: { navigator: "space+e", "work-swarms": "space+x" },
        fixedKeybinds: { escape: "escape", quit: "ctrl+q" },
      }),
    );
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: { navigator: "space+e", "work-swarms": "space+x" },
      fixedKeybinds: { escape: "escape", quit: "ctrl+q" },
    });
  });

  test("a cleared override (an empty binding) is not an override", async () => {
    const { server } = fakeCore(
      fakeServices({
        keybinds: { navigator: "space+e", chat: "" },
        fixedKeybinds: { insert: "" },
      }),
    );
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: {},
    });
  });
});

describe("keybinds.set validation", () => {
  test("a blank or non-string action is -32602 and never boots", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server, counter } = fakeCore(fakeServices({ saveKeybinds }));
    for (const action of ["", "   ", 5, undefined]) {
      const error = await errorOf(server, "keybinds.set", { action, binding: "space+e" });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("action");
    }
    expect(calls).toEqual([]);
    expect(counter.calls).toBe(0);
  });

  test("an invalid form is -32602 naming the accepted forms", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server, counter } = fakeCore(fakeServices({ saveKeybinds }));
    for (const binding of ["", "  ", "ctrl+shift+k", "space+", "space+escape", "banana", "f6", "ctrl+"]) {
      const error = await errorOf(server, "keybinds.set", { action: "navigator", binding });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("not a binding");
      expect(error.message).toContain("space+<key>");
      expect(error.message).toContain("ctrl+<character>");
      expect(error.message).toContain("escape, enter, tab");
    }
    expect(calls).toEqual([]);
    expect(counter.calls).toBe(0);
  });

  test("a non-string binding is -32602", async () => {
    const { server } = fakeCore(fakeServices({ saveKeybinds: fakeSaveKeybinds().saveKeybinds }));
    const error = await errorOf(server, "keybinds.set", { action: "navigator", binding: 7 });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("binding");
  });

  test("a non-boolean fixed flag is -32602 and never boots", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server, counter } = fakeCore(fakeServices({ saveKeybinds }));
    const error = await errorOf(server, "keybinds.set", {
      action: "escape",
      binding: "escape",
      fixed: "yes",
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("fixed");
    expect(calls).toEqual([]);
    expect(counter.calls).toBe(0);
  });

  test("a missing saveKeybinds is -32601 with retryable false", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "keybinds.set", { action: "navigator", binding: "space+e" });
    expect(error.code).toBe(-32601);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("not available in this build");
  });
});

describe("keybinds.set writes", () => {
  test("a leader binding is stored in ui.keybinds and echoed", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { chat: "space+c" } }));

    const written = await resultOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+e",
    });
    expect(written).toEqual({
      keybinds: { chat: "space+c", navigator: "space+e" },
      fixedKeybinds: {},
    });
    expect(calls).toEqual([
      {
        keybinds: { chat: "space+c", navigator: "space+e" },
        fixedKeybinds: {},
        cleared: { keybinds: [], fixedKeybinds: [] },
      },
    ]);
    // The read path is the write path: no second read, no stale boot snapshot.
    expect(await resultOf(server, "keybinds.get")).toEqual(written);
  });

  test("a fixed key is stored in ui.fixed_keybinds", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { navigator: "space+e" } }));

    const written = await resultOf(server, "keybinds.set", {
      action: "escape",
      binding: "escape",
      fixed: true,
    });
    expect(written).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: { escape: "escape" },
    });
    expect(calls[0]).toEqual({
      keybinds: { navigator: "space+e" },
      fixedKeybinds: { escape: "escape" },
      cleared: { keybinds: [], fixedKeybinds: [] },
    });
  });

  test("every documented form is accepted and normalised", async () => {
    const { saveKeybinds } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds }));
    const forms: Array<[string, string]> = [
      ["space+e", "space+e"],
      [" Space+E ", "space+e"],
      ["?", "?"],
      [":", ":"],
      ["/", "/"],
      ["i", "i"],
      ["0", "0"],
      ["escape", "escape"],
      ["enter", "enter"],
      ["tab", "tab"],
      ["space", "space"],
      ["ctrl+q", "ctrl+q"],
      ["Ctrl+Q", "ctrl+q"],
    ];
    for (const [input, stored] of forms) {
      const written = await resultOf(server, "keybinds.set", {
        action: `action-${stored}`,
        binding: input,
      });
      expect(written.keybinds).toMatchObject({ [`action-${stored}`]: stored });
    }
  });

  test("an action already in fixed_keybinds keeps its table when `fixed` is omitted", async () => {
    const { saveKeybinds } = fakeSaveKeybinds();
    const { server } = fakeCore(
      fakeServices({ saveKeybinds, fixedKeybinds: { down: "j" } }),
    );
    const written = await resultOf(server, "keybinds.set", { action: "down", binding: "n" });
    expect(written).toEqual({ keybinds: {}, fixedKeybinds: { down: "n" } });
  });

  test("moving an action between tables clears the old entry", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(
      fakeServices({ saveKeybinds, keybinds: { "add-sources": "s" } }),
    );
    const written = await resultOf(server, "keybinds.set", {
      action: "add-sources",
      binding: "a",
      fixed: true,
    });
    expect(written).toEqual({ keybinds: {}, fixedKeybinds: { "add-sources": "a" } });
    expect(calls[0]?.cleared).toEqual({ keybinds: ["add-sources"], fixedKeybinds: [] });
  });

  test("the reply is what was stored, not what was requested", async () => {
    // A config write may normalise or drop an entry; the shell must render the
    // write's own answer.
    const { saveKeybinds } = fakeSaveKeybinds({
      transform: (input) => ({ keybinds: { ...input.keybinds, extra: "space+z" }, fixedKeybinds: {} }),
    });
    const { server } = fakeCore(fakeServices({ saveKeybinds }));
    const written = await resultOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+e",
    });
    expect(written).toEqual({ keybinds: { navigator: "space+e", extra: "space+z" }, fixedKeybinds: {} });
    expect(await resultOf(server, "keybinds.get")).toEqual(written);
  });

  test("a null binding clears the action back to its default", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(
      fakeServices({
        saveKeybinds,
        keybinds: { navigator: "space+e", chat: "space+c" },
        fixedKeybinds: { quit: "ctrl+q" },
      }),
    );

    const cleared = await resultOf(server, "keybinds.set", { action: "navigator", binding: null });
    expect(cleared).toEqual({
      keybinds: { chat: "space+c" },
      fixedKeybinds: { quit: "ctrl+q" },
    });
    expect(calls[0]).toEqual({
      keybinds: { chat: "space+c" },
      fixedKeybinds: { quit: "ctrl+q" },
      cleared: { keybinds: ["navigator"], fixedKeybinds: [] },
    });

    // An omitted binding is the same request as null.
    const alsoCleared = await resultOf(server, "keybinds.set", { action: "quit" });
    expect(alsoCleared).toEqual({ keybinds: { chat: "space+c" }, fixedKeybinds: {} });
    expect(calls[1]?.cleared).toEqual({ keybinds: [], fixedKeybinds: ["quit"] });
  });

  test("clearing an action that has no override writes nothing", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { chat: "space+c" } }));
    const result = await resultOf(server, "keybinds.set", { action: "navigator", binding: null });
    expect(result).toEqual({ keybinds: { chat: "space+c" }, fixedKeybinds: {} });
    expect(calls).toEqual([]);
  });

  test("a failed write is one -32000 and leaves the stored tables alone", async () => {
    const { saveKeybinds } = fakeSaveKeybinds({ fail: "config.toml could not be written" });
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { chat: "space+c" } }));

    const error = await errorOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+e",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "keybind",
      action: "navigator",
      message: "config.toml could not be written",
    });
    expect(await resultOf(server, "keybinds.get")).toEqual({
      keybinds: { chat: "space+c" },
      fixedKeybinds: {},
    });
  });
});

describe("keybinds.set duplicates", () => {
  test("a binding another action holds in keybinds is refused", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { "work-swarms": "space+x" } }));

    const error = await errorOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+x",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({
      kind: "keybind",
      action: "navigator",
      binding: "space+x",
      conflict: "work-swarms",
      message: "Space x is already bound to work-swarms.",
    });
    expect(error.message).toBe("Space x is already bound to work-swarms.");
    expect(calls).toEqual([]);
  });

  test("a binding another action holds in fixed_keybinds is refused too", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(
      fakeServices({ saveKeybinds, fixedKeybinds: { insert: "i", down: "j" } }),
    );

    const leader = await errorOf(server, "keybinds.set", { action: "navigator", binding: "j" });
    expect(leader.code).toBe(BOOT_FAILED);
    expect(leader.data).toEqual({
      kind: "keybind",
      action: "navigator",
      binding: "j",
      conflict: "down",
      message: "j is already bound to down.",
    });

    const fixed = await errorOf(server, "keybinds.set", {
      action: "up",
      binding: "j",
      fixed: true,
    });
    expect(fixed.code).toBe(BOOT_FAILED);
    expect((fixed.data as { conflict: string }).conflict).toBe("down");
    expect(calls).toEqual([]);
  });

  test("the conflict compares normalised forms and the stored spelling", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { quit: "Ctrl+Q" } }));

    const error = await errorOf(server, "keybinds.set", { action: "navigator", binding: "ctrl+q" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.data).toEqual({
      kind: "keybind",
      action: "navigator",
      binding: "ctrl+q",
      conflict: "quit",
      message: "Ctrl+Q is already bound to quit.",
    });
    expect(calls).toEqual([]);
  });

  test("an action may re-set its own binding", async () => {
    const { saveKeybinds, calls } = fakeSaveKeybinds();
    const { server } = fakeCore(fakeServices({ saveKeybinds, keybinds: { navigator: "space+e" } }));
    const written = await resultOf(server, "keybinds.set", {
      action: "navigator",
      binding: "space+e",
    });
    expect(written).toEqual({ keybinds: { navigator: "space+e" }, fixedKeybinds: {} });
    expect(calls).toHaveLength(1);
  });
});

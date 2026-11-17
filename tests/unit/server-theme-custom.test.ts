/**
 * The custom palette (`docs/product.md` §12 Themes).
 *
 * The shell owns the twelve-token catalogue and every default; the core only
 * **stores and validates** `[ui.custom_theme]`. Every case here boots the real
 * composition root in a throwaway workspace (no model, so no provider is
 * contacted) because the write path is a real `config.toml` patch.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { boot } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import {
  BOOT_FAILED,
  THEME_TOKEN_NAMES,
  createCoreServer,
  parseRequest,
  validateThemeTokens,
  type CoreServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ThemeTokens,
} from "../../src/server/protocol";
import { patchConfig } from "../../src/storage/config";
import { createWorkspace } from "../../src/storage/workspace";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const NOW = () => new Date("2026-11-01T12:00:00Z");

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

let base: string;
let workspaceRoot: string;
let dataDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "theme-custom-"));
  workspaceRoot = join(base, "workspace");
  dataDir = join(base, "data");
  unwrap(await createWorkspace(workspaceRoot, { dataDir }));
});

afterEach(async () => {
  await removeTemp(base);
});

/**
 * The real boot plus the real `main.ts` `saveThemeTokens` wrapper.
 *
 * `main.ts` starts readline and owns stdout, so it is not importable; this
 * mirrors its wrapper exactly — one `patchConfig` of `[ui.custom_theme]`, an
 * empty sentinel for a dropped token, `updateConfig`, then the visible map —
 * while the protocol remains the thing under test.
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

/** A core whose boot has no `saveThemeTokens` writer. */
function readerCore(): CoreServer {
  return createCoreServer({
    boot: () => boot({ workspaceRoot, dataDir, env: {}, now: NOW }),
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
    request(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) })),
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

async function tokensOf(server: CoreServer): Promise<ThemeTokens> {
  const result = await resultOf(server, "theme.custom.get");
  return result.tokens as ThemeTokens;
}

async function errorOf(
  server: CoreServer,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have been refused`);
  return response.error;
}

describe("theme.custom.get", () => {
  test("a fresh config has no overrides", async () => {
    expect(await tokensOf(themeCore())).toEqual({});
    // Nothing was invented: the palette catalogue is the shell's.
    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toContain("[ui.custom_theme]");
    expect(config).not.toMatch(/background\s*=/);
  });
});

describe("theme.custom.set", () => {
  test("stores the tokens, echoes them and lands in [ui.custom_theme]", async () => {
    const server = themeCore();
    const written = await resultOf(server, "theme.custom.set", {
      tokens: {
        background: "#101820",
        foreground: "#f2f2f2",
        primary: "#AABBCC",
      },
    });
    // Values are normalised to one stored spelling; the reply is what the file
    // holds, not an echo of the request.
    expect(written).toEqual({
      tokens: {
        background: "#101820",
        foreground: "#F2F2F2",
        primary: "#AABBCC",
      },
    });
    expect(await tokensOf(server)).toEqual(written.tokens as ThemeTokens);

    const config = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    expect(config).toMatch(/\[ui\.custom_theme\][^[]*background = "#101820"/s);
    expect(config).toMatch(/\[ui\.custom_theme\][^[]*primary = "#AABBCC"/s);
  });

  test("the set is a replacement: a dropped token is cleared", async () => {
    const server = themeCore();
    await resultOf(server, "theme.custom.set", {
      tokens: { background: "#101820", foreground: "#F2F2F2" },
    });

    const narrowed = await resultOf(server, "theme.custom.set", {
      tokens: { background: "#101820" },
    });
    expect(narrowed).toEqual({ tokens: { background: "#101820" } });
    expect(await tokensOf(server)).toEqual({ background: "#101820" });
    // `foreground` reads back as absent rather than a stale colour.
    expect(await tokensOf(themeCore())).toEqual({ background: "#101820" });
  });

  test("an empty object clears the palette", async () => {
    const server = themeCore();
    await resultOf(server, "theme.custom.set", {
      tokens: { background: "#101820", line: "#30363C" },
    });

    expect(await resultOf(server, "theme.custom.set", { tokens: {} })).toEqual({ tokens: {} });
    expect(await tokensOf(server)).toEqual({});
    expect(await tokensOf(themeCore())).toEqual({});
  });

  test("an unknown token name is -32602 and names it", async () => {
    const server = themeCore();
    // Boot once so the config file exists, then prove the refusal writes nothing.
    expect(await tokensOf(server)).toEqual({});
    const before = await readFile(join(workspaceRoot, "config.toml"), "utf8");
    const error = await errorOf(server, "theme.custom.set", {
      tokens: { background: "#101820", red: "#FF0000" },
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain('"red"');
    expect(error.message).toContain("is not a theme token");
    expect(error.message).toContain("background");
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(before);
    expect(await tokensOf(server)).toEqual({});
  });

  test("a colour that is not #RRGGBB is -32602 and names the token", async () => {
    const server = themeCore();
    for (const value of ["#12345", "red", "#GGGGGG", "", "#1122334"]) {
      const error = await errorOf(server, "theme.custom.set", {
        tokens: { primary: value },
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("primary");
      expect(error.message).toContain("#RRGGBB");
    }
    expect(await tokensOf(server)).toEqual({});
  });

  test("a non-object tokens value is -32602 and never boots", async () => {
    for (const tokens of [undefined, [], "background", 7]) {
      const error = await errorOf(themeCore(), "theme.custom.set", { tokens });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("tokens object");
    }
  });

  test("a restart reads the same tokens from config.toml", async () => {
    const stored = await resultOf(themeCore(), "theme.custom.set", {
      tokens: { surface: "#15181B", accent: "#FF6B6B" },
    });
    expect(await tokensOf(themeCore())).toEqual(stored.tokens as ThemeTokens);
  });

  test("a build with no config writer is -32601 and writes nothing", async () => {
    const error = await errorOf(readerCore(), "theme.custom.set", {
      tokens: { background: "#101820" },
    });
    expect(error.code).toBe(-32601);
    expect(error.retryable).toBe(false);
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).not.toMatch(
      /background = "#101820"/,
    );
    // The read half still answers on that build.
    expect(await tokensOf(readerCore())).toEqual({});
  });

  test("a failed write is one -32000 config error and the old tokens stay", async () => {
    const blockedRoot = join(base, "blocked");
    unwrap(await createWorkspace(blockedRoot, { dataDir }));
    const server = createCoreServer({
      boot: async () => {
        const booted = await boot({ workspaceRoot: blockedRoot, dataDir, env: {}, now: NOW });
        if (!booted.ok) return booted;
        return {
          ok: true,
          value: {
            ...booted.value,
            saveThemeTokens: async () => ({
              ok: false as const,
              error: { message: "The config could not be written." },
            }),
          },
        };
      },
    });
    const error = await errorOf(server, "theme.custom.set", {
      tokens: { background: "#101820" },
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toEqual({ kind: "config", message: "The config could not be written." });
    expect(await tokensOf(server)).toEqual({});
  });
});

describe("settings.patch", () => {
  test("cannot bypass the palette validation", async () => {
    const error = await errorOf(themeCore(), "settings.patch", {
      patch: { ui: { custom_theme: { red: "#FF0000" } } },
    });
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("theme.custom.set");
  });
});

describe("validateThemeTokens", () => {
  test("accepts exactly the twelve documented names", () => {
    expect(THEME_TOKEN_NAMES).toHaveLength(12);
    const all: ThemeTokens = {};
    for (const name of THEME_TOKEN_NAMES) all[name] = "#0D0F11";
    const validated = validateThemeTokens(all);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(Object.keys(validated.value).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
  });
});

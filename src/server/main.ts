/**
 * Headless core entry point.
 *
 * The Flutter shell spawns this over stdio. It must never write anything except
 * JSON-RPC lines to stdout; diagnostics go to stderr.
 *
 * The application is booted lazily: `initialize` and `ping` answer immediately so
 * the shell can start and show a boot refusal, and the first data request boots
 * the real workspace, config and services exactly once.
 */
import { createInterface } from "node:readline";

import { createCoreServer, isShutdown, parseRequest, type DecisionSettings, type KeybindWrite, type ThemeTokens, type WorkPermissions } from "./protocol";
import type { PluginCommand, PluginPolicyCell } from "../storage/config-schema";

/**
 * The two flags a person runs, before the protocol starts.
 *
 * `install.sh` ends with `lockedin --version`, so the binary has to answer that
 * without a shell attached: the stdio server would otherwise wait for JSON-RPC
 * input forever. Anything else (including no argument) is the sidecar.
 */
// A compiled binary is `[executable, ...flags]`; `bun run main.ts` is
// `[bun, main.ts, ...flags]`, so the flag is matched wherever it lands.
const argv = new Set(process.argv.slice(1));
if (argv.has("--version") || argv.has("-v")) {
  const { APP_VERSION } = await import("../version");
  process.stdout.write(`${APP_VERSION}\n`);
  process.exit(0);
}
if (argv.has("--help") || argv.has("-h")) {
  process.stdout.write(
    [
      "LockedIn core — the headless sidecar behind the desktop app.",
      "",
      "usage:",
      "  lockedin            speak JSON-RPC 2.0 over stdin/stdout (the shell does this)",
      "  lockedin --version  print the version and exit",
      "  lockedin --help     print this text and exit",
      "",
      "The workspace comes from LOCKEDIN_WORKSPACE (default ~/LockedIn-Tui);",
      "app data from LOCKEDIN_DATA_DIR. The desktop app starts this for you.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const lines = createInterface({ input: process.stdin, terminal: false });
let shuttingDown = false;

const server = createCoreServer({
  boot: async () => {
    // Imported on first use so the handshake never waits on provider glue.
    // `boot()` reads LOCKEDIN_WORKSPACE / LOCKEDIN_DATA_DIR itself.
    const { boot, settingsViewFrom } = await import("../app/boot");
    const { patchConfig } = await import("../storage/config");
    const result = await boot();
    if (!result.ok) return result;
    const booted = result.value;
    const visibleTokens = (tokens: ThemeTokens): ThemeTokens => {
      const visible: ThemeTokens = {};
      for (const [token, value] of Object.entries(tokens)) {
        if (typeof value === "string" && value.trim() !== "") visible[token] = value;
      }
      return visible;
    };
    /**
     * The custom palette tokens as this process last wrote them.
     *
     * `patchConfig` merges tables, so a token removed from the map is cleared by
     * writing an empty string — the sentinel the keybind tables already use —
     * and every read filters it out. The map is a replacement: a token the
     * request omits must disappear from the file, or resetting one row in the
     * editor would not persist.
     */
    let storedThemeTokens: ThemeTokens = visibleTokens(booted.config.ui.custom_theme);
    /** Notes from `[prompts]`; an empty string is a cleared note. */
    const storedPrompts: Record<string, string> = { ...booted.config.prompts };
    return {
      ok: true as const,
      value: {
        ...booted,
        createChat: booted.createChat,
        history: booted.history,
        linkProvider: booted.linkProvider,
        modelsForProvider: booted.modelsForProvider,
        linkedProviders: booted.linkedProviders,
        promptNote: (id) => (storedPrompts[id] ?? "").trim(),
        savePrompt: async (id, note) => {
          const written = await patchConfig(booted.workspace.paths, {
            prompts: { [id]: note },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          if (note.trim() === "") delete storedPrompts[id];
          else storedPrompts[id] = note.trim();
          await booted.updateConfig(written.value.config);
          return { ok: true as const, value: undefined };
        },
        updateCheck: async () => {
          const [{ checkForUpdate }, { APP_VERSION }] = await Promise.all([
            import("../services/update"),
            import("../version"),
          ]);
          return checkForUpdate({ current: APP_VERSION, app: "desktop" });
        },
        // Persist first, then apply to the live service, then report the view.
        // The protocol never sees TOML and never invents a settings shape.
        saveConfig: async (patch: Record<string, unknown>) => {
          const written = await patchConfig(booted.workspace.paths, patch as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          return {
            ok: true as const,
            value: settingsViewFrom(written.value.config, booted.settings.dataDir),
          };
        },
        // One policy cell, written through the same config file as everything
        // else. Nothing here starts a server or calls a plugin: a policy is
        // configuration for a later turn, and the permission gate is separate.
        savePolicy: async (input: {
          command: PluginCommand;
          server: string;
          value: PluginPolicyCell;
        }) => {
          const written = await patchConfig(booted.workspace.paths, {
            plugins: { policy: { [input.command]: { [input.server]: input.value } } },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          return { ok: true as const, value: written.value.config.plugins.policy };
        },
        // The decision layer is two stored values. This build bundles no local
        // model runtime, so the protocol only ever asks for an empty `model`;
        // this wrapper does not re-decide that, it persists what it was given
        // through the same config file and reports what the file now stores.
        saveDecision: async (input: DecisionSettings) => {
          const written = await patchConfig(booted.workspace.paths, {
            decision_layer: { enabled: input.enabled, model: input.model },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          return {
            ok: true as const,
            value: {
              enabled: written.value.config.decision_layer.enabled,
              model: written.value.config.decision_layer.model,
            },
          };
        },
        // The global Work write/command opt-in is two stored booleans. This is
        // the only writer of `[work]`: `settings.patch` refuses the section, so
        // the approval gate and the file cannot disagree.
        saveWorkPermissions: async (input: WorkPermissions) => {
          const written = await patchConfig(booted.workspace.paths, {
            work: { allow_write: input.allowWrite, allow_command: input.allowCommand },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          return {
            ok: true as const,
            value: {
              allowWrite: written.value.config.work.allow_write,
              allowCommand: written.value.config.work.allow_command,
            },
          };
        },

        // The keybind tables are one config write. The protocol computed the
        // whole table, so this only merges it in; a cleared action is stored as
        // an empty binding, which every reader treats as "no override" because
        // the default action catalogue lives in the UI registry, never here.
        saveKeybinds: async (input: KeybindWrite) => {
          const keybinds = { ...input.keybinds };
          const fixedKeybinds = { ...input.fixedKeybinds };
          for (const action of input.cleared.keybinds) keybinds[action] = "";
          for (const action of input.cleared.fixedKeybinds) fixedKeybinds[action] = "";
          const written = await patchConfig(booted.workspace.paths, {
            ui: { keybinds, fixed_keybinds: fixedKeybinds },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          return {
            ok: true as const,
            value: {
              keybinds: written.value.config.ui.keybinds,
              fixedKeybinds: written.value.config.ui.fixed_keybinds,
            },
          };
        },

        // The custom palette is one config table. The protocol validated the
        // names and colours; this only replaces the stored map, clearing any
        // token the request dropped, then reports what the file now holds. The
        // defaults live in the shell, so an empty map is a complete answer.
        saveThemeTokens: async (tokens: ThemeTokens) => {
          const patch: ThemeTokens = {};

          for (const token of Object.keys(storedThemeTokens)) patch[token] = "";
          for (const [token, value] of Object.entries(tokens)) patch[token] = value;

          const written = await patchConfig(booted.workspace.paths, {
            ui: { custom_theme: patch },
          } as never);
          if (!written.ok) {
            return { ok: false as const, error: { message: written.error.message } };
          }
          await booted.updateConfig(written.value.config);
          storedThemeTokens = visibleTokens(written.value.config.ui.custom_theme);
          return { ok: true as const, value: storedThemeTokens };
        },
      },
    };
  },
  notify: (notification) => {
    // Events share stdout with responses; they never carry a request id.
    process.stdout.write(`${JSON.stringify(notification)}\n`);
  },
});

function write(value: unknown): void {
  try {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } catch {
    // The shell closed the pipe; the readline close handler exits next.
  }
}

async function handleLine(line: string): Promise<void> {
  const request = parseRequest(line);
  if ("error" in request) {
    write(request);
    return;
  }
  const response = await server.handle(request);
  if (response) write(response);
  if (isShutdown(request)) {
    shuttingDown = true;
    lines.close();
    setImmediate(() => process.exit(0));
  }
}

lines.on("line", (line) => {
  if (line.trim() === "") return;
  void handleLine(line).catch((error: unknown) => {
    // The dispatch already maps handler failures to JSON-RPC errors; this is the
    // last-resort guard so one bad line can never take the core down.
    console.error(`LockedIn core: ${error instanceof Error ? error.message : String(error)}`);
  });
});

lines.on("close", () => {
  if (!shuttingDown) process.exit(0);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SettingsView } from "../types/settings";
import { listProviders } from "../llm/catalogue";
import {
  PROMPT_DEFINITIONS,
  isPromptId,
  normalisePromptNote,
  type PromptId,
} from "../domain/prompts";
import { UPDATE_REPO } from "../services/update";
import { APP_VERSION } from "../version";
import {
  KEYBIND_FORMS,
  displayBinding,
  keybindConflict,
  keybindTable,
  normalizeKeybind,
  type KeybindMaps,
} from "./keybinds";
import { validateThemeTokens, type ThemeTokens } from "./theme-tokens";
import {
  DECISION_LOCAL_MODEL_REASON,
  DECISION_RULES_ONLY_REFUSAL,
  type DecisionSettings,
  type DecisionView,
} from "./decision-types";
import type { SessionServices } from "./session-context";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  messageOf,
  oneLine,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** The in-memory overrides a Settings write leaves behind for this process. */
export type SettingsOverrideDoors<C extends SessionServices> = {
  settingsView: (current: C) => SettingsView;
  setSettings: (view: SettingsView) => void;
  keybinds: (current: C) => KeybindMaps;
  setKeybinds: (maps: KeybindMaps) => void;
  theme: (current: C) => ThemeTokens;
  setTheme: (tokens: ThemeTokens) => void;
  decision: (current: C) => DecisionSettings;
  setDecision: (settings: DecisionSettings) => void;
};

export type SettingsHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
} & SettingsOverrideDoors<C>;

/**
 * The Settings surface's read and write handlers: settings, providers, prompt
 * notes, updates, the custom palette, keybinds and the decision layer.
 *
 * A successful write carries its result in an in-memory override, because
 * `booted.config` is a boot snapshot; without it `get` would keep reporting the
 * values the process booted with.
 */
export function createSettingsHandlers<C extends SessionServices>(
  ctx: SettingsHandlerContext<C>,
): {
  handlers: Record<
    string,
    (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse> | JsonRpcResponse
  >;
} {
  const {
    services,
    settingsView,
    keybinds: storedKeybinds,
    setKeybinds,
    theme: storedTheme,
    setTheme,
    decision: storedDecision,
    setDecision,
  } = ctx;

  const settingsGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, settingsView(current.value) as unknown as Record<string, unknown>);
  };

  const providerList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    let linked: string[] = [];
    if (current.value.linkedProviders) {
      try {
        linked = await current.value.linkedProviders();
      } catch {
        // A locked or missing keychain is not a catalogue failure: the list
        // still renders and every row simply reads as not linked.
        linked = [];
      }
    }
    const providers = listProviders().map((spec) => ({
      id: spec.id,
      label: spec.label,
      keyRequired: spec.keyRequired,
      baseUrl: spec.baseUrl,
      note: spec.note ?? "",
      linked: linked.includes(spec.id),
    }));
    return success(id, { providers, linked });
  };

  const providerLink = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const providerId = params.providerId;
    if (typeof providerId !== "string" || providerId.trim() === "") {
      return invalid(id, "provider.link requires a provider id");
    }
    if (!listProviders().some((spec) => spec.id === providerId)) {
      return invalid(id, `provider.link: unknown provider ${JSON.stringify(providerId)}`);
    }
    const key = params.key;
    if (typeof key !== "string") {
      return invalid(id, "provider.link requires a key string (empty only for a keyless endpoint)");
    }
    const baseUrl = params.baseUrl;
    if (baseUrl !== undefined && typeof baseUrl !== "string") {
      return invalid(id, "provider.link: baseUrl must be a string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    if (!current.value.linkProvider) {
      return failure(id, -32601, "Provider linking is not available in this build", undefined, false);
    }
    const result = await current.value.linkProvider({
      providerId,
      key,
      ...(baseUrl && baseUrl.trim() !== "" ? { baseUrl: baseUrl.trim() } : {}),
    });
    if (!result.ok) {
      const error = result.error;
      const message =
        "message" in error && typeof error.message === "string"
          ? error.message
          : error.kind === "rate-limit"
            ? `${error.provider} is rate limiting this key; try again later`
            : "the provider rejected the key";
      const hint =
        "hint" in error && typeof error.hint === "string" ? error.hint : undefined;
      return failure(
        id,
        BOOT_FAILED,
        message,
        {
          kind: error.kind,
          provider: providerId,
          ...(hint === undefined ? {} : { hint }),
        },
        false,
      );
    }
    return success(id, {
      providerId,
      models: result.value.models,
      secretRef: result.value.secretRef,
      requests: result.value.requests,
      modelSelected: null,
    });
  };



  const promptItems = (note: (id: PromptId) => string) =>
    PROMPT_DEFINITIONS.map((definition) => {
      const text = note(definition.id);
      return { ...definition, note: text, custom: text.trim() !== "" };
    });

  const promptsList = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { items: promptItems(current.value.promptNote ?? (() => "")) });
  };

  /**
   * Set or clear one prompt note.
   *
   * The note is guidance appended to that generator; the reply's shape, its
   * limits and the safety rules are unchanged. An omitted `text` clears it, as
   * does an empty string.
   */
  const promptsSet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const promptId = params.id;
    if (!isPromptId(promptId)) {
      return invalid(
        id,
        `prompts.set: unknown prompt ${JSON.stringify(promptId)}; expected one of ${PROMPT_DEFINITIONS.map((entry) => entry.id).join(", ")}`,
      );
    }
    const normalised = normalisePromptNote(params.text ?? null);
    if (!normalised.ok) return invalid(id, `prompts.set: ${normalised.message}`);
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const save = current.value.savePrompt;
    if (!save) {
      return failure(id, -32601, "Prompt editing is not available in this build", { kind: "prompt", id: promptId }, false);
    }
    const written = await save(promptId, normalised.note);
    if (!written.ok) {
      return failure(
        id,
        BOOT_FAILED,
        oneLine(written.error.message),
        { kind: "config", message: oneLine(written.error.message) },
        false,
      );
    }
    return success(id, { items: promptItems(current.value.promptNote ?? (() => "")) });
  };

  /** The running version and the public release repository. No network. */
  const updateInfo = (id: RpcId): JsonRpcResponse =>
    success(id, { current: APP_VERSION, repo: UPDATE_REPO });

  /**
   * Ask the release feed whether a newer build exists.
   *
   * A check is read-only and explicit: no background re-check, no automatic
   * download and no retry. The desktop app cannot replace its own bundle from
   * here, so the reply carries the release page for the user to open.
   */
  const updateCheck = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const check = current.value.updateCheck;
    if (!check) {
      return failure(
        id,
        BOOT_FAILED,
        "update checking is not available in this build",
        { kind: "update", message: "update checking is not available in this build" },
        false,
      );
    }
    let result: import("../services/update").UpdateCheck;
    try {
      result = await check();
    } catch (error) {
      return failure(
        id,
        BOOT_FAILED,
        oneLine(messageOf(error)),
        { kind: "update", message: oneLine(messageOf(error)) },
        false,
      );
    }
    if (result.kind === "available") {
      return success(id, {
        current: result.current,
        kind: "available",
        version: result.info.version,
        asset: result.info.asset,
        url: result.info.releaseUrl,
      });
    }
    if (result.kind === "current") {
      return success(id, { current: result.current, kind: "current", latest: result.latest });
    }
    return success(id, {
      current: result.current,
      kind: "unavailable",
      message: result.message,
    });
  };

  /**
   * The MCP surface.
   *
   * `mcp.list` projects the configured servers exactly as the TUI's Plugins pane
   * does: name, transport, enabled flag, connection status and tool names. It
   * never returns `command`, `args`, `env` or a credential, and it never starts
   * a process — a server that is not connected simply reads as `stopped`.
   *
   * `mcp.refresh` is the only method that may spawn a stdio server, and only
   * because the shell asked for it; boot's own background start stays the
   * startup path. A server that fails carries its status on the row.
   *
   * `mcp.policy.get` returns the stored matrix verbatim. An absent policy is
   * `{}`: the core never invents cells, and `DEFAULT_PLUGIN_POLICY` is applied
   * by the policy engine, not by this transport.
   *
   * `mcp.policy.set` writes exactly one cell and is configuration only: it never
   * starts a server, calls a tool or approves a plugin write.
   *
   * `mcp.confirm` answers one pending write prompt. It resolves an in-memory
   * request only — it never boots the app, starts a server, writes config or
   * remembers the answer — and an unknown or late request id is a benign no-op
   * so a shell that raced a timeout is not punished with an error.
   */

  const themeTokensStored = (current: C): ThemeTokens => {
    const stored = storedTheme(current);
    const tokens: ThemeTokens = {};
    for (const [token, value] of Object.entries(stored)) {
      if (typeof value === "string" && value.trim() !== "") tokens[token] = value;
    }
    return tokens;
  };

  /**
   * Read the custom palette tokens (`docs/product.md` §12 Themes).
   *
   * This is a read: it writes nothing and boots no new state. `{}` is a valid
   * answer (no overrides), not a failure, and no colour is filled in here.
   */
  const themeCustomGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { tokens: themeTokensStored(current.value) });
  };

  /**
   * Replace the custom palette tokens (`docs/product.md` §12 Themes).
   *
   * The map is a replacement, not a merge: a token the request omits is cleared,
   * which is what "reset one token" means in the editor, and `{}` clears the
   * palette. Names and colours are validated here (`-32602`, naming the token);
   * a build without the config writer is `-32601`; a failed write is one
   * `-32000` `data: {kind: "config", message}` that leaves the previous tokens
   * in place. Nothing is retried.
   *
   * The core only stores and validates: it never decides what a colour means or
   * pairs colour with meaning. A theme token keeps its semantic role, and the
   * shell still pairs every colour with a label or a glyph.
   */
  const themeCustomSet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const validated = validateThemeTokens(params.tokens);
    if (!validated.ok) {
      const message = validated.error.message;
      return invalid(id, message);
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    if (!current.value.saveThemeTokens) {
      return failure(
        id,
        -32601,
        "Custom palette editing is not available in this build",
        undefined,
        false,
      );
    }

    const saved = await current.value.saveThemeTokens(validated.value);
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "config", message }, false);
    }
    // The config write is the truth: report the filtered stored map, not our
    // guess at what it merged.
    const tokens: ThemeTokens = {};
    for (const [token, value] of Object.entries(saved.value)) {
      if (typeof value === "string" && value.trim() !== "") tokens[token] = value;
    }
    setTheme(tokens);
    return success(id, { tokens });
  };

  /* ------------------------------------------------------------------------ */
  /* Keybinds — read and write the two stored binding tables                  */
  /* ------------------------------------------------------------------------ */

  /**
   * The stored keybind tables.
   *
   * `ui.keybinds` and `ui.fixed_keybinds` are the only source: the core never
   * invents a default, so a fresh workspace reads `{}` and the UI registry
   * supplies its own default table. An empty entry is a cleared override and is
   * filtered out.
   */
  const keybindMaps = (current: C): KeybindMaps =>
    storedKeybinds(current) ?? {
      keybinds: keybindTable(current.config?.ui.keybinds),
      fixedKeybinds: keybindTable(current.config?.ui.fixed_keybinds),
    };

  const keybindsGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { ...keybindMaps(current.value) });
  };

  /**
   * Set or clear one action's binding (`docs/product.md` §2.5).
   *
   * This is the storage half of the keymap registry, not the registry: the core
   * knows no action ids and no defaults. It validates the binding *form*,
   * refuses a duplicate across **both** tables, writes one config patch and
   * echoes the stored tables. `binding: null` (or an omitted `binding`) removes
   * the override, so the action falls back to the registry default.
   *
   * `fixed` selects the table — `false`/absent means `ui.keybinds` (leader and
   * direct chords), `true` means `ui.fixed_keybinds` (mode and navigation keys).
   * With no `fixed` flag, an action already overridden in `fixed_keybinds` keeps
   * its place rather than being silently moved by a rename.
   */
  const keybindsSet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawAction = params.action;
    if (typeof rawAction !== "string" || rawAction.trim() === "") {
      return invalid(id, "keybinds.set requires a non-empty action id");
    }
    const action = rawAction.trim();

    const rawFixed = params.fixed;
    if (rawFixed !== undefined && typeof rawFixed !== "boolean") {
      return invalid(id, "keybinds.set: fixed must be true or false");
    }

    // An omitted `binding` is the same request as `binding: null`: clear it.
    const rawBinding = params.binding;
    let binding: string | null = null;
    if (rawBinding !== null && rawBinding !== undefined) {
      if (typeof rawBinding !== "string") {
        return invalid(id, `keybinds.set: a binding is ${KEYBIND_FORMS}`);
      }
      const normalized = normalizeKeybind(rawBinding);
      if (normalized === null) {
        return invalid(
          id,
          `keybinds.set: ${JSON.stringify(rawBinding)} is not a binding; use ${KEYBIND_FORMS}`,
        );
      }
      binding = normalized;
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    if (!current.value.saveKeybinds) {
      return failure(
        id,
        -32601,
        "Keybinding editing is not available in this build",
        undefined,
        false,
      );
    }

    const stored = keybindMaps(current.value);
    const keybinds = { ...stored.keybinds };
    const fixedKeybinds = { ...stored.fixedKeybinds };
    const tables = { keybinds, fixedKeybinds };
    const cleared = { keybinds: [] as string[], fixedKeybinds: [] as string[] };

    if (binding === null) {
      // Clearing removes the override from both tables: an action can only live
      // in one, but a hand-edited config could once have carried it in both.
      for (const name of ["keybinds", "fixedKeybinds"] as const) {
        if (!(action in tables[name])) continue;
        delete tables[name][action];
        cleared[name].push(action);
      }
      // Nothing stored, nothing to write: the default already applies.
      if (cleared.keybinds.length === 0 && cleared.fixedKeybinds.length === 0) {
        return success(id, { keybinds, fixedKeybinds });
      }
    } else {
      const conflict = keybindConflict(action, binding, [keybinds, fixedKeybinds]);
      if (conflict !== null) {
        const message = `${displayBinding(binding)} is already bound to ${conflict}.`;
        return failure(
          id,
          BOOT_FAILED,
          message,
          { kind: "keybind", action, binding, conflict, message },
          false,
        );
      }
      const target =
        rawFixed === undefined
          ? action in fixedKeybinds
            ? "fixedKeybinds"
            : "keybinds"
          : rawFixed
            ? "fixedKeybinds"
            : "keybinds";
      // A move is a removal plus an insert; the other table must not keep a
      // stale override that would shadow the new one.
      for (const name of ["keybinds", "fixedKeybinds"] as const) {
        if (name === target || !(action in tables[name])) continue;
        delete tables[name][action];
        cleared[name].push(action);
      }
      tables[target][action] = binding;
    }

    const saved = await current.value.saveKeybinds({ keybinds, fixedKeybinds, cleared });
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "keybind", action, message }, false);
    }
    // The config write is the truth: report what it stored, not our guess.
    const written = {
      keybinds: keybindTable(saved.value.keybinds),
      fixedKeybinds: keybindTable(saved.value.fixedKeybinds),
    };
    setKeybinds(written);
    return success(id, { ...written });
  };

  /* ------------------------------------------------------------------------ */
  /* Optional decision layer — off by default, rules-only in this build        */
  /* ------------------------------------------------------------------------ */

  /**
   * The stored decision-layer values.
   *
   * `booted.config` is the boot snapshot, so the override wins after a write.
   * A build whose boot carries no config falls back to the documented defaults
   * (`docs/data-model.md` §2): disabled, no model.
   */
  const decisionSettings = (current: C): DecisionSettings =>
    storedDecision(current) ?? {
      enabled: current.config?.decision_layer?.enabled ?? false,
      model: current.config?.decision_layer?.model ?? "",
    };

  /**
   * The whole view: the stored values plus the two facts this build guarantees.
   *
   * `rulesOnly` and `localModel.supported` are literals, not read from config,
   * because no config value can make a local runtime exist.
   */
  const decisionView = (stored: DecisionSettings): DecisionView => ({
    enabled: stored.enabled,
    model: stored.model,
    rulesOnly: true,
    localModel: { supported: false, reason: DECISION_LOCAL_MODEL_REASON },
  });

  /**
   * Read the optional decision layer (`docs/product.md` §10.4).
   *
   * Off by default and rules-only in this build. The reply says both things in
   * its own shape, so the shell never has to infer that a model is missing.
   * This is a read: it writes nothing and boots no new state.
   */
  const decisionGet = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    return success(id, { ...decisionView(decisionSettings(current.value)) });
  };

  /**
   * Write the decision layer's two stored values.
   *
   * The rules are always on; `enabled` therefore records whether the optional
   * ranking layer may run, not whether rules apply. Since this build bundles no
   * local model runtime, **any request that would store a non-empty `model` is
   * refused** — including enabling while a hand-edited model is already present.
   * The alternative (storing the name and reporting `supported: false`) would
   * leave a config value that claims a capability the app does not have, so the
   * one rule is: `decision_layer.model` is only ever empty. Enabling with an
   * empty model is allowed and is exactly the rules-only mode.
   *
   * A malformed shape is `-32602` and never boots; a build without the config
   * writer is `-32601`; the refusal and a failed write are `-32000`, are
   * reported once, and write nothing.
   */
  const decisionSet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawEnabled = params.enabled;
    if (rawEnabled !== undefined && typeof rawEnabled !== "boolean") {
      return invalid(id, "decision.set: enabled must be true or false");
    }
    const rawModel = params.model;
    if (rawModel !== undefined && typeof rawModel !== "string") {
      return invalid(id, "decision.set: model must be a string");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const stored = decisionSettings(current.value);
    // Neither field asked for: no write, and the reply is the same view.
    if (rawEnabled === undefined && rawModel === undefined) {
      return success(id, { ...decisionView(stored) });
    }

    const next: DecisionSettings = {
      enabled: rawEnabled ?? stored.enabled,
      model: rawModel === undefined ? stored.model : rawModel.trim(),
    };

    // One rule, one message: a non-empty model is never stored in this build.
    if (next.model !== "") {
      return failure(
        id,
        BOOT_FAILED,
        DECISION_RULES_ONLY_REFUSAL,
        { kind: "decision", message: DECISION_RULES_ONLY_REFUSAL },
        false,
      );
    }

    if (!current.value.saveDecision) {
      return failure(
        id,
        -32601,
        "Decision-layer editing is not available in this build",
        undefined,
        false,
      );
    }

    const saved = await current.value.saveDecision(next);
    if (!saved.ok) {
      const message = oneLine(saved.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "config", message }, false);
    }
    // The config write is the truth: echo what it stored, not our request.
    setDecision(saved.value);
    return success(id, { ...decisionView(saved.value) });
  };

  /* ------------------------------------------------------------------------ */
  /* Global Work write/command opt-in — the outer approval gate               */
  /* ------------------------------------------------------------------------ */

  /**
   * The stored global opt-in, with the post-write override winning.
   *
   * Both flags default to false (`docs/data-model.md` §2 `[work]`), so a build
   * whose boot carries no config refuses every approval rather than granting one
   * by omission.
   */

  return {
    handlers: {
      settingsGet,
      providerList,
      providerLink,
      promptsList,
      promptsSet,
      updateInfo,
      updateCheck,
      themeCustomGet,
      themeCustomSet,
      keybindsGet,
      keybindsSet,
      decisionGet,
      decisionSet,
    },
  };
}

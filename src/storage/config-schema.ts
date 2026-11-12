/**
 * `config.toml` schema, defaults and validation (WP-102).
 *
 * Sources of truth:
 * - `docs/data-model.md` §2 for keys, defaults and ranges;
 * - `swarm/contracts.md` §4.5 for the binding string form.
 *
 * Validation never repairs. It returns the first problem with the key path, the
 * accepted values and one next step, so the loader can leave the file
 * untouched (`docs/data-model.md` §2: "Invalid values fail loading with a
 * specific message; the app does not silently reset the file").
 *
 * Unknown keys are NOT rejected: they are preserved by the loader, so this
 * module validates only the keys it knows.
 */

import { isAbsolute } from "node:path";
import type { Result } from "../domain/markdown";
import { err, ok } from "../domain/markdown";
/** Target schema version once migrations exist. No migration ships in v1 yet. */
export const CONFIG_VERSION = 1

export type NudgeIntensity = "gentle" | "balanced" | "intensive"
export type ArchiveBackend = "folder" | "github"
export type BudgetPeriod = "day" | "month"

export const NUDGE_INTENSITIES: readonly NudgeIntensity[] = ["gentle", "balanced", "intensive"]
export const ARCHIVE_BACKENDS: readonly ArchiveBackend[] = ["folder", "github"]
export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["day", "month"]
export const RESPONSE_STYLES = ["brief", "normal", "detailed"] as const
export const TUTOR_POLICIES = ["direct", "guided", "socratic"] as const

/**
 * Binding maps are `action id -> binding string` (`swarm/contracts.md` §4.5).
 *
 * Storage validates only that these are strings. Parsing, validating and
 * conflict-checking a binding is the keymap registry's job (`src/ui/keymap`),
 * which is the single source of truth for key literals — duplicating the format
 * here would create the second key table that `tests/unit/keymap.test.ts`
 * forbids.
 */
export type BindingMap = Record<string, string>

/* -------------------------------------------------------------------------- */
/* plugins (`docs/product.md` §11)                                             */
/* -------------------------------------------------------------------------- */

/** Only stdio MCP servers exist in v1; anything else is a typed issue. */
export type PluginTransport = "stdio"
export const PLUGIN_TRANSPORTS: readonly PluginTransport[] = ["stdio"]

export type PluginServerConfig = {
  transport: PluginTransport
  command: string
  args: string[]
  enabled: boolean
}

export type PluginPolicyCell = "on" | "explicit" | "off"
export const PLUGIN_POLICY_VALUES: readonly PluginPolicyCell[] = ["on", "explicit", "off"]

/** Commands that have a plugin policy row. */
export type PluginCommand = "chill" | "lockin" | "flashcards" | "study-guide" | "skill"
export const PLUGIN_COMMANDS: readonly PluginCommand[] = [
  "chill",
  "lockin",
  "flashcards",
  "study-guide",
  "skill",
]

/**
 * Commands that never call a plugin at all (`docs/product.md` §11), so `on` is
 * not a storable value for them — it is refused, never silently dropped.
 */
export const NEVER_PLUGIN_COMMANDS: readonly PluginCommand[] = ["flashcards", "study-guide"]

/** The documented default when a policy cell is absent. */
export const DEFAULT_PLUGIN_POLICY: Record<PluginCommand, PluginPolicyCell> = {
  chill: "on",
  lockin: "explicit",
  flashcards: "off",
  "study-guide": "off",
  skill: "on",
}

/** Server fields that would put a credential in config. */
const SECRET_SERVER_FIELDS = new Set(["token", "key", "secret", "api_key", "password", "passphrase"])

export type PluginPolicy = Record<string, Record<string, PluginPolicyCell>>
export type ThemeTokens = Record<string, string>

export type Config = {
  ui: {
    username: string
    username_color: string
    theme: string
    nudge_intensity: NudgeIntensity
    hide_hints: boolean
    mouse: boolean
    chill_history_limit: number
    excerpt_chars: number
    response_style: string
    tutor_policy: string
    custom_theme: ThemeTokens
    keybinds: BindingMap
    fixed_keybinds: BindingMap
    direct_keybinds: BindingMap
    /** Dev-only sandboxed effect plugins. */
    effects: {
      /** Folders that contain plugin directories (manifest + entry). */
      dirs: string[]
      /** Plugin ids that are discovered but not mounted. */
      disabled: string[]
    }
  }
  models: {
    chat: string
    generation: string
    base_url: string
    max_tool_calls: number
    max_tokens_per_request: number
  }
  usage: {
    budget: number
    period: BudgetPeriod
    warn_at: number
    pause_at_limit: boolean
  }
  storage: {
    max_items_per_side: number
    max_mb_per_side: number
  }
  archive: {
    backend: ArchiveBackend
    folder: string
    github: {
      repo: string
      branch: string
      consent: boolean
      /** Keychain pointer, not a secret (`docs/data-model.md` §2). */
      token_ref: string
    }
  }
  plugins: {
    enabled: boolean
    depth: string
    /** Keyed by server name; empty until one is configured. */
    servers: Record<string, PluginServerConfig>
    /** Keyed by command, then by server name. */
    policy: PluginPolicy
  }
  decision_layer: {
    enabled: boolean
    model: string
  }
}

/** Exactly `docs/data-model.md` §2. */
export const DEFAULT_CONFIG: Config = {
  ui: {
    username: "friend",
    username_color: "",
    theme: "lockedin",
    nudge_intensity: "balanced",
    hide_hints: false,
    mouse: false,
    chill_history_limit: 20,
    excerpt_chars: 400,
    response_style: "normal",
    tutor_policy: "direct",
    custom_theme: {},
    keybinds: {},
    fixed_keybinds: {},
    direct_keybinds: {},
    effects: {
      dirs: [],
      disabled: [],
    },
  },
  models: {
    chat: "",
    generation: "",
    base_url: "",
    max_tool_calls: 8,
    max_tokens_per_request: 16_000,
  },
  usage: {
    budget: 0,
    period: "day",
    warn_at: 0.8,
    pause_at_limit: false,
  },
  storage: {
    max_items_per_side: 25,
    max_mb_per_side: 500,
  },
  archive: {
    backend: "folder",
    folder: "",
    github: {
      repo: "",
      branch: "main",
      consent: false,
      token_ref: "lockedin/github-token",
    },
  },
  plugins: {
    enabled: false,
    depth: "standard",
    servers: {},
    policy: {},
  },
  decision_layer: {
    enabled: false,
    model: "",
  },
}

export type ConfigIssue = {
  /** Dotted path, e.g. `ui.nudge_intensity`. */
  key: string
  message: string
  next: string
}

export type TomlDocument = Record<string, unknown>

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** A fresh copy of the documented defaults (safe to hand to callers). */
export function defaultConfig(): Config {
  return clone(DEFAULT_CONFIG)
}

export function defaultDocument(): TomlDocument {
  return clone(DEFAULT_CONFIG) as unknown as TomlDocument
}

/* -------------------------------------------------------------------------- */
/* secrets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Names that would put a credential in `config.toml` (`AGENTS.md` §2.11).
 * `token_ref` is a keychain *pointer* and is deliberately not matched.
 */
const SECRET_NAME = /^(api[_-]?key|access[_-]?key|secret|token|password|passphrase|key)$|_(token|secret|password|api[_-]?key)$/

/** First offending dotted key path, or `null`. Walks tables, not arrays. */
export function findSecretKey(document: unknown, prefix = ""): string | null {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return null
  for (const [key, value] of Object.entries(document as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    const normalised = key.toLowerCase()
    if (SECRET_NAME.test(normalised) && normalised !== "token_ref") return path
    const nested = findSecretKey(value, path)
    if (nested) return nested
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

function issue(key: string, message: string, next: string): ConfigIssue {
  return { key, message, next }
}

function isTable(value: unknown): value is TomlDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(path: string, value: unknown): Result<string, ConfigIssue> {
  if (typeof value !== "string") {
    return err(issue(path, `${path} must be a string.`, `Set ${path} to a quoted string.`))
  }
  return ok(value)
}

function asBoolean(path: string, value: unknown): Result<boolean, ConfigIssue> {
  if (typeof value !== "boolean") {
    return err(issue(path, `${path} must be true or false.`, `Set ${path} to true or false.`))
  }
  return ok(value)
}

/** Folder list for effect plugins; `~` is expanded when the loader runs. */
function asPluginDirs(path: string, value: unknown): Result<string[], ConfigIssue> {
  const list = asStringArray(path, value)
  if (!list.ok) return list
  for (const entry of list.value) {
    if (entry.trim() === "" || entry.includes("\u0000")) {
      return err(issue(path, `${path} contains an empty folder.`, `Remove the empty entry from ${path}.`))
    }
    if (!isAbsolute(entry) && !entry.startsWith("~")) {
      return err(issue(path, `${path} must contain absolute paths.`, `Write the folder as /home/you/effects or ~/effects.`))
    }
  }
  return list
}

function asPluginIds(path: string, value: unknown): Result<string[], ConfigIssue> {
  const list = asStringArray(path, value)
  if (!list.ok) return list
  for (const entry of list.value) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry)) {
      return err(issue(path, `${path} contains an invalid plugin id: ${entry}.`, `Use the id from the plugin manifest.`))
    }
  }
  return list
}

function asNumber(
  path: string,
  value: unknown,
  min: number,
  max: number,
  { integer = false }: { integer?: boolean } = {},
): Result<number, ConfigIssue> {
  const range = max === Number.POSITIVE_INFINITY ? `at least ${min}` : `between ${min} and ${max}`
  if (typeof value !== "number" || Number.isNaN(value)) {
    return err(issue(path, `${path} must be a number${max === Number.POSITIVE_INFINITY ? "" : ` ${range}`}.`, `Set ${path} to a number ${range}.`))
  }
  if (integer && !Number.isInteger(value)) {
    return err(issue(path, `${path} must be a whole number.`, `Set ${path} to a whole number ${range}.`))
  }
  if (value < min || value > max) {
    return err(
      issue(
        path,
        `${path} must be between ${min} and ${max} (got ${value}).`,
        `Set ${path} to a value ${range}.`,
      ),
    )
  }
  return ok(value)
}

/** An http(s) URL, or the empty string (the field is optional). */
function asUrlOrEmpty(path: string, value: unknown): Result<string, ConfigIssue> {
  if (typeof value !== "string") return asString(path, value)
  const text = value.trim()
  if (text === "") return ok(value)
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return err(issue(path, `${path} must be an http or https URL.`, `Set ${path} to an http(s) endpoint, or leave it empty.`))
    }
    return ok(value)
  } catch {
    return err(issue(path, `${path} is not a URL.`, `Set ${path} to an http(s) endpoint, or leave it empty.`))
  }
}

/** An absolute path, or the empty string (the field is optional). */
function asAbsoluteOrEmpty(path: string, value: unknown): Result<string, ConfigIssue> {
  if (typeof value !== "string") return asString(path, value)
  if (value.trim() === "") return ok(value)
  if (!isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
    return err(issue(path, `${path} must be an absolute path.`, `Set ${path} to a full path, or leave it empty.`))
  }
  return ok(value)
}

/** `owner/name`, or the empty string (the field is optional). */
function asRepoOrEmpty(path: string, value: unknown): Result<string, ConfigIssue> {
  if (typeof value !== "string") return asString(path, value)
  const text = value.trim()
  if (text === "") return ok(value)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    return err(issue(path, `${path} must look like owner/name.`, `Set ${path} to the GitHub repository, or leave it empty.`))
  }
  return ok(value)
}

function asEnum<T extends string>(
  path: string,
  value: unknown,
  allowed: readonly T[],
): Result<T, ConfigIssue> {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return err(
      issue(
        path,
        `${path} must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)}).`,
        `Set ${path} to ${allowed.join(", ")}.`,
      ),
    )
  }
  return ok(value as T)
}

function asStringMap(path: string, value: unknown): Result<Record<string, string>, ConfigIssue> {
  if (!isTable(value)) {
    return err(issue(path, `${path} must be a table of strings.`, `Use [${path}] with key = "value" entries.`))
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return err(
        issue(
          `${path}.${key}`,
          `${path}.${key} must be a string.`,
          `Set ${path}.${key} to a quoted string.`,
        ),
      )
    }
  }
  return ok(value as Record<string, string>)
}

function asStringArray(path: string, value: unknown): Result<string[], ConfigIssue> {
  if (!Array.isArray(value)) {
    return err(issue(path, `${path} must be a list of strings.`, `Write ${path} as a list, for example args = ["-y", "server"].`))
  }
  for (const item of value) {
    if (typeof item !== "string") {
      return err(issue(path, `${path} must contain only strings.`, `Remove the non-string entry from ${path}.`))
    }
  }
  return ok(value as string[])
}

/** One `plugins.servers.<name>` row. Unknown fields are preserved. */
function validatePluginServer(name: string, value: unknown): Result<PluginServerConfig, ConfigIssue> {
  const path = `plugins.servers.${name}`
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return err(issue(path, `“${name}” is not a valid server name.`, "Use letters, digits, dot, dash or underscore."))
  }
  if (!isTable(value)) {
    return err(issue(path, `${path} must be a table.`, `Add a [plugins.servers.${name}] section.`))
  }
  for (const field of Object.keys(value)) {
    if (SECRET_SERVER_FIELDS.has(field.toLowerCase())) {
      return err(
        issue(
          `${path}.${field}`,
          `${path}.${field} is a credential and config.toml never stores secrets.`,
          "Remove it and link the value in Settings → Providers so it lives in the OS keychain.",
        ),
      )
    }
  }

  const transport = asEnum(`${path}.transport`, value.transport ?? "stdio", PLUGIN_TRANSPORTS)
  if (!transport.ok) return transport

  const command = asString(`${path}.command`, value.command)
  if (!command.ok) return command
  if (command.value.trim() === "") {
    return err(issue(`${path}.command`, `${path}.command must not be empty.`, "Set the command that starts the MCP server."))
  }

  const args = asStringArray(`${path}.args`, value.args ?? [])
  if (!args.ok) return args

  const enabled = asBoolean(`${path}.enabled`, value.enabled ?? true)
  if (!enabled.ok) return enabled

  return ok({ transport: transport.value, command: command.value, args: args.value, enabled: enabled.value })
}

function validatePluginServers(value: unknown): Result<Record<string, PluginServerConfig>, ConfigIssue> {
  const path = "plugins.servers"
  if (!isTable(value)) {
    return err(issue(path, `${path} must be a table of servers.`, "Add [plugins.servers.<name>] sections, or leave it out."))
  }
  const servers: Record<string, PluginServerConfig> = {}
  for (const [name, server] of Object.entries(value)) {
    const validated = validatePluginServer(name, server)
    if (!validated.ok) return validated
    servers[name] = validated.value
  }
  return ok(servers)
}

function validatePluginPolicy(value: unknown): Result<PluginPolicy, ConfigIssue> {
  const path = "plugins.policy"
  if (!isTable(value)) {
    return err(issue(path, `${path} must be a table keyed by command.`, "Add [plugins.policy.<command>] sections, or leave it out."))
  }

  const policy: PluginPolicy = {}
  for (const [command, cells] of Object.entries(value)) {
    const rowPath = `${path}.${command}`
    if (!(PLUGIN_COMMANDS as readonly string[]).includes(command)) {
      return err(
        issue(
          rowPath,
          `${rowPath} is not a command that has a plugin policy.`,
          `Use one of ${PLUGIN_COMMANDS.join(", ")}.`,
        ),
      )
    }
    if (!isTable(cells)) {
      return err(issue(rowPath, `${rowPath} must be a table of server policies.`, `Add [plugins.policy.${command}] with <server> = "on" | "explicit" | "off".`))
    }

    const row: Record<string, PluginPolicyCell> = {}
    for (const [server, cell] of Object.entries(cells)) {
      const cellPath = `${rowPath}.${server}`
      if (typeof cell !== "string" || !(PLUGIN_POLICY_VALUES as readonly string[]).includes(cell)) {
        return err(
          issue(
            cellPath,
            `${cellPath} must be one of ${PLUGIN_POLICY_VALUES.join(", ")} (got ${JSON.stringify(cell)}).`,
            `Set ${cellPath} to ${PLUGIN_POLICY_VALUES.join(", ")}.`,
          ),
        )
      }
      if (
        cell === "on" &&
        (NEVER_PLUGIN_COMMANDS as readonly string[]).includes(command)
      ) {
        return err(
          issue(
            cellPath,
            `${command} never calls plugins, so ${cellPath} cannot be "on".`,
            `Set ${cellPath} to "off"; this command never calls a plugin.`,
          ),
        )
      }
      row[server] = cell as PluginPolicyCell
    }
    policy[command] = row
  }
  return ok(policy)
}

function table(path: string, value: unknown): Result<TomlDocument, ConfigIssue> {
  if (!isTable(value)) {
    return err(issue(path, `${path} must be a table.`, `Add a [${path}] section to config.toml.`))
  }
  return ok(value)
}

/**
 * Validate the known keys of a merged document. Returns the first problem in a
 * stable order so the message is reproducible.
 */
export function validateDocument(document: TomlDocument): Result<Config, ConfigIssue> {
  const get = (path: string): unknown =>
    path.split(".").reduce<unknown>((node, key) => (isTable(node) ? node[key] : undefined), document)

  const steps: Array<() => Result<unknown, ConfigIssue>> = [
    () => asString("ui.username", get("ui.username")),
    () => asString("ui.username_color", get("ui.username_color")),
    () => asString("ui.theme", get("ui.theme")),
    () => asEnum("ui.nudge_intensity", get("ui.nudge_intensity"), NUDGE_INTENSITIES),
    () => asBoolean("ui.hide_hints", get("ui.hide_hints")),
    () => asBoolean("ui.mouse", get("ui.mouse")),
    () => asNumber("ui.chill_history_limit", get("ui.chill_history_limit"), 0, 10_000, { integer: true }),
    () => asNumber("ui.excerpt_chars", get("ui.excerpt_chars"), 1, 10_000, { integer: true }),
    () => asEnum("ui.response_style", get("ui.response_style"), RESPONSE_STYLES),
    () => asEnum("ui.tutor_policy", get("ui.tutor_policy"), TUTOR_POLICIES),
    () => asStringMap("ui.custom_theme", get("ui.custom_theme")),
    () => asStringMap("ui.keybinds", get("ui.keybinds")),
    () => asStringMap("ui.fixed_keybinds", get("ui.fixed_keybinds")),
    () => asStringMap("ui.direct_keybinds", get("ui.direct_keybinds")),
    () => asPluginDirs("ui.effects.dirs", get("ui.effects.dirs")),
    () => asPluginIds("ui.effects.disabled", get("ui.effects.disabled")),

    () => asString("models.chat", get("models.chat")),
    () => asString("models.generation", get("models.generation")),
    () => asUrlOrEmpty("models.base_url", get("models.base_url")),
    () => asNumber("models.max_tool_calls", get("models.max_tool_calls"), 1, 128, { integer: true }),
    () =>
      asNumber("models.max_tokens_per_request", get("models.max_tokens_per_request"), 1, 1_000_000, {
        integer: true,
      }),

    () => asNumber("usage.budget", get("usage.budget"), 0, Number.POSITIVE_INFINITY),
    () => asEnum("usage.period", get("usage.period"), BUDGET_PERIODS),
    () => asNumber("usage.warn_at", get("usage.warn_at"), 0, 1),
    () => asBoolean("usage.pause_at_limit", get("usage.pause_at_limit")),

    () => asNumber("storage.max_items_per_side", get("storage.max_items_per_side"), 1, 100_000, { integer: true }),
    () => asNumber("storage.max_mb_per_side", get("storage.max_mb_per_side"), 1, 1_000_000, { integer: true }),

    () => asEnum("archive.backend", get("archive.backend"), ARCHIVE_BACKENDS),
    () => asAbsoluteOrEmpty("archive.folder", get("archive.folder")),
    () => asRepoOrEmpty("archive.github.repo", get("archive.github.repo")),
    () => asString("archive.github.branch", get("archive.github.branch")),
    () => asBoolean("archive.github.consent", get("archive.github.consent")),
    () => asString("archive.github.token_ref", get("archive.github.token_ref")),

    () => asBoolean("plugins.enabled", get("plugins.enabled")),
    () => asString("plugins.depth", get("plugins.depth")),
    () => validatePluginServers(get("plugins.servers") ?? {}),
    () => validatePluginPolicy(get("plugins.policy") ?? {}),

    () => asBoolean("decision_layer.enabled", get("decision_layer.enabled")),
    () => asString("decision_layer.model", get("decision_layer.model")),
  ]

  for (const step of steps) {
    const result = step()
    if (!result.ok) return err(result.error)
  }

  // Tables that must exist as objects; checked after their scalar children so
  // a missing table reports the first key inside it.
  for (const path of ["ui", "models", "usage", "storage", "archive", "plugins", "decision_layer"]) {
    const result = table(path, get(path))
    if (!result.ok) return err(result.error)
  }
  const github = table("archive.github", get("archive.github"))
  if (!github.ok) return err(github.error)

  return ok(document as unknown as Config)
}

/**
 * Effective policy for one command/server pair: an explicit cell wins, otherwise
 * the documented default. A command that never calls plugins is always `off`.
 */
export function pluginPolicyFor(
  plugins: Config["plugins"],
  command: PluginCommand,
  server: string,
): PluginPolicyCell {
  if ((NEVER_PLUGIN_COMMANDS as readonly string[]).includes(command)) return "off"
  return plugins.policy[command]?.[server] ?? DEFAULT_PLUGIN_POLICY[command]
}

/** Merge a patch into a document, table-by-table; scalars replace. */
export function mergeDocuments(base: TomlDocument, patch: TomlDocument): TomlDocument {
  const out: TomlDocument = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    out[key] =
      isTable(value) && isTable(existing)
        ? mergeDocuments(existing, value)
        : isTable(value)
          ? mergeDocuments({}, value)
          : value
  }
  return out
}

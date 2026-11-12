/**
 * `config.toml` load / patch / migrate (WP-102).
 *
 * Contract:
 *
 * - Missing file → documented defaults, written atomically.
 * - Malformed TOML → typed `parse` error. It is never repaired.
 * - Invalid value → typed `invalid` error naming the key; **the file is not
 *   touched** (hash unchanged).
 * - Secret-bearing key → typed `secret` error; keys belong in the keychain.
 * - `patch()` merges tables, preserves unknown keys, and edits only the lines
 *   it changes (comment- and formatting-preserving); if the surgical edit
 *   cannot round-trip, it serializes the whole document instead and the result
 *   is re-parsed and compared before writing.
 * - Every write is temp file → fsync → rename in the same directory.
 * - Concurrent patches to one file are serialized in-process; the last write
 *   wins and the file is never a mix of two patches.
 * - `schema_version` appears only once a migration exists, and is written once.
 */

import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { err, ok, type Result } from "../domain/markdown";
import { CONFIG_VERSION, defaultDocument, findSecretKey, mergeDocuments, validateDocument, type Config, type TomlDocument } from "./config-schema";
import { CONFIG_FILE, type WorkspacePaths } from "./paths";
export type ConfigError =
  | {
      kind: "config"
      code: "parse" | "invalid" | "secret"
      path: string
      key?: string
      message: string
      next: string
    }
  | { kind: "storage"; path: string; message: string; next: string }

export type ConfigMigration = {
  /** Version this migration produces. */
  to: number
  apply(document: TomlDocument): TomlDocument
}

/**
 * v2 moves the UI plugin list from `[ui.effects]` to `[ui.plugins]`.
 *
 * `ui.effects` was the development name; the loader, SDK and docs now say
 * plugin. Existing values are copied once and the old table is removed.
 */
const migrateUiPlugins: ConfigMigration = {
  to: 2,
  apply(document) {
    const ui = document.ui
    if (!ui || typeof ui !== "object" || Array.isArray(ui)) return document
    const table = ui as Record<string, unknown>
    const legacy = table.effects
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return document
    const old = legacy as Record<string, unknown>
    const current =
      table.plugins && typeof table.plugins === "object" && !Array.isArray(table.plugins)
        ? (table.plugins as Record<string, unknown>)
        : {}
    table.plugins = {
      ...current,
      ...(current.dirs === undefined && old.dirs !== undefined ? { dirs: old.dirs } : {}),
      ...(current.disabled === undefined && old.disabled !== undefined
        ? { disabled: old.disabled }
        : {}),
    }
    delete table.effects
    return document
  },
}

/** Forward-only, versioned. */
export const CONFIG_MIGRATIONS: readonly ConfigMigration[] = [migrateUiPlugins]

export type LoadOptions = {
  /** Override for tests and for the first real migration. */
  migrations?: readonly ConfigMigration[]
}

export type LoadedConfig = {
  config: Config
  /** The full document, including keys this build does not know. */
  document: TomlDocument
  path: string
  /** True when the file did not exist and the defaults were written. */
  created: boolean
  /** True when a migration rewrote the file. */
  migrated: boolean
}

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  )
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function storageError(path: string, error: unknown, message: string, next: string): ConfigError {
  return { kind: "storage", path, message: `${message} (${describeError(error)})`, next }
}

/* -------------------------------------------------------------------------- */
/* serialization                                                               */
/* -------------------------------------------------------------------------- */

export function serializeDocument(document: TomlDocument): string {
  const text = stringify(document as never)
  return text.endsWith("\n") ? text : `${text}\n`
}

function isTable(value: unknown): value is TomlDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Structural equality: key order is irrelevant, values are not. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isTable(a) && isTable(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

type Leaf = { table: string[]; key: string; value: unknown }

function leavesOf(patch: TomlDocument, table: string[] = []): Leaf[] {
  const leaves: Leaf[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (isTable(value)) leaves.push(...leavesOf(value, [...table, key]))
    else leaves.push({ table, key, value })
  }
  return leaves
}

/** One TOML value, exactly as the parser would write it. */
function tomlValue(value: unknown): string {
  const text = stringify({ v: value as never })
  for (const line of text.split("\n")) {
    if (line.startsWith("v =") || line.startsWith("v=")) {
      return line.slice(line.indexOf("=") + 1).trim()
    }
  }
  return String(value)
}

/** Split `value  # comment` without touching `#` inside a string. */
function splitComment(valuePart: string): { value: string; comment: string } {
  let quote: string | null = null
  for (let i = 0; i < valuePart.length; i++) {
    const char = valuePart[i] as string
    if (quote) {
      if (char === "\\") {
        i += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "#") {
      return { value: valuePart.slice(0, i).trimEnd(), comment: valuePart.slice(i) }
    }
  }
  return { value: valuePart.trimEnd(), comment: "" }
}

type Range = { header: string | null; headerLine: number; start: number; end: number }

function sections(lines: string[]): Range[] {
  const ranges: Range[] = []
  let current: Range = { header: null, headerLine: -1, start: 0, end: lines.length }
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(lines[i] as string)
    if (!match) continue
    current.end = i
    ranges.push(current)
    current = { header: (match[1] as string).trim(), headerLine: i, start: i + 1, end: lines.length }
  }
  ranges.push(current)
  return ranges
}

const KEY_LINE = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/

/**
 * Edit only the lines the patch changes. Returns `null` when the structure
 * cannot be edited safely (the caller then serializes the whole document).
 */
function patchText(text: string, patch: TomlDocument): string | null {
  const leaves = leavesOf(patch)
  if (leaves.length === 0) return text

  const lines = text.split("\n")
  // Drop the trailing empty element produced by a final newline; it comes back
  // on join and keeps the file ending in exactly one newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  for (const leaf of leaves) {
    const tableName = leaf.table.join(".")
    const ranges = sections(lines)
    const range = ranges.find((candidate) => (candidate.header ?? "") === tableName)

    if (!range) {
      // New table: append a block at EOF.
      lines.push("", `[${tableName}]`, `${leaf.key} = ${tomlValue(leaf.value)}`)
      continue
    }

    let found = false
    for (let i = range.start; i < range.end; i++) {
      const match = KEY_LINE.exec(lines[i] as string)
      if (!match || match[2] !== leaf.key) continue
      const indent = match[1] as string
      const key = match[2] as string
      const equals = match[3] as string
      const rest = match[4] as string
      const { comment } = splitComment(rest)
      const value = tomlValue(leaf.value)
      lines[i] = `${indent}${key}${equals}${value}${comment ? ` ${comment}` : ""}`
      found = true
      break
    }
    if (found) continue

    // Key missing from an existing table: insert before the next header.
    let insertAt = range.end
    while (insertAt > range.start && (lines[insertAt - 1] as string).trim() === "") insertAt -= 1
    lines.splice(insertAt, 0, `${leaf.key} = ${tomlValue(leaf.value)}`)
  }

  return `${lines.join("\n")}\n`
}

/* -------------------------------------------------------------------------- */
/* atomic write                                                                */
/* -------------------------------------------------------------------------- */

async function writeAtomic(file: string, text: string): Promise<Result<void, ConfigError>> {
  const dir = dirname(file)
  const temp = join(dir, `.${basename(file)}.tmp-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temp, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, file)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // nothing else to do with a failing close
    }
    try {
      await rm(temp, { force: true })
    } catch {
      // a leftover temp file is harmless; it is never read back
    }
    return err(
      storageError(
        file,
        error,
        "The config could not be written.",
        "Check that the workspace is writable; the previous config was kept.",
      ),
    )
  }

  try {
    const dirHandle = await open(dir, "r")
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // Directory fsync is not supported on every platform; the rename landed.
  }

  return ok(undefined)
}

/* -------------------------------------------------------------------------- */
/* one writer per file                                                         */
/* -------------------------------------------------------------------------- */

const chains = new Map<string, Promise<void>>()

/** Serialize work on one path. A rejected task never blocks the next one. */
async function withFileLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  chains.set(key, chained)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (chains.get(key) === chained) chains.delete(key)
  }
}

/* -------------------------------------------------------------------------- */
/* parse + validate                                                            */
/* -------------------------------------------------------------------------- */

function parseConfig(text: string, path: string): Result<TomlDocument, ConfigError> {
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (error) {
    return err({
      kind: "config",
      code: "parse",
      path,
      message: `config.toml is not valid TOML: ${describeError(error)}`,
      next: "Fix the reported line and reload; nothing was changed on disk.",
    })
  }
  if (!isTable(parsed)) {
    return err({
      kind: "config",
      code: "parse",
      path,
      message: "config.toml must contain a table of sections.",
      next: "Fix the file so it starts with a [table] section; nothing was changed on disk.",
    })
  }
  return ok(parsed)
}

/**
 * Validate the *effective* document: the on-disk document with documented
 * defaults filling any absent key.
 *
 * A hand-written partial `config.toml` therefore works (a missing key takes its
 * documented default) while a key that is present with the wrong type or an
 * out-of-range value is still a specific error. The returned `document` stays
 * exactly what is on disk, so a patch never materialises keys the user did not
 * write.
 */
function checkDocument(document: TomlDocument, path: string): Result<Config, ConfigError> {
  const secret = findSecretKey(document)
  if (secret) {
    return err({
      kind: "config",
      code: "secret",
      path,
      key: secret,
      message: `${secret} looks like a credential, and secrets are never stored in config.toml.`,
      next: "Remove it from config.toml and link the key in Settings → Providers so it lives in the OS keychain.",
    })
  }

  const validated = validateDocument(mergeDocuments(defaultDocument(), document))
  if (!validated.ok) {
    return err({
      kind: "config",
      code: "invalid",
      path,
      key: validated.error.key,
      message: validated.error.message,
      next: validated.error.next,
    })
  }
  return ok(validated.value)
}

async function build(
  document: TomlDocument,
  path: string,
  created: boolean,
  migrated: boolean,
): Promise<Result<LoadedConfig, ConfigError>> {
  const checked = checkDocument(document, path)
  if (!checked.ok) return checked
  return ok({ config: checked.value, document, path, created, migrated })
}

/* -------------------------------------------------------------------------- */
/* load                                                                        */
/* -------------------------------------------------------------------------- */

export async function loadConfig(
  paths: WorkspacePaths,
  options: LoadOptions = {},
): Promise<Result<LoadedConfig, ConfigError>> {
  const file = paths.config
  return withFileLock(file, async () => {
    let text: string
    try {
      text = await readFile(file, "utf8")
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        return err(
          storageError(
            file,
            error,
            "config.toml could not be read.",
            "Check the file permissions and that the disk is readable.",
          ),
        )
      }
      // Missing file → documented defaults, written atomically with the
      // current schema version so a later load does not migrate it.
      const document = { ...defaultDocument(), schema_version: CONFIG_VERSION }
      const written = await writeAtomic(file, serializeDocument(document))
      if (!written.ok) return written
      return build(document, file, true, false)
    }

    const parsed = parseConfig(text, file)
    if (!parsed.ok) return parsed

    const migrations = options.migrations ?? CONFIG_MIGRATIONS
    if (migrations.length === 0) return build(parsed.value, file, false, false)

    const from = typeof parsed.value.schema_version === "number" ? parsed.value.schema_version : 0
    if (from >= CONFIG_VERSION) return build(parsed.value, file, false, false)

    let document = parsed.value
    for (const migration of [...migrations].sort((a, b) => a.to - b.to)) {
      if (migration.to <= from) continue
      document = migration.apply(document)
    }
    document.schema_version = CONFIG_VERSION

    const checked = checkDocument(document, file)
    if (!checked.ok) return checked

    const written = await writeAtomic(file, serializeDocument(document))
    if (!written.ok) return written
    return ok({
      config: checked.value,
      document,
      path: file,
      created: false,
      migrated: true,
    })
  })
}

/* -------------------------------------------------------------------------- */
/* patch                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Merge `patch` into the config and write it atomically.
 *
 * The file is only rewritten after the merged document validates; on any
 * failure the previous bytes stay on disk.
 */
export async function patchConfig(
  paths: WorkspacePaths,
  patch: TomlDocument,
  _options: LoadOptions = {},
): Promise<Result<LoadedConfig, ConfigError>> {
  const file = paths.config
  return withFileLock(file, async () => {
    let text: string | null = null
    try {
      text = await readFile(file, "utf8")
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        return err(
          storageError(
            file,
            error,
            "config.toml could not be read.",
            "Check the file permissions and that the disk is readable.",
          ),
        )
      }
    }

    let base: TomlDocument
    if (text === null) {
      base = defaultDocument()
    } else {
      const parsed = parseConfig(text, file)
      if (!parsed.ok) return parsed
      base = parsed.value
    }

    const merged = mergeDocuments(base, patch)
    const checked = checkDocument(merged, file)
    if (!checked.ok) return checked

    let serialized: string
    if (text === null) {
      serialized = serializeDocument(merged)
    } else {
      // Surgical edit keeps comments and untouched formatting; verify it by
      // re-parsing before trusting it.
      const edited = patchText(text, patch)
      const verify = edited === null ? null : parseConfig(edited, file)
      const identical = verify !== null && verify.ok && deepEqual(verify.value, merged)
      serialized = identical && edited !== null ? edited : serializeDocument(merged)
    }

    const written = await writeAtomic(file, serialized)
    if (!written.ok) return written

    return ok({
      config: checked.value,
      document: merged,
      path: file,
      created: text === null,
      migrated: false,
    })
  })
}

/** Current config without creating or writing anything. */
export async function readConfig(
  paths: WorkspacePaths,
): Promise<Result<LoadedConfig, ConfigError>> {
  try {
    const text = await readFile(paths.config, "utf8")
    const parsed = parseConfig(text, paths.config)
    if (!parsed.ok) return parsed
    return build(parsed.value, paths.config, false, false)
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return err({
        kind: "config",
        code: "parse",
        path: paths.config,
        message: "config.toml does not exist yet.",
        next: "Load the config once to create it with the documented defaults.",
      })
    }
    return err(
      storageError(
        paths.config,
        error,
        "config.toml could not be read.",
        "Check the file permissions and that the disk is readable.",
      ),
    )
  }
}

export { CONFIG_FILE }

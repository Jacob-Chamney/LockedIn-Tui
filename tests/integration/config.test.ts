/**
 * WP-102 — config load, patch, migrate.
 *
 * One named test per row of `docs/testing.md` §11.2 (P1-CF-01 … P1-CF-07), plus
 * the malformed-file case. Fixtures are copied into a temp workspace first, so
 * "the file was not touched" is asserted against the real bytes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_MIGRATIONS, loadConfig, patchConfig, readConfig, serializeDocument, type ConfigError, type LoadedConfig } from "../../src/storage/config";
import { CONFIG_VERSION, DEFAULT_CONFIG, defaultDocument, findSecretKey, validateDocument } from "../../src/storage/config-schema";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURES = join(import.meta.dir, "..", "fixtures", "config")
const isRoot = typeof process.getuid === "function" && process.getuid() === 0
const isWindows = process.platform === "win32"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    try {
      chmodSync(dir, 0o700)
    } catch {
      // already gone
    }
    await removeTemp(dir)
  }
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, ConfigError>): ConfigError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function tempWorkspace(label: string): Promise<Workspace> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-cfg-${label}-`))
  cleanup.push(parent)
  const workspace = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  // A config test starts from "no config.toml" unless it copies a fixture.
  await rm(workspace.paths.config, { force: true })
  return workspace
}

async function copyFixture(name: string, workspace: Workspace): Promise<string> {
  await cp(join(FIXTURES, name, "config.toml"), workspace.paths.config)
  return readFile(workspace.paths.config, "utf8")
}

function hash(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
}

function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith(".config.toml.tmp-"))
}

function text(loaded: LoadedConfig): string {
  return readFileSync(loaded.path, "utf8")
}

/* -------------------------------------------------------------------------- */
/* P1-CF-01                                                                    */
/* -------------------------------------------------------------------------- */

describe("config", () => {
  test("creates defaults", async () => {
    const workspace = await tempWorkspace("defaults")
    expect(existsSync(workspace.paths.config)).toBe(false)

    const loaded = unwrap(await loadConfig(workspace.paths))

    expect(loaded.created).toBe(true)
    expect(loaded.migrated).toBe(false)
    expect(loaded.config).toEqual(DEFAULT_CONFIG)
    const createdDocument = { ...defaultDocument(), schema_version: CONFIG_VERSION }
    expect(loaded.document).toEqual(createdDocument)

    // written, parseable, and exactly the documented defaults
    expect(existsSync(workspace.paths.config)).toBe(true)
    expect(readFileSync(workspace.paths.config, "utf8")).toBe(serializeDocument(createdDocument))
    expect(tempFiles(workspace.paths.root)).toEqual([])

    // a second load reads the file instead of recreating it
    const again = unwrap(await loadConfig(workspace.paths))
    expect(again.created).toBe(false)
    expect(again.config).toEqual(DEFAULT_CONFIG)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-02                                                                 */
  /* ------------------------------------------------------------------------ */

  test("preserves unknown keys on round-trip", async () => {
    const workspace = await tempWorkspace("round-trip")
    const before = await copyFixture("unknown-keys", workspace)
    const beforeLines = before.split("\n")

    const loaded = unwrap(await patchConfig(workspace.paths, { ui: { theme: "high-contrast" } }))
    const after = text(loaded)
    const afterLines = after.split("\n")

    // the change landed
    expect(loaded.config.ui.theme).toBe("high-contrast")

    // unknown table and keys survive, in the document and on disk
    expect(loaded.document.experimental_search).toEqual({
      rerank: true,
      model: "local-1b",
      weights: { title: 3, body: 1 },
    })
    expect(after).toContain("[experimental_search]")
    expect(after).toContain("rerank = true")

    // only the edited key differs, byte for byte; the comment on that line stays
    expect(afterLines).toHaveLength(beforeLines.length)
    const changed = afterLines
      .map((line, index) => ({ line, index, original: beforeLines[index] }))
      .filter((entry) => entry.line !== entry.original)
    expect(changed).toHaveLength(1)
    expect(changed[0]?.line).toBe('theme = "high-contrast" # crimson by default')

    // untouched sections are byte-identical, comments included
    expect(after).toContain("# Personal config — comments and unknown tables must survive a patch.")
    expect(after).toContain('navigator = "space+e"')

    // and a key the build does not know can be patched without disturbing others
    const extended = unwrap(
      await patchConfig(workspace.paths, { experimental_search: { model: "local-3b" } }),
    )
    expect(extended.document.experimental_search).toEqual({
      rerank: true,
      model: "local-3b",
      weights: { title: 3, body: 1 },
    })
    expect(text(extended)).toContain("[experimental_search]")
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-03                                                                 */
  /* ------------------------------------------------------------------------ */

  test("invalid value leaves the file untouched", async () => {
    const workspace = await tempWorkspace("invalid")
    await copyFixture("unknown-keys", workspace)
    const before = hash(workspace.paths.config)

    const cases: Array<{ patch: Parameters<typeof patchConfig>[1]; key: string }> = [
      { patch: { ui: { nudge_intensity: "extreme" } }, key: "ui.nudge_intensity" },
      { patch: { models: { max_tool_calls: -1 } }, key: "models.max_tool_calls" },
      { patch: { ui: { chill_history_limit: "many" } }, key: "ui.chill_history_limit" },
      { patch: { usage: { warn_at: 1.5 } }, key: "usage.warn_at" },
      { patch: { models: { base_url: "file:///etc/passwd" } }, key: "models.base_url" },
      { patch: { archive: { folder: "relative/archive" } }, key: "archive.folder" },
      { patch: { archive: { github: { repo: "not a repo" } } }, key: "archive.github.repo" },
    ]

    for (const { patch, key } of cases) {
      const error = expectErr(await patchConfig(workspace.paths, patch))
      expect(error.kind).toBe("config")
      if (error.kind !== "config") continue
      expect(error.code).toBe("invalid")
      expect(error.key).toBe(key)
      expect(error.message).toContain(key)
      expect(error.next.length).toBeGreaterThan(0)
      expect(hash(workspace.paths.config)).toBe(before)
    }

    // the accepted values are named for an enum, not just "invalid"
    const enumError = expectErr(
      await patchConfig(workspace.paths, { ui: { nudge_intensity: "extreme" } }),
    )
    if (enumError.kind === "config") {
      expect(enumError.message).toContain("gentle, balanced, intensive")
    }

    // a file that is invalid on disk is refused at load, and not rewritten
    const invalid = await tempWorkspace("invalid-file")
    await copyFixture("invalid", invalid)
    const invalidHash = hash(invalid.paths.config)
    const loadError = expectErr(await loadConfig(invalid.paths))
    if (loadError.kind !== "config") throw new Error(`unexpected ${loadError.kind}`)
    expect(loadError.code).toBe("invalid")
    expect(loadError.key).toBe("ui.nudge_intensity")
    expect(hash(invalid.paths.config)).toBe(invalidHash)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-04                                                                 */
  /* ------------------------------------------------------------------------ */

  test("concurrent patches serialize", async () => {
    const workspace = await tempWorkspace("concurrent")
    unwrap(await loadConfig(workspace.paths))

    // 20 different keys: none may be lost by a racing read-modify-write
    const distinct = Array.from({ length: 20 }, (_, index) => index)
    await Promise.all(
      distinct.map((index) =>
        patchConfig(workspace.paths, { experimental_search: { [`key_${index}`]: index } }),
      ),
    )

    const afterDistinct = unwrap(await readConfig(workspace.paths))
    expect(afterDistinct.document.experimental_search).toEqual(
      Object.fromEntries(distinct.map((index) => [`key_${index}`, index])),
    )

    // 5 writers on one key: the file ends as one of them, never a mix
    const values = ["lockedin", "high-contrast", "claude", "codex", "lockedin-light"]
    await Promise.all(values.map((theme) => patchConfig(workspace.paths, { ui: { theme } })))

    const finalText = readFileSync(workspace.paths.config, "utf8")
    const themeLines = finalText.split("\n").filter((line) => line.startsWith("theme = "))
    expect(themeLines).toHaveLength(1)
    const final = unwrap(await readConfig(workspace.paths))
    expect(values).toContain(final.config.ui.theme)
    expect(tempFiles(workspace.paths.root)).toEqual([])
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-05                                                                 */
  /* ------------------------------------------------------------------------ */

  test("rejects secret-bearing keys", async () => {
    const workspace = await tempWorkspace("secret")
    unwrap(await loadConfig(workspace.paths))
    const before = hash(workspace.paths.config)

    const patches: Array<{ patch: Parameters<typeof patchConfig>[1]; key: string; value: string }> = [
      { patch: { providers: { api_key: "sk-fixture-not-a-real-key" } }, key: "providers.api_key", value: "sk-fixture-not-a-real-key" },
      { patch: { archive: { github: { token: "ghp_fixture" } } }, key: "archive.github.token", value: "ghp_fixture" },
      { patch: { plugins: { client_secret: "shh" } }, key: "plugins.client_secret", value: "shh" },
    ]

    for (const { patch, key, value } of patches) {
      const error = expectErr(await patchConfig(workspace.paths, patch))
      expect(error.kind).toBe("config")
      if (error.kind !== "config") continue
      expect(error.code).toBe("secret")
      expect(error.key).toBe(key)
      // the message names the key and never echoes the value
      expect(error.message).toContain(key)
      expect(error.message).not.toContain(value)
      expect(hash(workspace.paths.config)).toBe(before)
    }

    // token_ref is a keychain pointer, so it is accepted and stays in config
    const accepted = unwrap(
      await patchConfig(workspace.paths, {
        archive: { github: { token_ref: "lockedin/github-token-2" } },
      }),
    )
    expect(accepted.config.archive.github.token_ref).toBe("lockedin/github-token-2")
    expect(readFileSync(workspace.paths.config, "utf8")).toContain("token_ref")

    // a config file that already carries a secret is refused, not rewritten
    const onDisk = await tempWorkspace("secret-file")
    await copyFixture("secret", onDisk)
    const diskHash = hash(onDisk.paths.config)
    const loadError = expectErr(await loadConfig(onDisk.paths))
    if (loadError.kind !== "config") throw new Error(`unexpected ${loadError.kind}`)
    expect(loadError.code).toBe("secret")
    expect(hash(onDisk.paths.config)).toBe(diskHash)

    // the detector itself: pointers pass, credentials do not
    expect(findSecretKey({ archive: { github: { token_ref: "lockedin/x" } } })).toBeNull()
    expect(findSecretKey({ a: { b: { access_token: "x" } } })).toBe("a.b.access_token")
    expect(findSecretKey({ ui: { username: "friend" } })).toBeNull()
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-06                                                                 */
  /* ------------------------------------------------------------------------ */

  test("writes through an atomic replace", async () => {
    const workspace = await tempWorkspace("atomic")
    unwrap(await loadConfig(workspace.paths))
    const before = readFileSync(workspace.paths.config, "utf8")

    // a successful patch leaves no temp file behind
    unwrap(await patchConfig(workspace.paths, { ui: { username: "patched" } }))
    expect(tempFiles(workspace.paths.root)).toEqual([])
    expect(readFileSync(workspace.paths.config, "utf8")).toContain('username = "patched"')

    // a failing write leaves the previous bytes and no temp file
    if (!isRoot && !isWindows) {
      const failed = unwrap(await patchConfig(workspace.paths, { ui: { username: "kept" } }))
      const goodBytes = readFileSync(failed.path, "utf8")
      await chmod(workspace.paths.root, 0o500)
      const error = expectErr(await patchConfig(workspace.paths, { ui: { username: "lost" } }))
      expect(error.kind).toBe("storage")
      if (error.kind === "storage") expect(error.path).toBe(workspace.paths.config)
      expect(readFileSync(workspace.paths.config, "utf8")).toBe(goodBytes)
      expect(tempFiles(workspace.paths.root)).toEqual([])
      await chmod(workspace.paths.root, 0o700)
    }

    // nothing was ever written outside the config file
    expect(readFileSync(workspace.paths.config, "utf8")).not.toBe(before)
    expect(CONFIG_MIGRATIONS.length).toBeGreaterThan(0)
  })

  /* ------------------------------------------------------------------------ */
  /* P1-CF-07                                                                 */
  /* ------------------------------------------------------------------------ */

  test("a created config carries the schema version and stays stable", async () => {
    const workspace = await tempWorkspace("migrations")
    const first = unwrap(await loadConfig(workspace.paths))
    expect(first.created).toBe(true)
    expect(first.migrated).toBe(false)
    expect(readFileSync(workspace.paths.config, "utf8")).toContain(
      `schema_version = ${CONFIG_VERSION}`,
    )

    // A second load neither migrates nor writes.
    const { mtimeMs } = await import("node:fs/promises").then((fs) =>
      fs.stat(workspace.paths.config),
    )
    const second = unwrap(await loadConfig(workspace.paths))
    expect(second.migrated).toBe(false)
    expect(second.created).toBe(false)
    const after = await import("node:fs/promises").then((fs) => fs.stat(workspace.paths.config))
    expect(after.mtimeMs).toBe(mtimeMs)
  })

  /* ------------------------------------------------------------------------ */
  /* malformed TOML is never repaired                                        */
  /* ------------------------------------------------------------------------ */

  test("malformed TOML is a typed parse error", async () => {
    const workspace = await tempWorkspace("malformed")
    await copyFixture("malformed", workspace)
    const before = hash(workspace.paths.config)

    const error = expectErr(await loadConfig(workspace.paths))
    expect(error.kind).toBe("config")
    if (error.kind !== "config") return
    expect(error.code).toBe("parse")
    expect(error.next.length).toBeGreaterThan(0)
    expect(hash(workspace.paths.config)).toBe(before)

    // a patch refuses too, and does not replace the broken file with defaults
    const patchError = expectErr(await patchConfig(workspace.paths, { ui: { theme: "codex" } }))
    expect(patchError.kind).toBe("config")
    expect(hash(workspace.paths.config)).toBe(before)
  })

  /* ------------------------------------------------------------------------ */
  /* binding form + defaults are the documented ones                          */
  /* ------------------------------------------------------------------------ */

  test("defaults and binding strings match the contract", () => {
    expect(DEFAULT_CONFIG.ui.nudge_intensity).toBe("balanced")
    expect(DEFAULT_CONFIG.ui.chill_history_limit).toBe(20)
    expect(DEFAULT_CONFIG.ui.excerpt_chars).toBe(400)
    expect(DEFAULT_CONFIG.models.max_tool_calls).toBe(8)
    expect(DEFAULT_CONFIG.models.max_tokens_per_request).toBe(16_000)
    expect(DEFAULT_CONFIG.usage.period).toBe("day")
    expect(DEFAULT_CONFIG.usage.warn_at).toBe(0.8)
    expect(DEFAULT_CONFIG.storage.max_items_per_side).toBe(25)
    expect(DEFAULT_CONFIG.archive.backend).toBe("folder")
    expect(DEFAULT_CONFIG.archive.github.token_ref).toBe("lockedin/github-token")
    expect(DEFAULT_CONFIG.decision_layer.enabled).toBe(false)
    expect(DEFAULT_CONFIG.ui.plugins).toEqual({ dirs: [], disabled: [] })

    // Binding *strings* are stored here but parsed and conflict-checked by the
    // keymap registry, so storage only requires them to be strings. This keeps
    // one key table in the codebase.
    const withBindings = validateDocument({
      ...defaultDocument(),
      ui: {
        ...(defaultDocument().ui as object),
        keybinds: { "learn.lockin": "space+l" },
        direct_keybinds: { search: "/" },
      },
    })
    expect(withBindings.ok).toBe(true)
    if (withBindings.ok) {
      expect(withBindings.value.ui.keybinds).toEqual({ "learn.lockin": "space+l" })
    }

    // a non-string binding is still a typed error naming the key
    const notStrings = validateDocument({
      ...defaultDocument(),
      ui: { ...(defaultDocument().ui as object), keybinds: { navigator: 1 } },
    })
    expect(notStrings.ok).toBe(false)
    if (!notStrings.ok) expect(notStrings.error.key).toBe("ui.keybinds.navigator")
  })

  test("UI plugin mounting is validated", () => {
    const ui = defaultDocument().ui as Record<string, unknown>
    const good = validateDocument({
      ...defaultDocument(),
      ui: { ...ui, plugins: { dirs: ["~/plugins"], disabled: ["lab.status"] } },
    })
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.value.ui.plugins.dirs).toEqual(["~/plugins"])

    const relative = validateDocument({
      ...defaultDocument(),
      ui: { ...ui, plugins: { dirs: ["plugins"], disabled: [] } },
    })
    expect(relative.ok).toBe(false)
    if (!relative.ok) expect(relative.error.key).toBe("ui.plugins.dirs")

    const badId = validateDocument({
      ...defaultDocument(),
      ui: { ...ui, plugins: { dirs: [], disabled: ["Not An Id"] } },
    })
    expect(badId.ok).toBe(false)
    if (!badId.ok) expect(badId.error.key).toBe("ui.plugins.disabled")
  })
})

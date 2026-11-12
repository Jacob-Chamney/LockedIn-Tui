/**
 * WP-135 — plugin server and policy config table.
 *
 * The packet's acceptance list, one test each. Config files are written into a
 * temp workspace so "the file did not change" is asserted against real bytes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, patchConfig, type ConfigError, type LoadedConfig } from "../../src/storage/config";
import { DEFAULT_CONFIG, DEFAULT_PLUGIN_POLICY, NEVER_PLUGIN_COMMANDS, PLUGIN_COMMANDS, PLUGIN_POLICY_VALUES, PLUGIN_TRANSPORTS, pluginPolicyFor } from "../../src/storage/config-schema";
import { createWorkspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURE = join(import.meta.dir, "..", "fixtures", "config-plugins", "pre-packet.toml")

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, ConfigError>): ConfigError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function workspace(label: string): Promise<{ root: string; config: string; dataDir: string }> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-plugins-${label}-`))
  cleanup.push(parent)
  const created = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  return { root: created.paths.root, config: created.paths.config, dataDir: parent }
}

async function withFixture(label: string): Promise<LoadedConfig> {
  const parent = await mkdtemp(join(TEMP_BASE, `lockedin-plugins-${label}-`))
  cleanup.push(parent)
  const created = unwrap(
    await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }),
  )
  await cp(FIXTURE, created.paths.config)
  return unwrap(await loadConfig(created.paths))
}

function configText(path: string): string {
  return readFileSync(path, "utf8")
}

describe("plugin config table", () => {
  test("defaults for an old config file are unchanged and still load", async () => {
    const loaded = await withFixture("old")
    expect(loaded.config.plugins.enabled).toBe(false)
    expect(loaded.config.plugins.depth).toBe("standard")
    // absent tables load as empty, not as a validation error
    expect(loaded.config.plugins.servers).toEqual({})
    expect(loaded.config.plugins.policy).toEqual({})
    expect(DEFAULT_CONFIG.plugins.servers).toEqual({})
    expect(DEFAULT_CONFIG.plugins.policy).toEqual({})
    // no other default moved
    expect(DEFAULT_CONFIG.plugins.enabled).toBe(false)
    expect(DEFAULT_CONFIG.plugins.depth).toBe("standard")

    // a real workspace with defaults round-trips too
    const fresh = await workspace("fresh")
    const defaults = unwrap(await loadConfig((await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)))
    expect(defaults.config.plugins.servers).toEqual({})
    expect(defaults.config.plugins.policy).toEqual({})
  })

  test("plugins.servers.notes.enabled round-trips and survives reload", async () => {
    const fresh = await workspace("servers")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)

    const patched = unwrap(
      await patchConfig(paths, {
        plugins: {
          servers: {
            notes: { transport: "stdio", command: "npx", args: ["-y", "@example/notes"], enabled: true },
          },
        },
      }),
    )
    expect(patched.config.plugins.servers.notes).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/notes"],
      enabled: true,
    })

    const reloaded = unwrap(await loadConfig(paths))
    expect(reloaded.config.plugins.servers.notes.enabled).toBe(true)
    expect(reloaded.config.plugins.servers.notes.command).toBe("npx")
    expect(configText(fresh.config)).toContain("[plugins.servers.notes]")
  })

  test("plugins.policy.lockin.notes = explicit round-trips", async () => {
    const fresh = await workspace("policy")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)

    unwrap(
      await patchConfig(paths, {
        plugins: {
          servers: { notes: { transport: "stdio", command: "npx", args: [], enabled: true } },
          policy: { lockin: { notes: "explicit" } },
        },
      }),
    )

    const reloaded = unwrap(await loadConfig(paths))
    expect(reloaded.config.plugins.policy.lockin).toEqual({ notes: "explicit" })
    // a configured cell wins; other commands keep their documented default
    expect(pluginPolicyFor(reloaded.config.plugins, "lockin", "notes")).toBe("explicit")
    expect(pluginPolicyFor(reloaded.config.plugins, "lockin", "other")).toBe(DEFAULT_PLUGIN_POLICY.lockin)
  })

  test("flashcards cannot store on, and the command is named", async () => {
    const fresh = await workspace("never")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)
    unwrap(await loadConfig(paths))
    const before = configText(fresh.config)

    const error = expectErr(
      await patchConfig(paths, { plugins: { policy: { flashcards: { notes: "on" } } } }),
    )
    expect(error.kind).toBe("config")
    if (error.kind !== "config") return
    expect(error.code).toBe("invalid")
    expect(error.key).toBe("plugins.policy.flashcards.notes")
    expect(error.message).toContain("flashcards")
    expect(error.next.length).toBeGreaterThan(0)
    expect(configText(fresh.config)).toBe(before)

    // study-guide is refused for the same reason
    const study = expectErr(
      await patchConfig(paths, { plugins: { policy: { "study-guide": { notes: "on" } } } }),
    )
    if (study.kind === "config") expect(study.key).toBe("plugins.policy.study-guide.notes")
    expect(NEVER_PLUGIN_COMMANDS).toContain("study-guide")

    // explicit/off are storable for the never commands
    const off = unwrap(await patchConfig(paths, { plugins: { policy: { flashcards: { notes: "off" } } } }))
    expect(pluginPolicyFor(off.config.plugins, "flashcards", "notes")).toBe("off")
  })

  test("an unknown command row is refused with a dotted path", async () => {
    const fresh = await workspace("unknown-command")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)
    unwrap(await loadConfig(paths))

    const error = expectErr(
      await patchConfig(paths, { plugins: { policy: { workout: { notes: "on" } } } }),
    )
    expect(error.kind).toBe("config")
    if (error.kind !== "config") return
    expect(error.key).toBe("plugins.policy.workout")
    expect(error.message).toContain("workout")
    expect(error.next).toContain("chill")
    expect(PLUGIN_COMMANDS.length).toBeGreaterThan(0)
  })

  test("a secret-shaped field under a server is refused, naming the keychain", async () => {
    const fresh = await workspace("secret")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)
    unwrap(await loadConfig(paths))
    const before = configText(fresh.config)

    for (const field of ["token", "key", "secret"]) {
      const error = expectErr(
        await patchConfig(paths, {
          plugins: { servers: { notes: { command: "npx", [field]: "ghp_not_a_real_token" } } },
        }),
      )
      expect(error.kind).toBe("config")
      if (error.kind !== "config") continue
      expect(error.code).toBe("secret")
      expect(error.key).toBe(`plugins.servers.notes.${field}`)
      expect(error.next.toLowerCase()).toContain("keychain")
      expect(JSON.stringify(error)).not.toContain("ghp_not_a_real_token")
    }
    expect(configText(fresh.config)).toBe(before)
  })

  test("a bad transport value is a typed issue, not a crash", async () => {
    const fresh = await workspace("transport")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)
    unwrap(await loadConfig(paths))

    const error = expectErr(
      await patchConfig(paths, {
        plugins: { servers: { notes: { transport: "sse", command: "npx" } } },
      }),
    )
    expect(error.kind).toBe("config")
    if (error.kind !== "config") return
    expect(error.code).toBe("invalid")
    expect(error.key).toBe("plugins.servers.notes.transport")
    expect(error.message).toContain("stdio")
    expect(PLUGIN_TRANSPORTS).toEqual(["stdio"])

    // and a non-string transport is reported, not thrown
    const wrongType = expectErr(
      await patchConfig(paths, { plugins: { servers: { notes: { transport: 7, command: "npx" } } } }),
    )
    if (wrongType.kind === "config") expect(wrongType.key).toBe("plugins.servers.notes.transport")
  })

  test("two consecutive writes produce identical bytes", async () => {
    const fresh = await workspace("stable")
    const paths = (await import("../../src/storage/paths")).workspacePaths(fresh.root, fresh.dataDir)
    unwrap(await loadConfig(paths))

    unwrap(
      await patchConfig(paths, {
        plugins: {
          servers: { notes: { transport: "stdio", command: "npx", args: ["-y", "notes"], enabled: true } },
          policy: { chill: { notes: "on" }, lockin: { notes: "explicit" } },
        },
      }),
    )
    const first = configText(fresh.config)

    unwrap(await patchConfig(paths, { plugins: { servers: { notes: { enabled: true } } } }))
    const second = configText(fresh.config)
    expect(second).toBe(first)

    // reloading and saving again is still byte-identical
    const reloaded = unwrap(await loadConfig(paths))
    unwrap(await patchConfig(paths, { plugins: reloaded.config.plugins }))
    expect(configText(fresh.config)).toBe(first)

    // only the toggled key appears once per table
    expect(second.match(/\[plugins\.servers\.notes\]/g)).toHaveLength(1)
    expect(PLUGIN_POLICY_VALUES).toEqual(["on", "explicit", "off"])
  })
})

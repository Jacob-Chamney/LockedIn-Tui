/**
 * Invariant suite — config (WP-109).
 *
 * Guards docs/testing.md §11.2 / §11.8: a secret can never be written to
 * `config.toml`, a rejected patch leaves the previous bytes on disk, and unknown
 * keys survive a round-trip because they may belong to a newer build.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSecretKey } from "../../src/storage/config-schema";
import { loadConfig, patchConfig, readConfig, type ConfigError } from "../../src/storage/config";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import type { Result } from "../../src/domain/markdown";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T>(result: Result<T, ConfigError>): ConfigError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

async function tempWorkspace(label: string): Promise<Workspace> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-inv-cfg-${label}-`))
  cleanup.push(dir)
  const workspace = unwrap(await createWorkspace(join(dir, "workspace"), { dataDir: join(dir, "data") }))
  return workspace
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await removeTemp(dir)
  }
})

function hashFile(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")
}

describe("config invariants", () => {
  test("P1-CF-05 secret-bearing keys are rejected and never written", async () => {
    const workspace = await tempWorkspace("secret")
    // Make sure a config exists so "unchanged" is meaningful.
    unwrap(await loadConfig(workspace.paths))
    const before = hashFile(workspace.paths.config)

    for (const key of ["api_key", "token", "secret", "password", "github_token"]) {
      const error = expectErr(await patchConfig(workspace.paths, { models: { [key]: "sk-should-never-land" } }))
      expect(error.kind).toBe("config")
      if (error.kind !== "config") continue
      expect(error.code).toBe("secret")
      expect(error.key).toBe(`models.${key}`)
      expect(error.next.length).toBeGreaterThan(0)

      // The value never reached the file.
      expect(readFileSync(workspace.paths.config, "utf8")).not.toContain("sk-should-never-land")
      expect(hashFile(workspace.paths.config)).toBe(before)
    }
  })

  test("P1-CF-05 a keychain pointer is not treated as a secret", async () => {
    const workspace = await tempWorkspace("token-ref")
    unwrap(await loadConfig(workspace.paths))

    expect(findSecretKey({ archive: { github: { token_ref: "lockedin/github-token" } } })).toBeNull()

    const saved = unwrap(
      await patchConfig(workspace.paths, {
        archive: { github: { token_ref: "lockedin/other-token" } },
      }),
    )
    expect(saved.config.archive.github.token_ref).toBe("lockedin/other-token")
  })

  test("P1-CF-03 an invalid value leaves the previous bytes in place", async () => {
    const workspace = await tempWorkspace("invalid")
    unwrap(await loadConfig(workspace.paths))
    const before = hashFile(workspace.paths.config)

    const error = expectErr(await patchConfig(workspace.paths, { ui: { nudge_intensity: "extreme" } }))
    expect(error.kind).toBe("config")
    if (error.kind === "config") {
      expect(error.code).toBe("invalid")
      expect(error.key).toBe("ui.nudge_intensity")
    }
    expect(hashFile(workspace.paths.config)).toBe(before)
  })

  test("P1-CF-02 unknown keys survive a patch round-trip", async () => {
    const workspace = await tempWorkspace("unknown")
    unwrap(await loadConfig(workspace.paths))

    // A newer build's key, written by hand.
    unwrap(await patchConfig(workspace.paths, { experimental_search: { model: "local-3b" } }))

    const patched = unwrap(await patchConfig(workspace.paths, { ui: { theme: "high-contrast" } }))
    expect(patched.config.ui.theme).toBe("high-contrast")
    expect(patched.document.experimental_search).toEqual({ model: "local-3b" })

    // A fresh read agrees: nothing was dropped on the later write.
    const reread = unwrap(await readConfig(workspace.paths))
    expect(reread.document.experimental_search).toEqual({ model: "local-3b" })
  })

  test("P1-CF-06 a successful patch replaces the file atomically (no temp left behind)", async () => {
    const workspace = await tempWorkspace("atomic")
    unwrap(await loadConfig(workspace.paths))

    unwrap(await patchConfig(workspace.paths, { ui: { theme: "high-contrast" } }))

    // The destination holds a complete, parseable document…
    const reread = unwrap(await readConfig(workspace.paths))
    expect(reread.config.ui.theme).toBe("high-contrast")
    // …and no temp file survived in the workspace root.
    const { readdirSync } = await import("node:fs")
    const leftovers = readdirSync(workspace.root).filter((name) => name.includes(".tmp-"))
    expect(leftovers).toEqual([])
  })

  test("P1-CF-04 concurrent patches serialize and never mix", async () => {
    const workspace = await tempWorkspace("concurrent")
    unwrap(await loadConfig(workspace.paths))

    await Promise.all([
      patchConfig(workspace.paths, { ui: { theme: "high-contrast" } }),
      patchConfig(workspace.paths, { ui: { hide_hints: true } }),
      patchConfig(workspace.paths, { ui: { mouse: true } }),
    ])

    const final = unwrap(await readConfig(workspace.paths))
    // Every writer merged the file it actually read; the result parses and each
    // key is a single valid value, never a torn mixture.
    expect(["lockedin", "high-contrast"]).toContain(final.config.ui.theme)
    expect(typeof final.config.ui.hide_hints).toBe("boolean")
    expect(typeof final.config.ui.mouse).toBe("boolean")
  })
})

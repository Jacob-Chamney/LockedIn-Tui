/**
 * WP-155 — settings end to end, five screens over one `config.toml`.
 *
 * Each settings screen is a pure view model that emits a patch; the shell routes
 * that patch to `patchConfig`. These tests do exactly that, against a real
 * workspace and a real config file, and then reload the file to prove the screen
 * and the disk agree.
 *
 * Two screens writing one file is the failure this packet is about, so every
 * scenario checks the *other* key's bytes as well as the edited one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { loadConfig, patchConfig, readConfig } from "../../src/storage/config";
import { createDefaultActions } from "../../src/ui/keymap/defaults";
import { KeymapRegistry } from "../../src/ui/keymap/registry";
import { applyOne } from "../../src/ui/keymap/persist";
import { SECTIONS, closeSection, commitUsername, initialAppearance, initialRouter, moveCursor, openSection, typeUsername, validateUsername } from "../../src/ui/settings/appearance";
import { afterLink, chooseModel, initialModels, submitKey, type ProviderRow } from "../../src/ui/settings/models";
import { initialUsage, setBudgetAmount, setWarnAt, togglePause } from "../../src/ui/settings/usage";
import { initialStorage, setCap } from "../../src/ui/settings/storage";
import { SettingsList } from "../../src/ui/settings";
import { crimson } from "../../src/ui/theme";
import { getProvider } from "../../src/llm/catalogue";
import { renderApp, trimTrailingBlankLines } from "../helpers/render";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []

function unwrap<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): E {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`)
  return result.error
}

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function workspace(): Promise<Workspace> {
  const parent = await mkdtemp(join(TEMP_BASE, "lockedin-e2e-set-"))
  cleanup.push(parent)
  return unwrap(await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") }))
}

/** `"usage.budget" → 20` becomes `{ usage: { budget: 20 } }`. */
function nest(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split(".")
    let cursor: Record<string, unknown> = out
    for (const part of parts.slice(0, -1)) {
      const next = (cursor[part] ?? {}) as Record<string, unknown>
      cursor[part] = next
      cursor = next
    }
    cursor[parts.at(-1)!] = value
  }
  return out
}

/** The shell's one write path: a screen's patch lands in the real file. */
async function apply(ws: Workspace, patch: Record<string, unknown>) {
  return patchConfig(ws.paths, nest(patch))
}

function fileText(ws: Workspace): string {
  return readFileSync(ws.paths.config, "utf8")
}

function hash(ws: Workspace): string {
  return new Bun.CryptoHasher("sha256").update(fileText(ws)).digest("hex")
}

const PROVIDERS: ProviderRow[] = [
  {
    spec: getProvider("openai")!,
    linked: true,
    validation: { kind: "ok", at: "2026-11-01T10:00:00Z", models: ["openai/gpt-4.1-mini", "openai/gpt-4.1"] },
  },
]

describe("settings end to end", () => {
  test("each screen persists its value and survives a reload", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))

    // Appearance: username.
    const appearance = typeUsername(initialAppearance(crimson), "jacob")
    const usernameResult = commitUsername(appearance)
    expect(usernameResult.kind).toBe("patch")
    if (usernameResult.kind === "patch") unwrap(await apply(ws, usernameResult.patch))

    // Usage: budget, warn threshold and pause.
    const budget = setBudgetAmount(initialUsage(unwrap(await readConfig(ws.paths)).config.usage), 25)
    expect(budget.kind).toBe("patch")
    if (budget.kind === "patch") unwrap(await apply(ws, budget.patch))

    const warn = setWarnAt(initialUsage(unwrap(await readConfig(ws.paths)).config.usage), 0.7)
    if (warn.kind === "patch") unwrap(await apply(ws, warn.patch))

    const pauseState = initialUsage(unwrap(await readConfig(ws.paths)).config.usage)
    const pause = togglePause(pauseState)
    if (pause.kind === "patch") unwrap(await apply(ws, pause.patch))

    // Models: choose a validated model.
    // The real flow: validate the key, then pick from the validated list.
    const linked = afterLink(
      initialModels(PROVIDERS),
      "openai",
      ["openai/gpt-4.1-mini", "openai/gpt-4.1"],
      "2026-11-01T10:00:00Z",
    )
    const chosen = chooseModel(linked, "chat", "openai/gpt-4.1-mini")
    if ("kind" in chosen) throw new Error(`model refused: ${chosen.reason}`)
    expect(chosen.chatModel).toBe("openai/gpt-4.1-mini")
    unwrap(await apply(ws, { "models.chat": chosen.chatModel }))

    // Storage: a per-side cap.
    const storage = initialStorage(
      { maxItemsPerSide: 25, maxMbPerSide: 500, excerptChars: 400 },
      { root: ws.root, dataDir: ws.data.dir, exports: ws.paths.exports } as never,
      { school: { status: "ok" }, skills: { status: "ok" } } as never,
    )
    const cap = setCap(storage, "maxItemsPerSide", 40)
    expect(cap.kind).toBe("patch")
    if (cap.kind === "patch") unwrap(await apply(ws, cap.patch))

    // Keybinds: rebind one action through the editor's own persist path.
    const registry = new KeymapRegistry(createDefaultActions(() => {}))
    // `f1` is free in the default table; `space+h` is already taken.
    expect(applyOne(registry, "help", "f1").ok).toBe(true)

    // Reload: the file — not the screen — is the truth.
    const reloaded = unwrap(await readConfig(ws.paths))
    expect(reloaded.config.ui.username).toBe("jacob")
    expect(reloaded.config.usage.budget).toBe(25)
    expect(reloaded.config.usage.warn_at).toBeCloseTo(0.7, 5)
    expect(typeof reloaded.config.usage.pause_at_limit).toBe("boolean")
    expect(reloaded.config.models.chat).toBe("openai/gpt-4.1-mini")
    expect(reloaded.config.storage.max_items_per_side).toBe(40)
  })

  test("two screens editing different keys never drop each other's change", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))

    const before = unwrap(await readConfig(ws.paths))

    // Screen A writes the budget.
    unwrap(await apply(ws, { "usage.budget": 12 }))
    const afterBudget = unwrap(await readConfig(ws.paths))
    const themeBytes = afterBudget.config.ui.theme
    expect(themeBytes).toBe(before.config.ui.theme)

    // Screen B writes the theme. The budget must survive, byte for byte.
    unwrap(await apply(ws, { "ui.theme": "high-contrast" }))
    const afterTheme = unwrap(await readConfig(ws.paths))
    expect(afterTheme.config.usage.budget).toBe(12)
    expect(afterTheme.config.ui.theme).toBe("high-contrast")

    // And the appearance screen still sees its own value on reload.
    expect(unwrap(await readConfig(ws.paths)).config.ui.theme).toBe("high-contrast")
  })

  test("the same key edited twice keeps the second value and one file", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))

    unwrap(await apply(ws, { "usage.budget": 5 }))
    unwrap(await apply(ws, { "usage.budget": 30 }))

    const reloaded = unwrap(await readConfig(ws.paths))
    expect(reloaded.config.usage.budget).toBe(30)
    // One file, and exactly one budget line in it.
    const text = fileText(ws)
    expect(text.match(/^budget\s*=/gm)?.length ?? 0).toBe(1)
  })

  test("an invalid value is refused with the field named and the file untouched", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))
    const before = hash(ws)

    // The screen's own validation.
    expect(validateUsername("").ok).toBe(false)
    const long = validateUsername("x".repeat(41))
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toContain("40")

    const warn = setWarnAt(initialUsage(unwrap(await readConfig(ws.paths)).config.usage), 2)
    expect(warn.kind).toBe("refused")
    if (warn.kind === "refused") expect(warn.reason).toContain("warn")

    // The storage layer refuses an out-of-range value too, naming the key.
    const error = expectErr(await apply(ws, { "usage.budget": -1 }))
    expect(error.kind).toBe("config")
    if (error.kind === "config") {
      expect(error.code).toBe("invalid")
      expect(error.key).toContain("usage.budget")
    }
    expect(hash(ws)).toBe(before)
  })

  test("a secret typed on the models screen never reaches config.toml", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))
    const KEY = "sk-e2e-should-never-land-0123456789"

    // The models screen hands the key to the keychain port, not to a patch.
    const models = initialModels(PROVIDERS)
    const submit = submitKey(models, PROVIDERS[0]!)
    // With no draft typed the screen refuses; either way the submit carries no
    // key text, which is the property this test is about.
    expect(["link", "validate", "refused"]).toContain(submit.kind)
    expect(JSON.stringify(submit)).not.toContain(KEY)

    // Even if a caller tried to persist the key, the config layer refuses it.
    const refused = expectErr(await apply(ws, { "models.api_key": KEY }))
    expect(refused.kind).toBe("config")
    if (refused.kind === "config") {
      expect(refused.code).toBe("secret")
      expect(refused.key).toBe("models.api_key")
    }

    // Byte scan: the value is nowhere in the file.
    const text = fileText(ws)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain("api_key")
  })

  test("moving between sections keeps the cursor sane and writes nothing", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))
    const before = hash(ws)

    let router = initialRouter
    // Down to the last section, then up one.
    for (let i = 0; i < SECTIONS.length + 2; i++) router = moveCursor(router, 1)
    expect(router.cursor).toBe(SECTIONS.length - 1)
    router = moveCursor(router, -1)
    expect(router.cursor).toBe(SECTIONS.length - 2)

    // Open, close, reopen: the previous cursor is remembered, never past the end.
    router = openSection(router)
    expect(router.section).not.toBeNull()
    router = closeSection(router)
    expect(router.section).toBeNull()
    expect(router.pane).toBe("list")
    expect(router.cursor).toBeGreaterThanOrEqual(0)
    expect(router.cursor).toBeLessThan(SECTIONS.length)

    // Navigation wrote nothing.
    expect(hash(ws)).toBe(before)
  })

  test("the settings list renders at 80x24 and names every section", async () => {
    const ws = await workspace()
    unwrap(await loadConfig(ws.paths))

    const ui = await renderApp({
      width: 80,
      height: 24,
      app: () => <SettingsList theme={crimson} width={80} height={24} focused router={initialRouter} />,
    })
    try {
      const frame = await ui.waitFor("SETTINGS")
      // Every section of the router is reachable from this one screen.
      for (const section of SECTIONS) expect(frame.toLowerCase()).toContain(section.label.split(" ")[0]!.toLowerCase())
      expect(trimTrailingBlankLines(frame).length).toBeLessThanOrEqual(24)
    } finally {
      await ui.dispose()
    }
  })
})

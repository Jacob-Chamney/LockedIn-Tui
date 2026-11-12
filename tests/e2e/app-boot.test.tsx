/**
 * WP-811 — cold start, end to end.
 *
 * Boots the real composition root (`src/app/boot.ts`) against a temp
 * `LOCKEDIN_WORKSPACE` and temp data dir, then mounts the real `App` with the
 * controller boot produced. Every pane is reached through the shell's own state,
 * `Esc` is driven as a key, and the disk is checked after each boot.
 *
 * `App` renders from `controller.state()` and its shell state at mount, so a pane
 * is asserted by mounting at that pane; the *transition* back to chat is asserted
 * on the live shell state after a real `Esc`, which is what the reducer does.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, type ShellApi } from "../../src/app/App";
import { boot, bootFailureLine } from "../../src/app/boot";
import { patchConfig, readConfig } from "../../src/storage/config";
import { MARKER_FILE, WORKSPACE_SCHEMA } from "../../src/storage/paths";
import type { PaneId } from "../../src/ui/shell/state";
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

async function tempRoot(label: string): Promise<string> {
  const dir = await mkdtemp(join(TEMP_BASE, `lockedin-e2e-boot-${label}-`))
  cleanup.push(dir)
  return dir
}

/** Boot the real thing against a temp workspace + data dir, no provider glue. */
async function bootIn(root: string) {
  return boot({
    workspaceRoot: join(root, "workspace"),
    dataDir: join(root, "data"),
    env: { HOME: root, XDG_DATA_HOME: join(root, "data") } as Record<string, string>,
    now: () => new Date("2026-11-01T10:00:00Z"),
  })
}

const PANES: PaneId[] = [
  "manager",
  "skills",
  "work",
  "sources",
  "reader",
  "stats",
  "archive",
  "settings",
  "plugins",
  "task-centre",
  "activity",
]

describe("cold start", () => {
  test("a fresh boot creates the workspace and the default config", async () => {
    const root = await tempRoot("fresh")
    const booted = unwrap(await bootIn(root))

    // The v1 marker and the documented layout exist on disk.
    const marker = join(booted.workspace.root, MARKER_FILE)
    expect(existsSync(marker)).toBe(true)
    expect(JSON.parse(readFileSync(marker, "utf8")).schema).toBe(WORKSPACE_SCHEMA)
    for (const dir of [booted.workspace.paths.schoolVault, booted.workspace.paths.goals]) {
      expect(existsSync(dir)).toBe(true)
    }

    // config.toml was written with defaults, and reading it back agrees.
    expect(existsSync(booted.workspace.paths.config)).toBe(true)
    const config = unwrap(await readConfig(booted.workspace.paths)).config
    expect(config.ui.username.length).toBeGreaterThan(0)
    expect(config.ui.chill_history_limit).toBe(20)
    expect(config.ui.nudge_intensity).toBe("balanced")
    expect(config.ui.mouse).toBe(false)
    expect(config.models.chat).toBe("")

    // App data lives outside the workspace.
    expect(booted.workspace.data.dir.startsWith(`${booted.workspace.root}/`)).toBe(false)
  })

  test("the first frame renders the workspace it just created, at 80x24", async () => {
    const root = await tempRoot("frame")
    const booted = unwrap(await bootIn(root))

    const ui = await renderApp({
      width: 80,
      height: 24,
      app: () => <App controller={booted.controller} chatScope={booted.scope} />,
    })
    try {
      const frame = await ui.waitFor("LOCKEDIN")
      expect(trimTrailingBlankLines(frame).length).toBeLessThanOrEqual(24)
      // Status bar: no model yet, and the usage line is honest about cost.
      expect(frame).toContain("0 tok")
      expect(frame.toLowerCase()).toContain("cost unknown")
    } finally {
      await ui.dispose()
    }
  })

  test("every registered pane mounts, and Esc returns to chat", async () => {
    const root = await tempRoot("panes")
    const booted = unwrap(await bootIn(root))

    for (const pane of PANES) {
      let api: ShellApi | undefined
      const ui = await renderApp({
        width: 80,
        height: 24,
        app: () => (
          <App
            controller={booted.controller}
            chatScope={booted.scope}
            initial={{ pane } as never}
            api={(next) => {
              api = next
            }}
          />
        ),
      })
      try {
        const frame = await ui.waitFor("LOCKEDIN")
        // The pane replaced the chat home. `work` is itself a chat surface, so it
        // legitimately renders the transcript.
        if (pane !== "work") {
          expect(frame.toLowerCase()).not.toContain("what do you want to learn")
        }
        expect(frame.length).toBeGreaterThan(0)
        expect(api?.state().pane).toBe(pane)

        // Esc is a real key, resolved through the registry. This used to be a
        // finding ("the pane stays mounted"): the cause was the test harness,
        // which sent a lone `\x1b` that the parser never delivered as a key, so
        // no test had ever reached this path. `tests/helpers/render.tsx` now uses
        // the kitty keyboard protocol and the key really arrives.
        await ui.press("escape")
        expect(api?.state().pane).toBe("chat")
      } finally {
        await ui.dispose()
      }
    }
  })

  test("a settings change survives quit and boot", async () => {
    const root = await tempRoot("persist")
    const first = unwrap(await bootIn(root))

    // The settings screen's own patch path, applied through the real writer.
    unwrap(await patchConfig(first.workspace.paths, { ui: { username: "cold-start" } }))
    expect(unwrap(await readConfig(first.workspace.paths)).config.ui.username).toBe("cold-start")

    // "Quit" is dropping the process state; boot again on the same directory.
    const second = unwrap(await bootIn(root))
    expect(second.config.ui.username).toBe("cold-start")
    // And the workspace was opened, not recreated: the marker is the same file.
    expect(JSON.parse(readFileSync(join(second.workspace.root, MARKER_FILE), "utf8")).schema).toBe(1)
  })

  test("no model: send is blocked, zero requests, cost unknown", async () => {
    const root = await tempRoot("nomodel")
    const booted = unwrap(await bootIn(root))
    expect(booted.config.models.chat).toBe("")
    expect(booted.controller.requests()).toEqual([])

    const outcome = await booted.controller.send("hello")
    expect(["no-model", "blocked"]).toContain(outcome.kind)
    expect(booted.controller.requests()).toEqual([])

    const state = booted.controller.state()
    expect(state.status).not.toBe("streaming")
    expect(state.messages.filter((message) => message.role === "assistant")).toEqual([])

    const ui = await renderApp({
      width: 80,
      height: 24,
      app: () => <App controller={booted.controller} chatScope={booted.scope} />,
    })
    try {
      const frame = await ui.waitFor("LOCKEDIN")
      expect(frame).toContain("0 tok")
      expect(frame.toLowerCase()).toContain("cost unknown")
    } finally {
      await ui.dispose()
    }
  })

  test("a corrupt config is one actionable line, not a stack trace", async () => {
    const root = await tempRoot("corrupt")
    const first = unwrap(await bootIn(root))
    await writeFile(first.workspace.paths.config, "this is = not [ valid toml\n[[[\n")

    const failure = expectErr(await bootIn(root))
    const line = bootFailureLine(failure)
    // A TOML parse error carries newlines; the boot line must still be one line.
    expect(line.split("\n").length).toBe(1)
    expect(line.toLowerCase()).toContain("config")
    expect(line.length).toBeGreaterThan(20)
    expect(line).not.toContain("at <anonymous>")
    expect(line).not.toContain("    at ")
    // The file was not rewritten or reset behind the user's back.
    expect(readFileSync(first.workspace.paths.config, "utf8")).toContain("not [ valid")
  })

  test("a legacy folder is refused with one actionable line and no writes", async () => {
    const root = await tempRoot("legacy")
    const legacy = join(root, "workspace")
    await mkdir(join(legacy, "school", "notes"), { recursive: true })
    await writeFile(join(legacy, "config.toml"), "[ui]\nusername = \"old\"\n")

    const before = readdirSync(legacy).sort()
    const failure = expectErr(await bootIn(root))
    const line = bootFailureLine(failure)
    expect(line.length).toBeGreaterThan(20)
    expect(line.toLowerCase()).toMatch(/version|workspace|folder/)
    expect(line).not.toContain("    at ")

    // Nothing was created inside the legacy folder and no marker appeared.
    expect(readdirSync(legacy).sort()).toEqual(before)
    expect(existsSync(join(legacy, MARKER_FILE))).toBe(false)
  })
})

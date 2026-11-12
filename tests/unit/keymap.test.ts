/**
 * WP-106 — the keymap test matrix from AGENTS.md §2.9 and docs/testing.md §2.9.
 *
 * No renderer, no network, no clock: the registry is pure domain code.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { createDefaultActions, commandNames } from "../../src/ui/keymap/defaults"
import { applyConfig, serialize } from "../../src/ui/keymap/persist"
import {
  bindingLabel,
  bindingToString,
  editorRows,
  generatedRows,
  helpRows,
  KeymapError,
  KeymapRegistry,
  overlayRows,
  parseBinding,
  validateActions,
  type Action,
  type Binding,
} from "../../src/ui/keymap/registry"
import {
  actionByCommand,
  bindingTakenBy,
  nextMode,
  resolveKey,
  resolveLeaderKey,
} from "../../src/ui/keymap/resolve"

const dispatch = () => {}
const fresh = () => new KeymapRegistry(createDefaultActions(dispatch))
const leader = (key: string): Binding => ({ kind: "leader", key })
const direct = (key: string): Binding => ({ kind: "direct", key })

function action(overrides: Partial<Action> & { id: string }): Action {
  return {
    label: overrides.id,
    group: "context",
    scope: "learn",
    defaultBinding: leader("q"),
    run: () => {},
    ...overrides,
  }
}

describe("add sources key", () => {
  test("a plain s opens sources from a learning scope", () => {
    const registry = fresh()
    const hit = resolveKey(
      { registry, mode: "normal", scope: "learn" },
      { name: "s" },
    )
    expect(hit.kind).toBe("action")
    if (hit.kind === "action") expect(hit.action.id).toBe("add-sources")
    expect(registry.bindingFor("add-sources")).toEqual(direct("s"))
  })

  test("s stays inert outside learning, and / is still search", () => {
    const registry = fresh()
    expect(resolveKey({ registry, mode: "normal", scope: "chill" }, { name: "s" }).kind).toBe("none")
    const search = resolveKey({ registry, mode: "normal", scope: "chill" }, { name: "/" })
    expect(search.kind).toBe("action")
    if (search.kind === "action") expect(search.action.id).toBe("search")
  })
})

describe("registry validation", () => {
  test("the shipped catalogue is valid", () => {
    expect(validateActions(createDefaultActions(dispatch))).toEqual([])
    expect(() => fresh()).not.toThrow()
  })

  test("duplicate binding in the same scope is a validation failure", () => {
    const issues = validateActions([
      action({ id: "one", defaultBinding: leader("q") }),
      action({ id: "two", defaultBinding: leader("q") }),
    ])
    expect(issues.map((i) => i.kind)).toContain("duplicate-binding")
    expect(() => new KeymapRegistry([
      action({ id: "one", defaultBinding: leader("q") }),
      action({ id: "two", defaultBinding: leader("q") }),
    ])).toThrow(KeymapError)
  })

  test("an action that loses its handler is a validation failure", () => {
    const broken = action({ id: "orphan" })
    delete (broken as { run?: unknown }).run
    const issues = validateActions([broken])
    expect(issues.map((i) => i.kind)).toContain("missing-handler")
    expect(() => new KeymapRegistry([broken])).toThrow(/has no handler/)
  })

  test("every shipped action has a handler", () => {
    for (const entry of fresh().actions()) {
      expect(typeof entry.run).toBe("function")
    }
  })

  test("a global binding conflicts with a scope binding; two scopes may share", () => {
    const clashes = validateActions([
      action({ id: "g", scope: "global", defaultBinding: leader("q") }),
      action({ id: "s", scope: "learn", defaultBinding: leader("q") }),
    ])
    expect(clashes.map((i) => i.kind)).toContain("duplicate-binding")

    const distinct = validateActions([
      action({ id: "l", scope: "learn", defaultBinding: leader("q") }),
      action({ id: "w", scope: "work", defaultBinding: leader("q") }),
    ])
    expect(distinct).toEqual([])
  })

  test("an action that is never enabled is unreachable", () => {
    const issues = validateActions([
      action({ id: "dead", enabled: () => false }),
    ])
    expect(issues.map((i) => i.kind)).toContain("unreachable")
  })
})

describe("rebinding", () => {
  test("rebinding removes the old key and installs the new one", () => {
    const registry = fresh()
    const before = registry.bindingFor("chat")!
    expect(bindingTakenBy(registry, "chill", before)?.id).toBe("chat")

    const result = registry.rebind("chat", leader("z"))
    expect(result.ok).toBe(true)
    expect(bindingTakenBy(registry, "chill", before)).toBeUndefined()
    expect(bindingTakenBy(registry, "chill", leader("z"))?.id).toBe("chat")
    expect(registry.bindingFor("chat")).toEqual(leader("z"))
    expect(registry.isOverridden("chat")).toBe(true)
  })

  test("a duplicate rebind is rejected, said out loud, and not applied", () => {
    const registry = fresh()
    const before = serialize(registry)
    const result = registry.rebind("work-swarms", leader("r")) // reader owns ␣ r (global)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a conflict")
    expect(result.conflict.reason).toBe("duplicate-binding")
    expect(result.conflict.message).toBe("␣ r is already Global reader.")
    expect(registry.bindingFor("work-swarms")).toEqual(leader("x"))
    expect(serialize(registry)).toEqual(before)
  })

  test("unknown action ids are refused, not silently created", () => {
    const registry = fresh()
    const result = registry.rebind("not-an-action", leader("q"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a conflict")
    expect(result.conflict.reason).toBe("unknown-action")
  })

  test("a leader binding with no key is refused", () => {
    const registry = fresh()
    const result = registry.rebind("chat", leader("space"))
    expect(result.ok).toBe(false)
  })

  test("reset one and reset all return to defaults", () => {
    const registry = fresh()
    registry.rebind("chat", leader("z"))
    registry.rebind("sessions", leader("8"))
    registry.reset("chat")
    expect(registry.bindingFor("chat")).toEqual(leader("c"))
    expect(registry.bindingFor("sessions")).toEqual(leader("8"))

    registry.reset()
    expect(registry.bindingFor("sessions")).toEqual(leader("h"))
    expect(registry.actions().some((a) => registry.isOverridden(a.id))).toBe(false)
  })

  test("rebinding never produces a duplicate binding anywhere in the registry", () => {
    const registry = fresh()
    registry.rebind("chat", leader("z"))
    registry.rebind("sessions", leader("c")) // free now that chat moved
    expect(registry.conflicts()).toEqual([])
    expect(registry.unreachable()).toEqual([])
  })
})

describe("resolution", () => {
  const ctx = (registry: KeymapRegistry, scope: "chill" | "learn" | "work" | "reader" | "deck" | "global", mode: "normal" | "insert") => ({
    registry,
    scope,
    mode,
  })

  test("fixed and direct keys are honoured through the same resolver", () => {
    const registry = fresh()
    const cases: Array<[string, string]> = [
      ["?", "help"],
      [":", "command"],
      ["/", "search"],
      ["j", "down"],
      ["k", "up"],
      ["i", "insert"],
      ["escape", "escape"],
    ]
    for (const [key, id] of cases) {
      const result = resolveKey(ctx(registry, "chill", "normal"), { name: key })
      expect(result.kind).toBe("action")
      if (result.kind !== "action") continue
      expect(result.action.id).toBe(id)
    }
    const quit = resolveKey(ctx(registry, "chill", "normal"), { name: "q", ctrl: true })
    expect(quit.kind).toBe("action")
    if (quit.kind === "action") expect(quit.action.id).toBe("quit")
  })

  test("the leader prefix opens the overlay instead of dispatching", () => {
    const registry = fresh()
    expect(resolveKey(ctx(registry, "chill", "normal"), { name: "space" }).kind).toBe("leader-pending")
    const result = resolveLeaderKey(ctx(registry, "chill", "normal"), { name: "c" })
    expect(result.kind).toBe("action")
    if (result.kind === "action") expect(result.action.id).toBe("chat")
  })

  test("Esc cancels the leader without dispatching", () => {
    const registry = fresh()
    expect(resolveLeaderKey(ctx(registry, "chill", "normal"), { name: "escape" }).kind).toBe("none")
  })

  test("a leader key from another scope does not fire", () => {
    const registry = fresh()
    // ␣ x is Work › swarms; it must not fire from Chill.
    expect(resolveLeaderKey(ctx(registry, "chill", "normal"), { name: "x" }).kind).toBe("none")
    expect(resolveLeaderKey(ctx(registry, "work", "normal"), { name: "x" }).kind).toBe("action")
  })

  test("insert mode only honours the text-entry exceptions", () => {
    const registry = fresh()
    expect(resolveKey(ctx(registry, "chill", "insert"), { name: "space" }).kind).toBe("none")
    expect(resolveKey(ctx(registry, "chill", "insert"), { name: "j" }).kind).toBe("none")
    const escape = resolveKey(ctx(registry, "chill", "insert"), { name: "escape" })
    expect(escape.kind).toBe("action")
    if (escape.kind === "action") expect(nextMode("insert", escape)).toBe("normal")
  })

  test("only explicit i / Enter enters insert", () => {
    const registry = fresh()
    const insert = resolveKey(ctx(registry, "chill", "normal"), { name: "i" })
    if (insert.kind !== "action") throw new Error("i must resolve")
    expect(nextMode("normal", insert)).toBe("insert")

    // Enter is the chat composer's business, not a registry action: no action
    // bound to `return` may switch to insert outside it.
    expect(resolveKey(ctx(registry, "chill", "normal"), { name: "return" }).kind).toBe("none")
  })

  test("leaving a panel always returns to NORMAL", () => {
    const registry = fresh()
    const exit = resolveKey(ctx(registry, "learn", "normal"), { name: "escape" })
    expect(exit.kind).toBe("action")
    expect(nextMode("insert", exit)).toBe("normal")

    for (const action of registry.actions()) {
      if (action.scope === "global" && action.id === "insert") continue
      if (action.modeAfter === undefined) continue
      expect(action.modeAfter).toBe("normal")
    }
  })

  test("commands route to actions, not to a second implementation", () => {
    const registry = fresh()
    for (const name of commandNames(registry.actions())) {
      expect(actionByCommand(registry, name)?.id).toBe(name)
      expect(actionByCommand(registry, `:${name}`)?.id).toBe(name)
    }
    expect(actionByCommand(registry, ":nope")).toBeUndefined()
  })
})

describe("generated surfaces", () => {
  test("help, overlay and editor show the same keys for every action", () => {
    const registry = fresh()
    registry.rebind("chat", leader("z"))

    const help = helpRows(registry, "learn")
    const overlay = overlayRows(registry, "learn", 2).flat()
    const editor = editorRows(registry)

    expect(help.length).toBe(overlay.length)
    for (const row of help) {
      const fromOverlay = overlay.find((r) => r.id === row.id)
      const fromEditor = editor.find((r) => r.id === row.id)
      expect(fromOverlay?.keys).toBe(row.keys)
      expect(fromEditor?.keys).toBe(row.keys)
      expect(row.keys).toBe(bindingLabel(registry.bindingFor(row.id)!))
    }
    expect(help.find((r) => r.id === "chat")?.keys).toBe("␣ z")
  })

  test("generated rows use the real override, not the default", () => {
    const registry = fresh()
    registry.rebind("settings", leader("9"))
    const row = generatedRows(registry, "chill").find((r) => r.id === "settings")
    expect(row?.keys).toBe("␣ 9")
    expect(row?.binding).toEqual(leader("9"))
  })

  test("the overlay groups the current context first", () => {
    const registry = fresh()
    const rows = overlayRows(registry, "work", 2).flat()
    const firstGlobal = rows.findIndex((r) => r.group === "global")
    const lastContext = rows.map((r) => r.group).lastIndexOf("context")
    expect(lastContext).toBeLessThan(firstGlobal === -1 ? rows.length : firstGlobal)
  })

  test("editor rows expose defaults so a reset is one key away", () => {
    const registry = fresh()
    registry.rebind("chat", leader("z"))
    const row = editorRows(registry).find((r) => r.id === "chat")!
    expect(row.keys).toBe("␣ z")
    expect(row.defaultKeys).toBe("␣ c")
    expect(row.overridden).toBe(true)
  })
})

describe("persistence", () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, "../fixtures/keymap/config.json"), "utf8"),
  )

  test("a stored config applies valid entries and refuses the rest", () => {
    const registry = fresh()
    const result = applyConfig(registry, fixture)

    expect(result.applied.sort()).toEqual(["chat", "help", "quit"])
    expect(result.rejected.map((r) => r.actionId).sort()).toEqual(["nope", "work-swarms"])
    expect(result.rejected.find((r) => r.actionId === "work-swarms")?.message).toBe(
      "␣ r is already Global reader.",
    )
    expect(result.rejected.find((r) => r.actionId === "nope")?.reason).toBe("unknown-action")

    expect(registry.bindingFor("chat")).toEqual(leader("z"))
    expect(registry.bindingFor("help")).toEqual(direct("f1"))
    expect(registry.bindingFor("work-swarms")).toEqual(leader("x"))
  })

  test("a refused entry is never written back", () => {
    const registry = fresh()
    applyConfig(registry, fixture)
    const written = serialize(registry)
    expect(written.ui?.keybinds?.["work-swarms"]).toBe("space+x")
    expect(written.ui?.keybinds?.nope).toBeUndefined()
    expect(written.ui?.keybinds?.chat).toBe("space+z")
    expect(written.ui?.fixed_keybinds?.help).toBe("f1")
  })

  test("serialize round-trips through a fresh registry", () => {
    const first = fresh()
    applyConfig(first, fixture)
    const stored = serialize(first)

    const second = fresh()
    const result = applyConfig(second, stored)
    expect(result.rejected).toEqual([])
    expect(serialize(second)).toEqual(stored)
  })

  test("binding strings parse both ways", () => {
    expect(bindingToString(leader("c"))).toBe("space+c")
    expect(bindingToString(direct("/"))).toBe("/")
    expect(parseBinding("space+C")).toEqual(leader("c"))
    expect(parseBinding("/")).toEqual(direct("/"))
    expect(parseBinding("esc")).toEqual(direct("escape"))
    expect("reason" in parseBinding("space+")).toBe(true)
    expect("reason" in parseBinding("")).toBe(true)
  })
})

// ---------------------------------------------------------------- drift guard

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

describe("one key table", () => {
  test("no screen keeps a second key list beside the registry", () => {
    const root = join(import.meta.dir, "../../src")
    const keymapDir = join(root, "ui/keymap")
    const offenders: string[] = []

    for (const file of sourceFiles(root)) {
      if (relative(keymapDir, file).startsWith("..") === false) continue // inside the registry
      const text = readFileSync(file, "utf8")
      const suspicious: string[] = []
      if (/kind:\s*["']leader["']/.test(text)) suspicious.push('kind: "leader"')
      if (/kind:\s*["']direct["']/.test(text)) suspicious.push('kind: "direct"')
      if (/space\+[a-z]/i.test(text)) suspicious.push("space+<key>")
      if (suspicious.length) offenders.push(`${relative(root, file)}: ${suspicious.join(", ")}`)
    }

    expect(offenders).toEqual([])
  })
})

describe("plugin keybind persistence", () => {
  test("a saved plugin binding applies after the plugin registers", () => {
    const registry = fresh()
    const config = { ui: { fixed_keybinds: { "status-toggle": "ctrl+t" } } }
    // Before the plugin loads the action does not exist, so the entry is rejected.
    expect(applyConfig(registry, config).applied).toEqual([])
    const registered = registry.register({
      id: "status-toggle",
      label: "Toggle status card",
      group: "plugin",
      scope: "global",
      defaultBinding: leader("s"),
      run: () => {},
    })
    expect(registered.ok).toBe(true)
    // Applying the same config again now reaches the plugin action.
    expect(applyConfig(registry, config).applied).toContain("status-toggle")
    expect(registry.bindingFor("status-toggle")).toEqual(direct("ctrl+t"))
  })
})

describe("plugin window focus keys", () => {
  test("F6 and F7 are global actions in every scope", () => {
    const actions = createDefaultActions(dispatch)
    const next = actions.find((entry) => entry.id === "plugin-focus-next")
    const prev = actions.find((entry) => entry.id === "plugin-focus-prev")
    expect(next?.defaultBinding).toEqual(direct("f6"))
    expect(prev?.defaultBinding).toEqual(direct("f7"))
    expect(next?.scope).toBe("global")
    expect(prev?.scope).toBe("global")

    const registry = fresh()
    for (const scope of ["global", "chill", "learn", "work"] as const) {
      const forward = resolveKey({ registry, scope, mode: "normal" }, { name: "f6" })
      expect(forward.kind).toBe("action")
      if (forward.kind === "action") expect(forward.action.id).toBe("plugin-focus-next")
      const back = resolveKey({ registry, scope, mode: "normal" }, { name: "f7" })
      expect(back.kind).toBe("action")
      if (back.kind === "action") expect(back.action.id).toBe("plugin-focus-prev")
    }
  })
})

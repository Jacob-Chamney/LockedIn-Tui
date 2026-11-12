/**
 * Invariant suite — keymap registry (WP-109).
 *
 * Guards docs/testing.md §11.6 / §11.8 and AGENTS.md §2.4: one action, one
 * binding, one handler, reachable from NORMAL, and the help/overlay/editor
 * surfaces are generated from the same data. If a refactor reintroduces a second
 * key table, or ships an action with no handler, one of these fails.
 */

import { describe, expect, test } from "bun:test"

import { commandNames, createDefaultActions } from "../../src/ui/keymap/defaults"
import { applyOne, serialize } from "../../src/ui/keymap/persist"
import {
  KeymapRegistry,
  bindingLabel,
  bindingToString,
  editorRows,
  helpRows,
  overlayRows,
  parseBinding,
  validateActions,
  type Action,
  type Binding,
} from "../../src/ui/keymap/registry"
import {
  actionByCommand,
  modeAfterPanelExit,
  nextMode,
  resolveKey,
  resolveLeaderKey,
} from "../../src/ui/keymap/resolve"

const dispatch = () => {}
const fresh = () => new KeymapRegistry(createDefaultActions(dispatch))
const leader = (key: string): Binding => ({ kind: "leader", key })

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

describe("keymap invariants", () => {
  test("P1-KM-01 every action has exactly one binding in its scope", () => {
    const registry = fresh()
    expect(registry.conflicts()).toEqual([])

    // Every action, in every scope it applies to, resolves back to itself.
    for (const current of registry.actions()) {
      const binding = registry.bindingFor(current.id)
      expect(binding).toBeDefined()
      if (!binding) continue
      const found = registry.actionFor(binding, current.scope)
      expect(found?.id).toBe(current.id)
    }

    // A duplicate is a validation failure that names the clashing action.
    const issues = validateActions([
      action({ id: "one", defaultBinding: leader("q") }),
      action({ id: "two", defaultBinding: leader("q") }),
    ])
    expect(issues.length).toBeGreaterThan(0)
    const duplicate = issues.find((issue) => issue.actionId === "one" && issue.kind === "duplicate-binding")
    expect(duplicate).toBeDefined()
    expect(duplicate?.message).toContain("two")
    expect(() => new KeymapRegistry([action({ id: "one" }), action({ id: "one" })])).toThrow()
  })

  test("P1-KM-02 every action has a handler", () => {
    for (const current of fresh().actions()) {
      expect(typeof current.run).toBe("function")
    }

    // Removing the handler is a validation failure, not a silent dead key.
    const issues = validateActions([action({ id: "handlerless", run: undefined })])
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((issue) => issue.actionId === "handlerless")).toBe(true)
  })

  test("P1-KM-03 every action is reachable in NORMAL by walking the registry", () => {
    const registry = fresh()
    expect(registry.unreachable()).toEqual([])

    for (const current of registry.actions()) {
      const binding = registry.bindingFor(current.id)!
      const resolved =
        binding.kind === "leader"
          ? resolveLeaderKey({ registry, mode: "normal", scope: current.scope }, { name: binding.key })
          : resolveKey({ registry, mode: "normal", scope: current.scope }, { name: binding.key })
      expect(resolved.kind).toBe("action")
      if (resolved.kind === "action") expect(resolved.action.id).toBe(current.id)
    }
  })

  test("P1-KM-04 rebind moves the binding: old key stops working", () => {
    const registry = fresh()
    const target = registry.actions().find((current) => current.defaultBinding.kind === "leader")!
    const oldKey = registry.bindingFor(target.id) as { kind: "leader"; key: string }

    // Pick a leader key nobody uses in that scope.
    const taken = new Set(
      registry
        .actions()
        .map((current) => registry.bindingFor(current.id))
        .filter((binding): binding is { kind: "leader"; key: string } => binding?.kind === "leader")
        .map((binding) => binding.key),
    )
    const free = ["z", "y", "x", "w", "v", "u"].find((key) => !taken.has(key))
    expect(free).toBeDefined()
    if (!free) return

    const result = registry.rebind(target.id, leader(free))
    expect(result.ok).toBe(true)

    expect(registry.bindingFor(target.id)).toEqual(leader(free))
    const moved = resolveLeaderKey({ registry, mode: "normal", scope: target.scope }, { name: free })
    expect(moved.kind === "action" && moved.action.id).toBe(target.id)

    const stale = resolveLeaderKey(
      { registry, mode: "normal", scope: target.scope },
      { name: oldKey.key },
    )
    expect(stale.kind === "action" && stale.action.id === target.id).toBe(false)
  })

  test("P1-KM-05 a conflicting rebind is rejected, not persisted, previous still works", () => {
    const registry = fresh()
    // Two actions that both use the leader, in scopes that can clash.
    const leaderBound = registry
      .actions()
      .filter((current) => registry.bindingFor(current.id)?.kind === "leader")
    const first = leaderBound[0]
    const second = leaderBound.find(
      (current) => current.id !== first?.id && current.scope === first?.scope,
    )
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return

    const conflictKey = registry.bindingFor(second.id) as { kind: "leader"; key: string }
    expect(conflictKey.kind).toBe("leader")
    const before = registry.bindingFor(first.id)

    const result = registry.rebind(first.id, leader(conflictKey.key))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflict.reason).toBe("duplicate-binding")
      // Copy style from docs/design.md §7.2.
      expect(result.conflict.message).toMatch(/^␣ \S+ is already /)
      expect(result.conflict.existingId).toBe(second.id)
    }

    // Nothing moved: the previous binding still resolves to the first action.
    expect(registry.bindingFor(first.id)).toEqual(before)
    const still = registry.actionFor(before!, first.scope)
    expect(still?.id).toBe(first.id)

    // And nothing was persisted: the serialized config still holds the old
    // binding for the action that was refused, and the other action keeps the
    // key it already owned.
    const config = serialize(registry)
    const keybinds = config.ui?.keybinds ?? {}
    expect(keybinds[first.id]).toBe(bindingToString(before!))
    expect(keybinds[second.id]).toBe(bindingToString(conflictKey))
  })

  test("P1-KM-06 help, overlay and editor agree for every action", () => {
    const registry = fresh()
    const scopes = ["global", "chill", "learn", "work", "reader", "deck"] as const

    for (const scope of scopes) {
      const help = helpRows(registry, scope)
      const overlay = overlayRows(registry, scope).flat()
      const helpById = new Map(help.map((row) => [row.id, row.keys]))
      for (const row of overlay) {
        expect(helpById.get(row.id)).toBe(row.keys)
      }
    }

    // The editor lists every action once, with the binding in force.
    const editor = editorRows(registry)
    expect(editor.map((row) => row.id).sort()).toEqual(
      registry.actions().map((current) => current.id).sort(),
    )
    for (const row of editor) {
      const binding = registry.bindingFor(row.id)!
      expect(row.keys).toBe(bindingLabel(binding))
    }
  })

  test("P1-KM-07 fixed keys resolve through the same registry", () => {
    const registry = fresh()
    const context = { registry, mode: "normal" as const, scope: "chill" as const }

    // `Ctrl+Q` (quit) is a direct key with a modifier.
    const quit = resolveKey(context, { name: "q", ctrl: true })
    expect(quit.kind).toBe("action")

    // `i` enters insert through the registry, from the chat pane only.
    const insert = registry.actions().find((current) => current.id === "insert")
    expect(insert).toBeDefined()
    const insertBinding = registry.bindingFor("insert")!
    expect(insertBinding.kind).toBe("direct")
    const insertPress = resolveKey(context, { name: (insertBinding as { key: string }).key })
    expect(insertPress.kind === "action" && insertPress.action.id).toBe("insert")

    // `escape` is bound and lands in normal.
    const escape = registry.actions().find((current) => current.id === "escape")
    expect(escape).toBeDefined()
    const escapeBinding = registry.bindingFor("escape") as { key: string }
    const escapePress = resolveKey(context, { name: escapeBinding.key })
    expect(escapePress.kind === "action" && escapePress.action.id).toBe("escape")

    // Leader prefix opens the overlay instead of dispatching.
    expect(resolveKey(context, { name: "space" }).kind).toBe("leader-pending")
  })

  test("P1-KM-08 panel exits always land in NORMAL", () => {
    expect(modeAfterPanelExit()).toBe("normal")

    const registry = fresh()
    for (const current of registry.actions()) {
      const after = nextMode("insert", {
        kind: "action",
        action: current,
        modeAfter: current.modeAfter ?? "normal",
      })
      // No action may leave the user stuck in INSERT; only an explicit action
      // whose destination is INSERT can keep it.
      if (current.modeAfter !== "insert") expect(after).toBe(current.modeAfter ?? "normal")
    }

    // Escape from a panel returns to normal even when the mode was insert.
    const escapeAction = registry.actions().find((current) => current.id === "escape")!
    const result = nextMode("insert", { kind: "action", action: escapeAction, modeAfter: "normal" })
    expect(result).toBe("normal")
  })

  test("P1-KM-09 bindings persist in the documented string form and reload", () => {
    const registry = fresh()
    const config = serialize(registry)

    // Every persisted value parses back to the binding in force: leader actions
    // in `ui.keybinds`, direct/fixed ones in `ui.fixed_keybinds`.
    const leaderValues = config.ui?.keybinds ?? {}
    const directValues = config.ui?.fixed_keybinds ?? {}
    expect(Object.keys(leaderValues).length).toBeGreaterThan(0)
    expect(Object.keys(directValues).length).toBeGreaterThan(0)

    for (const [id, value] of Object.entries(leaderValues)) {
      const parsed = parseBinding(value)
      expect("kind" in parsed).toBe(true)
      if ("kind" in parsed) expect(parsed.kind).toBe("leader")
      expect(bindingToString(registry.bindingFor(id)!)).toBe(value)
    }
    for (const [id, value] of Object.entries(directValues)) {
      const parsed = parseBinding(value)
      expect("kind" in parsed).toBe(true)
      if ("kind" in parsed) expect(parsed.kind).toBe("direct")
      expect(registry.bindingFor(id)?.kind).toBe("direct")
    }

    // A rebind round-trips through the string form.
    const applied = applyOne(registry, "help", "space+h")
    if (applied.ok) {
      expect(serialize(registry).ui?.keybinds?.help).toBe("space+h")
      expect(registry.bindingFor("help")).toEqual(leader("h"))
    }
  })

  test("commands are aliases of registry actions, not a second key table", () => {
    const registry = fresh()
    const names = commandNames(registry.actions())

    for (const name of names) {
      expect(actionByCommand(registry, name)).toBeDefined()
    }

    // The command name maps onto the action, so no command exists without one.
    expect(names.length).toBeGreaterThan(0)
  })
})

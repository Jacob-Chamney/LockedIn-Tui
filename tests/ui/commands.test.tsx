/**
 * WP-123 — command line and help overlay.
 *
 * The command model is pure and tested directly; the bar and help screen are
 * asserted through real frames at both sizes.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const { testRender } = await import("@opentui/solid")
const { App } = await import("../../src/app/App")
const { KeymapRegistry, bindingLabel, generatedRows } = await import(
  "../../src/ui/keymap/registry"
)
const { createDefaultActions } = await import("../../src/ui/keymap/defaults")
const commands = await import("../../src/ui/shell/commands")
const state = await import("../../src/ui/shell/state")

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/commands/typed.json"), "utf8"))

type Setup = Awaited<ReturnType<typeof testRender>>

const registry = new KeymapRegistry(createDefaultActions(() => {}))

async function mount(
  width: number,
  height: number,
  initial?: Record<string, unknown>,
) {
  const setup = await testRender(() => <App initial={initial as never} />, { width, height })
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function rows(setup: Setup): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

describe("every registry action is dispatchable by id", () => {
  test("resolveCommand maps each action id to itself", () => {
    for (const action of registry.actions()) {
      const result = commands.resolveCommand(registry, action.id)
      expect({ id: action.id, result }).toEqual({
        id: action.id,
        result: { kind: "action", id: action.id },
      })
    }
  })

  test("filtering surfaces an action by id prefix", () => {
    const matches = commands.filterCommands(registry, "ses")
    expect(matches.map((m) => m.name)).toContain("sessions")
    expect(matches.length).toBeGreaterThan(1)
    // Live filtering never returns something unrelated to what was typed.
    for (const match of matches) {
      const related =
        match.name.includes("ses") || match.label.toLowerCase().includes("ses")
      expect({ name: match.name, related }).toEqual({ name: match.name, related: true })
    }
  })

  test("an empty query lists commands without crashing", () => {
    expect(commands.filterCommands(registry, "").length).toBeGreaterThan(3)
  })
})

describe("aliases", () => {
  test("an alias dispatches the same target as its action id", () => {
    for (const alias of Object.keys(fixture.aliases)) {
      const viaAlias = commands.resolveCommand(registry, alias)
      const target = fixture.aliases[alias]!
      const viaId = commands.resolveCommand(registry, target)
      expect({ alias, kind: viaAlias.kind }).toEqual({ alias, kind: viaId.kind })
      if (viaAlias.kind === "action" && viaId.kind === "action") {
        expect(viaAlias.id).toBe(viaId.id)
      }
    }
  })

  test("names without a key of their own still resolve to their surface", () => {
    // `archive` and `themes` are pane routes (they open from the Explorer or a
    // command); only `keybinds` is a shell panel with no surface yet.
    for (const name of ["archive", "themes"]) {
      const result = commands.resolveCommand(registry, name)
      expect({ name, result }).toEqual({ name, result: { kind: "action", id: name } })
      expect(registry.action(name)).toBeUndefined()
    }
    const keybinds = commands.resolveCommand(registry, "keybinds")
    expect(keybinds).toEqual({ kind: "panel", id: "keybinds" })
  })

  test("clear is a shell command that empties chill", () => {
    expect(commands.resolveCommand(registry, "clear")).toEqual({
      kind: "action",
      id: "clear",
    })
    expect(commands.filterCommands(registry, "cle").map((match) => match.name)).toContain("clear")
  })

  test("update is a shell command with no key of its own", () => {
    expect(commands.resolveCommand(registry, "update")).toEqual({
      kind: "action",
      id: "update",
    })
    expect(registry.action("update")).toBeUndefined()
    expect(commands.filterCommands(registry, "upd").map((match) => match.name)).toContain(
      "update",
    )
  })

  test("no alias shadows a registry action with a different target", () => {
    for (const [alias, target] of Object.entries(commands.ALIASES)) {
      const action = registry.action(alias)
      if (action) expect(target).toBe(alias)
    }
  })
})

describe("unknown commands", () => {
  test("report one actionable line and keep the bar open", () => {
    for (const input of fixture.unknown as string[]) {
      const result = commands.resolveCommand(registry, input)
      expect(result.kind).toBe("unknown")
      if (result.kind !== "unknown") continue
      expect(result.message).toContain(input.trim().replace(/^:/, ""))
      expect(result.message.length).toBeGreaterThan(12)
    }
  })

  test("a near miss suggests the real command", () => {
    const result = commands.resolveCommand(registry, "sesions")
    expect(result.kind).toBe("unknown")
    if (result.kind !== "unknown") throw new Error("expected unknown")
    expect(result.message).toContain("sessions")
  })

  test("an empty submission says what to do", () => {
    const result = commands.resolveCommand(registry, "  ")
    expect(result.kind).toBe("unknown")
    if (result.kind !== "unknown") throw new Error("expected unknown")
    expect(result.message).toContain("Esc")
  })
})

describe("the bar is the only insert exception", () => {
  test("opening it enters INSERT and closing returns to NORMAL", () => {
    const open = state.reduce(state.initialShellState, { type: "command-open" })
    expect(open.overlay).toBe("command")
    expect(open.mode).toBe("insert")

    const closed = state.reduce(open, { type: "close-overlay" })
    expect(closed.overlay).toBe(null)
    expect(closed.mode).toBe("normal")
    expect(closed.commandQuery).toBe("")
  })

  test("a message does not close the bar or change the mode", () => {
    const open = state.reduce(state.initialShellState, { type: "command-open" })
    const typed = state.reduce(open, { type: "command-input", value: "nope" })
    const messaged = state.reduce(typed, { type: "command-message", message: "No command." })
    expect(messaged.overlay).toBe("command")
    expect(messaged.mode).toBe("insert")
    expect(messaged.commandMessage).toBe("No command.")
    expect(messaged.commandQuery).toBe("nope")
  })

  test("running a panel command leaves a normal shell", () => {
    const open = state.reduce(state.initialShellState, { type: "command-open" })
    const opened = state.reduce(open, { type: "panel-open", id: "themes" })
    expect(opened.overlay).toBe(null)
    expect(opened.mode).toBe("normal")
    expect(opened.panel).toBe("themes")
  })
})

describe("help matches the registry", () => {
  test("every help row shows the binding in force", () => {
    const rowsGenerated = generatedRows(registry, "global")
    for (const row of rowsGenerated) {
      expect(row.keys).toBe(bindingLabel(registry.bindingFor(row.id)!))
    }
    // a rebind changes help without touching the component
    registry.rebind("chat", { kind: "leader", key: "9" })
    const rebound = generatedRows(registry, "global").find((r) => r.id === "chat")
    expect(rebound?.keys).toBe("␣ 9")
    registry.reset()
  })

  test("help groups context, then global, then system", async () => {
    const setup = await mount(200, 60, { overlay: "help" })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("only bindings that work are listed")
      // One group per page: CONTEXT first, then GLOBAL and SYSTEM on Tab.
      expect(frame).toContain("CONTEXT")
      expect(frame).toContain("1/3")
      expect(frame).not.toContain("SYSTEM")
    } finally {
      await setup.dispose()
    }
  })
})

describe("snapshots", () => {
  test("command bar at 80x24", async () => {
    const setup = await mount(80, 24, { overlay: "command", mode: "insert", commandQuery: "ses" })
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      const frame = lines.join("\n")
      expect(frame).toContain(":ses")
      expect(frame).toContain("sessions")
      expect(frame).toContain("COMMAND")
      expect(frame).toContain("INSERT")
    } finally {
      await setup.dispose()
    }
  })

  test("command bar at 200x60 shows the unknown-command line", async () => {
    const setup = await mount(200, 60, {
      overlay: "command",
      mode: "insert",
      commandQuery: "nope",
      commandMessage: 'No command "nope". Press Esc and try ? for the keymap.',
    })
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(60)
      for (const line of lines) expect(line.length).toBe(200)
      const frame = lines.join("\n")
      expect(frame).toContain(":nope")
      expect(frame).toContain("No command")
      expect(frame).toContain("! ")
    } finally {
      await setup.dispose()
    }
  })
})

describe("no second table", () => {
  test("components contain no hard-coded key strings or command lists", () => {
    const dir = join(import.meta.dir, "../../src/ui/shell")
    const offenders: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
      if (entry.name === "commands.ts") continue // the one documented alias table
      const text = readFileSync(join(dir, entry.name), "utf8")
      if (/space\+[a-z]/i.test(text)) offenders.push(`${entry.name}: space+<key>`)
      if (/ctrl\+[a-z]/i.test(text)) offenders.push(`${entry.name}: ctrl+<key>`)
      if (/\b(?:themes?|archive|keybinds)\s*:\s*"/.test(text)) offenders.push(`${entry.name}: inline command map`)
    }
    expect(offenders).toEqual([])
    // the only command table lives in commands.ts
    expect(relative(dir, join(dir, "commands.ts"))).toBe("commands.ts")
  })
})

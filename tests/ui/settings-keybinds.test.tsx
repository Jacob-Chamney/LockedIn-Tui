/** WP-705 — keybinds settings built on the one registry. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const kb = await import("../../src/ui/settings/keybinds")
const { KeymapRegistry, editorRows, bindingLabel, generatedRows } = await import(
  "../../src/ui/keymap/registry"
)
const { createDefaultActions } = await import("../../src/ui/keymap/defaults")
const { serialize } = await import("../../src/ui/keymap/persist")
const { crimson } = await import("../../src/ui/theme")

type State = import("../../src/ui/settings/keybinds").KeybindsState

const registry = () => new KeymapRegistry(createDefaultActions(() => {}))
const state = (overrides: Partial<State> = {}): State => ({ ...kb.initialKeybinds, ...overrides })

async function mount(width: number, height: number, rows: ReturnType<typeof editorRows>, value = state()) {
  const setup = await testRender(
    () => <kb.KeybindsPanel theme={crimson} width={width} height={height} focused rows={rows} state={value} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("list", () => {
  test("every registry action appears with its real binding", async () => {
    const reg = registry()
    const rows = editorRows(reg)
    expect(rows).toHaveLength(reg.actions().length)
    const setup = await mount(120, 40, rows)
    try {
      const frame = lines(setup).join("\n")
      for (const row of rows.slice(0, 5)) expect(frame).toContain(row.keys)
    } finally {
      await setup.dispose()
    }
  })

  test("an override shows its custom binding and is marked", () => {
    const reg = registry()
    reg.rebind("chat", { kind: "leader", key: "9" })
    const row = editorRows(reg).find((entry) => entry.id === "chat")!
    expect(row.keys).toBe("␣ 9")
    expect(row.overridden).toBe(true)
    expect(kb.rowLabel(row)).toContain("(custom)")
  })

  test("grouped by scope then group", () => {
    const grouped = kb.groupedRows(editorRows(registry()))
    expect(grouped[0]!.scope).toBe("global")
    expect(grouped.every((section) => section.rows.length > 0)).toBe(true)
  })
})

describe("search", () => {
  test("filters by label and by id, and says when nothing matches", async () => {
    const reg = registry()
    expect(kb.search(editorRows(reg), "sessions").some((row) => row.id === "sessions")).toBe(true)
    expect(kb.search(editorRows(reg), "skill sessions").some((row) => row.id === "goals")).toBe(true)

    const none = kb.search(editorRows(reg), "zzz")
    expect(none).toHaveLength(0)
    const setup = await mount(100, 24, none, state({ query: "zzz" }))
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("no action matches")
      expect(frame).toContain("/zzz")
    } finally {
      await setup.dispose()
    }
  })
})

describe("rebind", () => {
  test("captures a chord and shows it before committing", () => {
    const reg = registry()
    const row = editorRows(reg).find((entry) => entry.id === "chat")!
    const capturing = kb.beginCapture(state(), row)
    expect(capturing.capturing).toBe("chat")

    const captured = kb.capture(capturing, "space+9")
    if ("kind" in captured) throw new Error("expected a state")
    expect(captured.captured).toEqual({ kind: "leader", key: "9" })

    // nothing has changed in the registry yet
    expect(bindingLabel(reg.bindingFor("chat")!)).toBe("␣ c")

    const result = kb.commit(reg, captured)
    expect(result.kind).toBe("applied")
    expect(bindingLabel(reg.bindingFor("chat")!)).toBe("␣ 9")
  })

  test("the old chord stops working and the new one resolves", () => {
    const reg = registry()
    const capturing = kb.beginCapture(state(), editorRows(reg).find((row) => row.id === "chat")!)
    const captured = kb.capture(capturing, "space+9")
    if ("kind" in captured) throw new Error("expected a state")
    kb.commit(reg, captured)
    expect(reg.actionFor({ kind: "leader", key: "c" }, "chill")).toBeUndefined()
    expect(reg.actionFor({ kind: "leader", key: "9" }, "chill")?.id).toBe("chat")
  })

  test("a duplicate chord is refused with the exact sentence and nothing persists", () => {
    const reg = registry()
    const before = serialize(reg)
    const capturing = kb.beginCapture(state(), editorRows(reg).find((row) => row.id === "work-swarms")!)
    const captured = kb.capture(capturing, "space+r")
    if ("kind" in captured) throw new Error("expected a state")

    const result = kb.commit(reg, captured)
    expect(result.kind).toBe("conflict")
    if (result.kind !== "conflict") throw new Error("expected a conflict")
    expect(result.sentence).toBe("␣ r is already Global reader.")
    expect(serialize(reg)).toEqual(before)
    expect(bindingLabel(reg.bindingFor("work-swarms")!)).toBe("␣ x")
  })

  test("Esc during capture keeps the old binding", () => {
    const reg = registry()
    const capturing = kb.beginCapture(state(), editorRows(reg).find((row) => row.id === "chat")!)
    const cancelled = kb.cancelCapture(capturing)
    expect(cancelled.capturing).toBe(null)
    expect(cancelled.captured).toBe(null)
    expect(bindingLabel(reg.bindingFor("chat")!)).toBe("␣ c")
    expect(kb.commit(reg, cancelled).kind).toBe("nothing")
  })

  test("the leader overlay follows the change immediately", () => {
    const reg = registry()
    const capturing = kb.beginCapture(state(), editorRows(reg).find((row) => row.id === "chat")!)
    const captured = kb.capture(capturing, "space+9")
    if ("kind" in captured) throw new Error("expected a state")
    kb.commit(reg, captured)
    const overlay = generatedRows(reg, "global").find((row) => row.id === "chat")
    expect(overlay?.keys).toBe("␣ 9")
  })
})

describe("reset", () => {
  test("reset one restores that action only", () => {
    const reg = registry()
    reg.rebind("chat", { kind: "leader", key: "9" })
    reg.rebind("sessions", { kind: "leader", key: "8" })
    const config = kb.resetOne(reg, state({ capturing: "chat" }))
    expect(bindingLabel(reg.bindingFor("chat")!)).toBe("␣ c")
    expect(bindingLabel(reg.bindingFor("sessions")!)).toBe("␣ 8")
    expect(config.ui?.keybinds?.chat).toBe("space+c")
  })

  test("reset all asks with the count and restores every default", () => {
    const reg = registry()
    reg.rebind("chat", { kind: "leader", key: "9" })
    reg.rebind("sessions", { kind: "leader", key: "8" })
    expect(kb.overrideCount(reg)).toBe(2)

    const armed = kb.armResetAll(state(), kb.overrideCount(reg))
    expect(armed.notice).toBe("reset 2 custom bindings to defaults? press R again to confirm")
    expect(kb.confirmResetAll(reg, state())).toBe(null)

    kb.confirmResetAll(reg, armed)
    expect(kb.overrideCount(reg)).toBe(0)
    expect(bindingLabel(reg.bindingFor("chat")!)).toBe("␣ c")
  })
})

describe("fixed keys and layout", () => {
  test("fixed keys are listed and rebindable by the same flow", () => {
    const reg = registry()
    const rows = editorRows(reg)
    for (const id of ["escape", "insert", "down", "up", "help", "command", "quit"]) {
      expect(rows.some((row) => row.id === id)).toBe(true)
    }
    const capturing = kb.beginCapture(state(), rows.find((row) => row.id === "help")!)
    const captured = kb.capture(capturing, "f1")
    if ("kind" in captured) throw new Error("expected a state")
    expect(kb.commit(reg, captured).kind).toBe("applied")
    expect(bindingLabel(reg.bindingFor("help")!)).toBe("F1")
  })

  test("80x24 truncates with an ellipsis and keeps the binding column", async () => {
    const rows = editorRows(registry())
    const setup = await mount(80, 24, rows)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      // The binding column stays visible at 80 columns.
      expect(out.join("\n")).toContain("Ctrl+Q")
    } finally {
      await setup.dispose()
    }

    // The list scrolls with the cursor, so every action is reachable.
    const chatIndex = rows.findIndex((row) => row.id === "chat")
    const scrolled = await mount(80, 24, rows, state({ cursor: chatIndex }))
    try {
      expect(lines(scrolled).join("\n")).toContain("␣ c")
    } finally {
      await scrolled.dispose()
    }
    expect(kb.fitLabel("a very long action label that will not fit", 30, 14)).toContain("…")
  })

  test("the component keeps no key literal and no defaults copy", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/keybinds.tsx"), "utf8")
    // The editor's own verbs are one parsed table; it holds no leader chord and
    // no copy of the defaults.
    expect(source).not.toMatch(/space\+[a-z]/i)
    expect(source).not.toContain("defaultBinding")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
  })

  test("keys come from one table", () => {
    expect(kb.intentFor("return")).toBe("rebind")
    expect(kb.intentFor("r")).toBe("reset")
    expect(kb.intentFor("r", { shift: true })).toBe("reset-all")
    expect(kb.footerHints()).toContain("R reset all")
  })
})

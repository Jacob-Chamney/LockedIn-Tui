/**
 * The `:` command palette.
 *
 * A thin floating window: typing filters, tab completes the selected name,
 * arrows move, Enter runs it, Esc closes without dispatching. The catalogue is
 * the keymap registry; aliases live in `commands.ts`.
 */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
type ShellApi = import("../../src/app/App").ShellApi
const commands = await import("../../src/ui/shell/commands")
const { createDefaultActions } = await import("../../src/ui/keymap/defaults")
const { KeymapRegistry } = await import("../../src/ui/keymap/registry")

const registry = new KeymapRegistry(createDefaultActions(() => {}))

async function open(): Promise<{ ui: Awaited<ReturnType<typeof renderApp>>; api: () => ShellApi }> {
  let api!: ShellApi
  const ui = await renderApp({ width: 120, height: 36, app: () => <App api={(value) => (api = value)} /> })
  await ui.waitFor("LOCKEDIN")
  await ui.press(":")
  return { ui, api: () => api }
}

describe("the filter", () => {
  test("a prefix ranks the real actions before aliases", () => {
    const matches = commands.filterCommands(registry, "t", 10)
    expect(matches.length).toBeGreaterThan(1)
    expect(matches[0]!.alias).toBe(false)
    // Prefix matches come first; label matches may follow.
    expect(matches.slice(0, 2).every((entry) => entry.name.startsWith("t") || entry.label.toLowerCase().includes("t"))).toBe(true)
    // One row per destination: `theme` is the alias for the themes surface.
    expect(matches.filter((entry) => entry.target === "themes")).toHaveLength(1)
    expect(matches.map((entry) => entry.name)).toContain("tasks")
  })

  test("an exact name wins", () => {
    expect(commands.filterCommands(registry, "themes", 5)[0]!.name).toBe("themes")
  })
})

describe("the palette", () => {
  test("':' opens a floating window with suggestions", async () => {
    const { ui, api } = await open()
    try {
      expect(api().state().overlay).toBe("command")
      await ui.press("t")
      const frame = ui.frame()
      expect(frame).toContain(":t")
      expect(frame).toContain("themes")
      expect(frame).toContain("tasks")
      // A floating window, not a full-width bar: the query line is inset.
      const row = frame.split("\n").find((line) => line.includes(":t"))!
      expect(row.indexOf(":t")).toBeGreaterThan(0)
      const title = frame.split("\n").findIndex((line) => line.includes("Commands"))
      expect(frame.split("\n")[title - 1]).not.toContain("┌")
      expect(row.trimEnd().length).toBeLessThan(frame.split("\n")[0]!.length)
    } finally {
      await ui.dispose()
    }
  })

  test("Tab cycles the list without typing", async () => {
    const { ui, api } = await open()
    try {
      await ui.press("t")
      const count = commands.filterCommands(registry, "t", 10).length
      expect(api().state().commandIndex).toBe(0)
      await ui.press("tab")
      expect(api().state().commandIndex).toBe(1)
      // Wraps at the end, so Tab alone can reach every row.
      for (let step = 1; step < count; step++) await ui.press("tab")
      expect(api().state().commandIndex).toBe(0)
      // Shift+Tab goes back.
      await ui.press("tab", { shift: true })
      expect(api().state().commandIndex).toBe(count - 1)
      // The query is untouched: Tab moves the selection, it does not complete.
      expect(api().state().commandQuery).toBe("t")
    } finally {
      await ui.dispose()
    }
  })

  test("arrows move the selection and Enter runs it", async () => {
    const { ui, api } = await open()
    try {
      await ui.press("t")
      const matches = commands.filterCommands(registry, "t", 10)
      await ui.press("down")
      expect(api().state().commandIndex).toBe(1)
      const chosen = matches[1]!
      await ui.press("return")
      // The palette closes and the surface it names is showing.
      expect(api().state().overlay).toBe(null)
      const target = chosen.target
      if (target === "tasks") expect(ui.frame()).toContain("TASK CENTRE")
      else if (target === "themes") expect(ui.frame()).toContain("THEME")
      else expect(api().state().overlay).toBe(null)
    } finally {
      await ui.dispose()
    }
  })

  test("Esc closes without dispatching", async () => {
    const { ui, api } = await open()
    try {
      await ui.press("escape")
      expect(api().state().overlay).toBe(null)
      expect(api().state().pane).toBe("chat")
    } finally {
      await ui.dispose()
    }
  })

  test("typing reaches the query, not the composer", async () => {
    const { ui, api } = await open()
    try {
      await ui.type("hel")
      expect(api().state().commandQuery).toBe("hel")
      // The chat composer stayed empty: the palette owns the keyboard.
      expect(ui.frame()).not.toContain("│ hel ")
    } finally {
      await ui.dispose()
    }
  })
})

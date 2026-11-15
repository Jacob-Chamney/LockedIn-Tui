/** The plugin manager lists discovered plugins as checkbox rows. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const manager = await import("../../src/ui/settings/plugin-manager")
const { crimson } = await import("../../src/ui/theme")

const STATE: import("../../src/ui/settings/plugin-manager").PluginManagerState = {
  cursor: 0,
  loading: false,
  notice: null,
  items: [
    { id: "lab.one", name: "One", manifestName: "One", bundled: true, enabled: true },
    { id: "lab.two", name: "Two", manifestName: "Two", bundled: false, enabled: false },
    { id: "lab.three", name: "Three", manifestName: "Three", bundled: false, enabled: false, error: "bad manifest" },
  ],
}

test("checked, unchecked and errored plugins render their boxes", async () => {
  const setup = await testRender(
    () => (
      <manager.PluginManagerPane
        theme={crimson}
        width={100}
        height={24}
        focused
        state={STATE}
      />
    ),
    { width: 100, height: 24 },
  )
  try {
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("▌ [x] One")
    expect(frame).toContain("[ ] Two")
    expect(frame).toContain("[-] Three")
    expect(frame).toContain("bundled")
    expect(frame).toContain("error")
    expect(frame).toContain("enabled")
  } finally {
    await setup.dispose()
  }
})

test("discovery shows skeleton rows", async () => {
  const setup = await testRender(
    () => (
      <manager.PluginManagerPane
        theme={crimson}
        width={100}
        height={24}
        focused
        state={{ ...STATE, items: [], loading: true }}
      />
    ),
    { width: 100, height: 24 },
  )
  try {
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    const frame = setup.captureCharFrame()
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] discovering plugins…/)
    expect(frame).toContain("░")
  } finally {
    await setup.dispose()
  }
})

test("the row label keeps its checkbox", () => {
  expect(manager.pluginRowLabel(STATE.items[0]!)).toBe("[x] One")
  expect(manager.pluginRowLabel(STATE.items[1]!)).toBe("[ ] Two")
  expect(manager.pluginRowLabel(STATE.items[2]!)).toBe("[-] Three")
})

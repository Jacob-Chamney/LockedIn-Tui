import { expect, test } from "bun:test"

import {
  initialPluginManager,
  movePluginCursor,
  pluginRowLabel,
  renamePluginItem,
  togglePluginItem,
} from "../../src/ui/settings/plugin-manager"

const items = [
  { id: "lab.orbit", name: "Orbit", manifestName: "Orbit", bundled: false, enabled: true },
  { id: "lab.snow", name: "Snow", manifestName: "Snow", bundled: true, enabled: false },
]

test("the cursor clamps to the list", () => {
  const state = { ...initialPluginManager, items }
  expect(movePluginCursor(state, 1).cursor).toBe(1)
  expect(movePluginCursor(movePluginCursor(state, 5), 5).cursor).toBe(1)
  expect(movePluginCursor(state, -3).cursor).toBe(0)
  expect(movePluginCursor({ ...state, items: [] }, 1).cursor).toBe(0)
})

test("space flips one plugin and the row shows the state", () => {
  const state = { ...initialPluginManager, items }
  expect(pluginRowLabel(state.items[0]!)).toBe("[x] Orbit")
  expect(pluginRowLabel(state.items[1]!)).toBe("[ ] Snow")
  const next = togglePluginItem(state, "lab.orbit")
  expect(next.items[0]!.enabled).toBe(false)
  expect(next.items[1]!.enabled).toBe(false)
})

test("an error is carried into the row", () => {
  const state = { ...initialPluginManager, items }
  const failed = renamePluginItem(state, "lab.orbit", "Orbit", "frame budget exceeded")
  expect(failed.items[0]!.error).toBe("frame budget exceeded")
})

test("the name reported by the plugin replaces the manifest name", () => {
  const state = { ...initialPluginManager, items }
  const renamed = renamePluginItem(state, "lab.snow", "Snowfall")
  expect(renamed.items[1]!.name).toBe("Snowfall")
  // An empty report keeps the manifest name rather than blanking the row.
  const blank = renamePluginItem(state, "lab.snow", "   ")
  expect(blank.items[1]!.name).toBe("Snow")
})



import { expect, test } from "bun:test"

import {
  latestPluginStatus,
  updatePluginStatus,
  type PluginStatusMap,
} from "../../src/ui/shell/plugin-status"

test("plugin statuses are keyed and the newest wins", () => {
  let map: PluginStatusMap = {}
  map = updatePluginStatus(map, "lab.one", { text: "one" }, 1)
  map = updatePluginStatus(map, "lab.two", { text: "two", tone: "warn" }, 2)
  expect(latestPluginStatus(map)).toMatchObject({ text: "two", tone: "warn" })
  map = updatePluginStatus(map, "lab.one", { text: "one again" }, 3)
  expect(latestPluginStatus(map)).toMatchObject({ text: "one again" })
})

test("null clears only that plugin", () => {
  let map: PluginStatusMap = {}
  map = updatePluginStatus(map, "a", { text: "a" }, 1)
  map = updatePluginStatus(map, "b", { text: "b" }, 2)
  map = updatePluginStatus(map, "a", null, 3)
  expect(map.a).toBeUndefined()
  expect(latestPluginStatus(map)?.text).toBe("b")
  expect(latestPluginStatus({})).toBeNull()
})

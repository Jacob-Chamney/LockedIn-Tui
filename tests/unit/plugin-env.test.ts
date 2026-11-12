import { expect, test } from "bun:test"

import {
  legacyPluginEnv,
  PLUGIN_ENV_KEYS,
  pluginEnvValue,
} from "../../src/ui/plugins/env"

test("the plugin environment prefers the new names", () => {
  expect(pluginEnvValue({ LOCKEDIN_PLUGINS: "1" }, "enabled")).toBe("1")
  expect(pluginEnvValue({ LOCKEDIN_EFFECTS: "1" }, "enabled")).toBe("1")
  expect(
    pluginEnvValue({ LOCKEDIN_PLUGINS: "particles", LOCKEDIN_EFFECTS: "trail" }, "enabled"),
  ).toBe("particles")
  expect(pluginEnvValue({}, "enabled")).toBeUndefined()
  for (const names of Object.values(PLUGIN_ENV_KEYS)) {
    expect(names[0].startsWith("LOCKEDIN_PLUGIN")).toBe(true)
  }
})

test("legacy names are reported once for the deprecation notice", () => {
  expect(legacyPluginEnv({})).toEqual([])
  expect(legacyPluginEnv({ LOCKEDIN_PLUGINS: "1" })).toEqual([])
  expect(
    legacyPluginEnv({
      LOCKEDIN_EFFECTS: "1",
      LOCKEDIN_EFFECTS_DIR: "~/effects",
    }).sort(),
  ).toEqual(["LOCKEDIN_EFFECTS", "LOCKEDIN_EFFECTS_DIR"])
})

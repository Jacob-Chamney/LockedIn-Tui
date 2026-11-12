import { expect, test } from "bun:test"

import { PLUGIN_ENV_KEYS, pluginEnvValue } from "../../src/ui/plugins/env"

test("the plugin environment reads the supported names", () => {
  expect(pluginEnvValue({ LOCKEDIN_PLUGINS: "1" }, "enabled")).toBe("1")
  expect(pluginEnvValue({ LOCKEDIN_PLUGINS_DIR: "~/plugins" }, "dir")).toBe("~/plugins")
  expect(pluginEnvValue({ LOCKEDIN_PLUGIN: "~/plugins/one" }, "plugin")).toBe("~/plugins/one")
  expect(pluginEnvValue({ LOCKEDIN_PLUGINS_FILE: "~/plugin.ts" }, "file")).toBe("~/plugin.ts")
  expect(pluginEnvValue({}, "enabled")).toBeUndefined()
  // The old development-preview names are retired.
  expect(pluginEnvValue({ LOCKEDIN_EFFECTS: "1" }, "enabled")).toBeUndefined()
  for (const name of Object.values(PLUGIN_ENV_KEYS)) {
    expect(name.startsWith("LOCKEDIN_PLUGIN")).toBe(true)
  }
})

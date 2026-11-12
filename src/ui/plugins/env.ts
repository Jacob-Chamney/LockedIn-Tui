/**
 * Environment names for the UI plugin harness.
 *
 * `LOCKEDIN_PLUGINS*` is the supported spelling. The `LOCKEDIN_EFFECTS*` names
 * from the development preview still work for one release; a caller can report
 * them through `legacyPluginEnv`.
 */
export const PLUGIN_ENV_KEYS = {
  enabled: ["LOCKEDIN_PLUGINS", "LOCKEDIN_EFFECTS"],
  dir: ["LOCKEDIN_PLUGINS_DIR", "LOCKEDIN_EFFECTS_DIR"],
  file: ["LOCKEDIN_PLUGINS_FILE", "LOCKEDIN_EFFECTS_FILE"],
  plugin: ["LOCKEDIN_PLUGIN", "LOCKEDIN_EFFECTS_PLUGIN"],
  systems: ["LOCKEDIN_PLUGINS_SYSTEMS", "LOCKEDIN_EFFECTS_SYSTEMS"],
  layer: ["LOCKEDIN_PLUGINS_LAYER", "LOCKEDIN_EFFECTS_LAYER"],
  debug: ["LOCKEDIN_PLUGINS_DEBUG", "LOCKEDIN_EFFECTS_DEBUG"],
  log: ["LOCKEDIN_PLUGINS_LOG", "LOCKEDIN_EFFECTS_LOG"],
} as const

export type PluginEnvKey = keyof typeof PLUGIN_ENV_KEYS

export function pluginEnvValue(
  env: Record<string, string | undefined>,
  key: PluginEnvKey,
): string | undefined {
  for (const name of PLUGIN_ENV_KEYS[key]) {
    const value = env[name]
    if (value !== undefined) return value
  }
  return undefined
}

/** Legacy names that are set, for a one-time deprecation notice. */
export function legacyPluginEnv(
  env: Record<string, string | undefined>,
): string[] {
  return Object.values(PLUGIN_ENV_KEYS)
    .map(([, legacy]) => legacy)
    .filter((name) => env[name] !== undefined)
}

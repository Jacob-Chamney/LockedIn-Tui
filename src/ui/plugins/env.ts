/** Environment names for the UI plugin harness. */
export const PLUGIN_ENV_KEYS = {
  enabled: "LOCKEDIN_PLUGINS",
  dir: "LOCKEDIN_PLUGINS_DIR",
  file: "LOCKEDIN_PLUGINS_FILE",
  plugin: "LOCKEDIN_PLUGIN",
  systems: "LOCKEDIN_PLUGINS_SYSTEMS",
  layer: "LOCKEDIN_PLUGINS_LAYER",
  debug: "LOCKEDIN_PLUGINS_DEBUG",
  log: "LOCKEDIN_PLUGINS_LOG",
} as const

export type PluginEnvKey = keyof typeof PLUGIN_ENV_KEYS

export function pluginEnvValue(
  env: Record<string, string | undefined>,
  key: PluginEnvKey,
): string | undefined {
  return env[PLUGIN_ENV_KEYS[key]]
}

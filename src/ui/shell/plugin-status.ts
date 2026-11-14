/** Status-bar chips published by UI plugins, keyed by plugin id. */
export type PluginStatusTone = "info" | "warn" | "error"

export type PluginStatusEntry = {
  text: string
  tone?: PluginStatusTone
  at: number
}

export type PluginStatusMap = Record<string, PluginStatusEntry>

/** Set or clear one plugin's chip; the newest entry wins in the bar. */
export function updatePluginStatus(
  map: PluginStatusMap,
  id: string,
  status: { text: string; tone?: PluginStatusTone } | null,
  at = Date.now(),
): PluginStatusMap {
  const next = { ...map }
  if (status === null) delete next[id]
  else next[id] = { text: status.text, tone: status.tone, at }
  return next
}

export function latestPluginStatus(map: PluginStatusMap): PluginStatusEntry | null {
  const entries = Object.values(map)
  if (entries.length === 0) return null
  return entries.reduce((latest, entry) => (entry.at >= latest.at ? entry : latest))
}

/** Settings patches are dotted keys; config.toml wants nested tables. */
import type { SettingsView } from "../ui/settings"

export function nestedPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split(".")
    let cursor = out
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part]
      if (!next || typeof next !== "object" || Array.isArray(next)) cursor[part] = {}
      cursor = cursor[part] as Record<string, unknown>
    }
    cursor[parts.at(-1)!] = value
  }
  return out
}

/** Apply one already-saved patch to the settings view, without touching disk. */
export function applyViewPatch(view: SettingsView, patch: Record<string, unknown>): SettingsView {
  const next = { ...view }
  for (const [key, value] of Object.entries(patch)) {
    if (key === "ui.username") next.username = String(value)
    else if (key === "models.chat") next.chatModel = String(value)
    else if (key === "models.base_url") next.baseUrl = String(value)
    else if (key === "models.max_tool_calls") next.maxToolCalls = Number(value)
    else if (key === "models.max_tokens_per_request") next.maxTokensPerRequest = Number(value)
    else if (key === "usage.budget") next.budgetUsd = Number(value)
    else if (key === "archive.folder") next.archiveFolder = String(value)
    else if (key === "ui.chill_history_limit") next.historyLimit = Number(value)
    else if (key === "ui.response_style") next.responseStyle = String(value)
    else if (key === "ui.tutor_policy") next.tutorPolicy = String(value)
  }
  return next
}

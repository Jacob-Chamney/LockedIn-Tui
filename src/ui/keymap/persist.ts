/**
 * Persistence for `ui.keybinds` (leader) and `ui.fixed_keybinds` (direct).
 *
 * The config is a projection of the registry, never a second source of truth:
 * conflicts are refused at apply time and are not written back.
 */
import {
  bindingToString,
  parseBinding,
  KeymapRegistry,
  type Binding,
  type KeyConflict,
  type RebindResult,
} from "./registry"

export type KeybindSection = {
  keybinds?: Record<string, string>
  fixed_keybinds?: Record<string, string>
}

export type KeybindConfig = {
  ui?: KeybindSection
}

export type ApplyResult = {
  applied: string[]
  rejected: KeyConflict[]
}

/** Leader actions land in `ui.keybinds`, direct (fixed) ones in `ui.fixed_keybinds`. */
export function serialize(registry: KeymapRegistry): KeybindConfig {
  const keybinds: Record<string, string> = {}
  const fixed: Record<string, string> = {}
  for (const action of [...registry.actions()].sort((a, b) => a.id.localeCompare(b.id))) {
    const binding = registry.bindingFor(action.id)
    if (!binding) continue
    if (binding.kind === "leader") keybinds[action.id] = bindingToString(binding)
    else fixed[action.id] = bindingToString(binding)
  }
  return { ui: { keybinds, fixed_keybinds: fixed } }
}

/** Parse + rebind one entry. A conflict is returned, never applied. */
export function applyOne(registry: KeymapRegistry, id: string, raw: string): RebindResult {
  const parsed = parseBinding(raw)
  if ("reason" in parsed) {
    return {
      ok: false,
      conflict: {
        reason: parsed.reason,
        message: `${id}: ${parsed.message ?? `"${raw}" is not a binding.`}`,
        actionId: id,
      },
    }
  }
  return registry.rebind(id, parsed as Binding)
}

/** Apply a stored config. Unknown ids are reported, not written anywhere. */
export function applyConfig(registry: KeymapRegistry, config: KeybindConfig): ApplyResult {
  const applied: string[] = []
  const rejected: KeyConflict[] = []
  const sections = [
    ["keybinds", config.ui?.keybinds ?? {}] as const,
    ["fixed_keybinds", config.ui?.fixed_keybinds ?? {}] as const,
  ]
  for (const [section, entries] of sections) {
    for (const id of Object.keys(entries).sort()) {
      const raw = entries[id]!
      if (!registry.action(id)) {
        rejected.push({
          reason: "unknown-action",
          message: `${section}.${id}: no such action.`,
          actionId: id,
        })
        continue
      }
      const result = applyOne(registry, id, raw)
      if (result.ok) applied.push(id)
      else rejected.push(result.conflict)
    }
  }
  return { applied, rejected }
}

/** The value a settings screen shows after a refused rebind: nothing changed. */
export function persistedValue(registry: KeymapRegistry, id: string): string | undefined {
  const binding = registry.bindingFor(id)
  return binding ? bindingToString(binding) : undefined
}

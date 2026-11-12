/**
 * Key resolution and mode rules.
 *
 * One resolver serves direct keys, fixed keys and the leader. Screens never
 * match keys themselves; they ask this module.
 */
import {
  LEADER_PREFIX,
  KeymapRegistry,
  sameBinding,
  modesOf,
  normalizeKey,
  type Action,
  type Binding,
  type Mode,
  type Scope,
} from "./registry"

export type ResolveContext = {
  registry: KeymapRegistry
  mode: Mode
  scope: Scope
}

export type ResolveResult =
  | { kind: "action"; action: Action; modeAfter: Mode }
  | { kind: "leader-pending" }
  | { kind: "none" }

export type KeypressLike = {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  alt?: boolean
}

/** Canonical key name for matching: modifiers first, lowercase. */
export function keyNameOf(press: KeypressLike): string {
  if (press.ctrl) return `ctrl+${normalizeKey(press.name)}`
  if (press.meta) return `meta+${normalizeKey(press.name)}`
  return normalizeKey(press.name)
}

function bindingForPress(
  registry: KeymapRegistry,
  scope: Scope,
  press: KeypressLike,
): { action: Action; binding: Binding } | undefined {
  const name = keyNameOf(press)
  for (const action of registry.actions()) {
    const binding = registry.bindingFor(action.id)
    if (!binding) continue
    if (binding.kind !== "direct") continue
    if (binding.key !== name) continue
    if (!scopesApply(action, scope)) continue
    return { action, binding }
  }
  return undefined
}

export function scopesApply(action: Action, scope: Scope): boolean {
  return action.scope === scope || action.scope === "global"
}

/**
 * Resolve one key press. The leader prefix itself never dispatches: it opens
 * the overlay and returns `leader-pending`.
 */
export function resolveKey(ctx: ResolveContext, press: KeypressLike): ResolveResult {
  const { registry, mode, scope } = ctx
  const name = keyNameOf(press)

  // Design §7.4: leader and single-key actions only fire in normal mode.
  if (mode === "normal" && !press.ctrl && !press.meta && name === LEADER_PREFIX) {
    return { kind: "leader-pending" }
  }

  const hit = bindingForPress(registry, scope, press)
  if (!hit) return { kind: "none" }
  if (!modesOf(hit.action).includes(mode)) return { kind: "none" }
  return { kind: "action", action: hit.action, modeAfter: hit.action.modeAfter ?? mode }
}

/** Resolve the second key of a leader sequence (`Space` then this press). */
export function resolveLeaderKey(ctx: ResolveContext, press: KeypressLike): ResolveResult {
  const { registry, scope } = ctx
  if (press.name === "escape") return { kind: "none" }
  const key = keyNameOf(press)
  for (const action of registry.actions()) {
    const binding = registry.bindingFor(action.id)
    if (!binding || binding.kind !== "leader" || binding.key !== key) continue
    if (!scopesApply(action, scope)) continue
    if (!modesOf(action).includes("normal")) continue
    return { kind: "action", action, modeAfter: action.modeAfter ?? "normal" }
  }
  return { kind: "none" }
}

/** Leaving any panel or manager returns to NORMAL, never silently INSERT. */
export function modeAfterPanelExit(): Mode {
  return "normal"
}

/** The mode after an action runs, with panel exits always landing in NORMAL. */
export function nextMode(current: Mode, result: ResolveResult): Mode {
  if (result.kind !== "action") return current
  if (result.action.id === "escape") return modeAfterPanelExit()
  return result.modeAfter
}

/** Commands are action aliases, not a second implementation. */
export function actionByCommand(registry: KeymapRegistry, command: string): Action | undefined {
  const name = command.trim().replace(/^:/, "").toLowerCase()
  return registry.action(name)
}

export function bindingTakenBy(
  registry: KeymapRegistry,
  scope: Scope,
  binding: Binding,
): Action | undefined {
  return registry.actions().find((action) => {
    const current = registry.bindingFor(action.id)
    return current !== undefined && sameBinding(current, binding) && scopesApply(action, scope)
  })
}

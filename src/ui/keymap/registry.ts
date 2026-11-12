/**
 * The keymap registry — the single source of truth for bindings.
 *
 * Everything the UI shows (help, the leader overlay, the editor, status hints)
 * and everything the resolver accepts is derived from this catalogue. There is
 * no second key table anywhere: a screen that wants a key asks the registry.
 *
 * This module is pure domain code. It must never import a renderer.
 */

export type Scope = "global" | "chill" | "learn" | "work" | "reader" | "deck"

export type Group = "context" | "global" | "system"

export type Mode = "insert" | "normal"

/** A leader binding is `Space` followed by `key`. The prefix is fixed by
 * design §7.3 and resolved by `resolve.ts`, not stored per action. */
export type Binding = { kind: "direct"; key: string } | { kind: "leader"; key: string }

export const LEADER_PREFIX = "space"

/** The leader is the open-box glyph, not the word "Space". */
export const LEADER_SYMBOL = "␣"

export type Keypress = {
  /** Normalised key name: `a`, `escape`, `return`, `space`, `f1`. */
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  alt?: boolean
}

export type ActionContext = {
  actionId: string
  scope: Scope
  mode: Mode
}

export type Action = {
  /** Stable id. Commands and config use it; renaming breaks both. */
  id: string
  label: string
  group: Group
  scope: Scope
  defaultBinding: Binding
  /** Modes in which the action fires. Defaults to `["normal"]`. */
  modes?: Mode[]
  /** Mode after the action runs. Omitted = unchanged. Panels always leave to
   * `normal`; only an explicit `i`/Enter enters `insert` (design §7.4). */
  modeAfter?: Mode
  enabled?: (ctx: ActionContext) => boolean
  /** Undefined is a validation failure: every action must have a handler. */
  run?: (ctx: ActionContext) => void
}

export type KeyConflictReason = "duplicate-binding" | "unknown-action" | "invalid-binding"

export type KeyConflict = {
  reason: KeyConflictReason
  /** Human sentence, e.g. `␣ x is already Work swarms.` */
  message: string
  binding?: Binding
  actionId?: string
  existingId?: string
}

export type RebindResult =
  | { ok: true; action: Action; previous: Binding }
  | { ok: false; conflict: KeyConflict }

export type ValidationIssue = {
  kind: "missing-handler" | "duplicate-binding" | "duplicate-id" | "unreachable" | "invalid-id"
  message: string
  actionId?: string
}

// ---------------------------------------------------------------- formatting

export function normalizeKey(name: string): string {
  const key = name.trim().toLowerCase()
  if (key === "esc") return "escape"
  if (key === "enter" || key === "cr") return "return"
  if (key === "ctrl+space" || key === "ctrl-space") return "ctrl+space"
  return key
}

/** The documented config/UI string form. `space+e`, `/`, `escape`, `ctrl+q`. */
export function bindingToString(binding: Binding): string {
  return binding.kind === "leader" ? `${LEADER_PREFIX}+${binding.key}` : binding.key
}

export function parseBinding(
  raw: string,
  options: { allowLeaderPrefixKey?: boolean } = {},
): Binding | KeyConflict {
  const text = raw.trim().toLowerCase()
  if (!text) {
    return { reason: "invalid-binding", message: `Empty binding.`, }
  }
  const parts = text.split("+")
  if (parts.length === 2 && parts[0] === LEADER_PREFIX) {
    const key = normalizeKey(parts[1]!)
    if (!key || key === LEADER_PREFIX) {
      return { reason: "invalid-binding", message: `"${raw}" has no key after ${LEADER_PREFIX}.` }
    }
    return { kind: "leader", key }
  }
  if (parts.length <= 2) {
    const key = normalizeKey(text)
    if (key === LEADER_PREFIX && options.allowLeaderPrefixKey !== true) {
      return {
        reason: "invalid-binding",
        message: `"${raw}" is the leader prefix; bind it as ${LEADER_PREFIX}+<key>.`,
      }
    }
    return { kind: "direct", key }
  }
  return { reason: "invalid-binding", message: `"${raw}" is not a binding.` }
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.kind === b.kind && a.key === b.key
}

/** Pretty key for humans and for conflict messages: `␣ e`, `Esc`, `Ctrl+Q`. */
export function prettyKey(key: string): string {
  if (key === "escape") return "Esc"
  if (key === "return") return "Enter"
  if (key === "space") return LEADER_SYMBOL
  if (key.startsWith("ctrl+")) return `Ctrl+${key.slice(5).toUpperCase()}`
  if (key.length === 1) return key
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** The key alone, for a chord whose prefix is already pressed. */
export function keyLabel(binding: Binding): string {
  return prettyKey(binding.key)
}

export function bindingLabel(binding: Binding): string {
  return binding.kind === "leader"
    ? `${prettyKey(LEADER_PREFIX)} ${prettyKey(binding.key)}`
    : prettyKey(binding.key)
}

/** A global action is reachable from every scope, so it conflicts with all of
 * them; two scope actions only conflict inside their shared scope. */
export function scopesOverlap(a: Scope, b: Scope): boolean {
  return a === b || a === "global" || b === "global"
}

// ---------------------------------------------------------------- registry

export type GeneratedRow = {
  id: string
  label: string
  group: Group
  scope: Scope
  /** The binding actually in force, user overrides included. */
  binding: Binding
  keys: string
  description: string
}

const DEFAULT_MODES: Mode[] = ["normal"]

export function modesOf(action: Action): Mode[] {
  return action.modes ?? DEFAULT_MODES
}

function conflictMessage(binding: Binding, other: Action): string {
  return `${bindingLabel(binding)} is already ${scopeTitle(other.scope)} ${other.label}.`
}

function scopeTitle(scope: Scope): string {
  switch (scope) {
    case "global":
      return "Global"
    case "chill":
      return "Chill"
    case "learn":
      return "Learn"
    case "work":
      return "Work"
    case "reader":
      return "Reader"
    case "deck":
      return "Deck"
  }
}

export class KeymapRegistry {
  private readonly catalogue: Action[]
  private readonly overrides = new Map<string, Binding>()
  private readonly known: Map<string, Action>

  constructor(actions: readonly Action[]) {
    const issues = validateActions(actions)
    if (issues.length > 0) {
      throw new KeymapError(issues)
    }
    this.catalogue = actions.map((action) => ({ ...action }))
    this.known = new Map(this.catalogue.map((action) => [action.id, action]))
  }

  actions(): readonly Action[] {
    return this.catalogue
  }

  action(id: string): Action | undefined {
    return this.known.get(id)
  }

  /** The binding in force: the user override when present, else the default. */
  bindingFor(id: string): Binding | undefined {
    const override = this.overrides.get(id)
    if (override) return override
    return this.known.get(id)?.defaultBinding
  }

  /** The action bound to `binding` in `scope`, if any (global actions apply). */
  actionFor(binding: Binding, scope: Scope): Action | undefined {
    for (const action of this.catalogue) {
      const current = this.bindingFor(action.id)
      if (!current || !sameBinding(current, binding)) continue
      if (scopesOverlap(action.scope, scope)) return action
    }
    return undefined
  }

  conflicts(): KeyConflict[] {
    const out: KeyConflict[] = []
    for (const action of this.catalogue) {
      const binding = this.bindingFor(action.id)
      if (!binding) continue
      const clash = this.catalogue.find((other) => {
        if (other.id === action.id) return false
        const otherBinding = this.bindingFor(other.id)
        return (
          otherBinding !== undefined &&
          sameBinding(otherBinding, binding) &&
          scopesOverlap(other.scope, action.scope)
        )
      })
      if (clash) {
        out.push({
          reason: "duplicate-binding",
          message: conflictMessage(binding, clash),
          binding,
          actionId: action.id,
          existingId: clash.id,
        })
      }
    }
    return out
  }

  /** Rebinding removes the old key by construction: it replaces the binding. */
  rebind(id: string, binding: Binding): RebindResult {
    const action = this.known.get(id)
    if (!action) {
      return {
        ok: false,
        conflict: {
          reason: "unknown-action",
          message: `No action "${id}".`,
          actionId: id,
          binding,
        },
      }
    }
    const previous = this.bindingFor(id)!
    if (
      binding.kind === "leader" &&
      (!binding.key || normalizeKey(binding.key) === LEADER_PREFIX)
    ) {
      return {
        ok: false,
        conflict: {
          reason: "invalid-binding",
          message: `${bindingLabel(binding)} has no key after the leader prefix.`,
          actionId: id,
          binding,
        },
      }
    }
    const next: Binding = { ...binding, key: normalizeKey(binding.key) } as Binding
    const clash = this.catalogue.find((other) => {
      if (other.id === id) return false
      const otherBinding = this.bindingFor(other.id)
      return (
        otherBinding !== undefined &&
        sameBinding(otherBinding, next) &&
        scopesOverlap(other.scope, action.scope)
      )
    })
    if (clash) {
      // Not persisted, not mutated (acceptance: duplicate is rejected).
      return { ok: false, conflict: { reason: "duplicate-binding", message: conflictMessage(next, clash), binding: next, actionId: id, existingId: clash.id } }
    }
    this.overrides.set(id, next)
    return { ok: true, action, previous }
  }

  /** Reset one action, or every action when `id` is omitted. */
  reset(id?: string): void {
    if (id === undefined) {
      this.overrides.clear()
      return
    }
    this.overrides.delete(id)
  }

  /** True when the action's current binding differs from its default. */
  isOverridden(id: string): boolean {
    const current = this.bindingFor(id)
    const action = this.known.get(id)
    if (!current || !action) return false
    return !sameBinding(current, action.defaultBinding)
  }

  /**
   * Reachability in NORMAL: every action must be resolvable with its current
   * binding for at least one context in its own scope.
   */
  unreachable(): Action[] {
    return this.catalogue.filter((action) => {
      const binding = this.bindingFor(action.id)
      if (!binding) return true
      if (!modesOf(action).includes("normal")) return false
      return !enabledInScope(action, binding, this)
    })
  }
}

export function enabledInScope(
  action: Action,
  binding: Binding,
  _registry: KeymapRegistry,
): boolean {
  const ctx: ActionContext = { actionId: action.id, scope: binding.kind === "leader" ? action.scope : action.scope, mode: "normal" }
  if (!action.enabled) return true
  for (const scope of [action.scope, "global"] as Scope[]) {
    if (action.enabled({ ...ctx, scope })) return true
  }
  return false
}

export class KeymapError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "))
    this.name = "KeymapError"
    this.issues = issues
  }
}

export function validateActions(actions: readonly Action[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()

  for (const action of actions) {
    if (!action.id || !/^[a-z0-9][a-z0-9-]*$/.test(action.id)) {
      issues.push({
        kind: "invalid-id",
        message: `Action id "${action.id}" must be lowercase kebab-case.`,
        actionId: action.id,
      })
    }
    if (seen.has(action.id)) {
      issues.push({ kind: "duplicate-id", message: `Duplicate action id "${action.id}".`, actionId: action.id })
    }
    seen.add(action.id)

    if (typeof action.run !== "function") {
      issues.push({
        kind: "missing-handler",
        message: `Action "${action.id}" has no handler.`,
        actionId: action.id,
      })
    }
    if (!action.defaultBinding || !action.defaultBinding.key) {
      issues.push({
        kind: "duplicate-binding",
        message: `Action "${action.id}" has no default binding.`,
        actionId: action.id,
      })
    }
  }

  // Unique binding per scope is established from defaults here; the registry
  // re-checks live bindings after every rebind.
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const a = actions[i]!
      const b = actions[j]!
      if (sameBinding(a.defaultBinding, b.defaultBinding) && scopesOverlap(a.scope, b.scope)) {
        issues.push({
          kind: "duplicate-binding",
          message: conflictMessage(a.defaultBinding, b),
          actionId: a.id,
        })
      }
    }
  }

  for (const action of actions) {
    if (!modesOf(action).includes("normal")) continue
    if (!action.enabled) continue
    const contexts: ActionContext[] = [
      { actionId: action.id, scope: action.scope, mode: "normal" },
      { actionId: action.id, scope: "global", mode: "normal" },
    ]
    if (!contexts.some((ctx) => action.enabled!(ctx))) {
      issues.push({
        kind: "unreachable",
        message: `Action "${action.id}" is never enabled in normal mode.`,
        actionId: action.id,
      })
    }
  }

  return issues
}

// ---------------------------------------------------------------- generated rows

/** Which groups and in what order: the current context first (design §7.3). */
const GROUP_ORDER: Group[] = ["context", "global", "system"]

function actionsForScope(registry: KeymapRegistry, scope: Scope): Action[] {
  return registry
    .actions()
    .filter((action) => scopesOverlap(action.scope, scope))
    .filter((action) => {
      const binding = registry.bindingFor(action.id)
      return binding !== undefined && enabledInScope(action, binding, registry)
    })
    .sort((a, b) => {
      const groupDelta = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
      if (groupDelta !== 0) return groupDelta
      if (a.scope !== b.scope) return a.scope === scope ? -1 : b.scope === scope ? 1 : 0
      return bindingLabel(registry.bindingFor(a.id)!).localeCompare(bindingLabel(registry.bindingFor(b.id)!))
    })
}

/**
 * One row model for every generated surface. Help, the leader overlay and the
 * keybind editor all read this, so they cannot disagree.
 */
export function generatedRows(registry: KeymapRegistry, scope: Scope): GeneratedRow[] {
  return actionsForScope(registry, scope).map((action) => {
    const binding = registry.bindingFor(action.id)!
    return {
      id: action.id,
      label: action.label,
      group: action.group,
      scope: action.scope,
      binding,
      keys: bindingLabel(binding),
      description: action.label,
    }
  })
}

export function helpRows(registry: KeymapRegistry, scope: Scope): GeneratedRow[] {
  return generatedRows(registry, scope)
}

export function overlayRows(
  registry: KeymapRegistry,
  scope: Scope,
  columns = 2,
): GeneratedRow[][] {
  const rows = generatedRows(registry, scope)
  const perColumn = Math.ceil(rows.length / columns)
  const out: GeneratedRow[][] = []
  for (let column = 0; column < columns; column++) {
    const slice = rows.slice(column * perColumn, (column + 1) * perColumn)
    if (slice.length > 0) out.push(slice)
  }
  return out
}

export type EditorRow = {
  id: string
  label: string
  group: Group
  scope: Scope
  keys: string
  defaultKeys: string
  overridden: boolean
  rebindable: boolean
}

export function editorRows(registry: KeymapRegistry): EditorRow[] {
  return registry.actions().map((action) => {
    const binding = registry.bindingFor(action.id)!
    return {
      id: action.id,
      label: action.label,
      group: action.group,
      scope: action.scope,
      keys: bindingLabel(binding),
      defaultKeys: bindingLabel(action.defaultBinding),
      overridden: registry.isOverridden(action.id),
      rebindable: true,
    }
  })
}

/**
 * The command line model.
 *
 * Command ids are the keymap registry's action ids — there is no second list.
 * Aliases are a small documented map for names that read better in a command
 * line, and for panels that are shell state rather than registry actions.
 */
import { bindingLabel, type Action, type KeymapRegistry } from "../keymap/registry"
import { PANE_FOR_ACTION } from "./state"

/**
 * Aliases the command line accepts. Targets are either a registry action id or
 * a shell panel id; the shell decides which, and nothing here calls a service.
 */
export const ALIASES: Record<string, string> = {
  chill: "chat",
  goal: "goals",
  skills: "goals",
  session: "sessions",
  sessions: "sessions",
  lockin: "lock-in",
  "lock-in": "lock-in",
  instructions: "session-settings",
  chatsettings: "chat-settings",
  style: "chat-settings",
  archive: "archive",
  themes: "themes",
  theme: "themes",
  keybinds: "keybinds",
  keys: "keybinds",
  tasks: "tasks",
  taskcenter: "tasks",
  task: "tasks",
  work: "work-projects",
  projects: "projects",
  project: "projects",
  agents: "work-agents",
  swarms: "work-swarms",
  changes: "work-changes",
  // Buffers, the way an editor treats windows.
  q: "buffer-close",
  close: "buffer-close",
  bd: "buffer-close",
  qo: "buffer-close-others",
  only: "buffer-close-others",
  qa: "buffer-close-all",
  qall: "buffer-close-all",
  bn: "buffer-next",
  bnext: "buffer-next",
  bp: "buffer-prev",
  bprev: "buffer-prev",
  ls: "buffer-list",
  bls: "buffer-list",
  home: "buffer-close-all",
  reset: "buffer-close-all",
}

/** Panels the shell owns that are not registry actions (no key of their own yet). */
export const SHELL_PANELS = ["archive", "themes", "keybinds"] as const

/** Shell verbs with no key of their own, dispatched by `App`. */
export const SHELL_ACTIONS = [
  "buffer-close",
  "buffer-close-others",
  "buffer-close-all",
  "buffer-next",
  "buffer-prev",
  "buffer-list",
] as const

/** Commands that belong to the shell rather than the keymap. */
export const SHELL_COMMANDS: CommandEntry[] = [
  {
    name: "clear",
    target: "clear",
    label: "clear the Chill transcript and local history",
    alias: false,
  },
  {
    name: "update",
    target: "update",
    label: "check for updates and install",
    alias: false,
  },
]

export type CommandEntry = {
  /** What the user types to reach it. */
  name: string
  /** The registry action id or shell panel id it dispatches. */
  target: string
  label: string
  alias: boolean
}

function actionEntries(registry: KeymapRegistry): CommandEntry[] {
  return registry.actions().map((action: Action) => ({
    name: action.id,
    target: action.id,
    label: action.label,
    alias: false,
  }))
}

/** Pane routes with no registry action or alias of their own. */
function routeEntries(registry: KeymapRegistry): CommandEntry[] {
  const out: CommandEntry[] = []
  // A route whose destination is already reachable by an action or alias does
  // not need a second command row (tasks and task-center are the same pane).
  const covered = new Set(
    Object.keys(PANE_FOR_ACTION)
      .filter((id) => registry.action(id) || ALIASES[id])
      .map((id) => PANE_FOR_ACTION[id]),
  )
  for (const id of Object.keys(PANE_FOR_ACTION)) {
    if (registry.action(id) || ALIASES[id]) continue
    if (covered.has(PANE_FOR_ACTION[id])) continue
    out.push({ name: id, target: id, label: id, alias: false })
  }
  return out
}

function aliasEntries(registry: KeymapRegistry): CommandEntry[] {
  return Object.entries(ALIASES).map(([name, target]) => {
    const action = registry.action(target)
    return {
      name,
      target,
      label: action?.label ?? target,
      alias: true,
    }
  })
}

export function allCommands(registry: KeymapRegistry): CommandEntry[] {
  const seen = new Set<string>()
  const out: CommandEntry[] = []
  for (const entry of [
    ...actionEntries(registry),
    ...routeEntries(registry),
    ...aliasEntries(registry),
    ...SHELL_COMMANDS,
  ]) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    out.push(entry)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Live filter: prefix matches first, then substring matches, then aliases. */
export function filterCommands(registry: KeymapRegistry, query: string, limit = 8): CommandEntry[] {
  const text = query.trim().toLowerCase()
  const commands = allCommands(registry)
  if (!text) return commands.slice(0, limit)
  // Exact id, then real actions before aliases, then substring, then label.
  const exact = commands.filter((c) => c.name === text)
  const prefix = commands.filter((c) => c.name !== text && c.name.startsWith(text) && !c.alias)
  const aliasPrefix = commands.filter((c) => c.name !== text && c.name.startsWith(text) && c.alias)
  const contains = commands.filter(
    (c) => !c.name.startsWith(text) && c.name.includes(text) && !c.alias,
  )
  const byLabel = commands.filter(
    (c) => !c.name.includes(text) && c.label.toLowerCase().includes(text),
  )
  // Typing is prefix-first: while a prefix matches, show only those — the user
  // asked for "everything that starts with t", not everything containing it.
  const prefixes = [...prefix, ...aliasPrefix]
  const ranked = prefixes.length > 0 ? [...exact, ...prefixes] : [...exact, ...contains, ...byLabel]
  // One row per destination: an alias and its target are the same command.
  const seen = new Set<string>()
  const unique: CommandEntry[] = []
  for (const entry of ranked) {
    if (seen.has(entry.target)) continue
    seen.add(entry.target)
    unique.push(entry)
  }
  return unique.slice(0, limit)
}

export type CommandResult =
  | { kind: "action"; id: string }
  | { kind: "panel"; id: string }
  | { kind: "unknown"; message: string }

/**
 * Resolve typed text to something the shell can dispatch. Never throws, never
 * closes the bar: the caller decides what to show.
 */
export function resolveCommand(registry: KeymapRegistry, raw: string): CommandResult {
  const text = raw.trim().replace(/^:/, "").toLowerCase()
  if (!text) return { kind: "unknown", message: "Type a command, then Enter. Esc cancels." }

  const target = ALIASES[text] ?? text
  // A command may name a keymap action *or* a surface that has no key of its
  // own (themes, archive): both go through dispatch, which knows the routes.
  if (
    registry.action(target) ||
    PANE_FOR_ACTION[target] !== undefined ||
    (SHELL_ACTIONS as readonly string[]).includes(target) ||
    SHELL_COMMANDS.some((entry) => entry.target === target)
  ) {
    return { kind: "action", id: target }
  }
  if ((SHELL_PANELS as readonly string[]).includes(target)) return { kind: "panel", id: target }

  const suggestion = nearestCommand(registry, text)
  return {
    kind: "unknown",
    message: suggestion
      ? `No command "${text}". Did you mean "${suggestion.name}"?`
      : `No command "${text}". Press Esc and try ? for the keymap.`,
  }
}

/** Small edit-distance suggestion so a typo teaches the right command. */
function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const table = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      table[i]![j] = Math.min(table[i - 1]![j]! + 1, table[i]![j - 1]! + 1, table[i - 1]![j - 1]! + cost)
    }
  }
  return table[rows - 1]![cols - 1]!
}

export function nearestCommand(registry: KeymapRegistry, text: string): CommandEntry | undefined {
  let best: { entry: CommandEntry; score: number } | undefined
  for (const entry of allCommands(registry)) {
    const score = distance(text, entry.name)
    if (score > 2) continue
    if (!best || score < best.score || (score === best.score && !entry.alias && best.entry.alias)) {
      best = { entry, score }
    }
  }
  return best?.entry
}

/** One line of help for the bar footer: the actual bound key, from the registry. */
export function commandHint(registry: KeymapRegistry, id: string): string | undefined {
  const action = registry.action(id)
  const binding = registry.bindingFor(id)
  return action && binding ? `${bindingLabel(binding)} ${action.label}` : undefined
}

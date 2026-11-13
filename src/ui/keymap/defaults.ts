/**
 * The default action catalogue. This is the only list of keys in the app.
 *
 * `run` is injected so the registry stays independent of the UI: the shell
 * passes a dispatcher and every action routes its command through it.
 */
import type { Action, Mode, Scope } from "./registry"

export type Dispatcher = (actionId: string, scope: Scope) => void

type Spec = {
  id: string
  label: string
  group: Action["group"]
  scope: Scope
  keys: string
  modes?: Mode[]
  modeAfter?: Mode
}

const leader = (key: string) => ({ kind: "leader" as const, key })
const direct = (key: string) => ({ kind: "direct" as const, key })

/** Fixed keys from docs/data-model.md `[ui.fixed_keybinds]`, plus direct keys
 * from design §7.1. They are ordinary actions: same registry, same resolver. */
const SPECS: Spec[] = [
  // system — always available, rebindable, honoured through the resolver
  { id: "quit", label: "quit", group: "system", scope: "global", keys: "ctrl+q" },
  { id: "help", label: "help", group: "system", scope: "global", keys: "?" },
  { id: "command", label: "commands", group: "system", scope: "global", keys: ":" },
  { id: "search", label: "search", group: "system", scope: "global", keys: "/" },
  { id: "escape", label: "back", group: "system", scope: "global", keys: "escape", modes: ["normal", "insert"], modeAfter: "normal" },
  { id: "insert", label: "insert", group: "system", scope: "global", keys: "i", modeAfter: "insert" },
  { id: "down", label: "move down", group: "system", scope: "global", keys: "j" },
  { id: "up", label: "move up", group: "system", scope: "global", keys: "k" },
  { id: "dismiss-notice", label: "dismiss notification", group: "system", scope: "global", keys: "ctrl+." },
  { id: "plugin-focus-next", label: "focus plugin window", group: "system", scope: "global", keys: "f6" },
  { id: "plugin-focus-prev", label: "focus previous plugin window", group: "system", scope: "global", keys: "f7" },

  // global — reachable from every scope
  { id: "navigator", label: "explorer", group: "global", scope: "global", keys: "space+e", modeAfter: "normal" },
  { id: "chat", label: "chill", group: "global", scope: "global", keys: "space+c", modeAfter: "normal" },
  { id: "buffers", label: "buffers", group: "global", scope: "global", keys: "space+b", modeAfter: "normal" },
  { id: "reader", label: "reader", group: "global", scope: "global", keys: "space+r", modeAfter: "normal" },
  { id: "knowledge", label: "knowledge base", group: "global", scope: "global", keys: "space+n", modeAfter: "normal" },
  { id: "archives", label: "archives", group: "global", scope: "global", keys: "space+f", modeAfter: "normal" },
  { id: "tasks", label: "task centre", group: "global", scope: "global", keys: "space+j", modeAfter: "normal" },
  { id: "stats", label: "stats", group: "global", scope: "global", keys: "space+t", modeAfter: "normal" },
  { id: "achievements", label: "achievements", group: "global", scope: "global", keys: "space+i", modeAfter: "normal" },
  { id: "settings", label: "settings", group: "global", scope: "global", keys: "space+,", modeAfter: "normal" },
  { id: "buffer-close", label: "close buffer", group: "global", scope: "global", keys: "space+0", modeAfter: "normal" },

  // learn — lock-in and skill sessions
  { id: "lock-in", label: "new lock-in", group: "context", scope: "learn", keys: "space+l", modeAfter: "normal" },
  { id: "goals", label: "skill sessions", group: "context", scope: "learn", keys: "space+g", modeAfter: "normal" },
  { id: "sessions", label: "lock-in sessions", group: "context", scope: "learn", keys: "space+h", modeAfter: "normal" },
  { id: "flashcards", label: "flashcards", group: "context", scope: "learn", keys: "space+k", modeAfter: "normal" },
  { id: "review", label: "review queue", group: "context", scope: "learn", keys: "space+v", modeAfter: "normal" },
  { id: "add-sources", label: "add sources", group: "context", scope: "learn", keys: "s", modeAfter: "normal" },
  { id: "session-outputs", label: "session outputs", group: "context", scope: "learn", keys: "space+o", modeAfter: "normal" },

  // work — projects, agents, chats, swarms
  { id: "work-projects", label: "work projects", group: "context", scope: "work", keys: "space+p", modeAfter: "normal" },
  { id: "work-agents", label: "work agents", group: "context", scope: "work", keys: "space+m", modeAfter: "normal" },
  { id: "work-sessions", label: "work chats", group: "context", scope: "work", keys: "space+u", modeAfter: "normal" },
  { id: "work-swarms", label: "work swarms", group: "context", scope: "work", keys: "space+x", modeAfter: "normal" },
  { id: "work-changes", label: "work changes", group: "context", scope: "work", keys: "space+d", modeAfter: "normal" },
  { id: "work-new", label: "new work project", group: "context", scope: "work", keys: "space+y", modeAfter: "normal" },
]

function bindingFromKeys(keys: string) {
  const parts = keys.split("+")
  if (parts.length === 2 && parts[0] === "space") return leader(parts[1]!)
  return direct(keys)
}

export function createDefaultActions(dispatch: Dispatcher): Action[] {
  return SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    group: spec.group,
    scope: spec.scope,
    defaultBinding: bindingFromKeys(spec.keys),
    modes: spec.modes,
    modeAfter: spec.modeAfter,
    run: (ctx) => dispatch(ctx.actionId, ctx.scope),
  }))
}

/** The product §13 command vocabulary, expressed as action ids — the same list,
 * not a parallel one. Used by WP-107's command line. */
export function commandNames(actions: readonly Action[]): string[] {
  return actions.map((action) => action.id)
}

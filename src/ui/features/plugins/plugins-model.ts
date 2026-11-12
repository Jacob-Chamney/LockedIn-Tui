/**
 * Plugin settings and policy surface — pure model.
 *
 * The host and the decision engine belong to `src/plugins/policy.ts`; this
 * module only renders the matrix, builds the config patch an enable/disable
 * would write, and states what the permission gate is asking. It never runs a
 * package manager, never spawns a process and never writes config itself.
 */
import { parseBinding, type Binding } from "../../keymap/registry"

export type ServerStatus = "connected" | "stopped" | { failed: string }

export type PluginToolRow = { name: string; write: boolean }

export type ServerRow = {
  name: string
  transport: "stdio"
  enabled: boolean
  status: ServerStatus
  tools: PluginToolRow[]
}

export type Command = "chill" | "lockin" | "flashcards" | "study-guide" | "skill"

export type Cell = "any" | "explicit" | "never" | "core"

/** One row per command, one column per server (product §11). */
export function cellFor(command: Command, server: ServerRow): Cell {
  switch (command) {
    case "chill":
      return "any"
    case "lockin":
      return "explicit"
    case "flashcards":
    case "study-guide":
      return "never"
    case "skill":
      return server.name === "web-search" ? "core" : "any"
  }
}

export function cellLabel(command: Command, server: ServerRow): string {
  const cell = cellFor(command, server)
  if (cell === "never") return "never"
  if (cell === "explicit") return server.enabled ? "explicit only" : "off"
  if (cell === "core") return "core"
  return server.enabled ? "enabled" : "off"
}

export function statusLabel(server: ServerRow): string {
  if (typeof server.status === "object") return `× failed: ${server.status.failed}`
  return server.status === "connected" ? "✓ connected" : "○ stopped"
}

export function serverLine(server: ServerRow): string {
  return `${server.enabled ? "◉" : "○"} ${server.name}  ${server.transport}  ${statusLabel(server)}  ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
}

export function toolLine(tool: PluginToolRow): string {
  return `${tool.write ? "!" : " "} ${tool.name}${tool.write ? "  write-capable" : "  read-only"}`
}

/** The flashcards row is visibly disabled with its reason, never silently ignored. */
export function lockedReason(command: Command): string | null {
  return command === "flashcards"
    ? "flashcards and study guides are built only from the session sources"
    : null
}

export type ToggleResult =
  | { kind: "write"; patch: { plugins: { servers: Record<string, { enabled: boolean }> } }; server: ServerRow }
  | { kind: "refused"; reason: string }

export function toggleServer(server: ServerRow): ToggleResult {
  return {
    kind: "write",
    patch: { plugins: { servers: { [server.name]: { enabled: !server.enabled } } } },
    server: { ...server, enabled: !server.enabled },
  }
}

export function toggleCell(command: Command, server: ServerRow): ToggleResult {
  const locked = lockedReason(command)
  if (locked) return { kind: "refused", reason: locked }
  // Turning a cell on enables the server if it is off; the matrix follows.
  if (!server.enabled) return toggleServer(server)
  return { kind: "write", patch: { plugins: { servers: { [server.name]: { enabled: true } } } }, server }
}

/** The exact config shape adding a server would write; nothing is installed. */
export function addServerPreview(name: string): string {
  return `[plugins.servers.${name}]\ncommand = "npx"\nargs = ["-y", "@scope/${name}"]\nenabled = false`
}

export function dependencyHint(name: string): string {
  return `install it yourself: npx -y @scope/${name}`
}

// ---------------------------------------------------------------- gate

export type PendingCall = { server: string; tool: string; input: unknown; write: boolean }

export type GateView = { open: boolean; call: PendingCall | null; summary: string }

export const SUMMARY_LIMIT = 200

/** A truncated, secret-free input summary; never the full payload. */
export function summarize(input: unknown): string {
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {})
  const scrubbed = text.replace(/("(?:api[_-]?key|token|secret|password)"\s*:\s*)"[^"]*"/gi, '$1"…"')
  return scrubbed.length <= SUMMARY_LIMIT ? scrubbed : `${scrubbed.slice(0, SUMMARY_LIMIT - 1)}…`
}

/** Read-only tools never open the gate (no approval needed). */
export function gateFor(call: PendingCall): GateView {
  if (!call.write) return { open: false, call: null, summary: "" }
  return { open: true, call, summary: summarize(call.input) }
}

export function gateCopy(view: GateView): string[] {
  if (!view.open || !view.call) return []
  return [
    `server ${view.call.server} · tool ${view.call.tool}`,
    `input ${view.summary}`,
    "the result is sent to the model",
    "Y run once · N refuse",
  ]
}

export type GateAnswer = { kind: "run"; once: true } | { kind: "refused"; line: string }

/**
 * Every call asks. There is no "remember for this session" and no auto-approve,
 * so the answer is derived from this call only.
 */
export function answerGate(granted: boolean): GateAnswer {
  return granted ? { kind: "run", once: true } : { kind: "refused", line: refusalLine() }
}

export function refusalLine(): string {
  return "plugin call refused"
}

/** Plugin output is labelled with the server in every surface. */
export function pluginLabel(server: string): string {
  return `external explanation · ${server}`
}

export function standingNote(): string {
  return "plugin output is still sent to the model"
}

// ---------------------------------------------------------------- keys

export type PluginsIntent = "down" | "up" | "open" | "toggle" | "disconnect" | "close"

const SPECS: Array<{ intent: PluginsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "open", key: "return", footer: "Enter connect" },
  { intent: "toggle", key: "e", footer: "e enable" },
  { intent: "disconnect", key: "c", footer: "c close" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`plugins key "${key}": ${binding.message}`)
  return binding
}

export const PLUGIN_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): PluginsIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return PLUGIN_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return PLUGIN_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

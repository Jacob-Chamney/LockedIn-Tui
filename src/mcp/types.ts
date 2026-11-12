/**
 * Plugin (MCP) contract types (`docs/product.md` §11, `docs/architecture.md`
 * §4.6/§5).
 *
 * Two rules are encoded in the types themselves:
 *
 *   - every result carries `label: "external explanation"` — plugin output is
 *     never a source (`docs/product.md` §6.3, AGENTS §2.7);
 *   - a tool is only read-only when the server says so; anything unknown is
 *     treated as write-capable and needs an approval.
 */
import type { ChatMode } from "../llm/chat"

export type { ChatMode }

/**
 * Modes that can run a plugin. Generation commands (flashcards, study guide)
 * are in the matrix but are not chat modes, so they live here rather than in
 * `src/llm/chat.ts`.
 */
export type PluginMode = ChatMode | "flashcards" | "study-guide"

export type PluginErrorKind =
  /** Policy refused the call. */
  | "denied"
  /** A write tool without an approval decision yet. */
  | "approval-required"
  | "cancelled"
  | "timeout"
  /** The server failed, crashed, or spoke something we cannot parse. */
  | "plugin"
  /** Not connected, not configured, or its command is missing. */
  | "unavailable"

export type PluginError = {
  readonly kind: PluginErrorKind
  readonly server: string
  /** One line. Never contains a prompt, a key or a tool payload. */
  readonly message: string
  /** One actionable sentence (`docs/design.md` §11). */
  readonly hint: string
}

export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: PluginError }

export type McpTool = {
  name: string
  description: string
  /** True only when the server declared `readOnlyHint: true`. */
  readOnly: boolean
  destructive: boolean
  label: "external explanation"
}

export type McpServerConfig = {
  id: string
  /** Executable to spawn. LockedIn never installs it. */
  command: string
  args: string[]
  env?: Record<string, string>
  /** Enabled in Settings → Plugins. */
  enabled?: boolean
  /** Core plugins (web search) are always available on the skill side. */
  core?: boolean
}

export type Approval = { granted: boolean }

export type CallOptions = {
  mode: PluginMode
  /** The user invoked this plugin explicitly; required in lock-in. */
  explicitCall?: boolean
  /** Present only after the user answered the permission prompt. */
  approval?: Approval
  signal?: AbortSignal
  timeoutMs?: number
}

export type PluginCallResult = {
  text: string
  isError: boolean
  ms: number
  /** Plugin output is labelled and never counted as a source. */
  label: "external explanation"
}

export type ServerState = {
  id: string
  pid: number | null
  alive: boolean
  calls: number
  /** Bounded stderr ring buffer; never surfaced in the UI except diagnostics. */
  stderr: string[]
}

export const EXTERNAL_LABEL = "external explanation" as const

export function pluginError(
  kind: PluginErrorKind,
  server: string,
  message: string,
  hint: string,
): PluginError {
  return { kind, server, message: message.split("\n")[0]!.slice(0, 200), hint }
}

/** Copy for each failure, in one place (`docs/design.md` §8). */
export function mcpErrorCopy(error: PluginError): { title: string; next: string } {
  switch (error.kind) {
    case "denied":
      return { title: error.message, next: error.hint }
    case "approval-required":
      return { title: "This plugin tool can write.", next: "Approve this one call, or reject it." }
    case "cancelled":
      return { title: "Plugin call stopped.", next: "Nothing was saved." }
    case "timeout":
      return { title: error.message, next: "The server may be stuck; restart it in Settings → Plugins." }
    case "plugin":
      return { title: error.message, next: error.hint }
    case "unavailable":
      return { title: error.message, next: error.hint }
  }
}

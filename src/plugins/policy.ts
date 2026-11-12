/**
 * Plugin policy matrix (`docs/product.md` §11).
 *
 * | Command              | Plugins                                  |
 * |----------------------|------------------------------------------|
 * | Chill                | any enabled                              |
 * | Lock-in              | only when explicitly called              |
 * | Flashcards / guides  | none                                     |
 * | Skill sessions       | web search (core) + enabled              |
 * | Work                 | enabled (workers stay read-only upstream) |
 *
 * `decidePolicy` is pure: no IO, so a policy answer can never spawn a process.
 * It also fails closed — a tool whose annotations are missing is treated as
 * write-capable and needs an approval.
 */
import type { Approval, PluginError, PluginMode, PluginResult, PluginTool } from "./types"

export type PolicyVerdict =
  | { kind: "allow" }
  | { kind: "deny"; error: PluginError }
  | { kind: "approval-required"; error: PluginError }

export type PolicyContext = {
  /** The server is enabled in Settings. */
  enabled: boolean
  /** The server is a core plugin (web search). */
  core?: boolean
  /** The configured server id, so only a real core server may bypass Settings. */
  serverId?: string
  /** The user invoked it explicitly from the command line. */
  explicitCall?: boolean
  approval?: Approval
}

function deny(message: string, hint: string): PolicyVerdict {
  return { kind: "deny", error: { kind: "denied", server: "", message, hint } }
}

function approval(message: string, hint: string): PolicyVerdict {
  return { kind: "approval-required", error: { kind: "approval-required", server: "", message, hint } }
}

/** Which core plugins a mode always has, regardless of Settings. */
export function coreServersFor(mode: PluginMode): readonly string[] {
  // Skills teach with their own intelligence and the web; Work projects may
  // research the code's ecosystem. Lock-in never gets the web by default.
  return mode === "skill" || mode === "work" ? ["web-search"] : []
}

export function decidePolicy(mode: PluginMode, tool: Pick<PluginTool, "readOnly">, context: PolicyContext): PolicyVerdict {
  if (mode === "flashcards" || mode === "study-guide") {
    return deny(
      "This output is built only from the session sources; plugins are disabled.",
      "Ask in chat or in a skill session instead.",
    )
  }

  const coreForMode =
    context.core === true &&
    context.serverId !== undefined &&
    coreServersFor(mode).includes(context.serverId)
  const allowed = context.enabled || coreForMode
  if (!allowed) {
    return deny("Plugins are disabled in Settings.", "Enable the server in Settings → Plugins.")
  }

  if (mode === "lockin" && context.explicitCall !== true) {
    return deny(
      "Lock-in only calls a plugin when you invoke it explicitly.",
      "Invoke the plugin from the chat command line.",
    )
  }

  // Write-capable tools need a decision for *this* call. No decision, no call.
  if (!tool.readOnly) {
    if (!context.approval) {
      return approval("This plugin tool can write. Approve it first.", "Press y to allow this one call, or n to reject.")
    }
    if (!context.approval.granted) {
      return deny("You rejected the plugin write.", "Nothing was sent.")
    }
  }

  return { kind: "allow" }
}

/** Convenience for callers that only need the boolean. */
export function isAllowed(mode: PluginMode, tool: Pick<PluginTool, "readOnly">, context: PolicyContext): PluginResult<true> {
  const verdict = decidePolicy(mode, tool, context)
  if (verdict.kind === "allow") return { ok: true, value: true }
  return { ok: false, error: verdict.error }
}

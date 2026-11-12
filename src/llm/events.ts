/**
 * The chat event contract (`docs/architecture.md` §4.3).
 *
 * This module is types plus the one invariant that cannot live anywhere else:
 * **exactly one terminal event per request**. Everything else in `src/llm/`
 * imports these names; no module declares a second copy.
 */

export type Usage = {
  input: number
  output: number
  /** `null` when the provider reported nothing — never `NaN`, never "free". */
  total: number | null
}

export type Attachment = {
  /** Local attachment file; the data URL is derived at send time. */
  path: string
  name: string
  mediaType: string
  sha256: string
}

export type Message = {
  role: "user" | "assistant" | "system"
  content: string
  images?: Attachment[]
  /** Display only; never part of the saved answer. */
  reasoning?: string
}

/**
 * The typed failures this layer can produce (`docs/architecture.md` §3.3).
 * `busy` is an additive extension for §7's "second send while streaming":
 * it is not in §3.3 yet and is proposed there in the WP-202 handoff.
 */
export type AppError =
  | { kind: "config"; message: string }
  | { kind: "auth"; provider: string; message: string }
  | { kind: "rate-limit"; provider: string; retryAfter?: number }
  | { kind: "network"; message: string }
  | { kind: "provider"; provider: string; status: number; message: string }
  | { kind: "cap"; cap: "tool-calls" | "tokens"; value: number }
  | { kind: "busy"; message: string }
  | { kind: "cancelled" }

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end"; detail?: string }
  | { type: "usage"; tokens: Usage }
  | {
      type: "done"
      text: string
      usage: Usage
      durationMs: number
      /** Per-step text, so callers can tell narration from the final answer. */
      steps: string[]
      /** True when the provider stopped at the output ceiling. */
      truncated?: boolean
    }
  | { type: "cancelled" }
  | { type: "error"; error: AppError }

export type TerminalKind = "done" | "cancelled" | "error"

export function isTerminal(event: ChatEvent): event is Extract<ChatEvent, { type: TerminalKind }> {
  return event.type === "done" || event.type === "cancelled" || event.type === "error"
}

/**
 * Guards the one-terminal-event rule. Every exit path in `chat.ts` goes
 * through `emit`, so a second terminal is impossible by construction rather
 * than by review.
 */
export function createTerminalGuard() {
  let emitted = false
  return {
    get closed() {
      return emitted
    },
    /** Returns false when a terminal event was already emitted. */
    claim(): boolean {
      if (emitted) return false
      emitted = true
      return true
    },
  }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total === null || b.total === null ? null : a.total + b.total,
  }
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, total: 0 }

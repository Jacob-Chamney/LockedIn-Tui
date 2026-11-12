/**
 * Chill chat view model. Pure: state in, render decisions out.
 *
 * Tool-free and read-only by construction — nothing here can call a tool, read
 * the vault or write a note (docs/product.md §3).
 */
export type Role = "user" | "assistant"

export type Attachment = { name: string; path: string; mediaType: string }

/** A paste is content, not a typed draft: the composer shows a chip, the send
 * still carries the full text. Images are labelled but not uploaded. */
export type PasteChip = {
  id: string
  kind: "text" | "image" | "ask"
  lines: number
  text?: string
  /** A short visible label for special chips, e.g. the step in an ask. */
  label?: string
}

export type Message = {
  id: string
  role: Role
  text: string
  /** Display only; never part of the saved answer. */
  reasoning?: string
  reasoningMs?: number
  thinkingExpanded?: boolean
  usage?: { input: number; output: number; total: number; costMicroUsd: number | null }
  durationMs?: number
  tools?: number
  /** Terminal state of this message; `stopped` keeps the marker, not the text. */
  outcome?: "done" | "stopped" | "failed"
  /** The provider stopped at the output ceiling. */
  truncated?: boolean
  error?: string
  attachments?: Attachment[]
}

export type ChatStatus = "idle" | "streaming" | "cancelled" | "failed" | "blocked"

/** How much the model may do: plan read-only, build with tools, learn is locked. */
export type ToolMode = "plan" | "build" | "learn"

export const TOOL_MODE_LABEL: Record<ToolMode, string> = {
  plan: "PLAN",
  build: "BUILD",
  learn: "LEARN",
}

export type ChatState = {
  /** Which response controls this surface offers; Chill offers none. */
  capabilities: import("../../llm/response-style").ChatCapabilities
  username: string
  model: string | null
  vision: boolean
  status: ChatStatus
  messages: Message[]
  /** Soft answer-length preference for this chat. */
  responseStyle: import("../../llm/response-style").ResponseStyle
  /** How the model should tutor this chat. */
  tutorPolicy: import("../../llm/response-style").TutorPolicy
  /** Live text of the message being streamed. */
  streamed: string
  composer: string
  attachments: Attachment[]
  /** Pasted blocks waiting to be sent, shown as chips in the composer. */
  pastes: PasteChip[]
  /** True when the user scrolled away from the bottom. */
  scrolledUp: boolean
  /** Selected tool mode; learning chats pin this to `learn`. */
  toolMode: ToolMode
  /** True for lock-in and skill chats: Shift+Tab is refused. */
  toolModeLocked: boolean
  /** True when this surface has tools, so plan/build is worth showing. */
  toolsAvailable: boolean
  /** How many restored messages are mounted (design §10: 12 initially). */
  mounted: number
  thinkingOpen: boolean
  blocked?: { reason: string; fix: string }
  error?: { failed: string; kept: string; next: string }
}

/**
 * Whether pasted bytes are an image.
 *
 * A two-byte prefix is not enough: "BM25 …" and "GI …" are ordinary text that
 * happens to start like BMP/GIF. An image header also contains a NUL, which a
 * text paste never does.
 */
export function isImagePaste(bytes: Uint8Array, mime = ""): boolean {
  if (mime.startsWith("image/")) return true
  const head = bytes.subarray(0, 8_192)
  if (!head.includes(0)) return false
  const has = (...prefix: number[]) => prefix.every((byte, index) => head[index] === byte)
  return (
    has(0x89, 0x50, 0x4e, 0x47) || // PNG
    has(0xff, 0xd8, 0xff) || // JPEG
    has(0x47, 0x49, 0x46, 0x38) || // GIF8
    has(0x42, 0x4d) // BMP
  )
}

export const MAX_ATTACHMENTS = 4
export const INITIAL_MOUNT = 12
export const COMPOSER_MAX_ROWS = 5

export { COST_UNKNOWN, formatCost } from "../../llm/pricing"

export const PLACEHOLDER = "Ask anything…  Enter send · Shift+Enter newline"
export const NO_MODEL_COPY = "no model configured"
export const STOP_LINE = "Esc stop"

export const initialChat = (
  username = "friend",
  model: string | null = null,
  responseStyle: import("../../llm/response-style").ResponseStyle = "normal",
  tutorPolicy: import("../../llm/response-style").TutorPolicy = "direct",
): ChatState => ({
  username,
  model,
  vision: false,
  capabilities: { responseStyle: false, tutorPolicy: false },
  status: model ? "idle" : "idle",
  messages: [],
  responseStyle,
  tutorPolicy,
  streamed: "",
  composer: "",
  attachments: [],
  pastes: [],
  scrolledUp: false,
  toolMode: "build",
  toolModeLocked: false,
  toolsAvailable: false,
  mounted: INITIAL_MOUNT,
  thinkingOpen: false,
})

/** The greeting uses the configured username (product §2.1). */
export function greeting(state: ChatState): string {
  return `${state.username}, what do you want to learn today?`
}

/** The leader is the open-box glyph, the way an editor writes it. */
export const LEADER_GLYPH = "␣"

/** The text cursor shown at the end of the composer in INSERT mode. */
export const COMPOSER_CURSOR = "▏"

export const HINTS = [
  `${LEADER_GLYPH} l new lock-in`,
  `${LEADER_GLYPH} g skill session`,
  `${LEADER_GLYPH} r reader`,
  `${LEADER_GLYPH} , settings`,
  "? all keys",
]

export function hints(_state: ChatState, options: { hidden?: boolean; collapsed?: boolean } = {}): string[] {
  if (options.hidden || options.collapsed) return []
  return HINTS.slice(0, 5)
}

export function canSend(state: ChatState): { ok: true } | { ok: false; reason: string; fix: string } {
  if (!state.model) {
    return { ok: false, reason: NO_MODEL_COPY, fix: "link a key in Settings → Providers" }
  }
  if (state.status === "blocked") {
    return { ok: false, reason: state.blocked?.reason ?? "budget", fix: state.blocked?.fix ?? "␣ ," }
  }
  if (state.status === "streaming") {
    return { ok: false, reason: "a reply is already streaming", fix: "Esc stop, then send" }
  }
  if (
    state.composer.trim() === "" &&
    state.attachments.length === 0 &&
    !state.pastes.some((paste) => paste.text)
  ) {
    return { ok: false, reason: "nothing to send", fix: "type a message" }
  }
  return { ok: true }
}

/** Enter sends; Shift+Enter and Ctrl+J insert a newline instead. */
export function composerKey(key: { name: string; shift?: boolean; ctrl?: boolean }): "send" | "newline" | "none" {
  if (key.name === "return") return key.shift ? "newline" : "send"
  if (key.name === "j" && key.ctrl) return "newline"
  return "none"
}

/** Break the draft into terminal-width chunks, keeping explicit newlines. */
function wrapComposer(text: string, width: number): string[] {
  const columns = Math.max(1, width)
  const out: string[] = []
  for (const line of text.split("\n")) {
    const characters = Array.from(line)
    if (characters.length === 0) {
      out.push("")
      continue
    }
    for (let at = 0; at < characters.length; at += columns) {
      out.push(characters.slice(at, at + columns).join(""))
    }
  }
  return out.length === 0 ? [""] : out
}

/**
 * Grows 1→5 rows, including wrapped lines, then follows the newest lines.
 * Without a width the explicit line count is used (callers that only need
 * the old shape).
 */
export function composerRows(state: ChatState, width?: number): number {
  if (width === undefined) {
    const explicit = state.composer.split("\n").length
    return Math.max(1, Math.min(COMPOSER_MAX_ROWS, explicit))
  }
  return Math.max(1, Math.min(COMPOSER_MAX_ROWS, wrapComposer(state.composer, width).length))
}

/** The visible window into the draft; the cursor is always at the end. */
export function composerText(state: ChatState, width?: number): string {
  const lines = width === undefined ? state.composer.split("\n") : wrapComposer(state.composer, width)
  return lines.slice(-COMPOSER_MAX_ROWS).join("\n")
}

/** Pasted chips sit on their own row under the typed text. */
export function pasteRows(state: ChatState): number {
  return state.pastes.length > 0 ? 1 : 0
}

export function pasteLabel(paste: PasteChip): string {
  if (paste.kind === "image") return "[img]"
  if (paste.kind === "ask") {
    const step = (paste.label ?? "").replace(/\s+/g, " ").trim()
    return step === "" ? "[Asking]" : `[Asking] ${step.slice(0, 48)}${step.length > 48 ? "…" : ""}`
  }
  return `[pasted ${paste.lines} line${paste.lines === 1 ? "" : "s"}]`
}

/** The text a paste contributes to the message; images contribute none. */
export function pastedText(state: ChatState): string {
  return state.pastes.flatMap((paste) => (paste.text ? [paste.text] : [])).join("\n")
}

export type AttachResult =
  | { ok: true; attachments: Attachment[] }
  | { ok: false; reason: string }

export function attach(state: ChatState, file: Attachment): AttachResult {
  if (!state.vision) {
    return { ok: false, reason: `${file.name} needs a vision model; pick one in Settings → Models.` }
  }
  if (state.attachments.length >= MAX_ATTACHMENTS) {
    return { ok: false, reason: `Up to ${MAX_ATTACHMENTS} images per message. Remove one to add ${file.name}.` }
  }
  return { ok: true, attachments: [...state.attachments, file] }
}

export function clearAttachments(state: ChatState): ChatState {
  return { ...state, attachments: [] }
}

export function chipLabel(file: Attachment): string {
  return `[${file.name} ×]`
}

// ---------------------------------------------------------------- transcript

/** 12 mounted initially; older messages wait behind `press e to load`. */
export function mountedMessages(state: ChatState): Message[] {
  return state.messages.slice(Math.max(0, state.messages.length - state.mounted))
}

export function hiddenCount(state: ChatState): number {
  return Math.max(0, state.messages.length - state.mounted)
}

export function loadMore(state: ChatState, extra = INITIAL_MOUNT): ChatState {
  return { ...state, mounted: Math.min(state.messages.length, state.mounted + extra) }
}

/** Esc during a reply discards the partial text and keeps only the marker. */
export function cancel(state: ChatState): ChatState {
  if (state.status !== "streaming") return state
  return { ...state, status: "cancelled", streamed: "", composer: state.composer }
}

export function stopMarker(state: ChatState): string | null {
  if (state.status !== "cancelled") return null
  return "Stopped"
}

export function streamingText(state: ChatState): string {
  return state.status === "streaming" ? state.streamed : ""
}

/** Shown in the bubble while the request is in flight and nothing has arrived. */
export const THINKING_LINE = "Thinking…"

/** True while a reply is streaming and not one character has arrived yet. */
export function waitingForModel(state: ChatState): boolean {
  return state.status === "streaming" && state.streamed === ""
}

export function stopLine(state: ChatState): string | null {
  return state.status === "streaming" ? STOP_LINE : null
}

/** Auto-scroll follows only while the user is at the bottom. */
export function followScroll(state: ChatState): boolean {
  return !state.scrolledUp
}

export function newMessagesMarker(state: ChatState): string | null {
  return state.scrolledUp && state.status === "streaming" ? "↓ new messages" : null
}

export function thinkingLine(message: Message): string | null {
  if (!message.reasoning) return null
  if (message.thinkingExpanded) return message.reasoning
  const seconds = ((message.reasoningMs ?? 0) / 1000).toFixed(1)
  return `▸ Thinking · ${seconds}s`
}


export type AppErrorLike =
  | { kind: "auth"; provider: string }
  | { kind: "rate-limit"; provider: string }
  | { kind: "network" }
  | { kind: "budget"; limit: number; period: "day" | "month" }
  | { kind: "cap"; cap: "tool-calls" | "tokens"; value: number }
  | { kind: "cancelled" }
  | { kind: string }

/** Map an AppError to one bubble: what failed, what was kept, what to do next. */
export function errorCopy(error: AppErrorLike): { failed: string; kept: string; next: string } | null {
  switch (error.kind) {
    case "auth":
      return {
        failed: `The provider rejected the key for ${"provider" in error ? error.provider : "the provider"}.`,
        kept: "Nothing was saved.",
        next: "Relink it in Settings → Providers.",
      }
    case "rate-limit":
      return {
        failed: "The provider is rate limiting.",
        kept: "Nothing was sent again and nothing was saved.",
        next: "Wait a moment, then send again.",
      }
    case "network":
      return {
        failed: "The network dropped mid-request.",
        kept: "The partial answer was discarded.",
        next: "Check the connection, then send again.",
      }
    case "budget":
      return {
        failed: "The usage budget is reached.",
        kept: "Nothing was sent.",
        next: "Raise the limit in Settings → Usage, or press the override key.",
      }
    case "cap":
      return {
        failed: "The request hit its cap.",
        kept: "The partial answer was discarded.",
        next: "Raise the cap in Settings → Models.",
      }
    case "cancelled":
      return null
    default:
      return {
        failed: "The request failed.",
        kept: "Nothing was saved.",
        next: "Try again, or check Settings → Providers.",
      }
  }
}

/**
 * Chat controller: the one place a chat request becomes UI state.
 *
 * Owns exactly one `ChatState`. The service is injected, so the UI test drives
 * a fake and never touches the network. Nothing here builds a prompt, reads a
 * database or writes a note; history is an injected port.
 */
import type { BudgetGate } from "../llm/budget";
import { estimateCostMicroUsd, priceFor } from "../llm/pricing";
import { runRecord, type RunRecord, type RunScope } from "../llm/usage";
import type { ChatMode, ChatRequest, ChatService } from "../llm/chat";
import type { ToolResolver, ToolSpec } from "../llm/tools";
import {
  DEFAULT_RESPONSE_STYLE,
  DEFAULT_TUTOR_POLICY,
  chatCapabilities,
  learningInstructions,
  type ResponseStyle,
  type TutorPolicy,
} from "../llm/response-style";
import type { ToolMode } from "../ui/chat/model";
import type { AppError, Usage } from "../llm/events";
import { cancel as cancelState, initialChat, loadMore as loadMoreState, pastedText, type Attachment, type ChatState, type Message } from "../ui/chat/model";
export type HistoryRecord = { role: "user" | "assistant"; content: string; at: string }

/** `chill.json` — text only, nothing derived, no reasoning. */
export type HistoryPort = {
  load: () => Promise<HistoryRecord[]>
  save: (records: HistoryRecord[]) => Promise<void>
}

export type ToolContext = {
  toolMode: ToolMode
  /** The user typed `:learning-web`, so a learning chat may search once. */
  webExplicit: boolean
}

export type ControllerConfig = {
  model: string | null
  maxToolCalls: number
  maxTokens: number
  chillHistoryLimit: number
  /** Default answer length for this chat. */
  responseStyle?: ResponseStyle
  /** Default tutoring policy for this chat. */
  tutorPolicy?: TutorPolicy
  /** Which surface this chat belongs to; defaults to Chill. */
  mode?: ChatMode
  /** Extra system context for this buffer, never written to the transcript. */
  context?: (context: ToolContext) => Promise<string>
  /** Scoped tools this buffer may call; empty for Chill. */
  tools?: ToolSpec[] | ((context: ToolContext) => ToolSpec[])
  /** Resolver for those tools, bound to this buffer's scope. */
  resolveTool?: ToolResolver
}

/** The only thing the controller needs from the usage store. */
export type UsagePort = { append: (run: RunRecord) => Promise<void> }

export type ControllerDeps = {
  service: ChatService
  budget: BudgetGate
  /**
   * Which side this chat belongs to. Required: a scope is never inferred from a
   * model name, a path or a heuristic (`swarm/packets/WP-136.md`).
   */
  scope: RunScope
  /** Persists one run per terminal turn. Omitted = accounting disabled. */
  usage?: UsagePort
  /** Called once if `usage.json` cannot be written; never retried. */
  onUsageError?: (message: string) => void
  history: HistoryPort
  config: () => ControllerConfig
  now?: () => Date
  /** Micro-USD already spent this period, seeded from `usage.json`. */
  spentMicroUsd?: number
  /**
   * The app-wide spend counter. Every buffer shares it; a per-controller total
   * would let each buffer spend the whole budget on its own.
   */
  spend?: { total: () => number; add: (microUsd: number) => void }
  /**
   * The configured endpoint. A loopback URL is a local, free model, so pricing
   * must see it — the model id alone cannot tell that it costs nothing.
   */
  baseUrl?: string
  /** Username for the greeting; defaults to the configured one. */
  username?: string
  vision?: boolean
}

/** What the status bar shows: tokens used, cost and the last response time. */
export type SessionUsage = {
  tokens: number
  /** Micro-USD; `null` while no priced run has completed. */
  costMicroUsd: number | null
  /** Last completed response, or `null` before the first finished turn. */
  durationMs: number | null
}

export type ChatController = {
  state: () => ChatState
  /**
   * Called after every state change. Returns an unsubscribe.
   *
   * Without this the UI could only ever render the state it read at mount: the
   * controller mutated a variable nothing tracked, so a streamed answer never
   * appeared and the status bar never left `0 tok`.
   */
  subscribe: (listener: (state: ChatState) => void) => () => void
  /** Session totals for the status bar; never a fabricated zero cost. */
  usage: () => SessionUsage
  /** Append typed text to the composer. */
  insert: (text: string) => void
  /** Clear the draft (text, pastes and attachments). */
  clearComposer: () => void
  /** `:clear`: empty the transcript and its local history. Refused mid-reply. */
  clearTranscript: () => { ok: true } | { ok: false; reason: string }
  /** Remove the last character (one code point, not one UTF-16 unit). */
  backspace: () => void
  /** Insert a newline instead of sending (Shift+Enter / Ctrl+J). */
  newline: () => void
  /** Attach a pasted block as a chip; the text is sent with the message. */
  pasteText: (text: string) => void
  /** Label a pasted image without claiming it can be uploaded. */
  pasteImage: () => void
  /** Queue an "ask about this step" chip for the composer. */
  askAboutStep: (step: string) => void
  /** Mount another page of older history. */
  loadMore: () => void
  /** Track whether the user scrolled away from the bottom. */
  setScrolledUp: (up: boolean) => void
  send: (text?: string) => Promise<SendOutcome>
  cancel: () => void
  override: () => void
  load: () => Promise<void>
  /** Re-read the live model (after Settings changes it) without dropping history. */
  syncConfig: () => void
  dispose: () => void
  /** Shift+Tab: plan ↔ build. Learning chats refuse and say why. */
  toggleToolMode: () => { ok: true; mode: ToolMode } | { ok: false; reason: string }
  /** Local chat setting: how long answers should be. */
  setResponseStyle: (style: ResponseStyle) => void
  /** Local chat setting: how the model should tutor. */
  setTutorPolicy: (policy: TutorPolicy) => void
  /** Test/diagnostic view: what the controller actually asked for. */
  requests: () => ChatRequest[]
}

export type SendOutcome =
  | { kind: "blocked"; reason: string; fix: string }
  | { kind: "no-model"; reason: string; fix: string }
  | { kind: "ignored"; reason: string; fix: string }
  | { kind: "sent"; requestId: string; outcome: "done" | "cancelled" | "error" }

const BLOCK_FIX = "␣ , to raise the limit"
const MODEL_FIX = "link a key in Settings → Providers"

/**
 * Cost for one run: an explicit `costMicroUsd` on the usage wins (a provider
 * may report it), otherwise the pricing table decides. An unknown model is
 * `null`, never 0 — 0 would claim the call was free.
 */
function costOf(model: string, usage: Usage, baseUrl?: string): number | null {
  const explicit = (usage as Usage & { costMicroUsd?: number | null }).costMicroUsd
  if (explicit !== undefined) return explicit
  const { price } = priceFor(model, baseUrl ? { baseUrl } : {})
  if (!price) return null
  return estimateCostMicroUsd(price, { input: usage.input, output: usage.output })
}

async function contextMessage(
  context: ((context: ToolContext) => Promise<string>) | undefined,
  toolContext: ToolContext,
): Promise<Array<{ role: "system"; content: string }>> {
  if (!context) return []
  const text = await context(toolContext)
  if (text.trim() === "") throw new Error("the selected sources produced no context")
  return [{ role: "system", content: text }]
}

function messageFrom(record: HistoryRecord, index: number): Message {
  return {
    id: `history-${index}`,
    role: record.role === "user" ? "user" : "assistant",
    text: record.content,
    outcome: "done",
  }
}

export function createChatController(deps: ControllerDeps): ChatController {
  const now = deps.now ?? (() => new Date())
  const started: ChatRequest[] = []
  let spentMicroUsd = deps.spentMicroUsd ?? 0
  let usageErrorReported = false

  /**
   * Append exactly one run per terminal turn, and keep the in-memory spend in
   * step with the file. A failed write is reported once and never retried: the
   * turn has already produced its answer, so it must not fail because a counter
   * could not be written.
   */
  const recordRun = async (model: string, usage: Usage | null, failed: boolean) => {
    const tokens: Usage = usage ?? { input: 0, output: 0, total: 0 }
    const costMicroUsd = costOf(model, tokens, deps.baseUrl)
    // The gate and the file see the same number, and so does the status bar.
    if (deps.spend) deps.spend.add(costMicroUsd ?? 0)
    else spentMicroUsd += costMicroUsd ?? 0
    sessionTokens += tokens.total ?? tokens.input + tokens.output
    // A null price poisons the session total, exactly as it poisons a stats
    // total: showing the sum of the priced runs would understate what was spent.
    // The budget gate can only add 0 for an unknown price; the status bar must
    // keep saying `cost unknown` rather than print a number that omits it.
    if (costMicroUsd === null) sessionCostMicroUsd = null
    else sessionCostMicroUsd = (sessionCostMicroUsd ?? 0) + costMicroUsd
    // The turn's own emit happened before the counters were known; tell the
    // status bar now, or it would read `0 tok` after a real turn.
    emit(state)
    if (!deps.usage) return
    try {
      await deps.usage.append(
        runRecord({
          model,
          usage: tokens,
          costMicroUsd,
          scope: deps.scope,
          failed,
          at: now(),
        }),
      )
    } catch (err) {
      if (!usageErrorReported) {
        usageErrorReported = true
        deps.onUsageError?.(
          `Could not save usage counters: ${String(err instanceof Error ? err.message : err).slice(0, 120)}. The answer is unaffected.`,
        )
      }
    }
  }
  let sequence = 0
  let pasteSequence = 0
  let active: string | null = null
  let disposed = false
  const cancelledBeforeSend = new Set<string>()

  const initialConfig = deps.config()
  const capabilities = chatCapabilities(initialConfig.mode)
  const learningLocked = initialConfig.mode === "lockin" || initialConfig.mode === "skill"
  let state: ChatState = {
    ...initialChat(
      deps.username ?? "friend",
      initialConfig.model,
      initialConfig.responseStyle ?? DEFAULT_RESPONSE_STYLE,
      initialConfig.tutorPolicy ?? DEFAULT_TUTOR_POLICY,
    ),
    capabilities,
    vision: deps.vision ?? false,
    toolMode: learningLocked ? "learn" : "build",
    toolModeLocked: learningLocked,
    toolsAvailable: initialConfig.mode !== undefined && initialConfig.mode !== "chill",
  }

  let sessionTokens = 0
  let sessionCostMicroUsd: number | null = null
  let sessionDurationMs: number | null = null
  const listeners = new Set<(state: ChatState) => void>()

  const emit = (next: ChatState) => {
    state = next
    for (const listener of listeners) listener(state)
  }

  async function persist(): Promise<void> {
    if (disposed) return
    const limit = deps.config().chillHistoryLimit
    if (limit <= 0) {
      await deps.history.save([])
      return
    }
    const records: HistoryRecord[] = state.messages
      .filter((message) => message.outcome === "done")
      .map((message) => ({ role: message.role, content: message.text, at: now().toISOString() }))
    // Text only: reasoning, usage and attachments never reach the file.
    await deps.history.save(records.slice(Math.max(0, records.length - limit)))
  }

  async function send(text?: string): Promise<SendOutcome> {
    const config = deps.config()
    let body = text ?? [state.composer.trim(), pastedText(state)].filter(Boolean).join("\n")
    // Capture the mode at send time: a Shift+Tab while context loads must not
    // change the tools of the request the user already started.
    const toolMode = state.toolMode
    // Only a lock-in chat treats this as a command; elsewhere (including a
    // skill chat, which already has the web) it is ordinary text and must not
    // vanish from the transcript.
    const learningWeb =
      config.mode === "lockin" ? /^\s*:learning-web\b\s*/i.exec(body) : null
    const webExplicit = learningWeb !== null
    if (learningWeb) body = body.slice(learningWeb[0].length)
    const toolContext: ToolContext = { toolMode, webExplicit }
    // The renderer already says "send disabled" for these; guard here too so a
    // key path can never start an empty or overlapping request.
    if (state.status === "streaming") {
      return { kind: "ignored", reason: "a reply is already streaming", fix: "Esc stops it first" }
    }
    if (body.trim() === "" && state.attachments.length === 0) {
      return { kind: "ignored", reason: "nothing to send", fix: "type a message or paste something" }
    }
    if (!config.model) {
      emit({ ...state, status: "idle", blocked: { reason: "no model configured", fix: MODEL_FIX } })
      return { kind: "no-model", reason: "no model configured", fix: MODEL_FIX }
    }
    // Narrowed once: the guard above proves a model is set.
    const modelId: string = config.model

    // Budget gate first: a blocked budget starts no request at all.
    const gate = deps.budget.check(deps.spend ? deps.spend.total() : spentMicroUsd)
    if (gate.block) {
      const limit = gate.block.limit
      emit({
        ...state,
        status: "blocked",
        blocked: {
          reason: `${gate.block.period} budget reached ($${(limit / 1_000_000).toFixed(2)})`,
          fix: BLOCK_FIX,
        },
      })
      return { kind: "blocked", reason: state.blocked!.reason, fix: BLOCK_FIX }
    }

    const requestId = `chat-${++sequence}`
    active = requestId
    const assistantId = `${requestId}-reply`
    const history: Message[] = [
      { id: `${requestId}-user`, role: "user", text: body, outcome: "done" },
      { id: assistantId, role: "assistant", text: "", outcome: undefined },
    ]
    // Keep the exact draft so a failed or stopped turn can put it back.
    const draft = { composer: state.composer, pastes: [...state.pastes] }
    sessionDurationMs = null
    emit({
      ...state,
      status: "streaming",
      streamed: "",
      composer: "",
      pastes: [],
      scrolledUp: false,
      blocked: undefined,
      error: undefined,
      messages: [...state.messages, ...history],
    })

    const update = (patch: (message: Message) => Message) => {
      emit({
        ...state,
        messages: state.messages.map((message) => (message.id === assistantId ? patch(message) : message)),
      })
    }

    /** Put the draft back only when the user has not started a new one. */
    const restoreDraft = () => {
      if (state.composer !== "" || state.pastes.length > 0) return {}
      return { composer: draft.composer, pastes: draft.pastes }
    }

    let contextual: Array<{ role: "system"; content: string }>
    try {
      contextual = await contextMessage(config.context, toolContext)
      const instructions = learningInstructions(state.responseStyle, state.tutorPolicy, capabilities)
      if (instructions !== "") contextual.push({ role: "system", content: instructions })
    } catch {
      const mapped = {
        failed: "The selected sources could not be read.",
        kept: "Nothing was sent and nothing was saved.",
        next: "Restore or re-add the session's sources, then send again.",
      }
      update((message) => ({ ...message, text: "", outcome: "failed", error: mapped.failed }))
      emit({ ...state, status: "failed", streamed: "", error: mapped, ...restoreDraft() })
      if (active === requestId) active = null
      return { kind: "sent", requestId, outcome: "error" }
    }

    const requestMessages: import("../llm/events").Message[] = [
      ...contextual,
      ...state.messages
        .filter((message) => message.text.length > 0)
        .map((message) => ({ role: message.role, content: message.text })),
    ]
    const allTools =
      typeof config.tools === "function"
        ? config.tools(toolContext)
        : config.tools ?? []
    const requestTools = allTools.filter((spec) => {
      if (toolMode === "plan" || toolMode === "learn") {
        if (spec.write || spec.command) return false
      }
      // Lock-in is source-bound. Skills are allowed the web by default while
      // still refusing writes and commands in their locked learning mode.
      if (toolMode === "learn" && config.mode === "lockin" && !webExplicit) {
        if (spec.web === true || /(^|[_-])web([_-]|$)/i.test(spec.name)) return false
      }
      return true
    })
    const request: ChatRequest = {
      requestId,
      mode: config.mode ?? "chill",
      messages: requestMessages,
      model: config.model,
      tools: requestTools,
      ...(config.resolveTool === undefined
        ? {}
        : {
            resolveTool: (name: string, input: Record<string, unknown>) =>
              config.resolveTool!(name, input, toolContext),
          }),
      images: state.attachments.map(
        (image: Attachment) => ({ path: image.path, name: image.name, mediaType: image.mediaType, sha256: "" }),
      ),
      caps: { maxToolCalls: config.maxToolCalls, maxTokens: config.maxTokens },
    }
    started.push(request)
    if (disposed || cancelledBeforeSend.delete(requestId)) {
      if (active === requestId) active = null
      return { kind: "sent", requestId, outcome: "cancelled" }
    }

    let streamed = ""
    let reasoning = ""
    let usage: Usage | undefined
    let terminal: "done" | "cancelled" | "error" = "error"
    let settled = false

    try {
      for await (const event of deps.service.send(request)) {
        if (disposed) {
          settled = true
          terminal = "cancelled"
          break
        }
        switch (event.type) {
          case "text":
            streamed += event.delta
            emit({ ...state, streamed })
            break
          case "reasoning":
            reasoning += event.delta
            break
          case "usage":
            usage = event.tokens
            break
          case "done":
            settled = true
            terminal = "done"
            usage = event.usage ?? usage
            update((message) => ({
              ...message,
              text: event.text || streamed,
              reasoning: reasoning || undefined,
              reasoningMs: event.durationMs,
              durationMs: event.durationMs,
              truncated: event.truncated === true,
              usage: usage
                ? {
                    input: usage.input,
                    output: usage.output,
                    total: usage.total ?? usage.input + usage.output,
                    costMicroUsd: costOf(modelId, usage, deps.baseUrl),
                  }
                : undefined,
              outcome: "done",
            }))
            emit({ ...state, status: "idle", streamed: "", attachments: [], model: config.model })
            sessionDurationMs = event.durationMs ?? null
            await recordRun(modelId, usage ?? null, false)
            // A history write failure must not turn a delivered answer into a
            // failed turn, and must not leave `active` set for the next stream.
            try {
              await persist()
            } catch (error) {
              deps.onUsageError?.(
                `Could not save the chat history: ${String(error instanceof Error ? error.message : error).slice(0, 120)}. The answer is unaffected.`,
              )
            }
            break
          case "cancelled":
            settled = true
            terminal = "cancelled"
            // Partial text is discarded, never committed to history.
            update((message) => ({ ...message, text: "", outcome: "stopped" }))
            emit({ ...state, status: "cancelled", streamed: "", ...restoreDraft() })
            break
          case "error": {
            settled = true
            terminal = "error"
            const mapped = mapError(event.error)
            update((message) => ({ ...message, text: "", outcome: "failed", error: mapped.failed }))
            emit({ ...state, status: "failed", streamed: "", error: mapped, ...restoreDraft() })
            // A failed call still spent tokens; it is recorded once, with no
            // retry of the request itself.
            await recordRun(modelId, usage ?? null, true)
            break
          }
          default:
            break
        }
        if (settled) break
      }

      if (!settled) {
        // The service ended without a terminal event. Recover instead of
        // leaving the composer blocked on "a reply is already streaming".
        terminal = "error"
        const mapped = {
          failed: "The reply ended without a result.",
          kept: "The partial answer was discarded.",
          next: "Send again, or check Settings → Providers.",
        }
        update((message) => ({ ...message, text: "", outcome: "failed", error: mapped.failed }))
        emit({ ...state, status: "failed", streamed: "", error: mapped, ...restoreDraft() })
        await recordRun(modelId, usage ?? null, true)
      }
    } catch (error) {
      terminal = "error"
      const mapped = mapError({
        kind: "provider",
        provider: config.mode ?? "chat",
        status: 0,
        message: error instanceof Error ? error.message : String(error),
      })
      update((message) => ({ ...message, text: "", outcome: "failed", error: mapped.failed }))
      emit({ ...state, status: "failed", streamed: "", error: mapped, ...restoreDraft() })
      await recordRun(modelId, usage ?? null, true)
    } finally {
      // A new turn may already own `active`; only the owner may clear it.
      if (active === requestId) active = null
    }

    return { kind: "sent", requestId, outcome: terminal }
  }

  /**
   * Composer editing.
   *
   * The pane is presentational, so the controller is the only thing that can
   * hold a draft: a key press has to land here or the app cannot be typed into.
   */
  function insert(text: string): void {
    if (state.status === "streaming") return
    emit({ ...state, composer: state.composer + text })
  }

  function clearComposer(): void {
    emit({ ...state, composer: "", pastes: [], attachments: [] })
  }

  /**
   * `:clear` (product §3.1). A streaming reply owns the turn, so it cannot be
   * cleared from under the stream; cancelling is the explicit path.
   */
  function clearTranscript(): { ok: true } | { ok: false; reason: string } {
    if (state.status === "streaming") {
      return { ok: false, reason: "a reply is streaming · Esc stops it first" }
    }
    emit({
      ...state,
      messages: [],
      streamed: "",
      scrolledUp: false,
      mounted: state.mounted,
      error: undefined,
      status: state.model ? "idle" : "idle",
    })
    void persist()
    return { ok: true }
  }

  function backspace(): void {
    if (state.status === "streaming") return
    if (state.composer === "") {
      if (state.pastes.length > 0) {
        emit({ ...state, pastes: state.pastes.slice(0, -1) })
        return
      }
      if (state.attachments.length > 0) {
        emit({ ...state, attachments: state.attachments.slice(0, -1) })
        return
      }
      return
    }
    const characters = Array.from(state.composer)
    characters.pop()
    emit({ ...state, composer: characters.join("") })
  }

  function newline(): void {
    if (state.status === "streaming") return
    emit({ ...state, composer: `${state.composer}\n` })
  }

  function pasteText(text: string): void {
    if (state.status === "streaming") return
    emit({
      ...state,
      pastes: [...state.pastes, { id: `paste-${++pasteSequence}`, kind: "text", lines: text.split("\n").length, text }],
    })
  }

  function pasteImage(): void {
    if (state.status === "streaming") return
    emit({ ...state, pastes: [...state.pastes, { id: `paste-${++pasteSequence}`, kind: "image", lines: 0 }] })
  }

  function askAboutStep(step: string): void {
    if (state.status === "streaming") return
    const text = step.replace(/\s+/g, " ").trim()
    if (text === "") return
    emit({
      ...state,
      pastes: [
        ...state.pastes,
        {
          id: `paste-${++pasteSequence}`,
          kind: "ask",
          lines: 1,
          text: `Ask about this step: "${text}"`,
          label: text,
        },
      ],
    })
  }

  function loadMore(): void {
    emit(loadMoreState(state))
  }

  function setScrolledUp(up: boolean): void {
    if (state.scrolledUp === up) return
    emit({ ...state, scrolledUp: up })
  }

  function cancel(): void {
    if (active) {
      cancelledBeforeSend.add(active)
      deps.service.cancel(active)
    }
    emit(cancelState(state))
    emit({
      ...state,
      messages: state.messages.map((message) =>
        message.outcome === undefined && message.role === "assistant"
          ? { ...message, outcome: "stopped", text: "" }
          : message,
      ),
    })
  }

  function override(): void {
    deps.budget.overrideOnce()
    emit({ ...state, status: "idle", blocked: undefined })
  }

  async function load(): Promise<void> {
    let records: HistoryRecord[]
    try {
      records = await deps.history.load()
    } catch {
      // Do not present an unreadable transcript as empty; a later save would
      // otherwise overwrite the real file with only the turns in memory.
      emit({
        ...state,
        error: {
          failed: "This chat's history could not be read.",
          kept: "Nothing was overwritten.",
          next: "Check the file's permissions, then reopen the buffer.",
        },
      })
      return
    }
    // A load that finishes after the user has started a turn must not erase
    // that turn; history is loaded before the first send in normal use.
    if (state.messages.length > 0 || state.status === "streaming") return
    const limit = deps.config().chillHistoryLimit
    const kept = limit <= 0 ? [] : records.slice(Math.max(0, records.length - limit))
    emit({ ...state, messages: kept.map(messageFrom) })
  }

  function syncConfig(): void {
    const config = deps.config()
    const model = config.model
    const responseStyle = config.responseStyle ?? DEFAULT_RESPONSE_STYLE
    const tutorPolicy = config.tutorPolicy ?? DEFAULT_TUTOR_POLICY
    if (
      state.model === model &&
      state.responseStyle === responseStyle &&
      state.tutorPolicy === tutorPolicy
    ) {
      return
    }
    emit({ ...state, model, responseStyle, tutorPolicy })
  }

  function dispose(): void {
    disposed = true
    if (active) deps.service.cancel(active)
    active = null
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    usage: () => ({ tokens: sessionTokens, costMicroUsd: sessionCostMicroUsd, durationMs: sessionDurationMs }),
    insert,
    clearComposer,
    clearTranscript,
    backspace,
    newline,
    pasteText,
    pasteImage,
    askAboutStep,
    loadMore,
    setScrolledUp,
    send,
    cancel,
    override,
    load,
    syncConfig,
    dispose,
    toggleToolMode: () => {
      if (!state.toolsAvailable) {
        return { ok: false, reason: "this chat has no tools, so plan/build does not apply" }
      }
      if (state.toolModeLocked) {
        return { ok: false, reason: "learning mode is locked in this chat" }
      }
      const mode: ToolMode = state.toolMode === "plan" ? "build" : "plan"
      emit({ ...state, toolMode: mode })
      return { ok: true, mode }
    },
    setResponseStyle: (style) => emit({ ...state, responseStyle: style }),
    setTutorPolicy: (policy) => emit({ ...state, tutorPolicy: policy }),
    requests: () => [...started],
  }
}

/** One mapping from AppError to the bubble the chat shows. */
export function mapError(error: AppError): { failed: string; kept: string; next: string } {
  switch (error.kind) {
    case "auth":
      return {
        failed: `The provider rejected the key for ${error.provider}.`,
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
    case "busy":
      return {
        failed: "A reply is already streaming.",
        kept: "Nothing else was sent.",
        next: "Press Esc to stop it, then send again.",
      }
    case "provider":
      return {
        failed: error.message || `The provider returned ${error.status}.`,
        kept: "Nothing was saved.",
        next:
          error.status === 429
            ? "The provider is busy; wait a few seconds, send again, or pick another model in Settings → Models."
            : "Check the model and provider in Settings → Models.",
      }
    case "config":
      return {
        failed: error.message || "The provider configuration is incomplete.",
        kept: "Nothing was sent.",
        next: "Open Settings → Models and fix the provider or model.",
      }
    case "cap":
      return {
        failed: `The ${error.cap === "tokens" ? "token" : "tool-call"} limit (${error.value}) was reached.`,
        kept: "The partial answer was discarded.",
        next: "Raise the cap in Settings or start a shorter turn.",
      }
    case "cancelled":
      return { failed: "Stopped.", kept: "The partial answer was discarded.", next: "Send again when ready." }
    default:
      return {
        failed: "The request failed.",
        kept: "Nothing was saved.",
        next: "Try again, or check Settings → Providers.",
      }
  }
}

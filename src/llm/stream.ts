/**
 * One streaming step: AI SDK → `ChatEvent`.
 *
 * The S5 spike is the behavioural reference; this is the production shape.
 * Three overrides are mandatory and are asserted by the integration test:
 *
 *   1. `maxRetries: 0` — the SDK default of 2 would silently break the
 *      no-retry rule (S5 surprise 1);
 *   2. an `onError` hook — otherwise the SDK writes the request body, i.e. the
 *      prompt, to stderr (S5 surprise 2);
 *   3. reasoning deltas come straight from `delta.reasoning_content`; no
 *      middleware shim (S5 surprise 3).
 */
import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai"
import { ZERO_USAGE, type AppError, type ChatEvent, type Usage } from "./events"

/**
 * A terminal UI owns stderr. The SDK prints warnings there, and without the
 * `onError` hook it also prints the request body (the prompt) — the S5 finding
 * that `docs/architecture.md` §9 forbids. Silence the SDK's warning channel
 * once, here, so no caller has to remember.
 */
;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

export type StepState = {
  text: string
  usage: Usage
  toolCalls: { id: string; name: string; input: unknown }[]
  failure: AppError | null
  aborted: boolean
  finishReason: string | null
}

export function newStepState(): StepState {
  return { text: "", usage: ZERO_USAGE, toolCalls: [], failure: null, aborted: false, finishReason: null }
}

/** Provider id used in error copy when nothing better is known. */
export type StepInput = {
  model: LanguageModel
  providerId: string
  messages: ModelMessage[]
  /** System/context text, kept out of the message list. */
  instructions?: string
  tools?: ToolSet | undefined
  signal: AbortSignal
  /** Hard provider output ceiling for this step. */
  maxOutputTokens?: number
}

/**
 * Stream one assistant step. Yields text/reasoning/tool deltas and returns a
 * populated `StepState` (via the object passed in) for the caller's loop.
 */
export async function* streamStep(input: StepInput, state: StepState): AsyncGenerator<ChatEvent> {
  const result = streamText({
    model: input.model,
    messages: input.messages,
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.tools ? { tools: input.tools } : {}),
    maxRetries: 0,
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    abortSignal: input.signal,
    // Keep the prompt out of stderr (docs/architecture.md §9).
    onError: () => {},
  })

  try {
    for await (const part of result.fullStream) {
      if (input.signal.aborted) {
        state.aborted = true
        break
      }
      switch (part.type) {
        case "text-delta":
          state.text += part.text
          yield { type: "text", delta: part.text }
          break
        case "reasoning-delta":
          yield { type: "reasoning", delta: part.text }
          break
        case "tool-call":
          state.toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input })
          break
        case "error":
          state.failure = mapProviderError(input.providerId, part.error)
          break
        case "abort":
          state.aborted = true
          break
        default:
          // start/finish/*-step parts are internal and never surfaced.
          break
      }
      if (state.failure || state.aborted) break
    }

    // A failed call still spent what arrived. Ask for usage on every
    // non-aborted stream; a provider that cannot report it leaves zeros.
    if (!state.aborted) {
      try {
        const usage = await result.usage
        state.usage = {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          // Missing usage is "unknown", never "free" and never NaN.
          total: usage.totalTokens ?? null,
        }
      } catch {
        // No usage is unknown, not zero-cost; the caller handles null pricing.
      }
      try {
        state.finishReason = await result.finishReason
      } catch {
        state.finishReason = null
      }
    }
  } catch (err) {
    if (input.signal.aborted || (err as Error)?.name === "AbortError") {
      state.aborted = true
    } else {
      state.failure = mapProviderError(input.providerId, err)
    }
  }
}

/**
 * One mapping from a provider failure to a typed error. The provider body is
 * never passed through: fixed copy, at most one sanitised line.
 */
export function mapProviderError(providerId: string, err: unknown): AppError {
  const e = err as { statusCode?: number; responseBody?: string; message?: string; name?: string; cause?: unknown }
  const status = e?.statusCode
  const body = (e?.responseBody ?? "").slice(0, 200)
  const message = (e?.message ?? String(err)).split("\n")[0]!.slice(0, 200)

  if (status === 401 || status === 403 || /invalid.?api.?key|incorrect api key|unauthor/i.test(body + message)) {
    return { kind: "auth", provider: providerId, message: "The provider rejected the key." }
  }
  if (status === 429 || /rate.?limit/i.test(body + message)) {
    // OpenCode's gateway returns 429 for an overloaded upstream as well as for
    // a real per-key limit. Say which one happened; the retry advice differs.
    if (/overload/i.test(body + message)) {
      return { kind: "provider", provider: providerId, status: 429, message: "The provider is overloaded upstream." }
    }
    return { kind: "rate-limit", provider: providerId }
  }
  const cause = String((e?.cause as Error)?.message ?? "")
  if (!status && /fetch failed|ECONNREFUSED|ENOTFOUND|socket|network|terminated|other side closed/i.test(`${message} ${cause}`)) {
    return { kind: "network", message: "Could not reach the provider." }
  }
  if (typeof status === "number") {
    return { kind: "provider", provider: providerId, status, message }
  }
  return { kind: "provider", provider: providerId, status: 0, message }
}

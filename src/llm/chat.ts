/**
 * `ChatService` — the only entry point for talking to a model
 * (`docs/architecture.md` §4.3).
 *
 * Guarantees, each covered by `tests/integration/chat-stream.test.ts`:
 *
 *   - exactly one terminal event (`done` | `cancelled` | `error`), enforced by
 *     a guard rather than by review;
 *   - no retry anywhere: one request per step, `maxRetries: 0` in the wrapper;
 *   - no fallback model: the request's model is the only model ever used;
 *   - cancellation is checked at every delta and between tool steps;
 *   - cancelled and failed runs never call the caller's `commit` hook;
 *   - the tool loop is bounded by `maxToolCalls` and `maxTokens`, both typed
 *     `cap` errors;
 *   - a second `send()` for the same context while streaming is rejected.
 *
 * The service writes nothing. Persistence is the caller's job after `done`.
 */
import type { LanguageModel, ModelMessage } from "ai"
import { addUsage, createTerminalGuard, ZERO_USAGE, type AppError, type Attachment, type ChatEvent, type Message, type Usage } from "./events"
import { executeTool, toSdkTools, type ToolResolver, type ToolSpec } from "./tools"
import { newStepState, streamStep } from "./stream"

export type ChatMode = "chill" | "lockin" | "skill" | "work"

export type ChatRequest = {
  requestId: string
  /** Concurrency scope; defaults to the mode. One active request per context. */
  context?: string
  mode: ChatMode
  messages: Message[]
  /** Provider-qualified model id, e.g. `openai/gpt-4.1-mini`. */
  model: string
  /** Empty for chill. The service never adds tools on its own. */
  tools?: ToolSpec[]
  /** Per-request resolver; a work buffer brings its own project scope. */
  resolveTool?: ToolResolver
  images?: Attachment[]
  caps: { maxToolCalls: number; maxTokens: number; maxOutputTokens?: number }
}

/** Default hard ceiling for one provider generation. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export type ChatHooks = {
  /** Called once, only after `done`. Never on cancel or error. */
  commit?: (text: string, usage: Usage, steps: string[]) => void
}

export type ChatServiceDeps = {
  /** Maps the request's model id to an SDK model. Never called twice. */
  resolveModel: (modelId: string) => LanguageModel
  providerId: string
  /** Scoped resolver for the tools this request declared. */
  resolveTool?: ToolResolver
  /** Default per-request budget for the loop. */
  maxSteps?: number
}

export type ChatService = {
  send(request: ChatRequest, hooks?: ChatHooks): AsyncGenerator<ChatEvent>
  cancel(requestId: string): void
  /** Requests currently streaming, for the task centre. */
  active(): string[]
}

export const MAX_IMAGES = 4

/** Images are only sent to a model that can read them. */
export function visionError(model: { supportsVision: boolean }, images: readonly Attachment[]): AppError | null {
  if (images.length === 0) return null
  if (images.length > MAX_IMAGES) {
    return { kind: "config", message: `Attach at most ${MAX_IMAGES} images.` }
  }
  if (!model.supportsVision) {
    return { kind: "config", message: "This model cannot read images. Pick a vision model or remove the images." }
  }
  return null
}

/** Derive the data URL at send time; it is never stored. */
export async function attachmentToDataUrl(attachment: Attachment): Promise<string> {
  const bytes = await Bun.file(attachment.path).arrayBuffer()
  return `data:${attachment.mediaType};base64,${Buffer.from(bytes).toString("base64")}`
}

async function toModelMessages(messages: readonly Message[]): Promise<ModelMessage[]> {
  const out: ModelMessage[] = []
  for (const message of messages) {
    if (message.role === "user" && message.images && message.images.length > 0) {
      const content: ({ type: "text"; text: string } | { type: "file"; data: string; mediaType: string })[] = [
        { type: "text", text: message.content },
      ]
      for (const image of message.images.slice(0, MAX_IMAGES)) {
        // `file` + mediaType is the current part shape; `image` is deprecated.
        content.push({ type: "file", data: await attachmentToDataUrl(image), mediaType: image.mediaType })
      }
      out.push({ role: "user", content })
    } else {
      out.push({ role: message.role, content: message.content })
    }
  }
  return out
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const controllers = new Map<string, AbortController>()
  const contexts = new Map<string, string>()

  return {
    active: () => [...controllers.keys()],

    cancel(requestId: string) {
      controllers.get(requestId)?.abort()
    },

    async *send(request: ChatRequest, hooks: ChatHooks = {}): AsyncGenerator<ChatEvent> {
      const context = request.context ?? request.mode
      const guard = createTerminalGuard()
      const started = Date.now()

      // One active request per context (docs/architecture.md §7).
      const busy = [...contexts.values()].includes(context)
      if (busy) {
        yield {
          type: "error",
          error: {
            kind: "busy",
            message: "A reply is already streaming in this view. Stop it first.",
          },
        }
        return
      }

      const controller = new AbortController()
      const key = request.requestId
      controllers.set(key, controller)
      contexts.set(key, context)
      const signal = controller.signal

      try {
        // Chill is tool-free by construction: the service never adds tools.
        if (request.mode === "chill" && request.tools && request.tools.length > 0) {
          yield {
            type: "error",
            error: { kind: "config", message: "Chill is tool-free; no tools were sent." },
          }
          return
        }

        // The AI SDK keeps system instructions separate from the message list:
        // a system message in `messages` is rejected before the provider sees
        // it. Join any system context into one `instructions` string.
        const instructions = request.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .filter((content) => content.trim() !== "")
          .join("\n\n")
        const messages = await toModelMessages(request.messages.filter((message) => message.role !== "system"))
        const specs = request.tools ?? []
        const resolver: ToolResolver =
          request.resolveTool ??
          deps.resolveTool ??
          (async (name) => `no resolver for ${name}`)

        let model: LanguageModel
        try {
          model = deps.resolveModel(request.model)
        } catch (err) {
          yield { type: "error", error: { kind: "provider", provider: deps.providerId, status: 0, message: String(err).slice(0, 200) } }
          return
        }

        let usage: Usage = ZERO_USAGE
        let text = ""
        const steps: string[] = []
        let toolCalls = 0
        const maxSteps = deps.maxSteps ?? 12

        for (let stepIndex = 0; ; stepIndex++) {
          if (signal.aborted) {
            if (guard.claim()) yield { type: "cancelled" }
            return
          }
          if (stepIndex >= maxSteps) {
            if (guard.claim()) {
              yield { type: "error", error: { kind: "cap", cap: "tool-calls", value: request.caps.maxToolCalls } }
            }
            return
          }

          const state = newStepState()
          const sdkTools = specs.length > 0 ? toSdkTools(specs, resolver) : undefined

          for await (const event of streamStep(
            {
              model,
              providerId: deps.providerId,
              messages,
              ...(instructions === "" ? {} : { instructions }),
              tools: sdkTools,
              signal,
              maxOutputTokens: request.caps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            },
            state,
          )) {
            if (guard.closed) return
            yield event
            if (signal.aborted) break
          }

          // Cancellation wins over everything: discard partial output.
          if (state.aborted || signal.aborted) {
            if (guard.claim()) yield { type: "cancelled" }
            return
          }

          if (state.failure) {
            if (state.usage.total !== 0) {
              usage = addUsage(usage, state.usage)
              yield { type: "usage", tokens: state.usage }
            }
            if (guard.claim()) yield { type: "error", error: state.failure }
            return
          }

          text += state.text
          steps.push(state.text)
          usage = addUsage(usage, state.usage)
          yield { type: "usage", tokens: state.usage }

          // A completed answer is never discarded because the input was large.
          // The provider's output ceiling bounds the generation itself.
          if (state.toolCalls.length === 0) {
            hooks.commit?.(text, usage, steps)
            if (guard.claim()) {
              yield {
                type: "done",
                text,
                usage,
                durationMs: Date.now() - started,
                steps,
                truncated: state.finishReason === "length",
              }
            }
            return
          }

          // Stop-after-overshoot guard for a tool loop, not a final answer.
          if (usage.total !== null && usage.total > request.caps.maxTokens) {
            if (guard.claim()) {
              yield { type: "error", error: { kind: "cap", cap: "tokens", value: request.caps.maxTokens } }
            }
            return
          }

          // Keep the assistant's narration in the model's own context; dropping
          // it makes the next step re-narrate or contradict itself.
          if (state.text.trim() !== "") {
            messages.push({ role: "assistant", content: [{ type: "text", text: state.text }] })
          }

          // Bounded tool loop: check the cap before executing the next call.
          for (const call of state.toolCalls) {
            if (signal.aborted) {
              if (guard.claim()) yield { type: "cancelled" }
              return
            }
            toolCalls += 1
            if (toolCalls > request.caps.maxToolCalls) {
              if (guard.claim()) {
                yield {
                  type: "error",
                  error: { kind: "cap", cap: "tool-calls", value: request.caps.maxToolCalls },
                }
              }
              return
            }

            const spec = specs.find((candidate) => candidate.name === call.name)
            const result = spec
              ? await executeTool(spec, call.input, resolver)
              : { ok: false as const, rejected: true as const, output: `rejected: unknown tool ${call.name}` }

            yield {
              type: "tool",
              name: call.name,
              status: "start",
              detail: JSON.stringify(call.input).slice(0, 200),
            }
            yield {
              type: "tool",
              name: call.name,
              status: "end",
              detail: result.ok ? result.output.slice(0, 200) : result.output,
            }

            messages.push({
              role: "assistant",
              content: [{ type: "tool-call", toolCallId: call.id, toolName: call.name, input: call.input }],
            })
            messages.push({
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: call.id,
                  toolName: call.name,
                  output: result.ok
                    ? { type: "text", value: result.output }
                    : { type: "text", value: result.output },
                },
              ],
            })
          }
        }
      } catch (err) {
        if (signal.aborted) {
          if (guard.claim()) yield { type: "cancelled" }
          return
        }
        if (guard.claim()) {
          yield {
            type: "error",
            error: { kind: "provider", provider: deps.providerId, status: 0, message: String(err).slice(0, 200) },
          }
        }
      } finally {
        controllers.delete(key)
        contexts.delete(key)
      }
    },
  }
}

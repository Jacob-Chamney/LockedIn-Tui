/**
 * ChatService integration test (WP-202).
 *
 * A local OpenAI-compatible SSE server stands in for a provider. No external
 * network, no real key.
 *
 * Every assertion here is a rule from `docs/architecture.md` §4.3/§7 and
 * `docs/product.md` §10.3, or a WP-202 acceptance box. The request log is the
 * evidence for "one request per attempt, never a retry".
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import { attachmentToDataUrl, createChatService, visionError, MAX_IMAGES } from "../../src/llm/chat"
import type { AppError, Attachment, ChatEvent } from "../../src/llm/events"
import type { ToolResolver, ToolSpec } from "../../src/llm/tools"

const ROOT = join(import.meta.dir, "..", "..")
const scripts = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "sse", "scripts.json"), "utf8")) as Record<
  string,
  {
    chunks: ({ text?: string; reasoning?: string; toolCall?: { name: string; arguments: unknown } })[]
    usage: [number, number]
    finish?: string
    repeat?: number
  }
>

type LogEntry = { model: string; tools: number; messages: unknown[]; body: Record<string, unknown> }
const log: LogEntry[] = []

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

function sseUsage(input: number, output: number): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  })}\n\n`
}

function body(script: string, runId: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const parts: string[] = [sseChunk({ role: "assistant" })]
  const entry = scripts[script]!
  const repeat = entry.repeat ?? 1
  for (let i = 0; i < repeat; i++) {
    for (const chunk of entry.chunks) {
      if (chunk.reasoning) parts.push(sseChunk({ reasoning_content: chunk.reasoning }))
      if (chunk.text) parts.push(sseChunk({ content: chunk.text }))
      if (chunk.toolCall) {
        parts.push(
          sseChunk({
            tool_calls: [
              {
                index: 0,
                // Unique per request *and* per call, like a real provider.
                id: `call_${runId}_${i}`,
                type: "function",
                function: { name: chunk.toolCall.name, arguments: JSON.stringify(chunk.toolCall.arguments) },
              },
            ],
          }),
        )
      }
    }
  }
  parts.push(sseChunk({}, entry.finish ?? "stop"))
  parts.push(sseUsage(entry.usage[0], entry.usage[1]))
  parts.push("data: [DONE]\n\n")

  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        await new Promise((r) => setTimeout(r, 1))
        controller.enqueue(enc.encode(part))
      }
      controller.close()
    },
  })
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const payload = (await req.json().catch(() => ({}))) as {
      model?: string
      tools?: unknown[]
      messages?: { role?: string; content?: unknown }[]
    }
    const model = payload.model ?? "normal"
    log.push({ model, tools: payload.tools?.length ?? 0, messages: payload.messages ?? [], body: payload })

    if (model === "auth") {
      return new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: 401 })
    }
    if (model === "rate") {
      return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429 })
    }

    let script = model
    // `tool` and `invalidInput` answer once a tool result comes back.
    // `toolLoop` keeps requesting tools so the cap can be exercised.
    if (model === "tool" || model === "invalidInput") {
      const hasToolResult = (payload.messages ?? []).some((m) => m.role === "tool")
      if (hasToolResult) script = "afterTool"
    }

    return new Response(body(script, log.length), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
})

const provider = createOpenAICompatible({
  name: "fake",
  baseURL: `http://127.0.0.1:${server.port}/v1`,
  apiKey: "spike-not-a-key",
})

const tools: ToolSpec[] = [
  {
    name: "read_note",
    description: "Read one note from the session sources",
    side: "school",
    write: false,
    command: false,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 } },
      required: ["path"],
      additionalProperties: false,
    },
  },
]

function makeService() {
  const calls: { name: string; input: unknown }[] = []
  const resolver: ToolResolver = async (name, input) => {
    calls.push({ name, input })
    return `contents of ${String((input as { path?: string }).path)}`
  }
  const service = createChatService({
    resolveModel: (id) => provider(id),
    providerId: "fake",
    resolveTool: resolver,
  })
  return { service, calls }
}

function request(model: string, over: Partial<Parameters<ReturnType<typeof createChatService>["send"]>[0]> = {}) {
  return {
    requestId: Math.random().toString(36).slice(2),
    mode: "chill" as const,
    messages: [{ role: "user" as const, content: "hi" }],
    model,
    caps: { maxToolCalls: 8, maxTokens: 16_000 },
    ...over,
  }
}

async function collect(stream: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const terminals = (events: ChatEvent[]) =>
  events.filter((e): e is Extract<ChatEvent, { type: "done" | "cancelled" | "error" }> => ["done", "cancelled", "error"].includes(e.type))

const kinds = (events: ChatEvent[]) => events.map((e) => (e.type === "error" ? `error(${e.error.kind})` : e.type))

const errorOf = (events: ChatEvent[]): AppError | null => {
  const terminal = terminals(events).at(-1)
  return terminal?.type === "error" ? terminal.error : null
}

let stderrBytes = 0
let stderrText = ""
const originalWrite = process.stderr.write.bind(process.stderr)

beforeAll(() => {
  process.stderr.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    stderrBytes += text.length
    stderrText += text
    return true
  }) as typeof process.stderr.write
})

afterAll(() => {
  process.stderr.write = originalWrite
  server.stop(true)
})

describe("streaming", () => {
  test("reasoning, text, usage, done — and nothing after done", async () => {
    const { service } = makeService()
    const before = log.length
    const events = await collect(service.send(request("normal")))

    expect(kinds(events)).toEqual(["reasoning", "reasoning", "text", "text", "usage", "done"])
    const terminal = terminals(events)
    expect(terminal).toHaveLength(1)
    expect(events.at(-1)!.type).toBe("done")
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>
    expect(done.text).toBe("Two plus two is four.")
    expect(done.usage.total).toBe(18)
    expect(done.steps).toHaveLength(1)
    expect(log.length - before).toBe(1)
  })

  test("system context is sent as instructions, not a message", async () => {
    const { service } = makeService()
    const events = await collect(
      service.send(
        request("normal", {
          messages: [
            { role: "system", content: "Use only the selected sources." },
            { role: "user", content: "hi" },
          ],
        }),
      ),
    )
    expect(events.at(-1)!.type).toBe("done")
    expect(JSON.stringify(log.at(-1)!.body)).toContain("Use only the selected sources.")
  })

  test("chill sends no tools", async () => {
    const { service } = makeService()
    await collect(service.send(request("normal", { mode: "chill" })))
    expect(log.at(-1)!.tools).toBe(0)
  })

  test("a tool round trip feeds the result back and finishes", async () => {
    const { service, calls } = makeService()
    const before = log.length
    const events = await collect(service.send(request("tool", { mode: "lockin", tools })))

    expect(terminals(events)).toHaveLength(1)
    expect(kinds(events)).toContain("tool")
    const toolEnds = events.filter((e) => e.type === "tool" && e.status === "end")
    expect(toolEnds).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(log.length - before).toBe(2)
    // The second request carries the tool result back to the model.
    expect((log.at(-1)!.messages as { role: string }[]).some((m) => m.role === "tool")).toBe(true)
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>
    expect(done.text).toContain("The note says hi.")
    // Per-step text is exposed so narration is not mistaken for the answer.
    expect(done.steps.length).toBeGreaterThan(1)
  })

  test("tool cap: exactly maxToolCalls executions, then one cap error", async () => {
    const { service, calls } = makeService()
    const events = await collect(
      service.send(request("toolLoop", { mode: "lockin", tools, caps: { maxToolCalls: 2, maxTokens: 16_000 } })),
    )
    expect(calls).toHaveLength(2)
    expect(terminals(events)).toHaveLength(1)
    const error = errorOf(events)
    expect(error?.kind).toBe("cap")
    if (error?.kind === "cap") {
      expect(error.cap).toBe("tool-calls")
      expect(error.value).toBe(2)
    }
  })

  test("a final answer over the total token cap is kept, not discarded", async () => {
    const { service } = makeService()
    let committed = 0
    const events = await collect(
      service.send(request("tokens", { caps: { maxToolCalls: 8, maxTokens: 1_000 } }), {
        commit: () => {
          committed += 1
        },
      }),
    )
    expect(errorOf(events)).toBeNull()
    const done = events.find((event): event is Extract<ChatEvent, { type: "done" }> => event.type === "done")
    expect(done?.text).toContain("Short answer")
    expect(done?.truncated).toBe(false)
    expect(committed).toBe(1)
    expect(terminals(events)).toHaveLength(1)
  })

  test("a provider length stop keeps the partial answer and marks it truncated", async () => {
    const { service } = makeService()
    let committed = 0
    const before = log.length
    const events = await collect(
      service.send(
        request("truncated", {
          caps: { maxToolCalls: 8, maxTokens: 16_000, maxOutputTokens: 123 },
        }),
        {
          commit: () => {
            committed += 1
          },
        },
      ),
    )
    const done = events.find((event): event is Extract<ChatEvent, { type: "done" }> => event.type === "done")
    expect(done?.truncated).toBe(true)
    expect(done?.text).toContain("output ceiling")
    expect(committed).toBe(1)
    expect(log[before]?.body.max_tokens).toBe(123)
  })
})

describe("failure policy", () => {
  test("401 is one auth error and one request", async () => {
    const { service } = makeService()
    const before = log.length
    const events = await collect(service.send(request("auth")))
    expect(errorOf(events)?.kind).toBe("auth")
    expect(log.length - before).toBe(1)
  })

  test("429 is one rate-limit error and one request", async () => {
    const { service } = makeService()
    const before = log.length
    const events = await collect(service.send(request("rate")))
    expect(errorOf(events)?.kind).toBe("rate-limit")
    expect(log.length - before).toBe(1)
  })
})

describe("cancellation", () => {
  test("cancel mid-text: last event is cancelled, nothing committed, no further request", async () => {
    const { service } = makeService()
    const before = log.length
    const req = request("slow")
    let committed = 0
    let textDeltas = 0
    const events: ChatEvent[] = []

    for await (const event of service.send(req, {
      commit: () => {
        committed += 1
      },
    })) {
      events.push(event)
      if (event.type === "text" && ++textDeltas === 5) service.cancel(req.requestId)
    }

    expect(events.at(-1)!.type).toBe("cancelled")
    expect(terminals(events)).toHaveLength(1)
    expect(committed).toBe(0)
    expect(log.length - before).toBe(1)
    // Partial text is dropped: there is no done event carrying it.
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  test("cancel between tool steps: no further tool and no further request", async () => {
    let service: ReturnType<typeof createChatService> | null = null
    const calls: string[] = []
    let requestId = ""
    service = createChatService({
      resolveModel: (id) => provider(id),
      providerId: "fake",
      resolveTool: async (name) => {
        calls.push(name)
        // Abort while the tool is running: the next step must not happen.
        service!.cancel(requestId)
        return "contents"
      },
    })
    requestId = "cancel-between"
    const before = log.length
    const events = await collect(
      service.send({ ...request("toolLoop", { mode: "lockin", tools }), requestId }),
    )

    expect(events.at(-1)!.type).toBe("cancelled")
    expect(calls).toHaveLength(1)
    expect(log.length - before).toBe(1)
  })
})

describe("concurrency", () => {
  test("a second send in the same context is rejected without a request", async () => {
    const { service } = makeService()
    const first = service.send(request("slow", { requestId: "one", context: "chill" }))
    const iterator = first[Symbol.asyncIterator]()
    await iterator.next() // first event: the request is now in flight
    const before = log.length

    const second = await collect(service.send(request("normal", { requestId: "two", context: "chill" })))
    expect(second).toHaveLength(1)
    expect(errorOf(second)?.kind).toBe("busy")
    expect(log.length - before).toBe(0)

    service.cancel("one")
    await iterator.return?.(undefined)
  })
})

describe("tool input validation", () => {
  test("an invalid call is not executed, is fed back, and does not throw", async () => {
    const { service, calls } = makeService()
    const events = await collect(service.send(request("invalidInput", { mode: "lockin", tools })))

    expect(calls).toHaveLength(0)
    const rejected = events.find((e) => e.type === "tool" && e.status === "end")
    expect(rejected && rejected.type === "tool" ? rejected.detail : "").toContain("rejected: invalid input")
    // The loop continues: the model gets a tool error and answers.
    expect(terminals(events)).toHaveLength(1)
    expect(events.at(-1)!.type).toBe("done")
  })
})

describe("images", () => {
  test("one image reaches the provider as a data URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sse-image-"))
    const path = join(dir, "dot.png")
    // A 1x1 PNG.
    writeFileSync(
      path,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
    const attachment: Attachment = { path, name: "dot.png", mediaType: "image/png", sha256: "spike" }
    expect(await attachmentToDataUrl(attachment)).toStartWith("data:image/png;base64,")

    const { service } = makeService()
    await collect(
      service.send(request("normal", { messages: [{ role: "user", content: "what is this?", images: [attachment] }] })),
    )
    const sent = JSON.stringify(log.at(-1)!.messages)
    expect(sent).toContain("data:image/png;base64,")
  })

  test("a non-vision model is refused by the caller, and more than four is refused", () => {
    const image: Attachment = { path: "/tmp/x.png", name: "x.png", mediaType: "image/png", sha256: "x" }
    expect(visionError({ supportsVision: false }, [image])?.kind).toBe("config")
    expect(visionError({ supportsVision: true }, Array.from({ length: MAX_IMAGES + 1 }, () => image))?.kind).toBe("config")
    expect(visionError({ supportsVision: true }, [image])).toBeNull()
  })
})

describe("stderr hygiene", () => {
  test("the SDK never writes the request body (or anything) to stderr", () => {
    // Captured across every scenario above, including the 401/429 failures and
    // the aborted stream.
    expect({ bytes: stderrBytes, text: stderrText.slice(0, 400) }).toEqual({ bytes: 0, text: "" })
  })
})

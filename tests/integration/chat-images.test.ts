/**
 * ChatService image transport (WP-202 follow-up).
 *
 * `chat.send` accepts image paths at the request level (`ChatRequest.images`)
 * while a stored user turn may carry its own `Message.images`. Both must reach
 * the provider as `file` parts holding a `data:` URL, and a text-only request
 * must stay byte-identical to what it was before.
 *
 * A local OpenAI-compatible SSE server stands in for a provider: no external
 * network, no real key. The captured request body is the evidence.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import { MAX_IMAGES, createChatService, type ChatRequest } from "../../src/llm/chat"
import type { Attachment, ChatEvent } from "../../src/llm/events"

type Part = { type?: string } & Record<string, unknown>
type CapturedMessage = { role?: string; content?: string | Part[] }
type LogEntry = { messages: CapturedMessage[]; body: Record<string, unknown> }

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

function body(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const parts = [
    sseChunk({ role: "assistant" }),
    sseChunk({ content: "Two plus two is four." }),
    sseChunk({}, "stop"),
    `data: ${JSON.stringify({
      id: "chatcmpl-fake",
      object: "chat.completion.chunk",
      created: 0,
      model: "fake",
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })}\n\n`,
    "data: [DONE]\n\n",
  ]

  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        await new Promise((resolve) => setTimeout(resolve, 1))
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
      messages?: CapturedMessage[]
    }
    log.push({ messages: payload.messages ?? [], body: payload as unknown as Record<string, unknown> })
    return new Response(body(), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
})

const provider = createOpenAICompatible({
  name: "fake",
  baseURL: `http://127.0.0.1:${server.port}/v1`,
  apiKey: "spike-not-a-key",
})

function makeService() {
  return createChatService({ resolveModel: (id) => provider(id), providerId: "fake" })
}

function request(model: string, over: Partial<ChatRequest> = {}) {
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

const dir = mkdtempSync(join(tmpdir(), "chat-images-"))
let imageCount = 0

/** A real 1x1 PNG on disk, because the data URL is derived by reading it. */
function png(): Attachment {
  const path = join(dir, `dot-${imageCount++}.png`)
  writeFileSync(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
  return { path, name: path.slice(dir.length + 1), mediaType: "image/png", sha256: "spike" }
}

/** Every `data:image/...;base64,` value in the captured messages. */
function dataUrls(messages: CapturedMessage[]): string[] {
  const found = JSON.stringify(messages).match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g)
  return found ?? []
}

function lastUser(messages: CapturedMessage[]): CapturedMessage | undefined {
  return messages.filter((message) => message.role === "user").at(-1)
}

afterAll(() => {
  server.stop(true)
})

describe("request-level images", () => {
  test("one image reaches the provider as a file/data-URL part on the last user message", async () => {
    const attachment = png()
    const events = await collect(makeService().send(request("normal", { images: [attachment] })))

    expect(events.at(-1)!.type).toBe("done")
    const messages = log.at(-1)!.messages
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1)

    const user = lastUser(messages)!
    expect(Array.isArray(user.content)).toBe(true)
    const parts = user.content as Part[]
    expect(parts[0]).toEqual({ type: "text", text: "hi" })
    // The AI SDK's `file` model part becomes an OpenAI `image_url` part whose
    // URL is the data URL derived at send time.
    const image = parts.at(-1) as { type?: string; image_url?: { url?: string } }
    expect(image.type).toBe("image_url")
    expect(image.image_url?.url).toStartWith("data:image/png;base64,")
    // Exactly one data URL for one attachment.
    expect(dataUrls(messages)).toHaveLength(1)
  })

  test("images attach to the last user turn, not the first", async () => {
    const attachment = png()
    await collect(
      makeService().send(
        request("normal", {
          messages: [
            { role: "user", content: "first" },
            { role: "assistant", content: "answer" },
            { role: "user", content: "second" },
          ],
          images: [attachment],
        }),
      ),
    )
    const messages = log.at(-1)!.messages
    const users = messages.filter((message) => message.role === "user")
    expect(users).toHaveLength(2)
    expect(users[0]!.content).toBe("first")
    const parts = users[1]!.content as Part[]
    expect(JSON.stringify(parts)).toContain("data:image/png;base64,")
  })

  test("with no user message the service appends one carrying the image", async () => {
    const attachment = png()
    await collect(
      makeService().send(
        request("normal", {
          messages: [{ role: "assistant", content: "earlier reply" }],
          images: [attachment],
        }),
      ),
    )
    const messages = log.at(-1)!.messages
    const user = lastUser(messages)
    expect(user).toBeDefined()
    expect(JSON.stringify(user!.content)).toContain("data:image/png;base64,")
  })

  test("message-level images keep working alongside request-level images", async () => {
    const stored = png()
    const fresh = png()
    await collect(
      makeService().send(
        request("normal", {
          messages: [{ role: "user", content: "what is this?", images: [stored] }],
          images: [fresh],
        }),
      ),
    )
    const messages = log.at(-1)!.messages
    expect(dataUrls(messages)).toHaveLength(2)
    // Both land on the same last user message.
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1)
  })

  test("more than MAX_IMAGES request images are capped by the service", async () => {
    const images = Array.from({ length: MAX_IMAGES + 2 }, () => png())
    const events = await collect(makeService().send(request("normal", { images })))

    expect(events.at(-1)!.type).toBe("done")
    expect(dataUrls(log.at(-1)!.messages)).toHaveLength(MAX_IMAGES)
  })
})

describe("text-only requests", () => {
  test("a request without images is unchanged", async () => {
    await collect(makeService().send(request("normal")))

    const messages = log.at(-1)!.messages
    expect(messages).toEqual([{ role: "user", content: "hi" }])
    expect(dataUrls(messages)).toHaveLength(0)
  })

  test("an empty images array is treated as no images", async () => {
    await collect(makeService().send(request("normal", { images: [] })))

    expect(log.at(-1)!.messages).toEqual([{ role: "user", content: "hi" }])
  })
})

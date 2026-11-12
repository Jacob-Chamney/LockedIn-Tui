/**
 * WP-126 — Chill chat, end to end.
 *
 * The real `App` (through its `controller` seam), the real `createChatController`
 * and the real `ChatService` against a local fake SSE server. No real provider,
 * no real key, no external network.
 *
 * Two deliberate notes on how this is asserted:
 *
 * 1. `App` renders from `controller.state()` **at mount**, so a frame is the
 *    snapshot of the conversation at that moment. Streaming transitions are
 *    asserted on the controller state and the request log — the same objects the
 *    screen reads — and the frame is asserted once the turn has settled. That is
 *    honest: asserting a mid-stream frame here would assert nothing.
 * 2. Nothing sleeps. The harness pumps the renderer's frame loop, and the
 *    cancel assertions wait on the controller's own terminal state.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { App } from "../../src/app/App";
import { createChatController, type ChatController, type HistoryRecord } from "../../src/app/chat-controller";
import { createBudgetGate } from "../../src/llm/budget";
import { createChatService } from "../../src/llm/chat";
import type { ChatRequest } from "../../src/llm/chat";
import { createMemorySecretStore } from "../contract/fakes/memory-secret-store";
import { renderApp } from "../helpers/render";
const FIXTURE = join(import.meta.dir, "..", "fixtures", "e2e", "chat", "scripts.json")

type Script = { chunks: { text?: string; reasoning?: string }[]; usage: [number, number]; finish?: string; repeat?: number }
const scripts = JSON.parse(await readFile(FIXTURE, "utf8")) as Record<string, Script>

type LogEntry = { model: string; tools: number; messages: unknown[] }
const log: LogEntry[] = []

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

function usageChunk(input: number, output: number): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  })}\n\n`
}

function streamFor(scriptName: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const entry = scripts[scriptName]!
  const parts: string[] = [chunk({ role: "assistant" })]
  for (let i = 0; i < (entry.repeat ?? 1); i++) {
    for (const piece of entry.chunks) {
      if (piece.reasoning) parts.push(chunk({ reasoning_content: piece.reasoning }))
      if (piece.text) parts.push(chunk({ content: piece.text }))
    }
  }
  parts.push(chunk({}, entry.finish ?? "stop"))
  parts.push(usageChunk(entry.usage[0], entry.usage[1]))
  parts.push("data: [DONE]\n\n")

  return new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        // Server-side pacing so a cancel can land mid-stream; the test itself
        // never sleeps.
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
      model?: string
      tools?: unknown[]
      messages?: unknown[]
    }
    const model = payload.model ?? "normal"
    log.push({ model, tools: payload.tools?.length ?? 0, messages: payload.messages ?? [] })

    if (model === "auth") {
      return new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: 401 })
    }
    if (model === "rate") {
      return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429 })
    }
    // Only the scripted names are special; any other model id streams normally.
    const script = scripts[model] ? model : "normal"
    return new Response(streamFor(script), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
})

const provider = createOpenAICompatible({
  name: "fake",
  baseURL: `http://127.0.0.1:${server.port}/v1`,
  apiKey: "e2e-not-a-key",
})

/** Stderr capture: the packet requires 0 bytes of noise. */
let stderrText = ""
const realStderrWrite = process.stderr.write.bind(process.stderr)
beforeAll(() => {
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrText += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    return true
  }) as typeof process.stderr.write
})
afterAll(() => {
  process.stderr.write = realStderrWrite
  server.stop(true)
})

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await removeTemp(dir)
})

type Harness = {
  controller: ChatController
  saves: HistoryRecord[][]
  secrets: ReturnType<typeof createMemorySecretStore>
}

async function harness(over: {
  model?: string | null
  limit?: number
  budget?: { budget: number; period: "day" | "month"; warn_at: number; pause_at_limit: boolean }
  spent?: number
  history?: HistoryRecord[]
} = {}): Promise<Harness> {
  const saves: HistoryRecord[][] = []
  const secrets = createMemorySecretStore()
  const service = createChatService({
    resolveModel: (id) => provider(id),
    providerId: "fake",
    resolveTool: async () => "",
  })
  const realGate = createBudgetGate({
    config: () => over.budget ?? { budget: 0, period: "day", warn_at: 0.8, pause_at_limit: false },
    now: () => new Date("2026-11-01T10:00:00Z"),
  })
  // The controller counts spend for *this* process only, and a loopback provider
  // is correctly priced as free — so a fake-server turn can never cross a limit.
  // This adapter stands in for spend already recorded in `usage.json` before the
  // app started, and forwards everything else to the real gate.
  const budget = over.spent
    ? {
        ...realGate,
        check: (spentMicroUsd: number, opts?: { override?: boolean }) =>
          realGate.check(spentMicroUsd + over.spent!, opts),
      }
    : realGate

  const controller = createChatController({
    scope: "school" as const,
    service,
    budget,
    history: {
      load: async () => over.history ?? [],
      save: async (records) => {
        saves.push(records)
      },
    },
    config: () => ({
      model: over.model === undefined ? "normal" : over.model,
      maxToolCalls: 4,
      maxTokens: 16_000,
      chillHistoryLimit: over.limit ?? 20,
    }),
    now: () => new Date("2026-11-01T10:00:00Z"),
    username: "friend",
  })
  return { controller, saves, secrets }
}

/** Mount the real App with the real controller and return its first frame. */
async function frameOf(controller: ChatController, width = 80, height = 24): Promise<string> {
  const ui = await renderApp({
    width,
    height,
    app: () => <App controller={controller} />,
  })
  try {
    return await ui.waitFor("LOCKEDIN")
  } finally {
    await ui.dispose()
  }
}

describe("chill chat end to end", () => {
  test("streams a reply through App, footer carries time, tokens and cost", async () => {
    log.length = 0
    const { controller } = await harness()
    const outcome = await controller.send("what are boundary conditions?")

    expect(outcome).toEqual({ kind: "sent", requestId: expect.any(String), outcome: "done" })

    // One request, chill mode, no tools — asserted on the request log.
    const requests = controller.requests()
    expect(requests.length).toBe(1)
    expect(log.length).toBe(1)
    const request: ChatRequest = requests[0]!
    expect(request.mode).toBe("chill")
    expect(request.tools).toEqual([])
    expect(log[0]!.tools).toBe(0)
    expect(request.model).toBe("normal")

    // The controller's state is the rendered conversation.
    const state = controller.state()
    expect(state.status).toBe("idle")
    const assistant = state.messages.filter((message) => message.role === "assistant").at(-1)!
    expect(assistant.text).toBe("Boundary conditions set the integral limits.")
    expect(assistant.outcome).toBe("done")
    expect(assistant.usage?.total).toBe(1152)

    // …and the real App renders it, with the quiet footer.
    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("Boundary conditions set the integral limits.")
    expect(frame).toContain("⏱")
    expect(frame).toContain("cost unknown") // no pricing for the fake model
    expect(frame).toContain("NORMAL")

    // Wide terminal renders the same conversation.
    const wide = await frameOf(controller, 120, 30)
    expect(wide).toContain("Boundary conditions set the integral limits.")
  })

  test("stop mid-stream: one cancelled, partial text discarded, no history write", async () => {
    log.length = 0
    const { controller, saves } = await harness()

    const sending = controller.send("count to three")
    // Wait for the stream to actually be running, on state, not on a clock.
    while (controller.state().status !== "streaming") await Promise.resolve()
    controller.cancel()
    const outcome = await sending

    expect(outcome).toEqual({ kind: "sent", requestId: expect.any(String), outcome: "cancelled" })
    expect(controller.requests().length).toBe(1)

    const state = controller.state()
    expect(state.status).toBe("cancelled")
    const assistant = state.messages.filter((message) => message.role === "assistant").at(-1)!
    expect(assistant.outcome).toBe("stopped")
    expect(assistant.text).toBe("")
    expect(state.streamed).toBe("")

    // A cancelled turn is never persisted.
    expect(saves).toEqual([])

    // The frame shows the Stopped marker and no partial answer.
    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("Stopped")
    expect(frame).not.toContain("one two three")
  })

  test("401 is one error bubble with the mapped copy and one request", async () => {
    log.length = 0
    const { controller, saves } = await harness({ model: "auth" })
    const outcome = await controller.send("hello")

    expect(outcome.kind).toBe("sent")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("error")
    expect(controller.requests().length).toBe(1)
    expect(log.length).toBe(1) // no retry

    const state = controller.state()
    expect(state.status).toBe("failed")
    expect(state.error?.failed).toContain("rejected the key")
    expect(state.error?.next).toContain("Settings → Providers")
    expect(saves).toEqual([])

    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("The provider rejected the key")
    // The full next step is on the state; a single unwrapped row clips it at 80.
    expect(frame).toContain("Relink it in Set")
    expect(state.error?.next).toContain("Settings → Providers.")
  })

  test("429 is one error bubble and is not retried", async () => {
    log.length = 0
    const { controller } = await harness({ model: "rate" })
    await controller.send("hello")

    expect(log.length).toBe(1)
    expect(controller.requests().length).toBe(1)
    expect(controller.state().error?.failed.toLowerCase()).toContain("rate limiting")

    const frame = await frameOf(controller, 80, 24)
    expect(frame.toLowerCase()).toContain("rate limiting")
  })

  test("budget pause blocks before any request; one override allows exactly one", async () => {
    log.length = 0
    const { controller } = await harness({
      budget: { budget: 0.01, period: "day", warn_at: 0.8, pause_at_limit: true },
      spent: 20_000, // $0.02 already recorded — over the $0.01 limit
    })

    const blocked = await controller.send("hi")
    expect(blocked.kind).toBe("blocked")
    expect(controller.requests()).toEqual([])
    expect(log.length).toBe(0)

    const state = controller.state()
    expect(state.status).toBe("blocked")
    expect(state.blocked?.reason).toContain("$0.01")
    expect(state.blocked?.fix.length).toBeGreaterThan(0)

    // The banner names the limit and the override key.
    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("$0.01")

    controller.override()
    const sent = await controller.send("hi")
    expect(sent.kind).toBe("sent")
    expect(controller.requests().length).toBe(1)
    expect(log.length).toBe(1)

    // The override is one-shot: the next send is gated again, with no request.
    const again = await controller.send("hi")
    expect(again.kind).toBe("blocked")
    expect(controller.requests().length).toBe(1)
    expect(log.length).toBe(1)
  })

  test("no model configured blocks send with the documented copy", async () => {
    log.length = 0
    const { controller } = await harness({ model: null })
    const outcome = await controller.send("hi")

    expect(outcome.kind).toBe("no-model")
    expect(controller.requests()).toEqual([])
    expect(log.length).toBe(0)

    const state = controller.state()
    expect(state.blocked?.reason).toBe("no model configured")
    expect(state.blocked?.fix).toContain("Settings → Providers")

    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("no model configured")
  })

  test("reload honours chill_history_limit and reasoning never reaches history", async () => {
    const records: HistoryRecord[] = Array.from({ length: 30 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${index}`,
      at: "2026-11-01T09:00:00Z",
    }))

    const { controller } = await harness({ limit: 20, history: records })
    await controller.load()

    const state = controller.state()
    expect(state.messages.length).toBe(20)
    expect(state.messages.at(-1)!.text).toBe("message 29")
    expect(state.messages[0]!.text).toBe("message 10")

    // A reasoning turn persists text only: no reasoning key, no usage, no cost.
    const after = await harness({ limit: 20 })
    const sending = after.controller.send("explain")
    const outcome = await sending
    expect(outcome.kind).toBe("sent")
    const saved = after.saves.at(-1) ?? []
    expect(saved.length).toBe(2)
    for (const record of saved) {
      expect(Object.keys(record).sort()).toEqual(["at", "content", "role"])
    }
    expect(JSON.stringify(saved)).not.toContain("think first")

    // The loaded history is what the App renders.
    const frame = await frameOf(controller, 80, 24)
    expect(frame).toContain("message 29")
  })

  test("history limit 0 disables persistence entirely", async () => {
    const { controller, saves } = await harness({ limit: 0 })
    await controller.send("hi")
    expect(saves.at(-1)).toEqual([])
    expect(controller.state().messages.some((message) => message.role === "assistant")).toBe(true)
  })
})

describe("chill chat end-to-end hygiene", () => {
  test("stderr stayed empty and no secret reached a log or the request log", async () => {
    expect(stderrText).toBe("")
    const { controller, secrets } = await harness()
    await controller.send("hygiene")
    expect(secrets.calls.set).toBe(0)
    expect(JSON.stringify(controller.requests())).not.toContain("e2e-not-a-key")
  })

  test("sends exactly one request per turn, sequentially", async () => {
    log.length = 0
    const { controller } = await harness()
    await controller.send("one")
    await controller.send("two")
    expect(controller.requests().length).toBe(2)
    expect(log.length).toBe(2)
    // The second request carries the first turn as context.
    expect(JSON.stringify(log[1]!.messages)).toContain("one")
  })
})

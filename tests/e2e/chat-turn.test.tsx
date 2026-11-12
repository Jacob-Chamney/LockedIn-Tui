/**
 * A real chat turn, through the real app.
 *
 * This is the test the user's bar actually asks for: boot the composition root,
 * configure a model that points at a local OpenAI-compatible server, type a
 * message with real key presses into the real `App`, press Enter, and see the
 * answer painted in the frame plus the usage counters move.
 *
 * No network leaves the machine, no keychain is touched: the endpoint is
 * loopback, which the provider glue treats as a local, free endpoint.
 */
import { afterAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { App } from "../../src/app/App"
import { boot } from "../../src/app/boot"
import { patchConfig } from "../../src/storage/config"
import { renderApp } from "../helpers/render"

const replies: string[] = []

function sse(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

const server = Bun.serve({
  port: 0,
  async fetch() {
    // Record what the app asked for, then answer in pieces so the pane has to
    // repaint mid-stream.
    replies.push("asked")
    const parts = [
      sse({ role: "assistant" }),
      sse({ content: "hello from " }),
      sse({ content: "the fake" }),
      sse({}, "stop"),
      `data: ${JSON.stringify({
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        created: 0,
        model: "fake",
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ]
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (const part of parts) {
            await new Promise((resolve) => setTimeout(resolve, 1))
            controller.enqueue(encoder.encode(part))
          }
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

const baseUrl = `http://127.0.0.1:${server.port}/v1`

afterAll(() => {
  server.stop(true)
})

test("a configured model answers a typed message, and the counters move", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "chat-turn-")), "ws")
  const dataDir = mkdtempSync(join(tmpdir(), "chat-turn-data-"))

  const first = await boot({ workspaceRoot: root, dataDir })
  if (!first.ok) throw new Error(`boot failed: ${first.error.message}`)

  // Configure a model against the loopback server. An empty `models.base_url`
  // would mean "provider default"; this one overrides it.
  const patched = await patchConfig(first.value.workspace.paths, {
    models: { chat: "openai/local-model", base_url: baseUrl },
  })
  if (!patched.ok) throw new Error(`patch failed: ${patched.error.message}`)

  const booted = await boot({ workspaceRoot: root, dataDir })
  if (!booted.ok) throw new Error(`boot failed: ${booted.error.message}`)
  expect(booted.value.config.models.chat).toBe("openai/local-model")

  const ui = await renderApp({
    width: 100,
    height: 30,
    app: () => (
      <App
        controller={booted.value.controller}
        usageStore={booted.value.usageStore}
        chatScope={booted.value.scope}
      />
    ),
  })

  try {
    const start = await ui.waitFor("LOCKEDIN")
    expect(start).toContain("0 tok")
    expect(start.toLowerCase()).toContain("cost unknown")

    // A real key path: `i` enters INSERT, the letters reach the controller, Enter
    // sends. Nothing here calls the controller directly.
    await ui.press("i")
    await ui.type("hello there")
    expect(ui.frame()).toContain("hello there")

    await ui.press("enter")
    // The fake server streams over real loopback HTTP. `waitUntil` yields the
    // event loop until the response has been painted, so no fixed sleep and no
    // frame-budget guess is needed — the finished turn is the condition.
    await ui.waitUntil(() => ui.frame().includes("16 tok"))
    const answered = ui.frame()
    expect(answered).toContain("hello from the fake")
    expect(replies.length).toBe(1)
    // Loopback is a local, free endpoint: a known price of zero, not "unknown".
    expect(answered).toContain("$0.0000")
  } finally {
    await ui.dispose()
  }
})

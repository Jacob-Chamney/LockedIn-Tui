/**
 * `:clear` in Chill.
 *
 * The command was documented in the product spec but had no implementation, so
 * typing it reported an unknown command. This drives the real key path: `:`,
 * the name, Enter.
 */
import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/App"
import { createChatController } from "../../src/app/chat-controller"
import type { ChatEvent } from "../../src/llm/events"
import type { ChatRequest, ChatService } from "../../src/llm/chat"
import { renderApp } from "../helpers/render"

const DONE: ChatEvent[] = [
  { type: "text", delta: "Remember the boundary conditions." },
  {
    type: "done",
    text: "Remember the boundary conditions.",
    steps: [],
    usage: { input: 4, output: 4, total: 8 },
    durationMs: 500,
  },
]

function service(): ChatService {
  return {
    active: () => [],
    cancel: () => {},
    async *send(_request: ChatRequest) {
      for (const event of DONE) yield event
    },
  }
}

function controller() {
  return createChatController({
    scope: "school" as const,
    service: service(),
    budget: {
      key: () => "2026-11-11",
      isOverridden: () => false,
      overrideOnce: () => {},
      check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
    },
    history: { load: async () => [], save: async () => {} },
    config: () => ({ model: "openai/gpt-4.1-mini", maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
    now: () => new Date("2026-11-11T09:00:00Z"),
  })
}

describe(":clear", () => {
  test("empties the transcript from the command line", async () => {
    const ctrl = controller()
    await ctrl.send("what matters?")
    const ui = await renderApp({ width: 100, height: 30, app: () => <App controller={ctrl} /> })
    try {
      await ui.waitFor("Remember the boundary conditions.")
      await ui.press(":")
      await ui.type("clear")
      await ui.press("enter")
      await ui.waitUntil(() => !ui.frame().includes("Remember the boundary conditions."))
      expect(ctrl.state().messages).toEqual([])
      // The empty chat returns the welcome, not a blank pane.
      expect(ui.frame()).toContain("what do you want to learn today?")
    } finally {
      await ui.dispose()
    }
  })
})

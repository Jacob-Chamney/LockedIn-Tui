/** NORMAL j/k scrolls the transcript when the chat has more than a screen. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { initialChat } = await import("../../src/ui/chat/model")
const { createChatController } = await import("../../src/app/chat-controller")

function longChat() {
  return {
    ...initialChat("friend", "m"),
    messages: Array.from({ length: 14 }, (_, index) => ({
      id: `m${index}`,
      role: "user" as const,
      text: `message ${index} with a line that is long enough to wrap in a narrow chat column`,
      outcome: "done" as const,
    })),
  }
}

const budget = {
  key: () => "test",
  isOverridden: () => false,
  overrideOnce: () => {},
  check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
}

describe("chat scrolling", () => {
  test("j/k scroll the transcript in NORMAL mode", async () => {
    const ui = await renderApp({
      width: 90,
      height: 24,
      app: () => <App initial={{ chat: longChat() } as never} />,
    })
    try {
      await ui.waitFor("message 13")
      const bottom = ui.frame()
      await ui.press("k")
      await ui.idle(4)
      const up = ui.frame()
      expect(up).not.toBe(bottom)
      // The last message is no longer the only thing on screen.
      expect(up).toContain("message 1")
      await ui.press("j")
      await ui.idle(4)
      expect(ui.frame()).toContain("message 13")
    } finally {
      await ui.dispose()
    }
  })
})


test("the composer shows a cursor only in INSERT mode", async () => {
  const ui = await renderApp({
    width: 100,
    height: 24,
    app: () => <App />,
  })
  try {
    await ui.waitFor("NORMAL")
    expect(ui.frame()).not.toContain("▏")
    await ui.press("i")
    await ui.waitFor("INSERT")
    expect(ui.frame()).toContain("▏")
  } finally {
    await ui.dispose()
  }
})


test("a streaming reply follows the newest line", async () => {
  const lines = Array.from({ length: 40 }, (_, index) => `stream line ${index}`)
  const text = lines.join("\n")
  const controller = createChatController({
    service: {
      active: () => [],
      cancel: () => {},
      async *send() {
        for (const line of lines) yield { type: "text" as const, delta: `${line}\n` }
        yield {
          type: "done" as const,
          text,
          steps: [],
          usage: { input: 1, output: 1, total: 2 },
          durationMs: 1,
        }
      },
    },
    budget,
    history: { load: async () => [], save: async () => {} },
    scope: "school",
    config: () => ({ model: "m", maxToolCalls: 8, maxTokens: 16_000, chillHistoryLimit: 20 }),
  })
  const ui = await renderApp({
    width: 90,
    height: 16,
    app: () => <App controller={controller} />,
  })
  try {
    await ui.waitFor("NORMAL")
    await ui.press("i")
    await ui.type("hi")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("stream line 39"))
  } finally {
    await ui.dispose()
  }
})

test("exiting insert clears the draft, and Ctrl+A clears it in place", async () => {
  const ui = await renderApp({ width: 100, height: 24, app: () => <App /> })
  try {
    await ui.waitFor("NORMAL")
    await ui.press("i")
    await ui.type("draft that should not survive")
    await ui.press("escape")
    expect(ui.frame()).toContain("NORMAL")
    expect(ui.frame()).not.toContain("draft that should not survive")

    await ui.press("i")
    await ui.type("another draft")
    expect(ui.frame()).toContain("another draft")
    await ui.press("a", { ctrl: true })
    expect(ui.frame()).not.toContain("another draft")
  } finally {
    await ui.dispose()
  }
})

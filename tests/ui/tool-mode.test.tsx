/** Shift+Tab shows PLAN/BUILD in the status bar; learning chats refuse. */
import { expect, test } from "bun:test"

import { createChatController } from "../../src/app/chat-controller"
import type { ChatMode, ChatRequest } from "../../src/llm/chat"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")

function controller(mode: ChatMode) {
  return createChatController({
    scope: "work",
    service: {
      active: () => [],
      cancel() {},
      async *send(request: ChatRequest) {
        yield { type: "done", text: "ok", steps: [], usage: { input: 1, output: 1, total: 2 } }
        void request
      },
    } as never,
    budget: {
      check: () => ({ block: null, state: {} as never }),
      overrideOnce() {},
      key: () => "",
      isOverridden: () => false,
    },
    history: { load: async () => [], save: async () => {} },
    config: () => ({
      model: "openai/gpt-4.1-mini",
      maxToolCalls: 8,
      maxTokens: 1000,
      chillHistoryLimit: 20,
      mode,
    }),
  })
}

test("Shift+Tab cycles BUILD and PLAN in the status bar", async () => {
  const ctrl = controller("work")
  const ui = await renderApp({
    width: 140,
    height: 32,
    app: () => <App controller={ctrl} initial={{ pane: "chat", mode: "normal", focus: "chat" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("BUILD"))
    await ui.press("tab", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("PLAN"))
    expect(ui.frame()).toContain("PLAN")
    await ui.press("tab", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("BUILD"))
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("chill never shows a plan/build mode", async () => {
  const ctrl = controller("chill")
  const ui = await renderApp({
    width: 140,
    height: 32,
    app: () => <App controller={ctrl} initial={{ pane: "chat", mode: "normal", focus: "chat" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("CHILL"))
    expect(ui.frame()).not.toContain("BUILD")
    expect(ui.frame()).not.toContain("PLAN")
    await ui.press("tab", { shift: true })
    expect(ctrl.state().toolMode).toBe("build")
    expect(ui.frame()).not.toContain("BUILD")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a learning chat stays on LEARN and explains the lock", async () => {
  const ctrl = controller("lockin")
  const ui = await renderApp({
    width: 140,
    height: 32,
    app: () => <App controller={ctrl} initial={{ pane: "chat", mode: "normal", focus: "chat" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("LEARN"))
    await ui.press("tab", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("locked"))
    expect(ui.frame()).toContain("LEARN")
    expect(ctrl.state().toolMode).toBe("learn")
  } finally {
    await ui.dispose()
  }
}, 30_000)

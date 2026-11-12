/** Chat settings: the response controls that apply to the active surface. */
import { expect, test } from "bun:test"

import { createChatController } from "../../src/app/chat-controller"
import type { ChatMode, ChatRequest } from "../../src/llm/chat"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { emptySettingsView } = await import("../../src/ui/settings")

function controller(mode: ChatMode) {
  return createChatController({
    scope: "school",
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
      model: "m",
      maxToolCalls: 8,
      maxTokens: 1000,
      chillHistoryLimit: 20,
      mode,
    }),
  })
}

test("a skill session offers style and tutor, and cycles both", async () => {
  const patches: Record<string, unknown>[] = []
  const ui = await renderApp({
    width: 120,
    height: 32,
    app: () => (
      <App
        controller={controller("skill")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
        initial={{ pane: "chat-settings" } as never}
        onConfigPatch={async (patch) => {
          patches.push(patch)
          return { ok: true }
        }}
      />
    ),
  })
  try {
    await ui.waitFor("Chat settings")
    const frame = ui.frame()
    expect(frame).toContain("Response style")
    expect(frame).toContain("Tutor policy")
    expect(frame).toContain("normal")
    expect(frame).toContain("direct")

    await ui.press("return")
    await ui.waitUntil(() => patches.length === 1)
    expect(patches[0]).toEqual({ ui: { response_style: "detailed" } })

    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => patches.length === 2)
    expect(patches[1]).toEqual({ ui: { tutor_policy: "guided" } })
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a lock-in session offers style only", async () => {
  const ui = await renderApp({
    width: 120,
    height: 32,
    app: () => (
      <App
        controller={controller("lockin")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
        initial={{ pane: "chat-settings" } as never}
      />
    ),
  })
  try {
    await ui.waitFor("Chat settings")
    expect(ui.frame()).toContain("Response style")
    expect(ui.frame()).not.toContain("Tutor policy")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("Settings opens the dedicated Chat settings pane", async () => {
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        controller={controller("skill")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
        initial={{ pane: "settings" } as never}
      />
    ),
  })
  try {
    await ui.waitFor("SETTINGS")
    await ui.press("j")
    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Chat settings"))
    expect(ui.frame()).toContain("Response style")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("Chill refuses Chat settings and says where it applies", async () => {
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        controller={controller("chill")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
        initial={{ pane: "settings" } as never}
      />
    ),
  })
  try {
    await ui.waitFor("SETTINGS")
    await ui.press("j")
    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("not Chill"))
    const frame = ui.frame()
    expect(frame).toContain("SETTINGS")
    expect(frame).not.toContain("Response style")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("the :style alias is refused from Chill as well", async () => {
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        controller={controller("chill")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("CHILL"))
    await ui.press(":")
    await ui.type("style")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("not Chill"))
    expect(ui.frame()).not.toContain("Response style")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a style keyword in Chill points at sessions, not Settings", async () => {
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        controller={controller("chill")}
        settings={{ ...emptySettingsView(), chatModel: "m", responseStyle: "normal", tutorPolicy: "direct" }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("CHILL"))
    await ui.press("i")
    await ui.type(":brief")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("applies to sessions"))
    expect(ui.frame()).not.toContain("Settings → Chat settings")
  } finally {
    await ui.dispose()
  }
}, 30_000)

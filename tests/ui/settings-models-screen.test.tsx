/** Settings → Chat model: link a key, then pick from the models it returned. */
import { describe, expect, test } from "bun:test"

import { App } from "../../src/app/App"
import { emptySettingsView } from "../../src/ui/settings"
import { renderApp } from "../helpers/render"

describe("the Models screen", () => {
  test("a linked key lists its models and the chosen id is saved", async () => {
    const patches: Record<string, unknown>[] = []
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
          linkProvider={async () => ({
            ok: true,
            value: {
              providerId: "openai",
              models: ["gpt-4.1-mini", "gpt-4.1"],
              modelSelected: null,
              requests: 1,
              secretRef: "lockedin/openai",
            },
          })}
          onConfigPatch={async (patch: Record<string, unknown>) => {
            patches.push(patch)
            return { ok: true, value: {} } as never
          }}
        />
      ),
    })
    try {
      await ui.waitFor("SETTINGS")
      // Username, theme, chat settings, then the Providers row.
      for (let step = 0; step < 3; step++) await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("PROVIDERS")
      expect(ui.frame()).toContain("OpenAI")

      await ui.press("enter")
      await ui.waitFor("Link OpenAI")
      await ui.type("sk-spike-placeholder-not-a-key")
      expect(ui.frame()).toContain("•")
      expect(ui.frame()).not.toContain("sk-spike-placeholder-not-a-key")
      await ui.press("enter")
      await ui.waitFor("linked · 2 models")
      await ui.press("escape")
      await ui.waitFor("SETTINGS")
      await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("openai/gpt-4.1-mini")
      expect(ui.frame()).toContain("openai/gpt-4.1")

      await ui.press("enter")
      await ui.waitFor("SETTINGS")
      expect(patches).toContainEqual({ models: { chat: "openai/gpt-4.1-mini" } })
    } finally {
      await ui.dispose()
    }
  })

  test("an already-linked key fetches its models without asking for the key again", async () => {
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
          modelsForProvider={async () => ({
            ok: true,
            value: {
              providerId: "openai",
              models: ["gpt-4.1-mini"],
              modelSelected: null,
              requests: 1,
              secretRef: "lockedin/openai",
            },
          })}
        />
      ),
    })
    try {
      await ui.waitFor("SETTINGS")
      for (let step = 0; step < 3; step++) await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("PROVIDERS")
      await ui.press("enter")
      await ui.waitFor("linked · 1 model")
      await ui.press("escape")
      await ui.waitFor("SETTINGS")
      await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("openai/gpt-4.1-mini")
      expect(ui.frame()).not.toContain("key •")
    } finally {
      await ui.dispose()
    }
  })

  test("the model section opens on the configured provider's models", async () => {
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
          settings={{
            ...emptySettingsView(),
            chatModel: "openai/gpt-4.1-mini",
            baseUrl: "",
          }}
          modelsForProvider={async () => ({
            ok: true,
            value: {
              providerId: "openai",
              models: ["gpt-4.1-mini", "gpt-4.1"],
              modelSelected: null,
              requests: 1,
              secretRef: "lockedin/openai",
            },
          })}
        />
      ),
    })
    try {
      await ui.waitFor("SETTINGS")
      // Username, theme, chat settings, providers, chat model.
      for (let step = 0; step < 4; step++) await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("openai/gpt-4.1-mini")
      expect(ui.frame()).toContain("openai · 2 models")
    } finally {
      await ui.dispose()
    }
  })

  test("an existing keychain entry is marked linked in Providers", async () => {
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
          settings={{
            ...emptySettingsView(),
            chatModel: "opencode-go/deepseek-v4.1-flash",
            baseUrl: "",
          }}
          linkedProviders={async () => ["opencode-go"]}
        />
      ),
    })
    try {
      await ui.waitFor("SETTINGS")
      for (let step = 0; step < 3; step++) await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("PROVIDERS")
      await ui.waitFor(/linked\s+✓/)
      expect(ui.frame()).toContain("active OpenCode Go")
    } finally {
      await ui.dispose()
    }
  })

  test("a stored key the provider rejects reopens the key window", async () => {
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
          modelsForProvider={async () => ({
            ok: false,
            error: { kind: "auth", provider: "openai", message: "rejected" },
          })}
        />
      ),
    })
    try {
      await ui.waitFor("SETTINGS")
      for (let step = 0; step < 3; step++) await ui.press("down")
      await ui.press("enter")
      await ui.waitFor("PROVIDERS")
      await ui.press("enter")
      await ui.waitFor("Link OpenAI")
      expect(ui.frame()).toContain("stored key was rejected")
    } finally {
      await ui.dispose()
    }
  })
})

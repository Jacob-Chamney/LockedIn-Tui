/** A buffer gets its own controller/history; two projects do not share one. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createChatController } = await import("../../src/app/chat-controller")
const { createWorkspace } = await import("../../src/storage/workspace")
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")

const budget = {
  key: () => "test",
  isOverridden: () => false,
  overrideOnce: () => {},
  check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
}

describe("per-buffer chat controllers", () => {
  test("opening two project buffers creates two independent histories", async () => {
    const base = await mkdtemp(join(tmpdir(), "per-buffer-"))
    const made = await createWorkspace(join(base, "ws"))
    if (!made.ok) throw new Error("workspace")
    const histories: unknown[] = []
    const ui = await renderApp({
      width: 140,
      height: 30,
      app: () => (
        <App
          workspace={made.value}
          initial={{ pane: "projects" } as never}
          createChat={(history) => {
            histories.push(history)
            return createChatController({
              service: {
                active: () => [],
                cancel: () => {},
                // eslint-disable-next-line require-yield
                async *send() {
                  return
                },
              },
              budget,
              history,
              scope: "work",
              config: () => ({ model: null, maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
            })
          }}
        />
      ),
    })
    try {
      await ui.waitFor("LOCKEDIN")
      const run = async (command: string) => {
        await ui.press(":")
        for (const char of command) await ui.press(char)
        await ui.press("return")
      }
      const project = async (name: string) => {
        await run("projects")
        await ui.press("n")
        await ui.type(name)
        await ui.press("return")
        await ui.press("return")
        await ui.press("return")
        await ui.waitUntil(() => ui.frame().split("\n")[0]?.includes(name) === true)
      }
      await project("notes")
      await project("atlas")
      expect(histories).toHaveLength(2)
      expect(histories[0]).not.toBe(histories[1])
    } finally {
      await ui.dispose()
    }
  })
})

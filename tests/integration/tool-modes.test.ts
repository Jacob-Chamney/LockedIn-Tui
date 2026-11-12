/** Shift+Tab modes and the learning-web opt-in, at the controller boundary. */
import { expect, test } from "bun:test"

import { createChatController } from "../../src/app/chat-controller"
import type { ChatMode, ChatRequest } from "../../src/llm/chat"
import type { ToolSpec } from "../../src/llm/tools"

const SPECS: ToolSpec[] = [
  { name: "list_files", description: "list", inputSchema: { type: "object" }, side: "work", write: false, command: false },
  { name: "write_file", description: "write", inputSchema: { type: "object" }, side: "work", write: true, command: false },
  { name: "run_command", description: "run", inputSchema: { type: "object" }, side: "work", write: false, command: true },
  { name: "search", description: "web", inputSchema: { type: "object" }, side: "none", write: false, command: false, web: true },
]

function make(mode: ChatMode) {
  const seen: ChatRequest[] = []
  const resolved: Array<{ name: string; context?: unknown }> = []
  const controller = createChatController({
    scope: "work",
    service: {
      active: () => [],
      cancel() {},
      async *send(request: ChatRequest) {
        seen.push(request)
        yield { type: "done", text: "ok", steps: [], usage: { input: 1, output: 1, total: 2 } }
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
      tools: () => SPECS,
      resolveTool: async (name, _input, context) => {
        resolved.push({ name, context })
        return JSON.stringify({ ok: true, value: [] })
      },
    }),
  })
  return { controller, seen, resolved }
}

test("chill has no tool modes to cycle", () => {
  const { controller } = make("chill")
  expect(controller.state().toolsAvailable).toBe(false)
  expect(controller.toggleToolMode()).toEqual({
    ok: false,
    reason: "this chat has no tools, so plan/build does not apply",
  })
  expect(controller.state().toolMode).toBe("build")
})

test("Shift+Tab cycles plan and build, and plan drops writes and commands", async () => {
  const { controller, seen } = make("work")
  expect(controller.state().toolMode).toBe("build")

  const plan = controller.toggleToolMode()
  expect(plan).toEqual({ ok: true, mode: "plan" })
  await controller.send("plan this")
  expect(seen[0]?.tools?.map((spec) => spec.name).sort()).toEqual(["list_files", "search"])

  expect(controller.toggleToolMode()).toEqual({ ok: true, mode: "build" })
  await controller.send("do it")
  expect(seen[1]?.tools?.map((spec) => spec.name).sort()).toEqual([
    "list_files",
    "run_command",
    "search",
    "write_file",
  ])
})

test("a learning chat is locked to learn and hides the web", async () => {
  const { controller, seen } = make("lockin")
  expect(controller.state().toolMode).toBe("learn")
  expect(controller.state().toolModeLocked).toBe(true)
  expect(controller.toggleToolMode()).toEqual({
    ok: false,
    reason: "learning mode is locked in this chat",
  })
  expect(controller.state().toolMode).toBe("learn")

  await controller.send("from my sources only")
  expect(seen[0]?.tools?.map((spec) => spec.name)).toEqual(["list_files"])
})

test("learning-web is ordinary text outside a learning chat", async () => {
  const { controller, seen } = make("work")
  await controller.send("learning-web is a phrase")
  const user = seen[0]?.messages.find((message) => message.role === "user")
  expect(user?.content).toBe("learning-web is a phrase")
})

test("a skill chat is locked to learn but keeps the web", async () => {
  const { controller, seen } = make("skill")
  expect(controller.state().toolMode).toBe("learn")
  expect(controller.state().toolModeLocked).toBe(true)
  expect(controller.toggleToolMode().ok).toBe(false)
  await controller.send("teach me registers")
  expect(seen[0]?.tools?.map((spec) => spec.name).sort()).toEqual([
    "list_files",
    "search",
  ])
})

test("learning-web opts one turn into the web and is stripped from the message", async () => {
  const { controller, seen, resolved } = make("lockin")
  await controller.send(":learning-web check the current definition")

  expect(seen[0]?.tools?.map((spec) => spec.name).sort()).toEqual(["list_files", "search"])
  const user = seen[0]?.messages.find((message) => message.role === "user")
  expect(user?.content).toBe("check the current definition")
  const shown = controller.state().messages.find((message) => message.role === "user")
  expect(shown?.text).toBe("check the current definition")

  await seen[0]!.resolveTool!("search", { q: "x" })
  expect(resolved[0]?.name).toBe("search")
  expect(resolved[0]?.context).toEqual({ toolMode: "learn", webExplicit: true })
})

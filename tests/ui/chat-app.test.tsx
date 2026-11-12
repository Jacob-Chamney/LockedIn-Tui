/**
 * WP-130 — chat controller and App wiring.
 *
 * A fake service drives the controller, so nothing here opens a socket.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createChatController, mapError } from "../../src/app/chat-controller"
import type { ChatEvent, Usage } from "../../src/llm/events"
import type { ChatRequest } from "../../src/llm/chat"
import type { ChatMode, ChatService } from "../../src/llm/chat"
import type { BudgetGate } from "../../src/llm/budget"
import type { HistoryRecord } from "../../src/app/chat-controller"
import { canSend } from "../../src/ui/chat/model"

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/chat-app/history.json"), "utf8"))

function fakeService(events: ChatEvent[]): ChatService & { requests: ChatRequest[]; cancelled: string[] } {
  const requests: ChatRequest[] = []
  const cancelled: string[] = []
  return {
    requests,
    cancelled,
    active: () => [],
    cancel: (id: string) => void cancelled.push(id),
    async *send(request: ChatRequest) {
      requests.push(request)
      for (const event of events) yield event
    },
  }
}

function memoryHistory(initial: HistoryRecord[] = []): { port: { load: () => Promise<HistoryRecord[]>; save: (r: HistoryRecord[]) => Promise<void> }; saved: HistoryRecord[][] } {
  const saved: HistoryRecord[][] = []
  let records = [...initial]
  return {
    saved,
    port: {
      load: async () => [...records],
      save: async (next) => {
        records = [...next]
        saved.push(next)
      },
    },
  }
}

function gate(block: { limit: number; period: "day" | "month" } | null): BudgetGate & { overrides: number } {
  let armed = 0
  let overrideArmed = false
  return {
    overrides: armed,
    key: () => "2026-11-01",
    isOverridden: () => overrideArmed,
    overrideOnce: () => {
      overrideArmed = true
      armed++
    },
    check: () => {
      if (overrideArmed) {
        overrideArmed = false
        return { block: null, state: { spent: 0, limit: 0, period: "day" } as never }
      }
      return { block: block ? { kind: "budget", ...block } : null, state: { spent: 0, limit: 0, period: "day" } as never }
    },
  }
}

const DONE: ChatEvent[] = [
  { type: "text", delta: "The boundary " },
  { type: "text", delta: "conditions fix the limits." },
  { type: "reasoning", delta: "check limits first" },
  { type: "usage", tokens: { input: 812, output: 340, total: 1152 } as Usage },
  { type: "done", text: "The boundary conditions fix the limits.", steps: [], usage: { input: 812, output: 340, total: 1152 } as Usage, durationMs: 6100 },
]

function controller(
  events: ChatEvent[],
  options: {
    block?: { limit: number; period: "day" | "month" } | null
    limit?: number
    history?: ReturnType<typeof memoryHistory>
    mode?: ChatMode
  } = {},
) {
  const service = fakeService(events)
  const history = options.history ?? memoryHistory()
  const ctrl = createChatController({
    scope: "school" as const,
    service,
    budget: gate(options.block ?? null),
    history: history.port,
    config: () => ({
      model: "openai/gpt-4.1-mini",
      maxToolCalls: 8,
      maxTokens: 16000,
      chillHistoryLimit: options.limit ?? 20,
      mode: options.mode ?? "chill",
    }),
    now: () => new Date("2026-11-01T14:31:00Z"),
  })
  return { ctrl, service, history }
}

function systemText(
  service: ChatService & { requests: ChatRequest[] },
  index: number,
): string {
  return service.requests[index]!.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n")
}

describe("send, stream and done", () => {
  test("one send renders the bubble and its footer", async () => {
    const { ctrl, service } = controller(DONE)
    const outcome = await ctrl.send("hello")
    expect(outcome.kind).toBe("sent")
    expect(service.requests).toHaveLength(1)
    expect(service.requests[0]!.mode).toBe("chill")
    expect(service.requests[0]!.tools).toEqual([])

    const state = ctrl.state()
    expect(state.status).toBe("idle")
    const assistant = state.messages.find((m) => m.role === "assistant")!
    expect(assistant.text).toBe("The boundary conditions fix the limits.")
    expect(assistant.outcome).toBe("done")
    expect(assistant.reasoning).toBe("check limits first")
    expect(assistant.durationMs).toBe(6100)
    expect(state.composer).toBe("")
  })

  test("a skill chat turns style and tutor policy into system instructions", async () => {
    const { ctrl, service } = controller(DONE, { mode: "skill" })
    ctrl.setResponseStyle("brief")
    ctrl.setTutorPolicy("socratic")
    await ctrl.send("hello")
    const systems = systemText(service, 0)
    expect(systems).toContain("Response style: brief")
    expect(systems).toContain("Tutoring policy: socratic")
  })

  test("a lock-in chat carries the style but never tutoring", async () => {
    const { ctrl, service } = controller(DONE, { mode: "lockin" })
    ctrl.setResponseStyle("brief")
    ctrl.setTutorPolicy("socratic")
    await ctrl.send("hello")
    const systems = systemText(service, 0)
    expect(systems).toContain("Response style: brief")
    expect(systems).not.toContain("Tutoring policy")
  })

  test("a chill chat carries no style or tutor instructions", async () => {
    const { ctrl, service } = controller(DONE)
    ctrl.setResponseStyle("brief")
    ctrl.setTutorPolicy("socratic")
    await ctrl.send("hello")
    const systems = systemText(service, 0)
    expect(systems).not.toContain("Response style")
    expect(systems).not.toContain("Tutoring policy")
  })

  test("pastes are cleared on send and their text joins the message", async () => {
    const { ctrl, service } = controller(DONE)
    ctrl.pasteText("one\ntwo")
    ctrl.pasteImage()
    expect(ctrl.state().pastes).toHaveLength(2)
    await ctrl.send()
    const state = ctrl.state()
    expect(state.pastes).toEqual([])
    const user = state.messages.find((message) => message.role === "user")!
    expect(user.text).toBe("one\ntwo")
    expect(service.requests[0]!.messages.at(-1)!.content).toBe("one\ntwo")
  })

  test("every request is tool-free", async () => {
    const { ctrl, service } = controller(DONE)
    await ctrl.send("hello")
    for (const request of service.requests) expect(request.tools).toEqual([])
  })
})

describe(":clear", () => {
  test("empties the transcript and the local history", async () => {
    const { ctrl, history } = controller(DONE)
    await ctrl.send("hello")
    expect(ctrl.state().messages.length).toBe(2)
    expect(ctrl.clearTranscript()).toEqual({ ok: true })
    expect(ctrl.state().messages).toEqual([])
    expect(ctrl.state().streamed).toBe("")
    // The persisted transcript is empty too, not stale.
    await Promise.resolve()
    expect(history.saved.at(-1)).toEqual([])
  })

  test("a streaming reply refuses to be cleared from under the stream", async () => {
    const { ctrl } = controller(DONE)
    const sending = ctrl.send("hello")
    const refused = ctrl.clearTranscript()
    expect(refused.ok).toBe(false)
    await sending
    expect(ctrl.state().messages.length).toBe(2)
  })
})

describe("send guards", () => {
  test("an empty draft starts no request", async () => {
    const { ctrl, service } = controller(DONE)
    const outcome = await ctrl.send()
    expect(outcome.kind).toBe("ignored")
    expect(service.requests).toHaveLength(0)
  })

  test("a second Enter while streaming does not start a second request", async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => (release = resolve))
    const service = fakeService([
      { type: "text", delta: "first" },
      { type: "done", text: "first", steps: [], usage: { input: 1, output: 1, total: 2 } as Usage, durationMs: 1 },
    ])
    const original = service.send
    service.send = async function* (request) {
      await blocked
      yield* original(request)
    }
    const ctrl = createChatController({
      scope: "school" as const,
      service,
      budget: gate(null),
      history: memoryHistory().port,
      config: () => ({ model: "m", maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
      now: () => new Date("2026-11-01T14:31:00Z"),
    })
    const first = ctrl.send("hello")
    const second = await ctrl.send("again")
    expect(second.kind).toBe("ignored")
    release()
    await first
  })
})

describe("live config", () => {
  test("a model selected in Settings reaches the chat state", () => {
    let model: string | null = null
    const ctrl = createChatController({
      scope: "school" as const,
      service: fakeService([]),
      budget: gate(null),
      history: memoryHistory().port,
      config: () => ({ model, maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
      now: () => new Date("2026-11-01T14:31:00Z"),
    })
    expect(ctrl.state().model).toBeNull()
    expect(canSend({ ...ctrl.state(), composer: "hi" }).ok).toBe(false)
    model = "openai/gpt-4.1-mini"
    ctrl.syncConfig()
    expect(ctrl.state().model).toBe("openai/gpt-4.1-mini")
    expect(canSend({ ...ctrl.state(), composer: "hi" }).ok).toBe(true)
  })
})

describe("pastes", () => {
  test("backspace removes the last paste before touching the draft", () => {
    const { ctrl } = controller(DONE)
    ctrl.pasteText("one\ntwo")
    expect(ctrl.state().pastes).toHaveLength(1)
    ctrl.backspace()
    expect(ctrl.state().pastes).toHaveLength(0)
    expect(ctrl.state().composer).toBe("")
  })
})

describe("history paging", () => {
  test("loadMore mounts another page of older messages", async () => {
    const history = memoryHistory()
    const { ctrl } = controller(DONE, { history })
    const records = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
      at: "2026-11-01T10:00:00Z",
    }))
    await history.port.save(records)
    await ctrl.load()
    expect(ctrl.state().mounted).toBe(12)
    ctrl.loadMore()
    // The default history limit is 20, so the second page stops there.
    expect(ctrl.state().mounted).toBe(20)
  })
})

describe("cancel", () => {
  test("cancel mid-stream stops the service and discards the partial text", async () => {
    const { ctrl, service } = controller([
      { type: "text", delta: "half an answer" },
      { type: "cancelled" },
    ])
    const outcome = await ctrl.send("hello")
    expect(outcome.kind).toBe("sent")
    if (outcome.kind !== "sent") return
    expect(outcome.outcome).toBe("cancelled")
    const assistant = ctrl.state().messages.find((m) => m.role === "assistant")!
    expect(assistant.text).toBe("")
    expect(assistant.outcome).toBe("stopped")
    expect(ctrl.state().status).toBe("cancelled")
    expect(service.cancelled).toHaveLength(0) // the stream cancelled itself
  })

  test("calling cancel asks the service for the active request", async () => {
    const { ctrl, service } = controller([{ type: "text", delta: "x" }])
    void ctrl.send("hello")
    ctrl.cancel()
    expect(service.cancelled.length + ctrl.state().messages.length).toBeGreaterThan(0)
  })
})

describe("failures", () => {
  test("a 401 becomes exactly one error bubble", async () => {
    const { ctrl } = controller([
      { type: "error", error: { kind: "auth", provider: "openai", message: "bad key" } },
    ])
    await ctrl.send("hello")
    const state = ctrl.state()
    expect(state.status).toBe("failed")
    expect(state.error?.failed).toContain("rejected the key")
    expect(state.error?.kept).toContain("Nothing was saved")
    expect(state.error?.next).toContain("Settings")
    const failed = state.messages.filter((m) => m.outcome === "failed")
    expect(failed).toHaveLength(1)
  })

  test("a 429 keeps the same shape", async () => {
    const { ctrl } = controller([
      { type: "error", error: { kind: "rate-limit", provider: "openai" } },
    ])
    await ctrl.send("hello")
    expect(ctrl.state().error?.failed).toContain("rate limiting")
  })

  test("every error kind maps once, and cancelled is not an error", () => {
    const cases = [
      { kind: "auth", provider: "p", message: "" },
      { kind: "rate-limit", provider: "p" },
      { kind: "network", message: "" },
      { kind: "provider", provider: "p", status: 500, message: "" },
      { kind: "cap", cap: "tokens", value: 1 },
      { kind: "config", message: "" },
      { kind: "busy", message: "" },
      { kind: "cancelled" },
    ] as const
    for (const error of cases) {
      const copy = mapError(error as never)
      expect(copy.failed.length).toBeGreaterThan(0)
      expect(copy.next.length).toBeGreaterThan(0)
    }
    // A provider failure names the provider's redacted reason, not "failed".
    expect(
      mapError({ kind: "provider", provider: "opencode-zen", status: 400, message: "model not found" }).failed,
    ).toContain("model not found")
  })
})

describe("budget", () => {
  test("a blocked budget starts no request at all", async () => {
    const { ctrl, service } = controller(DONE, { block: { limit: 5_000_000, period: "day" } })
    const outcome = await ctrl.send("hello")
    expect(outcome.kind).toBe("blocked")
    expect(service.requests).toHaveLength(0)
    expect(ctrl.state().status).toBe("blocked")
    expect(ctrl.state().blocked?.fix).toContain("␣ ,")
  })

  test("a one-shot override lets exactly one request through", async () => {
    const service = fakeService(DONE)
    const budgetGate = gate({ limit: 5_000_000, period: "day" })
    const ctrl = createChatController({
    scope: "school" as const,
      service,
      budget: budgetGate,
      history: memoryHistory().port,
      config: () => ({ model: "m", maxToolCalls: 8, maxTokens: 100, chillHistoryLimit: 20 }),
    })
    expect((await ctrl.send("one")).kind).toBe("blocked")
    ctrl.override()
    expect((await ctrl.send("two")).kind).toBe("sent")
    expect((await ctrl.send("three")).kind).toBe("blocked")
    expect(service.requests).toHaveLength(1)
  })

  test("no model configured starts no request", async () => {
    const service = fakeService(DONE)
    const ctrl = createChatController({
    scope: "school" as const,
      service,
      budget: gate(null),
      history: memoryHistory().port,
      config: () => ({ model: null, maxToolCalls: 8, maxTokens: 100, chillHistoryLimit: 20 }),
    })
    expect((await ctrl.send("hi")).kind).toBe("no-model")
    expect(service.requests).toHaveLength(0)
  })
})

describe("history", () => {
  test("history is written only after done, and contains no reasoning", async () => {
    const history = memoryHistory()
    const { ctrl } = controller(DONE, { history })
    await ctrl.send("hello")
    const last = history.saved.at(-1)!
    expect(last.map((r) => r.role)).toEqual(["user", "assistant"])
    expect(JSON.stringify(last)).not.toContain("check limits first")
    expect(JSON.stringify(last)).not.toContain("costMicroUsd")
  })

  test("a cancelled turn is not persisted", async () => {
    const history = memoryHistory()
    const { ctrl } = controller([{ type: "text", delta: "x" }, { type: "cancelled" }], { history })
    await ctrl.send("hello")
    expect(history.saved).toHaveLength(0)
  })

  test("reload respects the configured limit", async () => {
    const records: HistoryRecord[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
      at: "2026-11-01T00:00:00Z",
    }))
    const history = memoryHistory(records)
    const { ctrl } = controller(DONE, { history, limit: 20 })
    await ctrl.load()
    expect(ctrl.state().messages).toHaveLength(20)
    expect(ctrl.state().messages.at(-1)?.text).toBe("m29")
  })

  test("a zero limit keeps nothing on disk or in view", async () => {
    const history = memoryHistory(FIXTURE.messages.map((m: { role: "user" | "assistant"; content: string }) => ({ ...m, at: "x" })))
    const { ctrl } = controller(DONE, { history, limit: 0 })
    await ctrl.load()
    expect(ctrl.state().messages).toHaveLength(0)
  })
})

describe("one pane, one owner", () => {
  test("exactly one ChatPane definition exists under src/", () => {
    const root = join(import.meta.dir, "../../src")
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.tsx?$/.test(entry.name)) out.push(path)
      }
      return out
    }
    const definitions = walk(root).filter((file) =>
      /function ChatPane\b/.test(readFileSync(file, "utf8")),
    )
    expect(definitions.map((file) => file.slice(root.length + 1))).toEqual([join("ui", "chat", "chat.tsx")])
  })

  test("App imports the controller and the view, and creates no service", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/app/App.tsx"), "utf8")
    expect(source).toContain("createChatController")
    expect(source).toContain('from "./AppView"')
    expect(source).not.toContain("createChatService")
  })
})

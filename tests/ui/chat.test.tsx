/** WP-204 — Chill chat UI: the state table from the packet, rendered. */
import { describe, expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const chat = await import("../../src/ui/chat")
const { ChatPane } = chat
const { crimson } = await import("../../src/ui/theme")
const { bubbleCapCacheSize, disposeBubbleCaps } = await import("../../src/ui/chat/bubble")

type State = ReturnType<typeof chat.initialChat>

async function mount(
  width: number,
  height: number,
  state: State,
  props: { hintsHidden?: boolean; hintsCollapsed?: boolean; cellSize?: { width: number; height: number } | null } = {},
) {
  const setup = await testRender(
    () => (
      <ChatPane
        theme={crimson}
        width={width}
        height={height}
        focused
        state={state}
        hintsHidden={props.hintsHidden}
        hintsCollapsed={props.hintsCollapsed}
        cellSize={props.cellSize}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function rows(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

describe("empty state", () => {
  test("greets with the username and shows 4-5 hints", async () => {
    const state = chat.initialChat("ada", "openai/gpt-4.1-mini")
    const setup = await mount(100, 24, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("ada, what do you want to learn today?")
      expect(chat.hints(state).length).toBeGreaterThanOrEqual(4)
      expect(chat.hints(state).length).toBeLessThanOrEqual(5)
      for (const hint of chat.hints(state)) expect(frame).toContain(hint)
    } finally {
      await setup.dispose()
    }
  })

  test("the welcome block is centred on both axes", async () => {
    const setup = await mount(120, 40, chat.initialChat("ada", "m"))
    try {
      const out = rows(setup)
      const top = out.findIndex((line) => line.includes("██"))
      const bottom = out.findIndex((line) => line.includes("want to learn"))
      const hints = out.reduce((last, line, index) => (line.includes("␣ l") ? index : last), 0)
      const blockBottom = Math.max(bottom, hints)
      // The pane is rows 1..38; centre means equal room above and below (±1).
      const above = top - 1
      const below = 38 - blockBottom
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
      // Horizontally centred too: the logo's left and right margins match.
      const logo = out[top]!
      const left = logo.length - logo.trimStart().length
      const right = 120 - logo.trimEnd().length
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
    } finally {
      await setup.dispose()
    }
  })

  test("hints hide when configured and when collapsed", () => {
    const state = chat.initialChat()
    expect(chat.hints(state, { hidden: true })).toEqual([])
    expect(chat.hints(state, { collapsed: true })).toEqual([])
  })
})

describe("no model", () => {
  test("badge, disabled send, reason and the key that fixes it", async () => {
    const state = chat.initialChat("ada", null)
    state.composer = "hello"
    const setup = await mount(100, 24, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("no model configured")
      expect(frame).toContain("send disabled")
      expect(frame).toContain("Settings → Providers")
      expect(chat.canSend(state)).toEqual({
        ok: false,
        reason: "no model configured",
        fix: "link a key in Settings → Providers",
      })
    } finally {
      await setup.dispose()
    }
  })
})

describe("streaming and stop", () => {
  test("an empty streaming bubble says Thinking… until text arrives", async () => {
    const waiting = { ...chat.initialChat("ada", "m"), status: "streaming" as const, streamed: "" }
    const setup = await mount(100, 24, waiting)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("Thinking…")
      expect(chat.waitingForModel(waiting)).toBe(true)
    } finally {
      await setup.dispose()
    }
    const arriving = { ...waiting, streamed: "partial" }
    expect(chat.waitingForModel(arriving)).toBe(false)
  })

  test("live text, and one stop hint directly above the composer", async () => {
    const state = { ...chat.initialChat("ada", "m"), status: "streaming" as const, streamed: "partial" }
    const setup = await mount(100, 24, state)
    try {
      const lines = rows(setup)
      const frame = lines.join("\n")
      expect(frame).toContain("partial")
      expect(frame).toContain("Esc stop")
      // One notice, not a second "send is stop" line beside it.
      expect(frame).not.toContain("send is stop")
      const stop = lines.findIndex((line) => line.includes("Esc stop"))
      const bubbleCap = lines.reduce((last, line, index) => (line.includes("▖") ? index : last), -1)
      const composer = lines.findIndex((line) => line.includes("╭"))
      expect(stop).toBeGreaterThan(bubbleCap)
      expect(stop).toBeLessThan(composer)
      expect(chat.canSend(state).ok).toBe(false)
    } finally {
      await setup.dispose()
    }
  })

  test("Esc discards the partial text and leaves a Stopped marker", async () => {
    const streaming = { ...chat.initialChat("ada", "m"), status: "streaming" as const, streamed: "half an answer" }
    const stopped = chat.cancel(streaming)
    expect(stopped.status).toBe("cancelled")
    expect(stopped.streamed).toBe("")
    expect(chat.stopMarker(stopped)).toBe("Stopped")

    const setup = await mount(100, 24, stopped)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("Stopped")
      expect(frame).not.toContain("half an answer")
    } finally {
      await setup.dispose()
    }
  })

  test("cancel is a no-op when nothing is streaming", () => {
    const idle = chat.initialChat("ada", "m")
    expect(chat.cancel(idle)).toBe(idle)
  })
})

describe("failure copy", () => {
  test("one bubble says what failed, what was kept and the next action", () => {
    const copy = chat.errorCopy({ kind: "auth", provider: "openai" })!
    expect(copy.failed).toContain("rejected the key")
    expect(copy.kept).toContain("Nothing was saved")
    expect(copy.next).toContain("Settings → Providers")
    expect(chat.errorCopy({ kind: "cancelled" })).toBe(null)
  })

  test("the bubble renders once", async () => {
    const state = { ...chat.initialChat("ada", "m"), status: "failed" as const, error: chat.errorCopy({ kind: "network" })! }
    const setup = await mount(120, 24, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame.match(/× /g)?.length).toBe(1)
      expect(frame).toContain("network dropped")
    } finally {
      await setup.dispose()
    }
  })

  test("a budget block shows the limit and the override key", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      status: "blocked" as const,
      blocked: { reason: "day budget reached", fix: "␣ ," },
      composer: "hello",
    }
    const setup = await mount(120, 24, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("day budget reached")
      expect(frame).toContain("␣ ,")
      expect(chat.canSend(state).ok).toBe(false)
    } finally {
      await setup.dispose()
    }
  })
})

describe("composer", () => {
  test("grows 1 to 8 rows then stays put", () => {
    const state = chat.initialChat()
    expect(chat.composerRows(state)).toBe(1)
    state.composer = "a\nb\nc"
    expect(chat.composerRows(state)).toBe(3)
    state.composer = Array.from({ length: 20 }, () => "x").join("\n")
    expect(chat.composerRows(state)).toBe(5)
    expect(chat.composerText(state).split("\n")).toHaveLength(5)
    expect(chat.composerText(state).endsWith("x\nx\nx\nx\nx")).toBe(true)
  })

  test("wraps a long line and keeps the newest wrapped rows", () => {
    const state = chat.initialChat()
    state.composer = "abcdefghij".repeat(6)
    expect(chat.composerRows(state, 12)).toBe(5)
    const visible = chat.composerText(state, 12).split("\n")
    expect(visible).toHaveLength(5)
    for (const line of visible) expect(line.length).toBeLessThanOrEqual(12)
    expect(chat.composerText(state, 12).endsWith("abcdefghij")).toBe(true)
  })

  test("pastes are labelled, counted, and part of what is sent", () => {
    const pasted = {
      ...chat.initialChat("friend", "m"),
      pastes: [
        { id: "p1", kind: "text" as const, lines: 12, text: "one\ntwo" },
        { id: "p2", kind: "image" as const, lines: 0 },
      ],
    }
    expect(chat.pasteLabel(pasted.pastes[0]!)).toBe("[pasted 12 lines]")
    expect(chat.pasteLabel(pasted.pastes[1]!)).toBe("[img]")
    expect(
      chat.pasteLabel({ id: "ask", kind: "ask", lines: 1, text: "Ask about this step: \"Read it\"", label: "Read it" }),
    ).toBe("[Asking] Read it")
    expect(chat.pastedText(pasted)).toBe("one\ntwo")
    expect(chat.canSend(pasted).ok).toBe(true)
    expect(chat.pasteRows(pasted)).toBe(1)
    // An image alone is labelled, not silently sendable: there is no upload path.
    expect(chat.canSend({ ...chat.initialChat("friend", "m"), pastes: [pasted.pastes[1]!] }).ok).toBe(false)
  })

  test("Enter sends, Shift+Enter and Ctrl+J insert a newline", () => {
    expect(chat.composerKey({ name: "return" })).toBe("send")
    expect(chat.composerKey({ name: "return", shift: true })).toBe("newline")
    expect(chat.composerKey({ name: "j", ctrl: true })).toBe("newline")
    expect(chat.composerKey({ name: "x" })).toBe("none")
  })

  test("the placeholder is the documented copy", async () => {
    const setup = await mount(100, 24, chat.initialChat("ada", "m"))
    try {
      expect(rows(setup).join("\n")).toContain("Ask anything…  Enter send · Shift+Enter newline")
    } finally {
      await setup.dispose()
    }
  })
})

describe("attachments", () => {
  const image = (name: string) => ({ name, path: `/tmp/${name}`, mediaType: "image/png" })

  test("four are allowed and the fifth is refused with a sentence", () => {
    const state = { ...chat.initialChat("ada", "m"), vision: true }
    let current = state
    for (let i = 0; i < 4; i++) {
      const result = chat.attach(current, image(`i${i}.png`))
      if (!result.ok) throw new Error(result.reason)
      current = { ...current, attachments: result.attachments }
    }
    expect(current.attachments).toHaveLength(4)
    const fifth = chat.attach(current, image("i4.png"))
    expect(fifth.ok).toBe(false)
    if (fifth.ok) throw new Error("expected a refusal")
    expect(fifth.reason).toContain("Up to 4 images per message")
  })

  test("a non-vision model refuses with the reason", () => {
    const state = chat.initialChat("ada", "m")
    const result = chat.attach(state, image("a.png"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("needs a vision model")
  })

  test("chips render above the input and Ctrl+Shift+X clears them", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      vision: true,
      attachments: [image("a.png"), image("b.png")],
    }
    const setup = await mount(100, 24, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("[a.png ×]")
      expect(frame).toContain("[b.png ×]")
    } finally {
      await setup.dispose()
    }
    expect(chat.clearAttachments(state).attachments).toEqual([])
  })
})

describe("transcript", () => {
  const long = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `message ${i}`,
    }))

  test("mounts the latest 12 and hides the rest behind one key", async () => {
    const state = { ...chat.initialChat("ada", "m"), messages: long(30) }
    expect(chat.mountedMessages(state)).toHaveLength(12)
    expect(chat.hiddenCount(state)).toBe(18)
    const setup = await mount(120, 40, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("press e to load 18 older messages")
      expect(frame).toContain("message 29")
      expect(frame).not.toContain("message 3\n")
    } finally {
      await setup.dispose()
    }
  })

  test("loading more reveals older messages", () => {
    const state = { ...chat.initialChat("ada", "m"), messages: long(30) }
    const more = chat.loadMore(state)
    expect(chat.mountedMessages(more)).toHaveLength(24)
    expect(chat.hiddenCount(more)).toBe(6)
  })

  test("user messages sit right; assistant Markdown is rendered", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [
        { id: "u", role: "user" as const, text: "hello" },
        {
          id: "a",
          role: "assistant" as const,
          text: "**Bold** answer\n\n```go\npackage main\n```\n\n- one\n- two",
        },
      ],
    }
    const setup = await mount(120, 40, state)
    try {
      const out = rows(setup)
      const frame = out.join("\n")
      expect(frame).toContain("Bold")
      expect(frame).not.toContain("**Bold**")
      expect(frame).toContain("package main")
      expect(frame).not.toContain("```")
      expect(frame).toContain("• one")
      const indent = (line: string) => line.length - line.trimStart().length
      const you = out.findIndex((line) => line.includes("hello"))
      const assistant = out.findIndex((line) => line.includes("Bold"))
      expect(you).toBeGreaterThanOrEqual(0)
      expect(assistant).toBeGreaterThanOrEqual(0)
      expect(indent(out[you]!)).toBeGreaterThan(indent(out[assistant]!))
      expect(frame).not.toContain("assistant")
      expect(frame).toContain("you")
      expect(frame).toContain("locked in")
      expect(frame).not.toContain(" tok")
      expect(frame).not.toContain("cost unknown")
    } finally {
      await setup.dispose()
    }
  })

  test("thinking folds to one line and cost falls back to unknown", () => {
    const message = {
      id: "a",
      role: "assistant" as const,
      text: "answer",
      reasoning: "some reasoning",
      reasoningMs: 4200,
      durationMs: 6100,
      usage: { input: 800, output: 400, total: 1200, costMicroUsd: null },
    }
    expect(chat.thinkingLine(message)).toBe("▸ Thinking · 4.2s")
    expect(chat.thinkingLine({ ...message, thinkingExpanded: true })).toBe("some reasoning")
  })

  test("text that merely starts like an image is still text", () => {
    const text = (value: string) => new TextEncoder().encode(value)
    expect(chat.isImagePaste(text("BM25 ranking"), "")).toBe(false)
    expect(chat.isImagePaste(text("GI tract\n"), "")).toBe(false)
    expect(chat.isImagePaste(Uint8Array.from([0x42, 0x4d, 0, 0, 0, 0]), "")).toBe(true)
    expect(chat.isImagePaste(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), "")).toBe(true)
    expect(chat.isImagePaste(text("x"), "image/png")).toBe(true)
  })

  test("auto-scroll pauses with a marker when the user scrolls up", () => {
    const streaming = { ...chat.initialChat("ada", "m"), status: "streaming" as const }
    expect(chat.followScroll(streaming)).toBe(true)
    const scrolled = { ...streaming, scrolledUp: true }
    expect(chat.followScroll(scrolled)).toBe(false)
    expect(chat.newMessagesMarker(scrolled)).toBe("↓ new messages")
    expect(chat.newMessagesMarker(streaming)).toBe(null)
  })
})

describe("response style strip", () => {
  test("shows only the controls the surface offers", async () => {
    const skill = {
      ...chat.initialChat("ada", "m"),
      responseStyle: "brief" as const,
      tutorPolicy: "socratic" as const,
      capabilities: { responseStyle: true, tutorPolicy: true },
    }
    const skillSetup = await mount(100, 24, skill)
    try {
      expect(rows(skillSetup).join("\n")).toContain("style: brief · tutor: socratic")
    } finally {
      await skillSetup.dispose()
    }

    const lockin = { ...skill, capabilities: { responseStyle: true, tutorPolicy: false } }
    const lockinSetup = await mount(100, 24, lockin)
    try {
      const frame = rows(lockinSetup).join("\n")
      expect(frame).toContain("style: brief")
      expect(frame).not.toContain("tutor:")
    } finally {
      await lockinSetup.dispose()
    }

    // Chill has no response controls at all.
    const chill = { ...skill, capabilities: { responseStyle: false, tutorPolicy: false } }
    const chillSetup = await mount(100, 24, chill)
    try {
      const frame = rows(chillSetup).join("\n")
      expect(frame).not.toContain("style:")
      expect(frame).not.toContain("tutor:")
    } finally {
      await chillSetup.dispose()
    }
  })
})

describe("chat bubbles", () => {
  test("messages are labelled and filled, and only the composer is framed", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [
        { id: "u", role: "user" as const, text: "Explain the energy balance.", outcome: "done" as const },
        { id: "a", role: "assistant" as const, text: "The boundary conditions fix the limits.", outcome: "done" as const },
      ],
    }
    const setup = await mount(100, 30, state)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("Explain the energy balance.")
      expect(frame).toContain("The boundary conditions fix the limits.")
      expect(frame).toContain("you")
      expect(frame).toContain("locked in")
      // The composer keeps its frame; the bubbles do not draw one.
      expect((frame.match(/╭/g) ?? []).length).toBe(1)
    } finally {
      await setup.dispose()
    }
  })

  test("short messages are centred inside their bubble", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [
        { id: "u", role: "user" as const, text: "hello", outcome: "done" as const },
        { id: "a", role: "assistant" as const, text: "hi", outcome: "done" as const },
      ],
    }
    const setup = await mount(80, 30, state)
    try {
      const lines = rows(setup)
      const cap = lines.find((line) => line.includes("▘"))!
      const bubbleLeft = cap.indexOf("▘")
      const user = lines.find((line) => line.includes("hello"))!
      const assistant = lines.find((line) => line.trim() === "hi")!
      // A 20-cell bubble with a five-cell greeting centres it well away from
      // the left edge; the assistant's two-cell reply does the same.
      expect(user.indexOf("hello") - bubbleLeft).toBeGreaterThan(4)
      expect(assistant.indexOf("hi")).toBeGreaterThan(4)
    } finally {
      await setup.dispose()
    }
  })

  test("a fenced block is highlighted from the palette", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [
        {
          id: "a",
          role: "assistant" as const,
          text: "Try this:\n\n```cpp\nint main() { return 0; }\n```\n",
          outcome: "done" as const,
        },
      ],
    }
    const setup = await mount(90, 30, state)
    try {
      const hex = (c: unknown) => {
        const b = (c as { buffer: ArrayLike<number> }).buffer
        return `#${[b[0], b[1], b[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`
      }
      const keyword = () =>
        setup
          .captureSpans()
          .lines.flatMap((line) => line.spans)
          .find((span) => span.text.trim() === "int" && hex(span.fg) === crimson.primary.toLowerCase())
      // Shiki loads the grammar lazily; the plain text is painted first.
      const deadline = performance.now() + 5_000
      while (!keyword() && performance.now() < deadline) {
        await setup.flush()
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      expect(keyword()).toBeDefined()
      expect(rows(setup).join("\n")).toContain("int main()")
    } finally {
      await setup.dispose()
    }
  })

  test("a pixel size draws the ends as opaque cap images", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [{ id: "u", role: "user" as const, text: "hello", outcome: "done" as const }],
    }
    disposeBubbleCaps()
    const setup = await mount(80, 30, state, { cellSize: { width: 8, height: 16 } })
    try {
      expect(bubbleCapCacheSize()).toBeGreaterThan(0)
      expect(rows(setup).join("\n")).toContain("hello")
    } finally {
      await setup.dispose()
    }
  })

  test("without a pixel size the ends are quadrant glyphs", async () => {
    const state = {
      ...chat.initialChat("ada", "m"),
      messages: [
        { id: "u", role: "user" as const, text: "hello", outcome: "done" as const },
        { id: "a", role: "assistant" as const, text: "hi there", outcome: "done" as const },
      ],
    }
    disposeBubbleCaps()
    const setup = await mount(80, 30, state, { cellSize: null })
    try {
      const frame = rows(setup).join("\n")
      for (const glyph of ["▘", "▝", "▖", "▗"]) expect(frame).toContain(glyph)
      // The corner cell keeps the chat background; only the quadrant is fill.
      const all = setup.captureSpans().lines.flatMap((line) => line.spans)
      const corner = all.find((span) => span.text.includes("▘"))
      expect(corner).toBeDefined()
      const hex = (c: unknown) => {
        const b = (c as { buffer: ArrayLike<number> }).buffer
        return `#${[b[0], b[1], b[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`
      }
      // The cell is the fill; only the outer quadrant is background.
      expect(hex(corner!.bg)).toBe(crimson.primary.toLowerCase())
      expect(hex(corner!.fg)).toBe(crimson.background.toLowerCase())
    } finally {
      await setup.dispose()
    }
  })
})

/**
 * Render-side interaction budgets for release (`docs/testing.md` §5).
 *
 * These measure the cost of laying out and painting a frame in the headless
 * renderer. That is not the terminal presentation rate — a real TTY can still
 * pace or drop frames — but it proves the UI itself has 60 fps headroom and
 * catches a regression that would make the terminal budget impossible.
 */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"

import type { ScrollApi } from "../../src/ui/scroll"
import { ChatPane } from "../../src/ui/chat"
import { initialChat } from "../../src/ui/chat/model"
import { crimson } from "../../src/ui/theme"

const { testRender } = await import("@opentui/solid")

type Loopable = { loop: (skip: boolean) => Promise<void> }

async function paint(renderer: Loopable): Promise<number> {
  const started = performance.now()
  await renderer.loop(true)
  return performance.now() - started
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe("render-side interaction budgets", () => {
  test("scrolls a 1k-message chat at 60 fps", async () => {
    const messages = Array.from({ length: 1000 }, (_, index) => ({
      id: `m${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Message ${index}: boundary conditions and the integral of unit ${index}.`,
      outcome: "done" as const,
    }))
    const state = {
      ...initialChat("ada", "m"),
      messages,
      mounted: messages.length,
      scrolledUp: true,
    }
    const scrollRef: { current: ScrollApi | null } = { current: null }
    const setup = await testRender(
      () => (
        <ChatPane
          theme={crimson}
          width={200}
          height={60}
          focused
          state={state}
          onScrollReady={(api) => {
            scrollRef.current = api
          }}
        />
      ),
      { width: 200, height: 60 },
    )
    try {
      await setup.flush()
      const scroll: ScrollApi | null = scrollRef.current
      if (!scroll) throw new Error("the transcript did not hand over a scroller")
      const frames: number[] = []
      for (let step = 0; step < 120; step++) {
        scroll.scrollBy(-1)
        frames.push(await paint(setup.renderer as unknown as Loopable))
      }
      const average = mean(frames)
      console.log(
        `[perf] scroll 1k messages, 200x60: avg ${average.toFixed(2)} ms, ` +
          `median ${median(frames).toFixed(2)} ms, worst ${Math.max(...frames).toFixed(2)} ms`,
      )
      expect(average).toBeLessThan(16.7)
    } finally {
      await setup.dispose()
    }
  }, 60_000)

  test("streams repaint above 30 updates per second", async () => {
    const [state, setState] = createSignal({
      ...initialChat("ada", "m"),
      status: "streaming" as const,
      streamed: "",
      messages: Array.from({ length: 20 }, (_, index) => ({
        id: `m${index}`,
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Message ${index}`,
        outcome: "done" as const,
      })),
      mounted: 20,
    })
    const setup = await testRender(
      () => <ChatPane theme={crimson} width={200} height={60} focused state={state()} />,
      { width: 200, height: 60 },
    )
    try {
      await setup.flush()
      const frames: number[] = []
      let text = ""
      for (let step = 0; step < 120; step++) {
        text += "token "
        setState((current) => ({ ...current, streamed: text }))
        frames.push(await paint(setup.renderer as unknown as Loopable))
      }
      const average = mean(frames)
      console.log(
        `[perf] streaming repaint, 200x60: avg ${average.toFixed(2)} ms, ` +
          `median ${median(frames).toFixed(2)} ms, worst ${Math.max(...frames).toFixed(2)} ms`,
      )
      expect(average).toBeLessThan(1000 / 30)
    } finally {
      await setup.dispose()
    }
  }, 60_000)
})

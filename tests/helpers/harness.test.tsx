/**
 * Spike S8 — the harness itself is the subject.
 *
 * These tests must pass without any wall-clock sleep. The pending-port case is
 * the one that proves it: an assertion taken before the wait must fail, and the
 * same assertion after `waitFor` must pass. If the harness ever regressed to a
 * sleep, the "still pending" guard below would start passing and fail the test.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { useKeyboard } from "@opentui/solid"
import { createSignal } from "solid-js"

import { renderApp, type AppHarness } from "./render"

let harness: AppHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe("renderApp — the real App", () => {
  test.serial("renders the shell without a TTY and without a sleep", async () => {
    harness = await renderApp({ width: 100, height: 24 })

    const frame = await harness.waitFor("LOCKEDIN")
    expect(frame).toContain("a terminal workspace for learning")
    expect(frame).toContain("NORMAL")
    expect(frame).toContain("no model")
  })

  test.serial("keeps the frame stable when nothing happens", async () => {
    harness = await renderApp({ width: 80, height: 24 })
    const first = await harness.waitFor("CHILL")
    await harness.idle()
    expect(harness.frame()).toBe(first)
  })

  test.serial("a handled key reaches the renderer (Ctrl+Q destroys it)", async () => {
    harness = await renderApp({ width: 100, height: 24 })
    await harness.waitFor("LOCKEDIN")

    expect(harness.renderer.isDestroyed).toBe(false)
    harness.mockInput.pressKey("q", { ctrl: true })
    await harness.waitUntil(() => harness!.renderer.isDestroyed)
    expect(harness.renderer.isDestroyed).toBe(true)
  })

  test.serial("an unhandled key leaves the frame unchanged", async () => {
    harness = await renderApp({ width: 100, height: 24 })
    const before = await harness.waitFor("LOCKEDIN")
    const after = await harness.press("z")
    expect(after).toBe(before)
  })

  test.serial("renders at 200x60 and 80x24 without clipping the top bar", async () => {
    harness = await renderApp({ width: 200, height: 60 })
    const wide = await harness.waitFor("LOCKEDIN")
    expect(wide.split("\n")[0]).toContain("LOCKEDIN")
    expect(wide.split("\n")[0]).toContain("no model")

    const narrow = await harness.resize(80, 24)
    expect(narrow.split("\n")[0]).toContain("LOCKEDIN")
    expect(narrow.split("\n")[0]).toContain("no model")
  })
})

describe("port assertions and deterministic waits", () => {
  test.serial("asserts the port call, not component internals", async () => {
    const calls: string[] = []
    let release: ((answer: string) => void) | undefined
    const port = {
      ask: (question: string) => {
        calls.push(question)
        return new Promise<string>((resolve) => {
          release = resolve
        })
      },
    }

    harness = await renderApp({ width: 80, height: 12, app: () => <FakeChat port={port} /> })
    await harness.waitFor("ready")

    await harness.type("hello")
    expect(harness.shows("you: hello")).toBe(false)
    const submitted = await harness.press("ENTER")
    expect(submitted).toContain("you: hello")

    // The port was called — that is the contract, not the component's state.
    expect(calls).toEqual(["hello"])

    // Still pending: the frame must not show an answer yet.
    expect(harness.frame()).not.toContain("answer to hello")
    expect(harness.frame()).toContain("waiting")

    release?.("answer to hello")
    const answered = await harness.waitFor("answer to hello")
    expect(answered).toContain("answer to hello")
    expect(answered).not.toContain("waiting")
  })

  test.serial("a wait that cannot be satisfied fails fast instead of hanging", async () => {
    harness = await renderApp({
      width: 80,
      height: 12,
      app: () => <FakeChat port={{ ask: () => Promise.resolve("x") }} />,
      maxPasses: 8,
    })
    await harness.waitFor("ready")

    const error = await harness.waitFor("never rendered", { maxPasses: 8 }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("Timed out waiting for frame predicate")
  })

  test.serial("type() is delivered key by key and settles the frame", async () => {
    harness = await renderApp({
      width: 40,
      height: 8,
      app: () => <FakeChat port={{ ask: () => Promise.resolve("ok") }} />,
    })
    await harness.waitFor("ready")

    const frame = await harness.type("abc")
    expect(frame).toContain("abc")
    expect(frame).toContain("ready")
  })

  test.serial("waitUntil waits for work that completes after the frame is idle", async () => {
    // The port stays pending until the test resolves it on a later macrotask,
    // so the renderer is already visually idle when the promise settles. A
    // `waitFor`/`idle` would stop there; `waitUntil` must yield and keep polling.
    let release!: () => void
    const port = {
      ask: () =>
        new Promise<string>((resolve) => {
          release = () => resolve("late answer")
        }),
    }
    harness = await renderApp({ width: 80, height: 12, app: () => <FakeChat port={port} /> })
    await harness.waitFor("ready")

    await harness.type("hello")
    await harness.press("ENTER")
    // Pending by construction: nothing has resolved the port yet.
    expect(harness.frame()).not.toContain("late answer")

    setTimeout(() => release(), 0)
    await harness.waitUntil(() => harness!.frame().includes("late answer"))
    expect(harness.frame()).toContain("late answer")
    expect(harness.frame()).not.toContain("waiting")
  })

  test.serial("waitUntil names its deadline and the last frame when it cannot pass", async () => {
    harness = await renderApp({
      width: 40,
      height: 8,
      app: () => <FakeChat port={{ ask: () => Promise.resolve("ok") }} />,
    })
    await harness.waitFor("ready")

    const error = await harness
      .waitUntil(() => false, { timeoutMs: 30 })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )

    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("waitUntil timed out after 30 ms")
    expect(String((error as Error).message)).toContain("last frame")
  })
})

/**
 * Minimal screen used only by this test: renders a transcript and calls a port.
 * It deliberately completes asynchronously (the port resolves later), which is
 * the case a bare `expect(frame)` right after `press` gets wrong.
 */
function FakeChat(props: { port: { ask(question: string): Promise<string> } }) {
  const [question, setQuestion] = createSignal("")
  const [transcript, setTranscript] = createSignal<string[]>([])
  const [status, setStatus] = createSignal<"ready" | "waiting">("ready")

  const submit = async () => {
    const asked = question()
    if (asked === "") return
    setTranscript((lines) => [...lines, `you: ${asked}`])
    setQuestion("")
    setStatus("waiting")
    const answer = await props.port.ask(asked)
    setTranscript((lines) => [...lines, answer])
    setStatus("ready")
  }

  useKeyboard((event) => {
    if (event.eventType === "release") return
    if (event.name === "return") {
      void submit()
      return
    }
    if (event.name === "backspace") {
      setQuestion((current) => current.slice(0, -1))
      return
    }
    if (!event.ctrl && !event.meta && event.sequence.length === 1 && event.sequence >= " ") {
      setQuestion((current) => current + event.sequence)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <text>fake chat {status()}</text>
      <text>input: {question()}</text>
      {transcript().map((line) => (
        <text>{line}</text>
      ))}
    </box>
  )
}

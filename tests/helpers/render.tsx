/**
 * Headless UI test harness (spike S8).
 *
 * One entry point — `renderApp()` — returns a handle that injects keys, waits
 * on the renderer's own frame loop, and snapshots the character frame. No test
 * written on top of this should need `Bun.sleep` or any other wall-clock wait.
 *
 * Requirements: run under the Solid transform preload, because every `.tsx`
 * entry needs it for reactivity to exist at all:
 *
 *   bun test --preload @opentui/solid/preload tests/helpers
 *
 * See `spikes/s8-ui-harness/README.md` for wait semantics and flake risks.
 */

import { testRender } from "@opentui/solid"
import type { TestWaitForOptions, TestRendererSetup } from "@opentui/core/testing"
import type { JSX } from "solid-js"

import { App } from "../../src/app/App"

/** Frames the harness may pump before a wait fails. Bounds a stalled renderer. */
export const DEFAULT_MAX_PASSES = 60

export const DEFAULT_WIDTH = 100
export const DEFAULT_HEIGHT = 24

export type FramePredicate = string | RegExp | ((frame: string) => boolean)

/** Bounded poll for `waitUntil`; a deadline, never a fixed sleep. */
export type SettleOptions = {
  /** Wall-clock bound on the poll. Defaults to 2000 ms. */
  timeoutMs?: number
}

/** Default bound for `waitUntil`. Only a failing wait pays it. */
export const DEFAULT_SETTLE_TIMEOUT_MS = 2000

export type KeyModifiers = {
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  super?: boolean
  hyper?: boolean
}

/**
 * Friendly key names → the escape sequences OpenTUI's mock input understands.
 * `press("enter")` is what tests should write; the mapping keeps the sequence
 * table in one place instead of repeating `"RETURN"` at every call site.
 */
const NAMED_KEYS: Record<string, string> = {
  enter: "RETURN",
  return: "RETURN",
  escape: "ESCAPE",
  esc: "ESCAPE",
  tab: "TAB",
  backspace: "BACKSPACE",
  delete: "DELETE",
  home: "HOME",
  end: "END",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  space: " ",
}

/** Resolve a friendly key name to the sequence the mock input expects. */
export function resolveKeyName(key: string): string {
  return NAMED_KEYS[key.toLowerCase()] ?? key
}

export type RenderOptions = {
  /** Terminal width in cells. Defaults to 100. */
  width?: number
  /** Terminal height in cells. Defaults to 24. */
  height?: number
  /** Component under test. Defaults to the real `App`. */
  app?: () => JSX.Element
  /** Cap on frame-loop passes per wait. */
  maxPasses?: number
  /** Renderer mode. Split-footer tests commit chat history to scrollback. */
  screenMode?: "alternate-screen" | "main-screen" | "split-footer"
  externalOutputMode?: "capture-stdout" | "passthrough"
}

export type AppHarness = {
  /** The raw OpenTUI setup, for tests that need renderer internals. */
  readonly setup: TestRendererSetup
  readonly renderer: TestRendererSetup["renderer"]
  readonly mockInput: TestRendererSetup["mockInput"]
  /** Current character frame, exactly as the renderer would present it. */
  frame(): string
  /** Current frame split into lines, trailing blanks removed. */
  lines(): string[]
  /** True when the current frame contains `text` (or matches `pattern`). */
  shows(pattern: FramePredicate): boolean
  /**
   * Pump the frame loop until the rendered frame matches.
   * Resolves with the matching frame; throws (with the last frame attached)
   * when `maxPasses` is exhausted.
   */
  waitFor(pattern: FramePredicate, options?: TestWaitForOptions): Promise<string>
  /**
   * Yield the event loop and pump frames until an arbitrary predicate holds —
   * for service calls, ports, store slices and text produced by async work.
   *
   * `waitFor`/`idle` only pump while the renderer has a frame scheduled, so a
   * component awaiting file IO looks visually idle: the frame is stable, the
   * work is not done, and a positive assertion races it. This helper gives the
   * event loop a real turn (not a fixed sleep) before each check and stops at
   * `timeoutMs`, so it is deterministic and only slow when it fails.
   */
  waitUntil(predicate: () => boolean | Promise<boolean>, options?: SettleOptions): Promise<void>
  /** Pump the frame loop until the renderer is visually idle. */
  idle(maxPasses?: number): Promise<void>
  /** Send one key (optionally with modifiers) and settle the frame. */
  press(key: string, modifiers?: KeyModifiers): Promise<string>
  /** Type literal text and settle the frame. */
  type(text: string): Promise<string>
  /** Resize the virtual terminal and settle the frame. */
  resize(width: number, height: number): Promise<string>
  /** Snapshot helper: the frame plus its lines, for assertions and reports. */
  snapshot(): { frame: string; lines: string[]; width: number; height: number }
  /** Destroy the renderer and wait for it to close. Idempotent. */
  dispose(): Promise<void>
}

function toPredicate(pattern: FramePredicate): (frame: string) => boolean {
  if (typeof pattern === "function") return pattern
  if (pattern instanceof RegExp) {
    return (frame) => {
      pattern.lastIndex = 0
      return pattern.test(frame)
    }
  }
  return (frame) => frame.includes(pattern)
}

/**
 * Render a component headlessly and wrap it in the harness API.
 *
 * The default component is the real `App`, so `renderApp({ width, height })`
 * is enough for shell-level tests; later screen tests pass `{ app: () => <X /> }`.
 */
export async function renderApp(options: RenderOptions = {}): Promise<AppHarness> {
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES
  const component = options.app ?? (() => <App />)

  // `kittyKeyboard` is not cosmetic: without it the mock input sends a lone
  // `\x1b` for Esc, which the terminal parser treats as the start of a sequence
  // that never arrives, so no key event is ever delivered. The kitty protocol
  // encodes Esc unambiguously (`\x1b[27u`), so `press("escape")` reaches the app.
  // Before this, no test in the suite had ever delivered Esc through the shell —
  // which is why the "Esc returns to chat" claim went unverified.
  const setup = await testRender(component, {
    width,
    height,
    kittyKeyboard: true,
    ...(options.screenMode ? { screenMode: options.screenMode } : {}),
    ...(options.externalOutputMode ? { externalOutputMode: options.externalOutputMode } : {}),
  })
  let disposed = false

  const harness: AppHarness = {
    setup,
    renderer: setup.renderer,
    mockInput: setup.mockInput,

    frame: () => setup.captureCharFrame(),

    lines: () => trimTrailingBlankLines(setup.captureCharFrame()),

    shows: (pattern) => toPredicate(pattern)(setup.captureCharFrame()),

    waitFor: (pattern, waitOptions) =>
      setup.waitForFrame(toPredicate(pattern), { maxPasses, ...waitOptions }),

    waitUntil: async (predicate, waitOptions) => {
      const timeoutMs = waitOptions?.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS
      const deadline = performance.now() + timeoutMs
      for (;;) {
        // A real event-loop turn (not a fixed delay) lets queued fs, network
        // and timer callbacks run before the renderer is declared settled.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        try {
          await setup.flush({ maxPasses })
        } catch {
          // A busy renderer is retried until the deadline; the deadline is the
          // only failure condition so a transient frame flood cannot flake.
        }
        if (await predicate()) return
        if (performance.now() >= deadline) {
          throw new Error(
            `waitUntil timed out after ${timeoutMs} ms\nlast frame:\n${setup.captureCharFrame()}`,
          )
        }
      }
    },

    idle: (idleMaxPasses) => setup.flush({ maxPasses: idleMaxPasses ?? maxPasses }),

    async press(key, modifiers) {
      setup.mockInput.pressKey(resolveKeyName(key), modifiers)
      await harness.idle()
      return harness.frame()
    },

    async type(text) {
      await setup.mockInput.typeText(text)
      await harness.idle()
      return harness.frame()
    },

    async resize(nextWidth, nextHeight) {
      setup.resize(nextWidth, nextHeight)
      await harness.idle()
      return harness.frame()
    },

    snapshot: () => {
      const frame = setup.captureCharFrame()
      return {
        frame,
        lines: trimTrailingBlankLines(frame),
        width: setup.renderer.width,
        height: setup.renderer.height,
      }
    },

    async dispose() {
      if (disposed) return
      disposed = true
      await setup.dispose()
    },
  }

  return harness
}

/** Split a frame into lines and drop trailing all-blank lines. */
export function trimTrailingBlankLines(frame: string): string[] {
  const lines = frame.split("\n")
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop()
  return lines
}

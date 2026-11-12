import { expect, test } from "bun:test"

import {
  AppEffects,
  createAppEffects,
  findComposerCursor,
  resolveEffectsOptions,
  selectSystems,
} from "../../src/ui/effects/app-effects"
import { crimson } from "../../src/ui/theme/palettes"
import type { SceneHost } from "../../src/ui/effects/app-effects"

test("effects are opt-in and reduced motion wins", () => {
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "1" })).toEqual({
    enabled: true,
    trail: true,
    particles: true,
    layer: "under",
  })
  expect(resolveEffectsOptions({}).enabled).toBe(false)
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "1", LOCKEDIN_REDUCED_MOTION: "1" })).toEqual({
    enabled: false,
    trail: false,
    particles: false,
    layer: "under",
  })
})

test("the trail and the particles can be enabled separately", () => {
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "trail" })).toEqual({
    enabled: true,
    trail: true,
    particles: false,
    layer: "under",
  })
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "particles" }).particles).toBe(true)
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "fireflies" }).trail).toBe(false)
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "nope" }).enabled).toBe(false)
})

test("the text layer can be selected, with a safe fallback", () => {
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "1", LOCKEDIN_EFFECTS_LAYER: "around" }).layer).toBe("around")
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "1", LOCKEDIN_EFFECTS_LAYER: "over" }).layer).toBe("over")
  expect(resolveEffectsOptions({ LOCKEDIN_EFFECTS: "1", LOCKEDIN_EFFECTS_LAYER: "nope" }).layer).toBe("under")
})

function frame(lines: string[][]): import("@opentui/core").OptimizedBuffer {
  return {
    width: Math.max(...lines.map((spans) => spans.reduce((n, text) => n + text.length, 0))),
    height: lines.length,
    getSpanLines: () =>
      lines.map((spans) => ({
        spans: spans.map((text) => ({ text, width: text.length, attributes: 0 })),
      })),
  } as unknown as import("@opentui/core").OptimizedBuffer
}

test("the composer cursor is found by its glyph", () => {
  const buffer = frame([["LOCKEDIN"], ["the quick "], ["Ask anything"]])
  const withCursor = frame([["LOCKEDIN"], ["the quick "], ["ab\u258fc"]])
  expect(findComposerCursor(buffer)).toBeNull()
  expect(findComposerCursor(withCursor)).toEqual({ x: 2, y: 2 })
})

test("the last line with the glyph wins", () => {
  const buffer = frame([["a\u258f"], ["b\u258f"]])
  expect(findComposerCursor(buffer)).toEqual({ x: 1, y: 1 })
})

test("examples are selected by short name, id, or all", () => {
  const systems = [
    { id: "example.fireflies" },
    { id: "example.sparks" },
    { id: "user.own" },
  ] as unknown as import("../../src/ui/effects/api").ParticleSystem[]
  expect(selectSystems({}, systems).map((s) => s.id)).toEqual([
    "example.fireflies",
    "example.sparks",
    "user.own",
  ])
  expect(selectSystems({ LOCKEDIN_EFFECTS_SYSTEMS: "sparks,user.own" }, systems).map((s) => s.id)).toEqual([
    "example.sparks",
    "user.own",
  ])
  expect(selectSystems({ LOCKEDIN_EFFECTS_SYSTEMS: "example.sparks" }, systems).map((s) => s.id)).toEqual([
    "example.sparks",
  ])
  expect(selectSystems({ LOCKEDIN_EFFECTS_SYSTEMS: "nope" }, systems)).toEqual([])
})

function fakeRenderer(): import("@opentui/core").CliRenderer {
  return {
    addPostProcessFn() {},
    removePostProcessFn() {},
    onAnimationTick() {
      return () => {}
    },
    requestRender() {},
  } as unknown as import("@opentui/core").CliRenderer
}

function fakeHost(): import("../../src/ui/effects/host").EffectHost & { disposed: number } {
  return {
    layer: "around",
    particleCount: 0,
    disposed: 0,
    setCursor() {},
    resize() {},
    event() {},
    update() {},
    particles: () => [],
    clear() {},
    dispose() {
      this.disposed += 1
    },
  }
}

function effects(hosts: Array<{ id: string; host: import("../../src/ui/effects/host").EffectHost }> = []): AppEffects {
  return new AppEffects(
    fakeRenderer(),
    () => crimson,
    { enabled: true, trail: false, particles: true, layer: "around" },
    hosts,
  )
}

test("replacing hosts swaps what is mounted and disposes the old one", () => {
  const first = fakeHost()
  const running = effects([{ id: "user.a", host: first }])
  expect(running.systemIds).toEqual(["user.a"])
  running.setHosts([
    { id: "user.b", host: fakeHost() },
    { id: "user.c", host: fakeHost() },
  ])
  expect(running.systemIds).toEqual(["user.b", "user.c"])
  expect(first.disposed).toBe(1)
})

test("an invalid in-process system is not mounted", () => {
  const running = createAppEffects(
    fakeRenderer(),
    () => crimson,
    { LOCKEDIN_EFFECTS: "particles" },
    { systems: [{ id: "has spaces" }] as unknown as import("../../src/ui/effects/api").ParticleSystem[] },
  )
  expect(running?.systemIds).not.toContain("has spaces")
})

test("createAppEffects appends loaded systems and sandbox hosts to the examples", () => {
  const sandbox = fakeHost()
  const running = createAppEffects(
    fakeRenderer(),
    () => crimson,
    { LOCKEDIN_EFFECTS: "particles" },
    {
      systems: [{ id: "user.loaded" }] as unknown as import("../../src/ui/effects/api").ParticleSystem[],
      hosts: [{ id: "plugin.sandboxed", host: sandbox }],
    },
  )
  expect(running?.systemIds).toContain("user.loaded")
  expect(running?.systemIds).toContain("demo.fireflies")
  expect(running?.systemIds).toContain("plugin.sandboxed")
})

function fakeScene(ids: string[] = []): import("../../src/ui/effects/app-effects").SceneHost & { disposed: number } {
  return {
    hasScene: true,
    fps: 4,
    disposed: 0,
    onScene: null,
    resize() {},
    compose() {},
    nodes: () => [],
    focusableIds: () => ids,
    dispose() {
      this.disposed += 1
    },
  }
}

test("scene hosts are swapped and disposed", () => {
  const first = fakeScene()
  const running = new AppEffects(
    fakeRenderer(),
    () => crimson,
    { enabled: true, trail: false, particles: true, layer: "around" },
    [],
    [{ id: "scene.a", host: first }],
    () => ({ width: 80, height: 24 }),
  )
  expect(first.onScene).not.toBeNull()
  const second = fakeScene()
  running.setSceneHosts([{ id: "scene.b", host: second }])
  expect(first.disposed).toBe(1)
  expect(second.onScene).not.toBeNull()
})

test("plugin window focus cycles across hosts and is exposed per host", () => {
  const first = fakeScene(["main", "inner"])
  const second = fakeScene(["queue"])
  const running = new AppEffects(
    fakeRenderer(),
    () => crimson,
    { enabled: true, trail: false, particles: true, layer: "around" },
    [],
    [
      { id: "p", host: first },
      { id: "q", host: second },
    ],
    () => ({ width: 80, height: 24 }),
  )
  // The first focusable window is active before the first key.
  expect(running.focusedWindowFor("p")).toBe("main")
  expect(running.cycleFocus(1)).toBe("p/inner")
  expect(running.focusedWindowFor("p")).toBe("inner")
  expect(running.cycleFocus(1)).toBe("q/queue")
  expect(running.focusedWindowFor("p")).toBeNull()
  expect(running.focusedWindowFor("q")).toBe("queue")
  expect(running.cycleFocus(1)).toBe("p/main")
  expect(running.cycleFocus(-1)).toBe("q/queue")
})

test("pointer events route to the topmost plugin cell and dedupe hover", () => {
  let paint: ((buffer: unknown) => void) | null = null
  const renderer = {
    addPostProcessFn(fn: (buffer: unknown) => void) {
      paint = fn
    },
    removePostProcessFn() {},
    onAnimationTick() {
      return () => {}
    },
    requestRender() {},
    useMouse: false,
  } as unknown as import("@opentui/core").CliRenderer
  const calls: Array<{ type: string; target: Record<string, unknown> }> = []
  const host = {
    hasScene: true,
    fps: 4,
    hasPointer: true,
    focusableIds: () => ["panel"],
    resize() {},
    compose() {},
    nodes: () => [
      {
        kind: "group",
        id: "panel",
        focusable: true,
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 12,
        height: 6,
        nodes: [
          { kind: "hit", anchor: "absolute", x: 2, y: 2, width: 4, height: 1, row: 1, column: 2 },
        ],
      },
    ],
    onScene: null,
    runPointer(type: string, target: Record<string, unknown>) {
      calls.push({ type, target })
    },
  } as unknown as SceneHost
  const running = new AppEffects(
    renderer,
    () => crimson,
    { enabled: true, trail: false, particles: false, layer: "under" },
    [],
    [{ id: "p", host }],
    () => ({ width: 40, height: 12 }),
  )
  running.start()
  expect(paint).not.toBeNull()
  paint!({
    width: 40,
    height: 12,
    getSpanLines() {
      throw new Error("no spans")
    },
    fillRect() {},
    setCell() {},
    drawText() {},
  })

  // The window spans 1..13 x 1..7; the cell hit is at 3..7 x 3..4.
  expect(running.pointer("click", 3, 3)).toBe(true)
  expect(calls[0]).toEqual({
    type: "click",
    target: { x: 3, y: 3, window: "panel", row: 1, column: 2 },
  })
  expect(running.pointer("click", 20, 20)).toBe(false)

  // Hover is sent once per distinct target.
  expect(running.pointer("hover", 3, 3)).toBe(true)
  expect(running.pointer("hover", 3, 3)).toBe(false)
  expect(calls.filter((call) => call.type === "hover")).toHaveLength(1)
  // A click always dispatches.
  expect(running.pointer("click", 3, 3)).toBe(true)
  expect(calls.filter((call) => call.type === "click")).toHaveLength(2)

  // Wheel events carry the scroll direction and delta.
  expect(running.pointer("wheel", 3, 3, { direction: "down", delta: 1 })).toBe(true)
  expect(calls.at(-1)).toEqual({
    type: "wheel",
    target: {
      x: 3,
      y: 3,
      window: "panel",
      row: 1,
      column: 2,
      scroll: { direction: "down", delta: 1 },
    },
  })
  expect(running.pointer("wheel", 20, 20, { direction: "down", delta: 1 })).toBe(false)
})

test("drag grants suppress click and route press/move/release", () => {
  let paint: ((buffer: unknown) => void) | null = null
  const renderer = {
    addPostProcessFn(fn: (buffer: unknown) => void) {
      paint = fn
    },
    removePostProcessFn() {},
    onAnimationTick() {
      return () => {}
    },
    requestRender() {},
    useMouse: false,
  } as unknown as import("@opentui/core").CliRenderer
  const calls: Array<{ type: string; target: Record<string, unknown> }> = []
  const host = {
    hasScene: true,
    fps: 4,
    hasPointer: true,
    hasPointerEvent: (type: string) => type === "press",
    focusableIds: () => ["card"],
    resize() {},
    compose() {},
    nodes: () => [
      {
        kind: "group",
        id: "card",
        focusable: true,
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 20,
        height: 10,
        nodes: [
          { kind: "hit", anchor: "absolute", x: 1, y: 1, width: 4, height: 2, row: 0, column: 1 },
        ],
      },
    ],
    onScene: null,
    runPointer(type: string, target: Record<string, unknown>) {
      calls.push({ type, target })
    },
  } as unknown as SceneHost
  const running = new AppEffects(
    renderer,
    () => crimson,
    { enabled: true, trail: false, particles: false, layer: "under" },
    [],
    [{ id: "p", host }],
    () => ({ width: 40, height: 20 }),
  )
  running.start()
  paint!({
    width: 40,
    height: 20,
    getSpanLines() {
      throw new Error("no spans")
    },
    fillRect() {},
    setCell() {},
    drawText() {},
  })

  // The drag grant replaces click on the same press.
  expect(running.pointer("click", 3, 3)).toBe(false)
  expect(running.pointer("press", 3, 3)).toBe(true)
  expect(running.pointer("move", 4, 3)).toBe(true)
  expect(running.pointer("release", 4, 3)).toBe(true)
  expect(calls.map((call) => call.type)).toEqual(["press", "move", "release"])
  expect(calls[0]?.target).toMatchObject({ window: "card", row: 0, column: 1 })
  expect(calls[1]?.target).toMatchObject({ x: 4, y: 3, window: "card" })
})

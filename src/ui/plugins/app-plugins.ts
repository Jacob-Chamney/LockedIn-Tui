/**
 * App wiring for the rendering effects.
 *
 * Installed after the first frame and only while `LOCKEDIN_PLUGINS` is set.
 * The app draws its own composer cursor as a glyph, not as the terminal
 * cursor, so the layer finds the cursor cell in the rendered buffer, fills the
 * cells between the old and new position, and fades them out. Particle systems
 * — in-process first-party effects or sandboxed workers — emit from the same
 * anchor. Frames are requested only while something is animating.
 */
import type { CliRenderer, OptimizedBuffer } from "@opentui/core"

import type { ThemePalette } from "../theme"
import { validateParticleSystem, type ParticleSystem } from "./api"
import { CursorTrail } from "./cursor"
import { effectDebug } from "./debug"
import embers from "./examples/embers"
import fireflies from "./examples/fireflies"
import sparks from "./examples/sparks"
import { CustomParticleHost, type ParticleHost } from "./particle-host"
import { paintParticles, paintTrail, type TextLayer } from "./paint"
import { paintScene, type SceneHitRegion } from "./scene/paint"
import { clearSceneImageCache, type SceneImages } from "./scene/image"
import type { SceneNode, SceneState } from "./scene/model"
import { pluginEnvValue } from "./env"

export type PluginOptions = {
  enabled: boolean
  trail: boolean
  particles: boolean
  layer: TextLayer
}

/** A running host plus the id the app reports for it. */
export type ParticleHostEntry = {
  id: string
  host: ParticleHost
}

/** A sandboxed plugin that emits scene nodes. */
export type SceneHost = {
  hasScene: boolean
  fps: number
  /** True when the manifest routes pointer events to commands. */
  hasPointer?: boolean
  /** Whether a specific pointer event is mapped to a command. */
  hasPointerEvent?(type: "click" | "hover" | "wheel" | "press" | "move" | "release"): boolean
  /** Dispatch a click/hover target to the matching command. */
  runPointer?(
    type: "click" | "hover" | "wheel" | "press" | "move" | "release",
    target: {
      x: number
      y: number
      window?: string
      row?: number
      column?: number
      scroll?: { direction: "up" | "down" | "left" | "right"; delta: number }
    },
    state: SceneState,
  ): void
  /** Focusable window ids in the last composed scene. */
  focusableIds(): string[]
  resize(width: number, height: number): void
  compose(state: SceneState, time?: number): void
  nodes(): SceneNode[]
  onScene: (() => void) | null
  dispose?(): void
}

export type SceneHostEntry = {
  id: string
  host: SceneHost
}

/** Hosts, systems and state a caller can hand to `createAppPlugins`. */
export type PluginSetup = {
  /** Trusted in-process systems, in addition to the selected examples. */
  systems?: readonly ParticleSystem[]
  /** Already-built particle hosts, including sandboxed workers. */
  hosts?: readonly ParticleHostEntry[]
  /** Sandboxed scene hosts. */
  scenes?: readonly SceneHostEntry[]
  /** Read-only projection handed to scene plugins. */
  state?: () => SceneState
}



/** The composer cursor glyph (`COMPOSER_CURSOR` in the chat model). */
export const CURSOR_TEXT = "\u258f"

const LAYERS: TextLayer[] = ["around", "under", "over"]

/** A jump longer than this is a teleport, not a smear; only the landing cell is lit. */
const MAX_SMEAR_CELLS = 32

/** First-party example systems; user code arrives as in-process files or sandboxed hosts. */
const EXAMPLES: readonly ParticleSystem[] = [fireflies, sparks, embers]

function effectKinds(value: string | undefined): { trail: boolean; particles: boolean } {
  switch (value) {
    case "1":
    case "all":
      return { trail: true, particles: true }
    case "trail":
      return { trail: true, particles: false }
    case "particles":
    case "fireflies":
      return { trail: false, particles: true }
    default:
      return { trail: false, particles: false }
  }
}

/**
 * `LOCKEDIN_PLUGINS_SYSTEMS` selects examples by short name (`sparks`) or full
 * id (`example.sparks`); `all` (the default) runs every example.
 */
export function selectSystems(
  env: Record<string, string | undefined> = process.env,
  examples: readonly ParticleSystem[] = EXAMPLES,
): ParticleSystem[] {
  const raw = pluginEnvValue(env, "systems")?.trim()
  if (!raw || raw === "all") return [...examples]
  const wanted = new Set(raw.split(",").map((name) => name.trim()).filter(Boolean))
  return examples.filter((system) => wanted.has(system.id) || wanted.has(system.id.split(".").pop() ?? ""))
}

export function resolvePluginOptions(
  env: Record<string, string | undefined> = process.env,
): PluginOptions {
  const reduced = env.LOCKEDIN_REDUCED_MOTION === "1"
  const kinds = reduced ? { trail: false, particles: false } : effectKinds(pluginEnvValue(env, "enabled"))
  const requested = pluginEnvValue(env, "layer") as TextLayer | undefined
  const layer = requested && LAYERS.includes(requested) ? requested : "under"
  return { ...kinds, enabled: kinds.trail || kinds.particles, layer }
}

/**
 * The last line that draws the composer cursor glyph, or null when no composer
 * is on screen (normal mode, other panes).
 *
 * The raw char plane is packed, so the frame is read as span lines instead.
 */
export function findComposerCursor(buffer: OptimizedBuffer): { x: number; y: number } | null {
  let lines
  try {
    lines = buffer.getSpanLines()
  } catch {
    return null
  }
  for (let y = lines.length - 1; y >= 0; y--) {
    let x = 0
    for (const span of lines[y]!.spans) {
      const at = span.text.indexOf(CURSOR_TEXT)
      if (at >= 0) return { x: x + at, y }
      x += span.width
    }
  }
  return null
}

export class AppPlugins {
  private readonly renderer: CliRenderer
  private readonly palette: () => ThemePalette
  private readonly options: PluginOptions
  private hosts: ParticleHostEntry[]
  private scenes: SceneHostEntry[]
  private readonly state: () => SceneState
  private readonly trail = new CursorTrail(0.7, 96)
  private ticker: (() => void) | null = null
  private sceneTimer: ReturnType<typeof setInterval> | null = null
  private focusKeys: Array<{ key: string; host: string; local: string }> = []
  private activeFocus: { key: string; host: string; local: string } | null = null
  private hitRegions: Array<
    SceneHitRegion & { host: string }
  > = []
  private lastHover: string | null = null
  private last: { x: number; y: number } | null = null
  private started = false

  constructor(
    renderer: CliRenderer,
    palette: () => ThemePalette,
    options: PluginOptions,
    hosts: ParticleHostEntry[] = [],
    scenes: SceneHostEntry[] = [],
    state: () => SceneState = () => ({ width: 1, height: 1 }),
  ) {
    this.renderer = renderer
    this.palette = palette
    this.options = options
    this.hosts = hosts
    this.scenes = [...scenes]
    this.state = state
    for (const { host } of scenes) host.onScene = () => this.renderer.requestRender()
    this.syncFocus()
    this.renderer.useMouse = scenes.some(({ host }) => host.hasPointer === true)
  }

  /**
   * Rebuild the plugin-window focus list from the running scenes. The active
   * window survives if it still exists; otherwise the first one is focused.
   */
  syncFocus(): void {
    const keys: Array<{ key: string; host: string; local: string }> = []
    for (const entry of this.scenes) {
      for (const local of entry.host.focusableIds()) {
        keys.push({ key: `${entry.id}/${local}`, host: entry.id, local })
      }
    }
    this.focusKeys = keys
    if (this.activeFocus && !keys.some((entry) => entry.key === this.activeFocus!.key)) {
      this.activeFocus = null
    }
    if (!this.activeFocus) this.activeFocus = keys[0] ?? null
  }

  /** Move focus by `delta` and return the new `plugin/window` key. */
  cycleFocus(delta: number): string | null {
    this.syncFocus()
    if (this.focusKeys.length === 0) return null
    const index = this.activeFocus
      ? this.focusKeys.findIndex((entry) => entry.key === this.activeFocus!.key)
      : -1
    const next = this.focusKeys[(index + delta + this.focusKeys.length) % this.focusKeys.length]!
    this.activeFocus = next
    this.renderer.requestRender()
    return next.key
  }

  /** The focused window id for one host, or null when another host owns focus. */
  focusedWindowFor(hostId: string): string | null {
    return this.activeFocus?.host === hostId ? this.activeFocus.local : null
  }

  /**
   * Route a terminal-cell pointer event to the topmost hit region and its
   * plugin command. Hover is deduplicated; click always dispatches.
   */
  pointer(
    type: "click" | "hover" | "wheel" | "press" | "move" | "release",
    x: number,
    y: number,
    scroll?: { direction: "up" | "down" | "left" | "right"; delta: number },
  ): boolean {
    let hit: (SceneHitRegion & { host: string }) | null = null
    for (let index = this.hitRegions.length - 1; index >= 0; index--) {
      const region = this.hitRegions[index]!
      if (x >= region.left && x < region.right && y >= region.top && y < region.bottom) {
        hit = region
        break
      }
    }
    if (!hit) {
      this.lastHover = null
      return false
    }
    const entry = this.scenes.find((scene) => scene.id === hit!.host)
    // A drag grant replaces click for the same press, so mapping both does not
    // run two commands.
    if (type === "press" && !entry?.host.hasPointerEvent?.("press")) return false
    if (type === "click" && entry?.host.hasPointerEvent?.("press")) return false
    const key = `${hit.host}/${hit.window ?? ""}/${hit.row ?? ""}/${hit.column ?? ""}`
    if (type === "hover") {
      if (key === this.lastHover) return false
      this.lastHover = key
    }
    entry?.host.runPointer?.(
      type,
      {
        x,
        y,
        ...(hit.window ? { window: hit.window } : {}),
        ...(hit.row !== undefined ? { row: hit.row } : {}),
        ...(hit.column !== undefined ? { column: hit.column } : {}),
        ...(scroll ? { scroll } : {}),
      },
      this.state(),
    )
    return true
  }

  /** Human-readable focus target, e.g. `queue`. */
  focusLabel(): string | null {
    return this.activeFocus?.local ?? null
  }

  /** Swap the scene hosts, disposing the old ones. */
  setSceneHosts(scenes: SceneHostEntry[]): void {
    for (const { host } of this.scenes) {
      host.dispose?.()
    }
    this.scenes = scenes
    for (const { host } of scenes) host.onScene = () => this.renderer.requestRender()
    this.stopSceneTimer()
    this.syncFocus()
    this.renderer.useMouse = scenes.some(({ host }) => host.hasPointer === true)
    if (scenes.length > 0) this.startSceneTimer()
    this.renderer.requestRender()
  }

  private startSceneTimer(): void {
    if (this.sceneTimer) {
      clearInterval(this.sceneTimer)
      this.sceneTimer = null
    }
    if (this.scenes.length === 0) return
    // Tick at the fastest mounted scene; each host throttles to its own fps.
    const fastest = Math.min(
      ...this.scenes.map(({ host }) => Math.max(1, Math.min(60, host.fps ?? 4))),
    )
    const interval = Math.max(16, Math.round(1000 / fastest))
    this.sceneTimer = setInterval(() => {
      this.syncFocus()
      const state = this.state()
      const time = Date.now()
      for (const entry of this.scenes) {
        entry.host.resize(state.width, state.height)
        entry.host.compose(
          { ...state, focusedWindow: this.focusedWindowFor(entry.id) },
          time,
        )
      }
    }, interval)
  }

  private stopSceneTimer(): void {
    if (!this.sceneTimer) return
    clearInterval(this.sceneTimer)
    this.sceneTimer = null
  }

  /** Systems that are running, in-process or sandboxed. */
  get systemIds(): string[] {
    return this.hosts.map((entry) => entry.id)
  }

  /**
   * Swap every running host, disposing the old ones. The dev file watcher uses
   * this after a reload; sandboxed workers are terminated here.
   */
  setHosts(hosts: ParticleHostEntry[]): void {
    for (const { host } of this.hosts) {
      host.clear()
      host.dispose?.()
    }
    this.hosts = hosts
    if (this.options.particles && hosts.length > 0) this.ensureTicker()
  }

  start(): void {
    if (!this.options.enabled || this.started) return
    this.started = true
    this.renderer.addPostProcessFn(this.paint)
    this.startSceneTimer()
  }

  stop(): void {
    if (!this.started && this.hosts.length === 0) return
    this.started = false
    this.renderer.removePostProcessFn(this.paint)
    this.stopTicker()
    this.stopSceneTimer()
    clearSceneImageCache()
    this.trail.clear()
    for (const { host } of this.hosts) {
      host.clear()
      host.dispose?.()
    }
    this.hosts = []
    for (const { host } of this.scenes) host.dispose?.()
    this.scenes = []
    this.focusKeys = []
    this.activeFocus = null
    this.hitRegions = []
    this.lastHover = null
    this.last = null
  }

  /** Forward a key from the app's keyboard router. */
  keypress(name: string): void {
    if (!this.options.particles) return
    for (const { host } of this.hosts) host.event({ kind: "keypress", name })
    this.ensureTicker()
  }

  /** A message was sent; systems can burst on it. */
  send(): void {
    if (!this.options.particles) return
    for (const { host } of this.hosts) host.event({ kind: "send" })
    this.ensureTicker()
  }

  private paint = (buffer: OptimizedBuffer): void => {
    if (!this.options.enabled) return
    const cursor = findComposerCursor(buffer)
    if (cursor) {
      if (this.options.trail) {
        if (!this.last) {
          this.trail.record(cursor.x, cursor.y)
        } else if (cursor.x !== this.last.x || cursor.y !== this.last.y) {
          this.smear(this.last, cursor)
          this.ensureTicker()
        }
      }
      if (this.options.particles) {
        for (const { host } of this.hosts) {
          host.setCursor(cursor.x, cursor.y)
          host.resize(buffer.width, buffer.height)
        }
        this.ensureTicker()
      }
      this.last = cursor
    } else {
      this.last = null
    }

    const palette = this.palette()
    if (this.options.trail && this.trail.points.length > 0) {
      paintTrail(buffer, this.trail, palette, this.options.layer)
    }
    for (const { host } of this.hosts) {
      const alive = host.particles()
      if (alive.length > 0) paintParticles(buffer, alive, palette, host.layer)
    }
    if (this.scenes.length > 0) {
      this.syncFocus()
      const images = this.sceneImages(buffer)
      const hits: Array<SceneHitRegion & { host: string }> = []
      for (const { id, host } of this.scenes) {
        const nodes = host.nodes()
        if (nodes.length === 0) continue
        const found: SceneHitRegion[] = []
        paintScene(buffer, nodes, palette, images, found)
        for (const region of found) hits.push({ ...region, host: id })
      }
      this.hitRegions = hits
    }
  }

  /**
   * The image backend is used only when the terminal can draw images and the
   * cell pixel size is known (or kitty can scale without it).
   */
  private sceneImages(buffer: OptimizedBuffer): SceneImages | undefined {
    const capabilities = this.renderer.capabilities
    if (!capabilities || (!capabilities.kitty_graphics && !capabilities.sixel)) return undefined
    const resolution = this.renderer.resolution
    if (capabilities.sixel && !capabilities.kitty_graphics && !resolution) return undefined
    if (buffer.width <= 0 || buffer.height <= 0) return undefined
    return resolution
      ? { cellWidth: resolution.width / buffer.width, cellHeight: resolution.height / buffer.height }
      : { cellWidth: 8, cellHeight: 16 }
  }

  /** Light every cell between two cursor positions so a move leaves a smear. */
  private smear(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const steps = Math.max(Math.abs(dx), Math.abs(dy))
    if (steps > MAX_SMEAR_CELLS) {
      this.trail.record(to.x, to.y)
      return
    }
    for (let step = 1; step <= Math.max(1, steps); step++) {
      const t = step / Math.max(1, steps)
      this.trail.record(Math.round(from.x + dx * t), Math.round(from.y + dy * t))
    }
  }

  private ensureTicker(): void {
    if (this.ticker) return
    this.ticker = this.renderer.onAnimationTick(60, (dt) => {
      // The renderer reports milliseconds; effect ages are in seconds.
      const seconds = dt / 1000
      if (this.options.trail) this.trail.update(seconds)
      for (const { host } of this.hosts) host.update(seconds)
      this.renderer.requestRender()
      const trailIdle = !this.options.trail || this.trail.points.length === 0
      const particlesIdle = this.hosts.every(({ host }) => host.particleCount === 0)
      if (trailIdle && particlesIdle) this.stopTicker()
    })
  }

  private stopTicker(): void {
    if (!this.ticker) return
    this.ticker()
    this.ticker = null
  }
}

export function createAppPlugins(
  renderer: CliRenderer,
  palette: () => ThemePalette,
  env: Record<string, string | undefined> = process.env,
  setup: PluginSetup = {},
): AppPlugins | null {
  const options = resolvePluginOptions(env)
  if (!options.enabled) return null
  const hosts: ParticleHostEntry[] = []
  if (options.particles) {
    for (const system of [...selectSystems(env), ...(setup.systems ?? [])]) {
      const check = validateParticleSystem(system)
      if (!check.ok) {
        effectDebug(`invalid system: ${check.errors.join("; ")}`)
        continue
      }
      hosts.push({ id: system.id, host: new CustomParticleHost(1, 1, palette(), system) })
    }
    hosts.push(...(setup.hosts ?? []))
  }
  return new AppPlugins(
    renderer,
    palette,
    options,
    hosts,
    [...(setup.scenes ?? [])],
    setup.state ?? (() => ({ width: 1, height: 1 })),
  )
}

/**
 * Main-thread handle for a sandboxed effect.
 *
 * Frames are coalesced: at most one is in flight, and while the worker is busy
 * the latest cursor, size, events and elapsed time are merged into the next
 * request. A worker that misses its deadline is terminated and the effect is
 * quarantined, so a hung plugin cannot stall the UI.
 */
import { RGBA } from "@opentui/core"

import type { ThemePalette } from "../../theme"
import type { ParticleEvent } from "../api"
import type { ParticleHost } from "../particle-host"
import type { Particle } from "../particles"
import type { TextLayer } from "../paint"
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from "./limits"
import type { PluginManifest } from "./manifest"
import type { ComposeInput, FrameInput, WireParticle, WorkerIn, WorkerOut } from "./protocol"
import type { PluginStoreData } from "../plugin-state"
import { collectFocusIds, DEFAULT_SCENE_BUDGET, sanitizeScene, type SceneNode, type SceneState } from "../scene/model"

type Pending = {
  dt: number
  events: ParticleEvent[]
  cursor: { x: number; y: number }
  width: number
  height: number
}

type PendingScene = {
  state: SceneState
  time: number
}

export type SandboxWorkerOptions = {
  bundle: string
  manifest: PluginManifest
  palette: ThemePalette
  limits?: SandboxLimits
  /** Persistent state loaded by the host. */
  store?: PluginStoreData
}

/** Resolve a palette role or `#rrggbb`; unknown values fall back to the accent. */
export function resolveColor(value: string, palette: ThemePalette, alpha: number): RGBA {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    try {
      const base = RGBA.fromHex(value)
      return RGBA.fromValues(base.r, base.g, base.b, alpha)
    } catch {
      // fall through
    }
  }
  if (Object.prototype.hasOwnProperty.call(palette, value)) {
    const base = RGBA.fromHex(palette[value as keyof ThemePalette])
    return RGBA.fromValues(base.r, base.g, base.b, alpha)
  }
  const base = RGBA.fromHex(palette.accent)
  return RGBA.fromValues(base.r, base.g, base.b, alpha)
}

function paletteHex(palette: ThemePalette): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(palette)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function toParticles(wire: readonly WireParticle[], palette: ThemePalette): Particle[] {
  return wire.map((particle) => ({
    x: particle.x,
    y: particle.y,
    vx: particle.vx,
    vy: particle.vy,
    age: particle.age,
    life: particle.life,
    seed: particle.seed,
    glyph: particle.glyph,
    mode: "sparks",
    color: resolveColor(particle.color, palette, particle.alpha),
    layer: particle.layer,
  }))
}

export class SandboxWorkerPlugin implements ParticleHost {
  readonly manifest: PluginManifest
  layer: TextLayer = "around"
  hasParticles = true
  hasScene = false
  fps = 4
  commandIds: string[] = []
  /** True when the manifest routes pointer events to commands. */
  readonly hasPointer: boolean
  /** Display name from the plugin code, falling back to the manifest name. */
  pluginName = ""
  /** Called with the result of a plugin command. */
  onCommandResult:
    | ((result: {
        id: string
        ok: boolean
        message?: string
        copy?: string
        /** True when a pointer event, not a key, ran the command. */
        pointer?: boolean
      }) => void)
    | null = null
  /** Called when the plugin writes persistent state. */
  onStoreChange: ((store: PluginStoreData) => void) | null = null
  /** Called once when the plugin fails and is quarantined. */
  onFailure: ((message: string) => void) | null = null
  failed = false
  lastError: string | null = null
  /** Called when new scene nodes arrive, so the app can repaint. */
  onScene: (() => void) | null = null

  private readonly worker: Worker
  private readonly limits: SandboxLimits
  private readonly palette: ThemePalette
  private ready = false
  private disposed = false
  private inFlight = false
  private pending: Pending | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null
  private sceneInFlight = false
  private pendingScene: PendingScene | null = null
  private sceneTimeout: ReturnType<typeof setTimeout> | null = null
  private sceneOutput: SceneNode[] = []
  private focusIds: string[] = []
  private lastComposeAt = 0
  private lastSceneTime = 0
  private cursor = { x: 0, y: 0 }
  private pointerPending = new Map<string, number>()
  private width = 1
  private height = 1
  private output: Particle[] = []
  private count = 0

  private constructor(worker: Worker, manifest: PluginManifest, limits: SandboxLimits, palette: ThemePalette) {
    this.worker = worker
    this.manifest = manifest
    this.hasPointer = manifest.permissions.pointer !== undefined
    this.pluginName = manifest.name
    this.limits = limits
    this.palette = palette
    worker.onmessage = (event: MessageEvent<WorkerOut>) => this.receive(event.data)
    worker.onerror = (event) => this.fail(String(event.message ?? "worker error"))
  }

  static create(options: SandboxWorkerOptions): Promise<SandboxWorkerPlugin> {
    const limits = options.limits ?? DEFAULT_SANDBOX_LIMITS
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    const effect = new SandboxWorkerPlugin(worker, options.manifest, limits, options.palette)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        effect.dispose()
        reject(new Error(`effect ${options.manifest.id} did not start within ${limits.loadTimeoutMs + 1_000} ms`))
      }, limits.loadTimeoutMs + 1_000)
      effect.onReady = () => {
        clearTimeout(timer)
        resolve(effect)
      }
      effect.onStartError = (message) => {
        clearTimeout(timer)
        effect.dispose()
        reject(new Error(message))
      }
      const message: WorkerIn = {
        type: "load",
        bundle: options.bundle,
        manifest: options.manifest,
        limits,
        ...(options.store ? { store: options.store } : {}),
      }
      worker.postMessage(message)
    })
  }

  private onReady: (() => void) | null = null
  private onStartError: ((message: string) => void) | null = null

  get particleCount(): number {
    return this.count
  }

  setCursor(x: number, y: number): void {
    this.cursor = { x, y }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  event(event: ParticleEvent): void {
    const pending = this.pending ?? this.newPending()
    pending.events.push(event)
    this.pending = pending
  }

  update(dt: number): void {
    if (this.failed || this.disposed || !this.ready) return
    const pending = this.pending ?? this.newPending()
    pending.dt += Math.max(0, Math.min(0.1, dt))
    pending.cursor = this.cursor
    pending.width = this.width
    pending.height = this.height
    this.pending = pending
    if (!this.inFlight) this.send(pending)
  }

  particles(): Particle[] {
    return this.failed ? [] : this.output
  }

  /** Run a granted command in the sandbox. */
  command(
    id: string,
    state: SceneState,
    pointer?: {
      type: "click" | "hover" | "wheel" | "press" | "move" | "release"
      x: number
      y: number
      window?: string
      row?: number
      column?: number
      scroll?: { direction: "up" | "down" | "left" | "right"; delta: number }
    },
  ): void {
    if (this.failed || this.disposed || !this.ready || !this.commandIds.includes(id)) return
    this.worker.postMessage({
      type: "command",
      id,
      input: { state, time: Date.now(), ...(pointer ? { pointer } : {}) },
    } satisfies WorkerIn)
  }

  /**
   * Route one pointer target to the manifest's click/hover command.
   *
   * Hover is deduplicated by the caller; this only enforces the grant and the
   * command's presence in the sandbox declaration.
   */
  /** True when the manifest routes this pointer event to a command. */
  hasPointerEvent(type: "click" | "hover" | "wheel" | "press" | "move" | "release"): boolean {
    return this.manifest.permissions.pointer?.[type] !== undefined
  }

  runPointer(
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
  ): void {
    const id = this.manifest.permissions.pointer?.[type]
    if (!id || this.failed || this.disposed || !this.ready || !this.commandIds.includes(id)) {
      return
    }
    this.pointerPending.set(id, (this.pointerPending.get(id) ?? 0) + 1)
    this.command(id, state, { type, ...target })
  }

  /** Ask for scene nodes. Coalesced like particle frames. */
  compose(state: SceneState, time = Date.now()): void {
    if (this.failed || this.disposed || !this.ready || !this.hasScene) return
    // The shell ticks at the fastest scene's rate; each host keeps its own.
    if (time - this.lastComposeAt < 1000 / this.fps - 1) return
    this.lastComposeAt = time
    const pending = this.pendingScene ?? { state, time }
    pending.state = state
    pending.time = time
    this.pendingScene = pending
    if (!this.sceneInFlight) this.sendScene(pending)
  }

  nodes(): SceneNode[] {
    return this.failed ? [] : this.sceneOutput
  }

  /** Focusable window ids in the last composed scene. */
  focusableIds(): string[] {
    return this.failed ? [] : this.focusIds
  }

  clear(): void {
    this.output = []
    this.count = 0
    this.pending = null
    this.sceneOutput = []
    this.focusIds = []
    this.pendingScene = null
    this.lastComposeAt = 0
    this.lastSceneTime = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    if (this.sceneTimeout) clearTimeout(this.sceneTimeout)
    this.sceneTimeout = null
    try {
      // Give the worker a moment to run `deactivate` and send its final state.
      this.worker.postMessage({ type: "dispose" } satisfies WorkerIn)
      const worker = this.worker
      setTimeout(() => {
        try {
          worker.terminate()
        } catch {
          // already gone
        }
      }, 200).unref?.()
    } catch {
      // already gone
    }
  }

  private newPending(): Pending {
    return { dt: 0, events: [], cursor: this.cursor, width: this.width, height: this.height }
  }

  private send(pending: Pending): void {
    this.pending = null
    this.inFlight = true
    const input: FrameInput = {
      dt: Math.max(0.001, pending.dt),
      cursor: pending.cursor,
      width: pending.width,
      height: pending.height,
      events: pending.events,
    }
    this.arm()
    this.worker.postMessage({ type: "frame", input } satisfies WorkerIn)
  }

  private arm(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.fail(`effect ${this.manifest.id} missed its ${this.limits.callTimeoutMs} ms frame budget`)
    }, this.limits.callTimeoutMs + 250)
  }

  private receive(message: WorkerOut): void {
    if (message.type === "bye") {
      if (message.store) this.onStoreChange?.(message.store)
      return
    }
    if (this.disposed) return
    if (message.type === "ready") {
      this.layer = message.layer
      this.hasParticles = message.hasParticles === true
      this.hasScene = message.hasCompose === true
      this.fps = Math.max(1, Math.min(60, message.fps ?? 4))
      this.commandIds = message.commandIds ?? []
      const codeName = message.description?.name
      if (typeof codeName === "string" && codeName.trim() !== "") {
        this.pluginName = codeName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80)
      }
      this.ready = true
      this.onReady?.()
      this.onReady = null
      return
    }
    if (message.type === "command") {
      if (message.failed) {
        this.fail(message.error ?? "effect failed")
        return
      }
      if (message.store) this.onStoreChange?.(message.store)
      const pending = this.pointerPending.get(message.id) ?? 0
      const pointer = pending > 0
      if (pointer) {
        if (pending === 1) this.pointerPending.delete(message.id)
        else this.pointerPending.set(message.id, pending - 1)
      }
      this.onCommandResult?.({
        id: message.id,
        ok: message.ok,
        message: message.message,
        copy: message.copy,
        ...(pointer ? { pointer: true } : {}),
      })
      return
    }
    if (message.type === "scene") {
      if (this.sceneTimeout) clearTimeout(this.sceneTimeout)
      this.sceneTimeout = null
      this.sceneInFlight = false
      if (message.failed) {
        this.fail(message.error ?? "effect failed")
        return
      }
      const permission = this.manifest.permissions.scene
      this.sceneOutput = sanitizeScene(
        { nodes: message.nodes },
        {
          ...DEFAULT_SCENE_BUDGET,
          maxNodes: permission?.maxNodes ?? DEFAULT_SCENE_BUDGET.maxNodes,
          maxText: permission?.maxText ?? DEFAULT_SCENE_BUDGET.maxText,
        },
        permission?.anchors ?? [],
        { width: this.width, height: this.height },
        permission?.absolute === true,
      ).nodes
      this.focusIds = collectFocusIds(this.sceneOutput)
      if (message.store) this.onStoreChange?.(message.store)
      this.onScene?.()
      if (this.pendingScene) this.sendScene(this.pendingScene)
      return
    }
    if (message.type === "error") {
      if (message.phase === "load") {
        this.onStartError?.(message.message)
        this.onStartError = null
      } else {
        this.fail(message.message)
      }
      return
    }
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    this.inFlight = false
    if (message.store) this.onStoreChange?.(message.store)
    this.output = toParticles(message.particles, this.palette)
    this.count = message.count
    if (message.failed) {
      this.fail(message.error ?? "effect failed")
      return
    }
    if (this.pending) this.send(this.pending)
  }

  private sendScene(pending: PendingScene): void {
    this.pendingScene = null
    this.sceneInFlight = true
    const dt =
      this.lastSceneTime > 0
        ? Math.max(0, Math.min(0.5, (pending.time - this.lastSceneTime) / 1000))
        : 0
    this.lastSceneTime = pending.time
    // The clock is seconds, matching the particle context; the shell tracks it
    // in milliseconds for scheduling.
    const input: ComposeInput = {
      state: pending.state,
      time: pending.time / 1000,
      dt,
      palette: paletteHex(this.palette),
    }
    if (this.sceneTimeout) clearTimeout(this.sceneTimeout)
    this.sceneTimeout = setTimeout(() => {
      this.fail(`effect ${this.manifest.id} missed its ${this.limits.callTimeoutMs} ms scene budget`)
    }, this.limits.callTimeoutMs + 250)
    this.worker.postMessage({ type: "compose", input } satisfies WorkerIn)
  }

  private fail(reason: string): void {
    if (this.failed) return
    this.failed = true
    this.lastError = reason.slice(0, 200)
    this.onFailure?.(this.lastError)
    this.output = []
    this.count = 0
    this.pending = null
    this.sceneOutput = []
    this.pendingScene = null
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    if (this.sceneTimeout) clearTimeout(this.sceneTimeout)
    this.sceneTimeout = null
    try {
      this.worker.terminate()
    } catch {
      // already gone
    }
  }
}

/** @deprecated use SandboxWorkerPlugin. */
export { SandboxWorkerPlugin as SandboxWorkerEffect }

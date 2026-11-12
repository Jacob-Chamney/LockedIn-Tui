/**
 * One sandboxed effect, driven from the host thread.
 *
 * State lives inside QuickJS. Each frame is exactly one boundary call: the host
 * sends the packed buffer plus spawn policy as JSON, the effect spawns, steps
 * and styles inside the sandbox, and returns the new buffer and styles.
 */
import type { QuickJSHandle } from "quickjs-emscripten-core"

import type { ParticleEvent, ParticleSpawnTrigger } from "../api"
import type { TextLayer } from "../paint"
import type { PluginStoreData } from "../plugin-state"
import { EFFECT_ADAPTER_SOURCE, wrapBundle } from "./adapter"
import {
  DEFAULT_SANDBOX_LIMITS,
  MAX_BUNDLE_BYTES,
  MAX_CLIPBOARD_CHARS,
  type SandboxLimits,
} from "./limits"
import {
  checkSystemAgainstManifest,
  type PluginManifest,
  type SystemDescription,
} from "./manifest"
import { Sandbox, SandboxFailure, loadQuickJS, type SandboxError } from "./runtime"

type FrameOut = {
  count: number
  /** Flat [x, y, vx, vy, life, maxLife, seed] per particle. */
  state: number[]
  /** Flat [glyph, color, alpha, layer] per particle. */
  looks: unknown[]
  changes?: unknown
}

const LAYERS: readonly TextLayer[] = ["around", "under", "over"]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Plain particle data; the main thread resolves colours and paints. */
export type SandboxParticle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  seed: number
  glyph: string
  /** A palette role or `#rrggbb`; resolved by the host. */
  color: string
  alpha: number
  layer?: TextLayer
}

/** One glyph cell: printable, narrow, not a control character. */
export function safeGlyph(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "·"
  const [first] = [...value]
  if (!first) return "·"
  const code = first.codePointAt(0) ?? 0
  if (code < 0x20 || (code >= 0x7f && code <= 0xa0)) return "·"
  if (code >= 0x2e80) return "·" // wide/CJK glyphs break the cell grid
  return first
}

export class SandboxedPlugin {
  readonly manifest: PluginManifest
  readonly description: SystemDescription
  readonly layer: TextLayer
  readonly capacity: number
  readonly hasParticles: boolean
  readonly hasCompose: boolean
  /** Compose frames per second, capped by the manifest. */
  readonly fps: number
  readonly commandIds: string[]
  /** Display name from the plugin code, if it set one. */
  readonly pluginName: string | undefined
  failed = false
  lastError: string | null = null

  private readonly sandbox: Sandbox
  private readonly frameFn: QuickJSHandle
  private readonly composeFn: QuickJSHandle
  private readonly commandFn: QuickJSHandle
  private readonly activateFn: QuickJSHandle
  private readonly deactivateFn: QuickJSHandle
  private store: PluginStoreData = {}
  private storeDirty = false
  private readonly layers: readonly TextLayer[]
  private readonly triggers: readonly ParticleSpawnTrigger[]
  private readonly spawnRate: number
  private readonly spawnBurst: number
  private buffer = { count: 0, x: new Float32Array(1), y: new Float32Array(1), vx: new Float32Array(1), vy: new Float32Array(1), life: new Float32Array(1), maxLife: new Float32Array(1), seed: new Float32Array(1) }
  private events: ParticleEvent[] = []
  private cursor = { x: 0, y: 0 }
  private width = 1
  private height = 1
  private emit = 0
  private time = 0
  private output: SandboxParticle[] = []

  private constructor(
    sandbox: Sandbox,
    frameFn: QuickJSHandle,
    composeFn: QuickJSHandle,
    commandFn: QuickJSHandle,
    activateFn: QuickJSHandle,
    deactivateFn: QuickJSHandle,
    manifest: PluginManifest,
    description: SystemDescription,
  ) {
    this.sandbox = sandbox
    this.frameFn = frameFn
    this.composeFn = composeFn
    this.commandFn = commandFn
    this.activateFn = activateFn
    this.deactivateFn = deactivateFn
    this.manifest = manifest
    this.description = description
    const permission = manifest.permissions.particles
    this.hasParticles = description.hasParticles === true
    this.hasCompose = description.hasCompose === true
    const grantedFps = manifest.permissions.scene?.fps ?? 4
    const requestedFps = description.fps ?? 4
    this.fps = Math.max(1, Math.min(grantedFps, requestedFps))
    this.commandIds = description.commandIds ?? []
    this.pluginName = typeof description.name === "string" && description.name.trim() !== "" ? description.name.trim().slice(0, 80) : undefined
    this.capacity = permission?.maxParticles ?? 0
    this.layers = permission?.layers ?? []
    this.triggers = (description.spawnOn ?? []).filter((trigger) => permission?.triggers.includes(trigger))
    this.spawnRate = Math.min(permission?.spawnRate ?? 0, description.spawnRate ?? 0)
    this.spawnBurst = Math.min(permission?.spawnBurst ?? 0, description.spawnBurst ?? 0)
    this.layer =
      description.textLayer && permission?.layers.includes(description.textLayer)
        ? description.textLayer
        : (permission?.layers[0] ?? "around")
    const size = Math.max(1, this.capacity)
    this.buffer = {
      count: 0,
      x: new Float32Array(size),
      y: new Float32Array(size),
      vx: new Float32Array(size),
      vy: new Float32Array(size),
      life: new Float32Array(size),
      maxLife: new Float32Array(size),
      seed: new Float32Array(size),
    }
  }

  static async create(
    bundle: string,
    manifest: PluginManifest,
    limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
    store: PluginStoreData = {},
  ): Promise<SandboxedPlugin> {
    if (bundle.length > MAX_BUNDLE_BYTES) {
      throw new Error(`effect bundle is ${bundle.length} bytes; the limit is ${MAX_BUNDLE_BYTES}`)
    }
    const quickjs = await loadQuickJS()
    const sandbox = new Sandbox(quickjs, limits)
    const vm = sandbox.context
    let adapter: QuickJSHandle | null = null
    let define: QuickJSHandle | null = null
    let init: QuickJSHandle | null = null
    let frame: QuickJSHandle | null = null
    let compose: QuickJSHandle | null = null
    let runCommand: QuickJSHandle | null = null
    let activate: QuickJSHandle | null = null
    let deactivate: QuickJSHandle | null = null
    let exported: QuickJSHandle | null = null
    let result: QuickJSHandle | null = null
    let arg: QuickJSHandle | null = null
    try {
      adapter = sandbox.eval(EFFECT_ADAPTER_SOURCE, "lockedin:effect-adapter")
      define = vm.getProp(adapter, "define")
      init = vm.getProp(adapter, "init")
      frame = vm.getProp(adapter, "frame")
      compose = vm.getProp(adapter, "compose")
      runCommand = vm.getProp(adapter, "runCommand")
      activate = vm.getProp(adapter, "activate")
      deactivate = vm.getProp(adapter, "deactivate")

      exported = sandbox.eval(wrapBundle(bundle), `effect:${manifest.id}`)
      result = sandbox.call(define, [exported])
      const description = JSON.parse(String(vm.dump(result))) as SystemDescription

      const problems = checkSystemAgainstManifest(manifest, description)
      if (problems.length > 0) throw new Error(problems.join("; "))

      const capacity = manifest.permissions.particles?.maxParticles ?? 0
      arg = vm.newNumber(capacity)
      const storeArg = vm.newString(JSON.stringify(store))
      result.dispose()
      result = sandbox.call(init, [arg, storeArg])
      storeArg.dispose()
      JSON.parse(String(vm.dump(result)))

      const instance = new SandboxedPlugin(
        sandbox,
        frame,
        compose,
        runCommand,
        activate,
        deactivate,
        manifest,
        description,
      )
      instance.setStore(store)
      frame = null // owned by the instance now
      compose = null
      runCommand = null
      activate = null
      deactivate = null

      // Lifecycle: activate runs once, before the first frame.
      const activation = sandbox.call(instance.activationHandle, [vm.newString(JSON.stringify({}))])
      try {
        instance.absorbChanges(JSON.parse(String(vm.dump(activation))))
      } finally {
        activation.dispose()
      }
      // Everything else is a boot-time handle; a live handle makes runtime
      // disposal assert, so release them before returning.
      disposeAll([result, arg, exported])
      result = null
      arg = null
      exported = null
      define.dispose()
      define = null
      init.dispose()
      init = null
      adapter.dispose()
      adapter = null
      return instance
    } catch (error) {
      disposeAll([result, arg, exported, frame, compose, runCommand, activate, deactivate, init, define, adapter])
      sandbox.dispose()
      throw error
    }
  }

  /** The adapter handle used for activation; internal to `create`. */
  get activationHandle(): QuickJSHandle {
    return this.activateFn
  }

  get particleCount(): number {
    return this.buffer.count
  }

  /** Seed the host copy without marking it dirty. */
  setStore(store: PluginStoreData): void {
    this.store = { ...store }
    this.storeDirty = false
  }

  /** Store changes since the last call, or null when nothing was written. */
  takeStoreChanges(): PluginStoreData | null {
    if (!this.storeDirty) return null
    this.storeDirty = false
    return this.store
  }

  absorbChanges(out: { changes?: unknown } | null | undefined): void {
    if (out && out.changes && typeof out.changes === "object") {
      this.store = out.changes as PluginStoreData
      this.storeDirty = true
    }
  }

  /** Run the plugin's cleanup hook; safe to call once before disposal. */
  deactivate(): void {
    if (this.failed) return
    const vm = this.sandbox.context
    let result: QuickJSHandle | null = null
    try {
      result = this.sandbox.call(this.deactivateFn)
      this.absorbChanges(JSON.parse(String(vm.dump(result))))
    } catch (error) {
      this.fail(error)
    } finally {
      result?.dispose()
    }
  }

  setCursor(x: number, y: number): void {
    if (x === this.cursor.x && y === this.cursor.y) return
    this.cursor = { x, y }
    this.events.push({ kind: "cursor-move", x, y })
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  event(event: ParticleEvent): void {
    this.events.push(event)
  }

  /** Run a granted command inside the sandbox. Errors are contained. */
  runCommand(id: string, input: unknown): {
    ok: boolean
    message?: string
    level?: "info" | "warn" | "error"
    copy?: string
  } {
    if (this.failed || !this.commandIds.includes(id)) {
      return { ok: false, message: "command is not available" }
    }
    const vm = this.sandbox.context
    let arg: QuickJSHandle | null = null
    let result: QuickJSHandle | null = null
    try {
      arg = vm.newString(JSON.stringify({ ...(input as object), id }))
      result = this.sandbox.call(this.commandFn, [arg])
      const out = JSON.parse(String(vm.dump(result))) as {
        ok?: unknown
        message?: unknown
        level?: unknown
        copy?: unknown
        changes?: unknown
      }
      this.absorbChanges(out)
      const message = typeof out.message === "string" ? out.message.slice(0, 300) : undefined
      const level =
        out.level === "info" || out.level === "warn" || out.level === "error"
          ? out.level
          : undefined
      if (out.copy !== undefined) {
        if (this.manifest.permissions.clipboard !== true) {
          return { ok: false, message: "clipboard permission not granted" }
        }
        if (
          typeof out.copy !== "string" ||
          out.copy.length === 0 ||
          out.copy.length > MAX_CLIPBOARD_CHARS
        ) {
          return {
            ok: false,
            message: `clipboard text must be 1-${MAX_CLIPBOARD_CHARS} characters`,
          }
        }
        return { ok: out.ok !== false, message, ...(level ? { level } : {}), copy: out.copy }
      }
      return { ok: out.ok !== false, message, ...(level ? { level } : {}) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastError = message.slice(0, 200)
      if (error instanceof SandboxFailure && Sandbox.isFatal(error.info)) this.failed = true
      return { ok: false, message: this.lastError }
    } finally {
      arg?.dispose()
      result?.dispose()
    }
  }

  /** Ask the sandbox for scene nodes. The host validates the result. */
  compose(input: unknown): unknown {
    if (this.failed || !this.hasCompose) return { nodes: [] }
    const vm = this.sandbox.context
    let arg: QuickJSHandle | null = null
    let result: QuickJSHandle | null = null
    try {
      arg = vm.newString(JSON.stringify(input))
      result = this.sandbox.call(this.composeFn, [arg])
      const out = JSON.parse(String(vm.dump(result))) as { nodes?: unknown; changes?: unknown }
      this.absorbChanges(out)
      return out
    } catch (error) {
      this.fail(error)
      return { nodes: [] }
    } finally {
      arg?.dispose()
      result?.dispose()
    }
  }

  update(dt: number): void {
    if (this.failed || !this.hasParticles) return
    const step = Math.max(0, Math.min(0.1, dt))
    this.time += step
    this.emit += this.spawnRate * step

    let spawn = Math.floor(this.emit)
    this.emit -= spawn
    for (const event of this.events) {
      const kind = event.kind === "cursor-move" ? "cursor-move" : event.kind
      if (this.triggers.includes(kind)) spawn += this.spawnBurst
    }

    const input = {
      dt: step,
      time: this.time,
      width: this.width,
      height: this.height,
      cursor: this.cursor,
      palette: {},
      events: this.events,
      spawn,
      count: this.buffer.count,
      x: Array.from(this.buffer.x.subarray(0, this.buffer.count)),
      y: Array.from(this.buffer.y.subarray(0, this.buffer.count)),
      vx: Array.from(this.buffer.vx.subarray(0, this.buffer.count)),
      vy: Array.from(this.buffer.vy.subarray(0, this.buffer.count)),
      life: Array.from(this.buffer.life.subarray(0, this.buffer.count)),
      maxLife: Array.from(this.buffer.maxLife.subarray(0, this.buffer.count)),
      seed: Array.from(this.buffer.seed.subarray(0, this.buffer.count)),
    }
    this.events = []

    const vm = this.sandbox.context
    let arg: QuickJSHandle | null = null
    let result: QuickJSHandle | null = null
    try {
      arg = vm.newString(JSON.stringify(input))
      result = this.sandbox.call(this.frameFn, [arg])
      const out = JSON.parse(String(vm.dump(result))) as FrameOut
      this.absorbChanges(out)
      this.accept(out)
    } catch (error) {
      this.fail(error)
    } finally {
      arg?.dispose()
      result?.dispose()
    }
  }

  particles(): SandboxParticle[] {
    return this.failed ? [] : this.output
  }

  clear(): void {
    this.buffer.count = 0
    this.output = []
    this.events = []
    this.emit = 0
  }

  dispose(): void {
    for (const handle of [
      this.frameFn,
      this.composeFn,
      this.commandFn,
      this.activateFn,
      this.deactivateFn,
    ]) {
      try {
        handle.dispose()
      } catch {
        // The context may already be gone after a fatal error.
      }
    }
    this.sandbox.dispose()
  }

  private accept(out: FrameOut): void {
    const count = Number.isFinite(out.count) ? clamp(Math.floor(out.count), 0, this.capacity) : 0
    const state = Array.isArray(out.state) ? out.state : []
    const looks = Array.isArray(out.looks) ? out.looks : []
    const next: SandboxParticle[] = []
    const keep = { x: [] as number[], y: [] as number[], vx: [] as number[], vy: [] as number[], life: [] as number[], maxLife: [] as number[], seed: [] as number[] }
    for (let index = 0; index < count; index++) {
      const at = index * 7
      const x = state[at]
      const y = state[at + 1]
      const vx = state[at + 2]
      const vy = state[at + 3]
      const life = state[at + 4]
      const rawLife = state[at + 5]
      const seed = state[at + 6]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(life)) continue
      if (life <= 0) continue
      if (x < -1 || x > this.width + 1 || y < -1 || y > this.height + 1) continue
      const maxLife = Number.isFinite(rawLife) ? Math.max(0.001, rawLife) : Math.max(0.001, life)
      const look = index * 4
      const glyph = looks[look]
      const color = looks[look + 1]
      const rawAlpha = looks[look + 2]
      const rawLayer = looks[look + 3]
      const layer = typeof rawLayer === "string" && LAYERS.includes(rawLayer as TextLayer) && this.layers.includes(rawLayer as TextLayer)
        ? (rawLayer as TextLayer)
        : undefined
      const alpha = typeof rawAlpha === "number" && Number.isFinite(rawAlpha) ? clamp(rawAlpha, 0, 1) : 1
      next.push({
        x,
        y,
        vx: Number.isFinite(vx) ? vx : 0,
        vy: Number.isFinite(vy) ? vy : 0,
        age: maxLife - life,
        life: maxLife,
        seed: Number.isFinite(seed) ? seed : 0,
        glyph: safeGlyph(glyph),
        color: typeof color === "string" && color !== "" ? color : "accent",
        alpha,
        layer,
      })
      keep.x.push(x)
      keep.y.push(y)
      keep.vx.push(vx)
      keep.vy.push(vy)
      keep.life.push(life)
      keep.maxLife.push(maxLife)
      keep.seed.push(seed)
    }
    this.output = next
    this.buffer.count = keep.x.length
    for (let index = 0; index < this.buffer.count; index++) {
      this.buffer.x[index] = keep.x[index]!
      this.buffer.y[index] = keep.y[index]!
      this.buffer.vx[index] = keep.vx[index]!
      this.buffer.vy[index] = keep.vy[index]!
      this.buffer.life[index] = keep.life[index]!
      this.buffer.maxLife[index] = keep.maxLife[index]!
      this.buffer.seed[index] = keep.seed[index]!
    }
  }

  private fail(error: unknown): void {
    this.failed = true
    this.clear()
    if (error instanceof SandboxFailure) {
      const info: SandboxError = error.info
      this.lastError = `${info.name}: ${info.message}`.slice(0, 200)
    } else {
      this.lastError = String(error instanceof Error ? error.message : error).slice(0, 200)
    }
  }
}

function disposeAll(handles: Array<QuickJSHandle | null>): void {
  for (const handle of handles) {
    try {
      handle?.dispose()
    } catch {
      // A disposed context frees its handles.
    }
  }
}



/** @deprecated use SandboxedPlugin. */
export { SandboxedPlugin as SandboxedEffect }

/**
 * In-process host for the particle-system API.
 *
 * The host owns the packed buffer, spawn rate, event bursts, compaction and
 * palette resolution. A sandboxed version will move the same calls across a
 * worker boundary; the plugin contract stays the same.
 */
import { RGBA } from "@opentui/core"

import type { ThemePalette } from "../theme"
import {
  PARTICLE_LIMITS,
  type ParticleBuffer,
  type ParticleContext,
  type ParticleEvent,
  type ParticleSystem,
} from "./api"
import type { Particle } from "./particles"
import type { TextLayer } from "./paint"

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resolveColor(value: string | undefined, palette: ThemePalette): RGBA {
  if (!value) return RGBA.fromHex(palette.accent)
  if (value.startsWith("#")) {
    try {
      return RGBA.fromHex(value)
    } catch {
      return RGBA.fromHex(palette.accent)
    }
  }
  const role = palette[value as keyof ThemePalette]
  return RGBA.fromHex(role ?? palette.accent)
}

export class CustomParticleHost {
  readonly system: ParticleSystem
  readonly layer: TextLayer
  private readonly palette: ThemePalette
  private readonly out: ParticleBuffer
  private count = 0
  private time = 0
  private emit = 0
  private width: number
  private height: number
  private cursor = { x: 0, y: 0 }
  private events: ParticleEvent[] = []
  private lastCell = { x: -1, y: -1 }
  private failures = 0
  /** A system that throws repeatedly is stopped, not allowed to spam errors. */
  failed = false
  lastError: string | null = null

  constructor(
    width: number,
    height: number,
    palette: ThemePalette,
    system: ParticleSystem,
  ) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.palette = palette
    this.system = system
    this.layer = system.textLayer ?? "around"
    const capacity = Math.max(1, Math.min(PARTICLE_LIMITS.maxParticles, system.maxParticles ?? 256))
    this.out = {
      count: 0,
      capacity,
      x: new Float32Array(capacity),
      y: new Float32Array(capacity),
      vx: new Float32Array(capacity),
      vy: new Float32Array(capacity),
      life: new Float32Array(capacity),
      maxLife: new Float32Array(capacity),
      seed: new Float32Array(capacity),
    }
  }

  get particleCount(): number {
    return this.count
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  setCursor(x: number, y: number): void {
    this.cursor = { x, y }
    if (x !== this.lastCell.x || y !== this.lastCell.y) {
      this.lastCell = { x, y }
      this.events.push({ kind: "cursor-move", x, y })
    }
  }

  event(event: ParticleEvent): void {
    this.events.push(event)
  }

  clear(): void {
    this.count = 0
    this.emit = 0
    this.events = []
    this.out.count = 0
    this.failures = 0
    this.failed = false
    this.lastError = null
  }

  update(dt: number): void {
    if (this.failed) return
    const step = Math.max(0, Math.min(0.1, dt))
    this.time += step
    this.emit += (this.system.spawnRate ?? 0) * step

    const context = this.context(step)
    this.out.count = this.count

    for (const event of this.events) {
      const trigger = event.kind === "cursor-move" ? "cursor-move" : event.kind
      if (!this.system.spawnOn?.includes(trigger)) continue
      const bursts = Math.max(0, this.system.spawnBurst ?? 0)
      for (let index = 0; index < bursts; index++) this.spawn(context)
    }

    while (this.emit >= 1) {
      this.emit -= 1
      if (!this.spawn(context)) break
    }

    this.out.count = this.count
    if (this.system.step) {
      this.guard(() => this.system.step!(context, this.out, this.count))
    }
    this.out.count = this.count

    for (let index = this.count - 1; index >= 0; index--) {
      const alive = this.out.life[index]! > 0
      const inside =
        this.out.x[index]! >= -1 &&
        this.out.x[index]! <= this.width &&
        this.out.y[index]! >= -1 &&
        this.out.y[index]! <= this.height
      if (alive && inside) continue
      this.count -= 1
      const last = this.count
      if (index !== last) {
        this.out.x[index] = this.out.x[last]!
        this.out.y[index] = this.out.y[last]!
        this.out.vx[index] = this.out.vx[last]!
        this.out.vy[index] = this.out.vy[last]!
        this.out.life[index] = this.out.life[last]!
        this.out.maxLife[index] = this.out.maxLife[last]!
        this.out.seed[index] = this.out.seed[last]!
      }
    }
    this.out.count = this.count
    this.events = []
  }

  particles(): Particle[] {
    if (this.failed || this.count === 0) return []
    const context = this.context(0)
    const result: Particle[] = []
    for (let index = 0; index < this.count; index++) {
      const style = this.system.style
        ? this.guard(() => this.system.style!(context, this.out, index))
        : {}
      const maxLife = Math.max(0.001, this.out.maxLife[index]!)
      const life = this.out.life[index]!
      const base = resolveColor(style.color, this.palette)
      const alpha = clamp(style.alpha ?? 1, 0, 1)
      result.push({
        x: this.out.x[index]!,
        y: this.out.y[index]!,
        vx: this.out.vx[index]!,
        vy: this.out.vy[index]!,
        age: maxLife - life,
        life: maxLife,
        seed: this.out.seed[index]!,
        glyph: style.glyph && style.glyph.length > 0 ? style.glyph : "·",
        mode: "sparks",
        color: RGBA.fromValues(base.r, base.g, base.b, alpha),
        layer: style.layer,
      })
    }
    return result
  }

  private spawn(context: ParticleContext): boolean {
    if (this.failed || this.count >= this.out.capacity || !this.system.spawn) return false
    this.out.count = this.count
    if (!this.guard(() => this.system.spawn!(context, this.out, this.count), false)) return false
    this.count += 1
    this.out.count = this.count
    return true
  }

  private guard<T>(run: () => T): T
  private guard<T>(run: () => T, fallback: T): T
  private guard<T>(run: () => T, fallback?: T): T | undefined {
    try {
      return run()
    } catch (error) {
      this.failures += 1
      this.lastError = String(error instanceof Error ? error.message : error).slice(0, 200)
      if (this.failures >= 5) {
        this.failed = true
        this.count = 0
        this.out.count = 0
      }
      return fallback
    }
  }

  private context(dt: number): ParticleContext {
    return {
      dt,
      time: this.time,
      width: this.width,
      height: this.height,
      cursor: { ...this.cursor },
      palette: this.palette,
      events: this.events,
    }
  }
}

/**
 * The interface the app's frame loop uses. The in-process host and the
 * sandboxed worker host both implement it, so effects are interchangeable.
 */
export type EffectHost = {
  readonly layer: TextLayer
  readonly particleCount: number
  readonly failed?: boolean
  setCursor(x: number, y: number): void
  resize(width: number, height: number): void
  event(event: ParticleEvent): void
  update(dt: number): void
  particles(): Particle[]
  clear(): void
  dispose?(): void
}

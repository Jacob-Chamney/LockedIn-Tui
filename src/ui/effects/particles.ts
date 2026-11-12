/**
 * Deterministic cell-particle simulation for the terminal effects lab.
 *
 * Particles live in cell coordinates with float positions, so movement looks
 * smooth at 60 fps while rendering stays on the fixed cell grid. The field is
 * pure and takes its RNG from the caller, so tests are reproducible.
 */

export type ParticleMode = "fire" | "snow" | "sparks"

export type Rgb = readonly [number, number, number]

import type { RGBA } from "@opentui/core"

import type { TextLayer } from "./paint"

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  /** 0..1, used for colour interpolation. */
  seed: number
  glyph: string
  mode: ParticleMode
  /** Custom particle systems can choose an exact colour. */
  color?: RGBA
  /** Per-particle text layer; defaults to the system layer. */
  layer?: TextLayer
}

export type ParticleOptions = {
  max?: number
  rng?: () => number
}

const FIRE_GLYPHS = ["█", "▓", "▒", "░", "▀", "▄"]
const SNOW_GLYPHS = ["*", "·", "+", "∙"]
const SPARK_GLYPHS = ["·", "*", "+", "∙"]

const GRAVITY: Record<ParticleMode, number> = {
  // Cell rows grow downwards. Fire rises, then falls; snow drifts down;
  // sparks arc under a stronger pull.
  fire: 9,
  snow: 2,
  sparks: 18,
}

const DRAG: Record<ParticleMode, number> = {
  fire: 0.985,
  snow: 0.995,
  sparks: 0.97,
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class ParticleField {
  readonly particles: Particle[] = []
  readonly max: number
  private readonly rng: () => number
  private width: number
  private height: number

  constructor(width: number, height: number, options: ParticleOptions = {}) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.max = Math.max(1, options.max ?? 256)
    this.rng = options.rng ?? Math.random
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index]!
      if (particle.x < 0 || particle.x >= this.width || particle.y < 0 || particle.y >= this.height) {
        this.particles.splice(index, 1)
      }
    }
  }

  get count(): number {
    return this.particles.length
  }

  clear(): void {
    this.particles.length = 0
  }

  spawn(x: number, y: number, mode: ParticleMode, count?: number): void {
    const amount = Math.max(1, Math.floor(count ?? (mode === "sparks" ? 14 : 6)))
    for (let index = 0; index < amount; index++) {
      if (this.particles.length >= this.max) return
      const angle = this.rng() * Math.PI * 2
      const speed = mode === "snow" ? 1 + this.rng() * 3 : 2 + this.rng() * 9
      const upward = mode === "fire" ? -(5 + this.rng() * 12) : 0
      const vx = Math.cos(angle) * speed * (mode === "snow" ? 0.5 : 1)
      const vy = mode === "snow" ? 1 + this.rng() * 4 : upward + Math.sin(angle) * speed
      const life = mode === "snow" ? 1.4 + this.rng() * 1.8 : 0.35 + this.rng() * 0.9
      const glyph =
        mode === "fire"
          ? pick(FIRE_GLYPHS, this.rng)
          : mode === "snow"
            ? pick(SNOW_GLYPHS, this.rng)
            : pick(SPARK_GLYPHS, this.rng)
      this.particles.push({
        x: clamp(x, 0, this.width - 1),
        y: clamp(y, 0, this.height - 1),
        vx,
        vy,
        age: 0,
        life,
        seed: this.rng(),
        glyph,
        mode,
      })
    }
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(0.1, dt))
    if (step === 0) return
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index]!
      particle.age += step
      if (particle.age >= particle.life) {
        this.particles.splice(index, 1)
        continue
      }
      particle.vy += GRAVITY[particle.mode] * step
      particle.vx *= DRAG[particle.mode]
      particle.vy *= DRAG[particle.mode]
      particle.x += particle.vx * step
      particle.y += particle.vy * step
      if (
        particle.x < -1 ||
        particle.x > this.width ||
        particle.y < -1 ||
        particle.y > this.height
      ) {
        this.particles.splice(index, 1)
      }
    }
  }
}

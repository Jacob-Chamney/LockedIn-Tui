/**
 * Stable particle-system API for the effects host.
 *
 * A plugin defines behaviour, not painting. The host owns the particle buffer,
 * spawning policy, text layer, palette resolution, limits and rendering.
 *
 * This is the API the wiki demo documents. It runs in-process for first-party
 * effects and is designed to move into the sandboxed worker host unchanged.
 */
import type { ThemePalette } from "../theme"
import type { TextLayer } from "./paint"

export type ParticleEvent =
  | { kind: "cursor-move"; x: number; y: number }
  | { kind: "keypress"; name: string }
  | { kind: "send" }

export type ParticleBuffer = {
  /** Active particle count; the host keeps this current. */
  count: number
  capacity: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  life: Float32Array
  maxLife: Float32Array
  seed: Float32Array
}

export type ParticleContext = {
  dt: number
  time: number
  width: number
  height: number
  cursor: { x: number; y: number }
  palette: ThemePalette
  events: readonly ParticleEvent[]
}

export type ParticleStyle = {
  glyph?: string
  /** A palette role (`accent`, `warning`, …) or a `#rrggbb` value. */
  color?: string
  alpha?: number
  /** Optional per-particle override; defaults to the system layer. */
  layer?: TextLayer
}

export type ParticleSpawnTrigger = "cursor-move" | "keypress" | "send"

export type ParticleSystem = {
  id: string
  /** Display name for the plugin manager; the manifest name is the fallback. */
  name?: string
  maxParticles?: number
  textLayer?: TextLayer
  /** Particles emitted per second while active. */
  spawnRate?: number
  /** Extra bursts on these events. */
  spawnOn?: readonly ParticleSpawnTrigger[]
  spawnBurst?: number
  /** Fill one particle slot. Return false to stop the burst. */
  spawn?(ctx: ParticleContext, out: ParticleBuffer, index: number): boolean
  /** Advance active particles. The host compacts expired slots afterwards. */
  step?(ctx: ParticleContext, out: ParticleBuffer, count: number): void
  /** Per-particle look. */
  style?(ctx: ParticleContext, out: ParticleBuffer, index: number): ParticleStyle
}

export function defineParticleSystem(system: ParticleSystem): ParticleSystem {
  return system
}

/** Hard limits the host enforces, whatever a system asks for. */
export const PARTICLE_LIMITS = {
  maxParticles: 1024,
  spawnRate: 240,
  spawnBurst: 64,
  idLength: 64,
} as const

export type SystemCheck =
  | { ok: true; system: ParticleSystem }
  | { ok: false; errors: string[] }

const TRIGGERS: readonly ParticleSpawnTrigger[] = ["cursor-move", "keypress", "send"]
const TEXT_LAYERS: readonly TextLayer[] = ["around", "under", "over"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function boundedNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  errors: string[],
): void {
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${name} must be a number between ${min} and ${max}`)
  }
}

/**
 * Check a system loaded from a user file before it reaches the host.
 *
 * The host clamps limits too; this reports the problem to the author instead of
 * silently changing their effect.
 */
export function validateParticleSystem(input: unknown): SystemCheck {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ["a particle system must be an object"] }

  const id = input.id
  if (typeof id !== "string" || id.trim() === "") {
    errors.push("id must be a non-empty string")
  } else if (id.length > PARTICLE_LIMITS.idLength || /\s/.test(id.trim())) {
    errors.push(`id must be at most ${PARTICLE_LIMITS.idLength} characters and contain no spaces`)
  }

  boundedNumber(input.maxParticles, "maxParticles", 1, PARTICLE_LIMITS.maxParticles, errors)
  boundedNumber(input.spawnRate, "spawnRate", 0, PARTICLE_LIMITS.spawnRate, errors)
  boundedNumber(input.spawnBurst, "spawnBurst", 0, PARTICLE_LIMITS.spawnBurst, errors)

  if (input.textLayer !== undefined && !TEXT_LAYERS.includes(input.textLayer as TextLayer)) {
    errors.push(`textLayer must be one of ${TEXT_LAYERS.join(", ")}`)
  }

  if (input.spawnOn !== undefined) {
    if (!Array.isArray(input.spawnOn)) {
      errors.push("spawnOn must be an array")
    } else {
      for (const trigger of input.spawnOn) {
        if (!TRIGGERS.includes(trigger as ParticleSpawnTrigger)) {
          errors.push(`spawnOn contains an unknown trigger: ${String(trigger)}`)
        }
      }
    }
  }

  for (const name of ["spawn", "step", "style"] as const) {
    if (input[name] !== undefined && typeof input[name] !== "function") {
      errors.push(`${name} must be a function`)
    }
  }

  const emits = (input.spawnRate as number | undefined ?? 0) > 0 || (input.spawnOn as unknown[] | undefined ?? []).length > 0
  if (emits && typeof input.spawn !== "function") {
    errors.push("spawn is required when spawnRate or spawnOn is set")
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, system: input as ParticleSystem }
}

/**
 * Example particle system: keypress sparks.
 *
 * Copy this file, change the numbers and glyphs, and load it as a user effect.
 * The host owns the buffer and the frame loop; this file only decides what a
 * spark is, how it moves and what it looks like.
 *
 * - `spawnOn: ["keypress"]` emits `spawnBurst` particles per key.
 * - `spawn` fills one slot and returns false to stop the burst.
 * - `step` advances every live slot; the host compacts expired slots.
 * - `style` is called per live particle at paint time.
 */
import { defineParticleSystem } from "../api"

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default defineParticleSystem({
  id: "example.sparks",
  maxParticles: 120,
  textLayer: "around",
  spawnRate: 0,
  spawnOn: ["keypress"],
  spawnBurst: 3,

  spawn(ctx, out, index) {
    out.x[index] = clamp(ctx.cursor.x + (Math.random() - 0.5) * 2, 0, ctx.width - 1)
    out.y[index] = clamp(ctx.cursor.y, 0, ctx.height - 1)
    out.vx[index] = (Math.random() - 0.5) * 14
    out.vy[index] = -4 - Math.random() * 9
    const life = 0.3 + Math.random() * 0.6
    out.life[index] = life
    out.maxLife[index] = life
    out.seed[index] = Math.random()
    return true
  },

  step(_ctx, out, count) {
    for (let index = 0; index < count; index++) {
      out.vy[index] = out.vy[index]! + 18 * _ctx.dt
      out.vx[index] = out.vx[index]! * 0.98
      out.x[index] = out.x[index]! + out.vx[index]! * _ctx.dt
      out.y[index] = out.y[index]! + out.vy[index]! * _ctx.dt
      out.life[index] = out.life[index]! - _ctx.dt
    }
  },

  style(_ctx, out, index) {
    const seed = out.seed[index]!
    return {
      glyph: seed > 0.6 ? "+" : seed > 0.3 ? "*" : "·",
      color: seed > 0.5 ? "warning" : "accent",
      alpha: 0.7 + 0.3 * Math.sin(out.life[index]! * 20),
    }
  },
})

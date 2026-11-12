/**
 * Example particle system: an ember burst when a message is sent.
 *
 * Same contract as `sparks.ts`: spawn one slot, step the live slots, style
 * them. `spawnOn: ["send"]` means the burst fires once per sent message
 * instead of on every key.
 */
import { defineParticleSystem } from "../api"

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default defineParticleSystem({
  id: "example.embers",
  maxParticles: 160,
  textLayer: "around",
  spawnRate: 0,
  spawnOn: ["send"],
  spawnBurst: 28,

  spawn(ctx, out, index) {
    out.x[index] = clamp(ctx.cursor.x + (Math.random() - 0.5) * 24, 0, ctx.width - 1)
    out.y[index] = clamp(ctx.cursor.y + Math.random() * 2, 0, ctx.height - 1)
    out.vx[index] = (Math.random() - 0.5) * 1.6
    out.vy[index] = -0.5 - Math.random() * 1.6
    const life = 1.4 + Math.random() * 1.8
    out.life[index] = life
    out.maxLife[index] = life
    out.seed[index] = Math.random()
    return true
  },

  step(ctx, out, count) {
    for (let index = 0; index < count; index++) {
      const seed = out.seed[index]!
      out.vx[index] = out.vx[index]! + Math.sin(ctx.time * 2 + seed * 8) * 0.4 * ctx.dt
      out.vy[index] = out.vy[index]! - 0.25 * ctx.dt
      out.x[index] = out.x[index]! + out.vx[index]! * ctx.dt
      out.y[index] = out.y[index]! + out.vy[index]! * ctx.dt
      out.life[index] = out.life[index]! - ctx.dt
    }
  },

  style(_ctx, out, index) {
    const seed = out.seed[index]!
    const remaining = out.life[index]! / Math.max(0.001, out.maxLife[index]!)
    return {
      glyph: seed > 0.7 ? "░" : seed > 0.4 ? "·" : "∙",
      color: remaining > 0.5 ? "warning" : "accent",
      alpha: Math.min(1, remaining + 0.2),
    }
  },
})

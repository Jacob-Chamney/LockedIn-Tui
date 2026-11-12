/**
 * Demo particle system for the API and the wiki.
 *
 * It follows the cursor with warm fireflies: slow upward drift, a sine sway,
 * and a palette-driven colour mix. The same file is shown on the wiki's
 * Effects and particles page.
 */
import { defineParticleSystem } from "../api"

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default defineParticleSystem({
  id: "demo.fireflies",
  maxParticles: 320,
  textLayer: "under",
  spawnRate: 18,
  spawnOn: ["cursor-move"],
  spawnBurst: 5,

  spawn(ctx, out, index) {
    out.x[index] = clamp(
      ctx.cursor.x + (Math.random() - 0.5) * 8,
      0,
      ctx.width - 1,
    )
    out.y[index] = clamp(
      ctx.cursor.y + (Math.random() - 0.5) * 4,
      0,
      ctx.height - 1,
    )
    out.vx[index] = (Math.random() - 0.5) * 2
    out.vy[index] = -0.4 - Math.random() * 1.8
    const life = 1.2 + Math.random() * 1.8
    out.life[index] = life
    out.maxLife[index] = life
    out.seed[index] = Math.random()
    return true
  },

  step(ctx, out, count) {
    for (let index = 0; index < count; index++) {
      const seed = out.seed[index]!
      out.vx[index] = out.vx[index]! + Math.sin(ctx.time * 2.4 + seed * 9) * 0.6 * ctx.dt
      out.vy[index] = out.vy[index]! + Math.cos(ctx.time * 1.7 + seed * 5) * 0.25 * ctx.dt
      out.vx[index] = out.vx[index]! * 0.99
      out.vy[index] = out.vy[index]! * 0.995
      out.x[index] = out.x[index]! + out.vx[index]! * ctx.dt
      out.y[index] = out.y[index]! + out.vy[index]! * ctx.dt
      out.life[index] = out.life[index]! - ctx.dt
    }
  },

  style(_ctx, out, index) {
    const seed = out.seed[index]!
    const glyph = seed > 0.78 ? "*" : seed > 0.42 ? "·" : "∙"
    const color = seed > 0.66 ? "warning" : seed > 0.33 ? "accent" : "success"
    const alpha = 0.65 + 0.35 * Math.sin((out.maxLife[index]! - out.life[index]!) * 3 + seed * 6)
    return { glyph, color, alpha }
  },
})

import { describe, expect, test } from "bun:test"

import { defineParticleSystem } from "../../src/ui/effects/api"
import { CustomParticleHost } from "../../src/ui/effects/host"
import { crimson } from "../../src/ui/theme/palettes"

const system = defineParticleSystem({
  id: "test.spark",
  maxParticles: 4,
  textLayer: "under",
  spawnBurst: 2,
  spawnOn: ["cursor-move"],
  spawn(_ctx, out, index) {
    out.x[index] = 10
    out.y[index] = 5
    out.vx[index] = 1
    out.vy[index] = 0
    out.life[index] = 1
    out.maxLife[index] = 1
    out.seed[index] = 0.5
    return true
  },
  step(_ctx, out, count) {
    for (let index = 0; index < count; index++) {
      out.x[index] = out.x[index]! + out.vx[index]!
      out.life[index] = out.life[index]! - 0.1
    }
  },
  style() {
    return { glyph: "*", color: "warning", alpha: 0.8 }
  },
})

describe("custom particle host", () => {
  test("a cursor move spawns a burst, steps and styles it", () => {
    const host = new CustomParticleHost(40, 12, crimson, system)
    host.setCursor(10, 5)
    host.update(1 / 60)
    expect(host.particleCount).toBe(2)
    const particles = host.particles()
    expect(particles).toHaveLength(2)
    expect(particles[0]!.glyph).toBe("*")
    expect(particles[0]!.x).toBe(11)
    expect(particles[0]!.color?.toInts()[3]).toBe(204)
    expect(particles[0]!.color?.toInts()[0]).toBeGreaterThan(0)
  })

  test("the buffer cap is respected", () => {
    const host = new CustomParticleHost(40, 12, crimson, system)
    for (let index = 0; index < 10; index++) {
      host.setCursor(index, 5)
      host.update(1 / 60)
    }
    expect(host.particleCount).toBeLessThanOrEqual(4)
  })

  test("expired particles are compacted", () => {
    const host = new CustomParticleHost(40, 12, crimson, system)
    host.setCursor(10, 5)
    host.update(1 / 60)
    expect(host.particleCount).toBe(2)
    for (let step = 0; step < 20; step++) host.update(0.1)
    expect(host.particleCount).toBe(0)
  })
})

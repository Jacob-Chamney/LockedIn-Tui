import { describe, expect, test } from "bun:test"

import { CursorSpring, CursorTrail } from "../../src/ui/effects/cursor"
import { ParticleField } from "../../src/ui/effects/particles"

function seeded(seed = 1): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe("particle field", () => {
  test("spawns a bounded burst and caps the pool", () => {
    const field = new ParticleField(80, 24, { max: 5, rng: seeded(2) })
    field.spawn(10, 10, "sparks", 20)
    expect(field.count).toBe(5)
  })

  test("particles expire and leave the field", () => {
    const field = new ParticleField(80, 24, { rng: seeded(3) })
    field.spawn(10, 10, "fire", 1)
    const life = field.particles[0]!.life
    for (let step = 0; step < Math.ceil((life + 0.05) / 0.1); step++) field.update(0.1)
    expect(field.count).toBe(0)
  })

  test("fire rises and sparks fall under gravity", () => {
    const fire = new ParticleField(80, 40, { rng: () => 0.5 })
    fire.spawn(20, 20, "fire", 1)
    const fireStart = fire.particles[0]!.y
    fire.update(0.05)
    expect(fire.particles[0]!.y).toBeLessThan(fireStart)

    const sparks = new ParticleField(80, 40, { rng: () => 0.5 })
    sparks.spawn(20, 20, "sparks", 1)
    const sparkStart = sparks.particles[0]!.y
    sparks.update(0.1)
    expect(sparks.particles[0]!.y).toBeGreaterThan(sparkStart)
  })

  test("a resize drops particles outside the new field", () => {
    const field = new ParticleField(80, 24, { rng: seeded(4) })
    field.spawn(70, 20, "snow", 8)
    field.resize(20, 10)
    expect(field.particles.every((particle) => particle.x < 20 && particle.y < 10)).toBe(true)
  })
})

describe("cursor trail", () => {
  test("records distinct cells and fades old ones", () => {
    const trail = new CursorTrail(0.2, 4)
    trail.record(1, 1)
    trail.record(1, 1)
    trail.record(2, 1)
    expect(trail.points).toHaveLength(2)
    trail.update(0.1)
    expect(trail.points).toHaveLength(2)
    trail.update(0.11)
    expect(trail.points).toHaveLength(0)
  })

  test("keeps a bounded history", () => {
    const trail = new CursorTrail(10, 3)
    for (let x = 0; x < 10; x++) trail.record(x, 0)
    expect(trail.points.length).toBeLessThanOrEqual(3)
  })
})

describe("cursor spring", () => {
  test("converges on the target and reports idle", () => {
    const spring = new CursorSpring(0, 0)
    spring.setTarget(20, 10)
    for (let step = 0; step < 120; step++) spring.update(1 / 60)
    expect(spring.distance).toBeLessThan(0.1)
    expect(spring.active).toBe(false)
    expect(spring.cell).toEqual({ x: 20, y: 10 })
  })
})

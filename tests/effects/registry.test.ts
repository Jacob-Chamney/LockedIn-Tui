import { describe, expect, test } from "bun:test"

import { validateParticleSystem } from "../../src/ui/effects/api"
import { CustomParticleHost } from "../../src/ui/effects/host"
import { EffectRegistry } from "../../src/ui/effects/registry"
import { crimson } from "../../src/ui/theme/palettes"

function system(overrides: Record<string, unknown> = {}) {
  return {
    id: "user.example",
    maxParticles: 16,
    textLayer: "around",
    spawnRate: 2,
    spawnOn: ["keypress"],
    spawnBurst: 1,
    spawn(_ctx: unknown, out: { x: Float32Array; y: Float32Array; life: Float32Array; maxLife: Float32Array; seed: Float32Array }, index: number) {
      out.x[index] = 1
      out.y[index] = 1
      out.life[index] = 1
      out.maxLife[index] = 1
      out.seed[index] = 0.5
      return true
    },
    ...overrides,
  }
}

describe("particle system validation", () => {
  test("a well-formed system passes", () => {
    expect(validateParticleSystem(system())).toMatchObject({ ok: true })
  })

  test("the id is required and readable", () => {
    expect(validateParticleSystem(system({ id: "" })).ok).toBe(false)
    expect(validateParticleSystem(system({ id: "has spaces" })).ok).toBe(false)
    expect(validateParticleSystem(system({ id: "x".repeat(65) })).ok).toBe(false)
  })

  test("limits are reported, not silently clamped", () => {
    const tooMany = validateParticleSystem(system({ maxParticles: 5000 }))
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.errors.join(" ")).toContain("maxParticles")
    expect(validateParticleSystem(system({ spawnRate: -1 })).ok).toBe(false)
    expect(validateParticleSystem(system({ spawnBurst: 999 })).ok).toBe(false)
  })

  test("layers, triggers and callbacks are checked", () => {
    expect(validateParticleSystem(system({ textLayer: "behind" })).ok).toBe(false)
    expect(validateParticleSystem(system({ spawnOn: ["paste"] })).ok).toBe(false)
    expect(validateParticleSystem(system({ spawn: "no" })).ok).toBe(false)
    expect(validateParticleSystem(system({ spawn: undefined })).ok).toBe(false)
  })

  test("a system that emits must be able to spawn", () => {
    const result = validateParticleSystem(system({ spawn: undefined, spawnOn: ["send"] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(" ")).toContain("spawn is required")
  })
})

describe("effect registry", () => {
  test("adds, lists and removes systems", () => {
    const registry = new EffectRegistry()
    expect(registry.add(system()).ok).toBe(true)
    expect(registry.add(system({ id: "user.second" })).ok).toBe(true)
    expect(registry.list().map((entry) => entry.id)).toEqual(["user.example", "user.second"])
    expect(registry.setEnabled("user.example", false)).toBe(true)
    expect(registry.enabled().map((entry) => entry.id)).toEqual(["user.second"])
    expect(registry.remove("user.example")).toBe(true)
    expect(registry.size).toBe(1)
  })

  test("a duplicate id is rejected", () => {
    const registry = new EffectRegistry()
    registry.add(system())
    const again = registry.add(system())
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.errors[0]).toContain("already registered")
  })

  test("an invalid system never enters the registry", () => {
    const registry = new EffectRegistry()
    expect(registry.add({ id: "" }).ok).toBe(false)
    expect(registry.size).toBe(0)
  })
})

describe("host failure containment", () => {
  test("a system that throws is stopped instead of crashing the frame loop", () => {
    const host = new CustomParticleHost(40, 12, crimson, {
      ...system({
        step() {
          throw new Error("boom")
        },
      }),
    } as unknown as import("../../src/ui/effects/api").ParticleSystem)
    host.setCursor(4, 4)
    for (let index = 0; index < 6; index++) host.update(1 / 60)
    expect(host.failed).toBe(true)
    expect(host.lastError).toBe("boom")
    expect(host.particleCount).toBe(0)
    expect(host.particles()).toEqual([])
  })

  test("a throwing spawn reports the error and emits nothing", () => {
    const host = new CustomParticleHost(40, 12, crimson, {
      ...system({
        spawnOn: ["cursor-move"],
        spawn() {
          throw new Error("no slot")
        },
      }),
    } as unknown as import("../../src/ui/effects/api").ParticleSystem)
    host.setCursor(4, 4)
    host.update(1 / 60)
    expect(host.lastError).toBe("no slot")
    expect(host.particleCount).toBe(0)
  })
})

test("keypress and send events reach systems that subscribe", () => {
  const spawned: string[] = []
  const host = new CustomParticleHost(40, 12, crimson, {
    id: "user.events",
    maxParticles: 8,
    textLayer: "around",
    spawnRate: 0,
    spawnOn: ["keypress", "send"],
    spawnBurst: 1,
    spawn(_ctx: unknown, out: { x: Float32Array; y: Float32Array; life: Float32Array; maxLife: Float32Array; seed: Float32Array }, index: number) {
      spawned.push("spawn")
      out.x[index] = 1
      out.y[index] = 1
      out.life[index] = 1
      out.maxLife[index] = 1
      out.seed[index] = 0.5
      return true
    },
  } as unknown as import("../../src/ui/effects/api").ParticleSystem)
  host.event({ kind: "keypress", name: "a" })
  host.update(1 / 60)
  expect(host.particleCount).toBe(1)
  host.event({ kind: "send" })
  host.update(1 / 60)
  expect(host.particleCount).toBe(2)
  expect(spawned).toHaveLength(2)
})

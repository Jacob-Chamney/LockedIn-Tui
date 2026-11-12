/**
 * Effect sandbox benchmark (dev).
 *
 *   bun run scripts/effect-bench.ts
 *
 * Measures QuickJS init, one effect load, and the steady-state frame cost with
 * the default limits. Numbers are host-relative; run it before and after a
 * change to the boundary protocol.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bundleEffectEntry } from "../src/ui/effects/loader"
import { SandboxedEffect } from "../src/ui/effects/sandbox/effect"
import { loadQuickJS } from "../src/ui/effects/sandbox/runtime"
import type { EffectManifest } from "../src/ui/effects/sandbox/manifest"

const SOURCE = `
export default {
  id: "bench.effect",
  maxParticles: 160,
  textLayer: "around",
  spawnRate: 40,
  spawnOn: ["keypress"],
  spawnBurst: 2,
  spawn(ctx, out, index) {
    out.x[index] = ctx.cursor.x + (Math.random() - 0.5) * 8
    out.y[index] = ctx.cursor.y + (Math.random() - 0.5) * 4
    out.vx[index] = (Math.random() - 0.5) * 2
    out.vy[index] = -0.5 - Math.random() * 1.5
    out.life[index] = 1.2 + Math.random() * 1.8
    out.maxLife[index] = out.life[index]
    out.seed[index] = Math.random()
    return true
  },
  step(ctx, out, count) {
    for (let i = 0; i < count; i++) {
      out.x[i] += out.vx[i] * ctx.dt
      out.y[i] += out.vy[i] * ctx.dt
      out.life[i] -= ctx.dt
    }
  },
  style(_ctx, out, index) {
    return { glyph: out.seed[index] > 0.5 ? "*" : "·", color: "accent", alpha: 0.8 }
  },
}
`

const MANIFEST: EffectManifest = {
  manifestVersion: 1,
  id: "bench.effect",
  name: "Bench",
  version: "1.0.0",
  apiVersion: "1.0",
  entry: "effect.ts",
  permissions: {
    particles: {
      maxParticles: 160,
      layers: ["around"],
      triggers: ["keypress"],
      spawnRate: 60,
      spawnBurst: 4,
    },
  },
}

function stats(samples: number[]): { p50: number; p95: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!
  return {
    p50: at(0.5),
    p95: at(0.95),
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
  }
}

const dir = await mkdtemp(join(tmpdir(), "lockedin-effect-bench-"))
try {
  const entry = join(dir, "effect.ts")
  await writeFile(entry, SOURCE)

  const t0 = performance.now()
  await loadQuickJS()
  const wasm = performance.now() - t0

  const bundle = await bundleEffectEntry(entry)
  const t1 = performance.now()
  const effect = await SandboxedEffect.create(bundle, MANIFEST)
  const load = performance.now() - t1

  effect.resize(200, 60)
  effect.setCursor(100, 30)
  const warm = 40
  const frames = 600
  const samples: number[] = []
  for (let index = 0; index < warm + frames; index++) {
    if (index % 10 === 0) effect.event({ kind: "keypress", name: "a" })
    const started = performance.now()
    effect.update(1 / 60)
    const elapsed = performance.now() - started
    if (index >= warm) samples.push(elapsed)
  }
  effect.dispose()

  const frame = stats(samples)
  console.log(`quickjs wasm init   ${wasm.toFixed(1)} ms`)
  console.log(`effect load         ${load.toFixed(2)} ms  (bundle ${bundle.length} bytes)`)
  console.log(`frame p50 / p95     ${frame.p50.toFixed(3)} / ${frame.p95.toFixed(3)} ms`)
  console.log(`frame mean          ${frame.mean.toFixed(3)} ms over ${frames} frames`)
} finally {
  await rm(dir, { recursive: true, force: true })
}

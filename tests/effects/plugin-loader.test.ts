import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { effectPluginDirs, loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import { DEFAULT_SANDBOX_LIMITS } from "../../src/ui/effects/sandbox/limits"

const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

const EFFECT = `
export default {
  id: "lab.orbit",
  maxParticles: 16,
  textLayer: "around",
  spawnRate: 0,
  spawnOn: ["keypress"],
  spawnBurst: 2,
  spawn(ctx, out, index) {
    out.x[index] = ctx.cursor.x
    out.y[index] = ctx.cursor.y
    out.life[index] = 1
    out.maxLife[index] = 1
    out.seed[index] = 0.4
    return true
  },
  style() { return { glyph: "*", color: "accent" } },
}
`

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: "lab.orbit",
    name: "Orbit",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      particles: {
        maxParticles: 16,
        layers: ["around"],
        triggers: ["keypress"],
        spawnRate: 0,
        spawnBurst: 2,
      },
    },
    ...overrides,
  }
}

async function pluginDir(files: Record<string, string>, name = "orbit"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lockedin-plugin-"))
  dirs.push(root)
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(join(dir, file, ".."), { recursive: true })
    await writeFile(join(dir, file), contents)
  }
  return root
}

test("a plugin directory is discovered and its entry bundled", async () => {
  const root = await pluginDir({ "manifest.json": JSON.stringify(manifest()), "effect.ts": EFFECT })
  const dirs = await effectPluginDirs({ LOCKEDIN_EFFECTS_DIR: root })
  expect(dirs).toHaveLength(1)
  const loaded = await loadEffectPlugins(dirs)
  expect(loaded.errors).toEqual([])
  expect(loaded.plugins).toHaveLength(1)
  const plugin = loaded.plugins[0]!
  expect(plugin.manifest.id).toBe("lab.orbit")
  expect(plugin.bundle).toContain("lab.orbit")

  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest, DEFAULT_SANDBOX_LIMITS)
  try {
    effect.resize(40, 12)
    effect.setCursor(4, 4)
    effect.event({ kind: "keypress", name: "a" })
    effect.update(1 / 60)
    expect(effect.particleCount).toBe(2)
  } finally {
    effect.dispose()
  }
})

test("a manifest with a missing permission is rejected", async () => {
  const root = await pluginDir({
    "manifest.json": JSON.stringify(manifest({ permissions: {} })),
    "effect.ts": EFFECT,
  })
  const loaded = await loadEffectPlugins(await effectPluginDirs({ LOCKEDIN_EFFECTS_DIR: root }))
  expect(loaded.plugins).toEqual([])
  expect(loaded.errors[0]).toContain("permissions.particles")
})

test("an entry outside the plugin directory is rejected", async () => {
  const root = await pluginDir({
    "manifest.json": JSON.stringify(manifest({ entry: "../escape.ts" })),
    "effect.ts": EFFECT,
  })
  await writeFile(join(root, "escape.ts"), EFFECT)
  const loaded = await loadEffectPlugins(await effectPluginDirs({ LOCKEDIN_EFFECTS_DIR: root }))
  expect(loaded.plugins).toEqual([])
  expect(loaded.errors[0]).toContain("entry")
})

test("an effect that imports a Node builtin fails to build", async () => {
  const root = await pluginDir({
    "manifest.json": JSON.stringify(manifest()),
    "effect.ts": `import { readFileSync } from "node:fs"\n${EFFECT.replace('return true', 'readFileSync("/etc/passwd"); return true')}`,
  })
  const loaded = await loadEffectPlugins(await effectPluginDirs({ LOCKEDIN_EFFECTS_DIR: root }))
  expect(loaded.plugins).toEqual([])
  expect(loaded.errors.join(" ").toLowerCase()).toContain("self-contained")
})

test("a plugin directory needs a manifest", async () => {
  const root = await pluginDir({ "effect.ts": EFFECT })
  expect(await effectPluginDirs({ LOCKEDIN_EFFECTS_DIR: root })).toEqual([])
})

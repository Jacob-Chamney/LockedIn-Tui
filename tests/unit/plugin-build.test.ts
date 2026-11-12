import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildPlugin } from "../../scripts/plugin-build"
import { loadPlugins } from "../../src/ui/plugins/loader"
import { SandboxedPlugin } from "../../src/ui/plugins/sandbox/plugin"

const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1,
    id: "test.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: { anchors: ["top-left"], maxNodes: 4, maxText: 40 },
    },
    ...overrides,
  }
}

async function source(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lockedin-plugin-build-"))
  dirs.push(root)
  const dir = join(root, "demo")
  await mkdir(dir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents)
  }
  return dir
}

test("a source plugin packages into a loadable .lockedin directory", async () => {
  const dir = await source({
    "manifest.json": JSON.stringify(manifest()),
    "effect.ts": `import { definePlugin } from "@lockedin/sdk"
      export default definePlugin({
        id: "test.demo",
        name: "Demo",
        compose() { return { nodes: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "hi" }] } },
      })`,
  })
  const out = join(dir, "..", "out")
  const built = await buildPlugin(dir, out)
  expect(built.ok).toBe(true)
  if (!built.ok) return

  const packaged = JSON.parse(await Bun.file(join(built.dir, "manifest.json")).text()) as {
    entry: string
  }
  expect(packaged.entry).toBe("plugin.js")
  expect(await Bun.file(join(built.dir, "plugin.js")).exists()).toBe(true)

  const loaded = await loadPlugins([built.dir])
  expect(loaded.errors).toEqual([])
  const effect = await SandboxedPlugin.create(loaded.plugins[0]!.bundle, loaded.plugins[0]!.manifest)
  try {
    const scene = effect.compose({ state: { width: 40, height: 12 }, time: 1 }) as { nodes: unknown[] }
    expect(scene.nodes).toHaveLength(1)
  } finally {
    effect.dispose()
  }
})

test("a plugin whose system does not match its manifest is refused", async () => {
  const dir = await source({
    "manifest.json": JSON.stringify(manifest({ id: "test.other" })),
    "effect.ts": `export default { id: "test.demo", compose() { return { nodes: [] } } }`,
  })
  const built = await buildPlugin(dir, join(dir, "..", "out"))
  expect(built.ok).toBe(false)
  if (!built.ok) expect(built.error).toContain("does not match")
})

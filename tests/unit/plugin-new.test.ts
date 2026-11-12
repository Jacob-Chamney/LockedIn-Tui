import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildPlugin } from "../../scripts/plugin-build"
import {
  pluginDisplayName,
  scaffoldListing,
  scaffoldPlugin,
  SCAFFOLD_INFO,
  SCAFFOLD_TEMPLATES,
  type ScaffoldTemplate,
} from "../../scripts/plugin-new"
import { loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import type { SceneNode } from "../../src/ui/effects/scene/model"

const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-plugin-new-"))
  dirs.push(dir)
  return dir
}

test("plugin ids and templates are validated", async () => {
  const root = await temp()
  const badId = await scaffoldPlugin({ id: "Bad Id", template: "table", out: root })
  expect(badId.ok).toBe(false)
  const badTemplate = await scaffoldPlugin({
    id: "lab.demo",
    template: "nope" as ScaffoldTemplate,
    out: root,
  })
  expect(badTemplate.ok).toBe(false)
  expect(pluginDisplayName("my.focus-card")).toBe("Card")
  expect(pluginDisplayName("demo")).toBe("Demo")
})

for (const template of SCAFFOLD_TEMPLATES) {
  test(`the ${template} scaffold composes, packages and loads`, async () => {
    const root = await temp()
    const id = `lab.scaffold-${template}`
    const created = await scaffoldPlugin({ id, template, out: root })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const manifest = JSON.parse(await Bun.file(join(created.dir, "manifest.json")).text()) as {
      id: string
      entry: string
      name: string
      permissions: { commands: Array<{ id: string }>; scene: { anchors: string[] } }
    }
    expect(manifest.id).toBe(id)
    expect(manifest.entry).toBe("effect.ts")
    expect(manifest.permissions.scene.anchors).toContain("top-left")
    expect(manifest.permissions.commands.length).toBe(template === "kpi" ? 1 : 2)

    const loaded = await loadEffectPlugins([created.dir])
    expect(loaded.errors).toEqual([])
    const plugin = loaded.plugins[0]!
    expect(plugin.manifest.id).toBe(id)

    const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
    try {
      const scene = effect.compose({
        state: { width: 110, height: 40, focusedWindow: template === "kpi" ? "detail" : null },
        time: 0,
        dt: 0.1,
      }) as { nodes: SceneNode[] }
      expect(scene.nodes.length).toBeGreaterThan(0)

      if (template === "sidebar-main") {
        const split = scene.nodes[0]!
        expect(split.kind).toBe("group")
        if (split.kind !== "group") return
        expect(split.nodes.map((panel) => (panel.kind === "group" ? panel.id : null))).toEqual([
          "menu",
          "main",
        ])
        expect(effect.runCommand("next-row", {
          state: { width: 110, height: 40 },
          time: 1,
        })).toMatchObject({ ok: true, message: "row 1" })
        expect(effect.takeStoreChanges()).toEqual({ selected: 1 })
      } else if (template === "kpi") {
        const strip = scene.nodes[0]!
        expect(strip.kind).toBe("group")
        if (strip.kind !== "group") return
        expect(strip.nodes).toHaveLength(3)
        expect(effect.runCommand("refresh", {
          state: { width: 110, height: 40 },
          time: 1,
        })).toMatchObject({ ok: true, message: "refreshed 1" })
        expect(effect.takeStoreChanges()).toEqual({ refresh: 1 })
      } else {
        const windowNode = scene.nodes[0]!
        expect(windowNode.kind).toBe("group")
        if (windowNode.kind !== "group") return
        expect(windowNode.id).toBe("table")
        expect(effect.runCommand("next-row", {
          state: { width: 110, height: 40 },
          time: 1,
        })).toMatchObject({ ok: true, message: "row 1" })
      }
    } finally {
      effect.dispose()
    }

    // The same scaffold packages into a loadable .lockedin.
    const built = await buildPlugin(created.dir, join(root, `${template}-out`))
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const packagedManifest = JSON.parse(
      await Bun.file(join(built.dir, "manifest.json")).text(),
    ) as { entry: string }
    expect(packagedManifest.entry).toBe("plugin.js")
    const packaged = await loadEffectPlugins([built.dir])
    expect(packaged.errors).toEqual([])
    expect(packaged.plugins[0]!.manifest.id).toBe(id)
    const packagedEffect = await SandboxedEffect.create(
      packaged.plugins[0]!.bundle,
      packaged.plugins[0]!.manifest,
    )
    try {
      const scene = packagedEffect.compose({
        state: { width: 110, height: 40 },
        time: 0,
        dt: 0.1,
      }) as { nodes: SceneNode[] }
      expect(scene.nodes.length).toBeGreaterThan(0)
    } finally {
      packagedEffect.dispose()
    }
  })
}

test("an existing scaffold is kept unless force is set", async () => {
  const root = await temp()
  const first = await scaffoldPlugin({ id: "lab.once", template: "table", out: root })
  expect(first.ok).toBe(true)
  const second = await scaffoldPlugin({ id: "lab.once", template: "kpi", out: root })
  expect(second.ok).toBe(false)
  if (!second.ok) expect(second.error).toContain("already exists")
  const forced = await scaffoldPlugin({ id: "lab.once", template: "kpi", out: root, force: true })
  expect(forced.ok).toBe(true)
  if (!forced.ok) return
  expect(JSON.parse(await Bun.file(join(forced.dir, "manifest.json")).text())).toMatchObject({
    permissions: { commands: [{ id: "refresh" }] },
  })
})

test("the scaffold listing names every template", () => {
  const lines = scaffoldListing()
  expect(lines).toHaveLength(SCAFFOLD_TEMPLATES.length)
  for (const template of SCAFFOLD_TEMPLATES) {
    expect(lines.some((line) => line.startsWith(template))).toBe(true)
    expect(SCAFFOLD_INFO[template].length).toBeGreaterThan(10)
  }
})

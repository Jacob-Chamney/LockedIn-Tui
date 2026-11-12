import { expect, test } from "bun:test"

import { loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import type { SceneNode } from "../../src/ui/effects/scene/model"

async function example() {
  const loaded = await loadEffectPlugins(["src/ui/effects/examples/scene-drag"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
  const compose = (time = 0) =>
    effect.compose({
      state: { width: 120, height: 40 },
      time,
      dt: 0.25,
    }) as { nodes: SceneNode[] }
  return { plugin, effect, compose }
}

function card(nodes: readonly SceneNode[]) {
  const found = nodes.find((node) => node.kind === "group" && node.id === "card")
  if (found?.kind !== "group") throw new Error("expected card")
  return found
}

test("the drag example moves its window and persists the position", async () => {
  const { plugin, effect, compose } = await example()
  try {
    expect(plugin.manifest.permissions.pointer).toEqual({
      press: "drag-start",
      move: "drag-move",
      release: "drag-end",
    })
    expect(card(compose().nodes)).toMatchObject({ x: 8, y: 6, width: 46, height: 15 })

    const state = { width: 120, height: 40 }
    // Grab 2 cells in from the window origin, then drag to (20, 12).
    expect(
      effect.runCommand("drag-start", {
        state,
        pointer: { type: "press", x: 10, y: 8, window: "card" },
      }),
    ).toMatchObject({ ok: true })
    expect(
      effect.runCommand("drag-move", {
        state,
        pointer: { type: "move", x: 20, y: 12, window: "card" },
      }),
    ).toMatchObject({ ok: true })
    expect(card(compose().nodes)).toMatchObject({ x: 18, y: 10 })

    // Clamp to the viewport when dragged past the edge.
    effect.runCommand("drag-move", {
      state,
      pointer: { type: "move", x: 500, y: 500, window: "card" },
    })
    expect(card(compose().nodes)).toMatchObject({ x: 120 - 46, y: 40 - 15 })

    effect.runCommand("drag-move", {
      state,
      pointer: { type: "move", x: 20, y: 12, window: "card" },
    })
    expect(effect.runCommand("drag-end", { state, pointer: { type: "release", x: 20, y: 12 } })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ x: 18, y: 10 })
    expect(card(compose().nodes)).toMatchObject({ x: 18, y: 10 })
  } finally {
    effect.dispose()
  }
})

test("the packaged drag example loads", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/effects/examples/scene-drag", `${dir}/out`)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const loaded = await loadEffectPlugins([built.dir])
    expect(loaded.errors).toEqual([])
    const effect = await SandboxedEffect.create(
      loaded.plugins[0]!.bundle,
      loaded.plugins[0]!.manifest,
    )
    try {
      const scene = effect.compose({
        state: { width: 120, height: 40 },
        time: 0,
        dt: 0.25,
      }) as { nodes: SceneNode[] }
      expect(card(scene.nodes).x).toBe(8)
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

import { expect, test } from "bun:test"

import { loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import type { SceneNode } from "../../src/ui/effects/scene/model"

async function example() {
  const loaded = await loadEffectPlugins(["src/ui/effects/examples/scene-reorder"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
  const compose = (time = 0) =>
    effect.compose({
      state: { width: 110, height: 40 },
      time,
      dt: 0.25,
    }) as { nodes: SceneNode[] }
  return { plugin, effect, compose }
}

function panelIds(nodes: readonly SceneNode[]): Array<string | undefined> {
  const board = nodes[0]
  if (board?.kind !== "group") return []
  return board.nodes.map((node) => (node.kind === "group" ? node.id : undefined))
}

test("dragging one panel onto another swaps their slots", async () => {
  const { plugin, effect, compose } = await example()
  try {
    expect(plugin.manifest.permissions.pointer).toEqual({
      press: "reorder-start",
      move: "reorder-move",
      release: "reorder-end",
    })
    expect(panelIds(compose().nodes)).toEqual(["alpha", "beta"])

    const state = { width: 110, height: 40 }
    expect(
      effect.runCommand("reorder-start", {
        state,
        pointer: { type: "press", x: 10, y: 8, window: "alpha" },
      }),
    ).toMatchObject({ ok: true })
    // The dragged panel is highlighted while moving.
    const moving = compose().nodes[0]!
    if (moving.kind !== "group") throw new Error("expected dashboard")
    expect(moving.nodes[0]).toMatchObject({ kind: "group", id: "alpha", borderColor: "warning" })

    expect(
      effect.runCommand("reorder-move", {
        state,
        pointer: { type: "move", x: 50, y: 8, window: "beta" },
      }),
    ).toMatchObject({ ok: true })
    const hovering = compose().nodes[0]!
    if (hovering.kind !== "group") throw new Error("expected dashboard")
    expect(hovering.nodes[1]).toMatchObject({ kind: "group", id: "beta", borderColor: "success" })

    const end = effect.runCommand("reorder-end", {
      state,
      pointer: { type: "release", x: 50, y: 8, window: "beta" },
    })
    expect(end).toMatchObject({ ok: true, message: "alpha ⇄ beta" })
    expect(effect.takeStoreChanges()).toEqual({ order: "beta,alpha" })
    expect(panelIds(compose().nodes)).toEqual(["beta", "alpha"])

    // Dragging back restores the original order.
    effect.runCommand("reorder-start", {
      state,
      pointer: { type: "press", x: 50, y: 8, window: "beta" },
    })
    effect.runCommand("reorder-move", {
      state,
      pointer: { type: "move", x: 10, y: 8, window: "alpha" },
    })
    effect.runCommand("reorder-end", {
      state,
      pointer: { type: "release", x: 10, y: 8, window: "alpha" },
    })
    expect(effect.takeStoreChanges()).toEqual({ order: "alpha,beta" })
    expect(panelIds(compose().nodes)).toEqual(["alpha", "beta"])

    // Releasing over the same panel keeps the order.
    effect.runCommand("reorder-start", {
      state,
      pointer: { type: "press", x: 10, y: 8, window: "alpha" },
    })
    effect.runCommand("reorder-end", {
      state,
      pointer: { type: "release", x: 10, y: 8, window: "alpha" },
    })
    expect(panelIds(compose().nodes)).toEqual(["alpha", "beta"])
  } finally {
    effect.dispose()
  }
})

test("the packaged reorder example loads", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/effects/examples/scene-reorder", `${dir}/out`)
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
        state: { width: 110, height: 40 },
        time: 0,
        dt: 0.25,
      }) as { nodes: SceneNode[] }
      expect(panelIds(scene.nodes)).toEqual(["alpha", "beta"])
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

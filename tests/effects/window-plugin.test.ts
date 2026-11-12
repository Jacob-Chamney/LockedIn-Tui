import { expect, test } from "bun:test"

import { loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import {
  collectFocusIds,
  DEFAULT_SCENE_BUDGET,
  sanitizeScene,
  type SceneGroup,
  type SceneNode,
} from "../../src/ui/effects/scene/model"

test("the window example exposes persisted scroll commands", async () => {
  const loaded = await loadEffectPlugins(["src/ui/effects/examples/scene-window"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  expect(plugin.manifest.permissions.commands?.map((command) => command.id)).toEqual([
    "focus-scroll-down",
    "focus-scroll-up",
  ])
  expect(plugin.manifest.permissions.scene?.fps).toBe(30)
  expect(plugin.manifest.permissions.state).toContain("focused")

  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
  try {
    const state = { width: 100, height: 40, focused: true }
    expect(effect.runCommand("focus-scroll-down", { state, time: 1 })).toMatchObject({ ok: true })
    expect(effect.runCommand("focus-scroll-down", { state, time: 2 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ scroll: 2 })
    expect(effect.runCommand("focus-scroll-up", { state, time: 3 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ scroll: 1 })

    // Compose still works after the commands and uses the palette when present.
    const scene = effect.compose({
      state,
      time: 4,
      dt: 0.03,
      palette: { accent: "#ff6b6b", warning: "#d8b26a" },
    }) as { nodes: unknown[] }
    expect(scene.nodes.length).toBeGreaterThan(0)
  } finally {
    effect.dispose()
  }
})

test("the packaged window example loads with its commands", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = await Bun.$`mktemp -d`.text()
  try {
    const built = await buildPlugin("src/ui/effects/examples/scene-window", `${dir.trim()}/out`)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const loaded = await loadEffectPlugins([built.dir])
    expect(loaded.errors).toEqual([])
    expect(loaded.plugins[0]!.manifest.entry).toBe("plugin.js")
    expect(loaded.plugins[0]!.manifest.permissions.commands).toHaveLength(2)
  } finally {
    await Bun.$`rm -rf ${dir.trim()}`.quiet()
  }
})

function findGroup(nodes: readonly SceneNode[], id: string): SceneGroup | undefined {
  for (const node of nodes) {
    if (node.kind !== "group") continue
    if (node.id === id) return node
    const found = findGroup(node.nodes, id)
    if (found) return found
  }
  return undefined
}

test("the example exposes two focusable windows and styles the focused one", async () => {
  const loaded = await loadEffectPlugins(["src/ui/effects/examples/scene-window"])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
  try {
    const compose = (focusedWindow: string) => {
      const scene = effect.compose({
        state: { width: 100, height: 40, focusedWindow },
        time: 2,
        dt: 0.03,
        palette: { accent: "#ff6b6b", warning: "#d8b26a" },
      }) as { nodes: SceneNode[] }
      const result = sanitizeScene(
        scene,
        {
          ...DEFAULT_SCENE_BUDGET,
          maxNodes: plugin.manifest.permissions.scene?.maxNodes ?? 24,
          maxText: plugin.manifest.permissions.scene?.maxText ?? 512,
        },
        plugin.manifest.permissions.scene?.anchors ?? [],
        { width: 100, height: 40 },
        plugin.manifest.permissions.scene?.absolute === true,
      )
      return result.nodes
    }

    const focusedQueue = compose("queue")
    expect(collectFocusIds(focusedQueue)).toEqual(["focus", "queue"])
    expect(findGroup(focusedQueue, "queue")?.borderColor).toBe("success")
    expect(findGroup(focusedQueue, "focus")?.borderColor).toBe("line")

    const focusedMain = compose("focus")
    expect(findGroup(focusedMain, "focus")?.borderColor).not.toBe("line")
    expect(findGroup(focusedMain, "queue")?.borderColor).toBe("line")
  } finally {
    effect.dispose()
  }
})

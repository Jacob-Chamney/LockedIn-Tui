import { expect, test } from "bun:test"

import { loadPlugins } from "../../src/ui/plugins/loader"
import { SandboxedPlugin } from "../../src/ui/plugins/sandbox/plugin"
import { collectFocusIds, type SceneGroup, type SceneNode } from "../../src/ui/plugins/scene/model"

async function example() {
  const loaded = await loadPlugins(["src/ui/plugins/examples/scene-workbench"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedPlugin.create(plugin.bundle, plugin.manifest)
  const compose = (time: number, focusedWindow?: string) =>
    effect.compose({
      state: { width: 110, height: 40, focusedWindow },
      time,
      dt: 0.25,
    }) as { nodes: SceneNode[] }
  return { plugin, effect, compose }
}

function group(nodes: readonly SceneNode[], id: string): SceneGroup {
  const visit = (list: readonly SceneNode[]): SceneGroup | undefined => {
    for (const node of list) {
      if (node.kind !== "group") continue
      if (node.id === id) return node
      const found = visit(node.nodes)
      if (found) return found
    }
    return undefined
  }
  const found = visit(nodes)
  if (!found) throw new Error(`expected group ${id}`)
  return found
}

test("the workbench composes a KPI strip above a sidebar and main panel", async () => {
  const { effect, compose } = await example()
  try {
    const scene = compose(0, "menu")
    expect(scene.nodes).toHaveLength(2)

    const metrics = scene.nodes[0]!
    expect(metrics.kind).toBe("group")
    if (metrics.kind !== "group") return
    expect(metrics.nodes).toHaveLength(4)
    expect(metrics.nodes.map((card) => (card.kind === "group" ? card.title : null))).toEqual([
      "focus",
      "streak",
      "sessions",
      "queue",
    ])
    const values = metrics.nodes.map((card) =>
      card.kind === "group"
        ? card.nodes
            .filter((node) => node.kind === "group")
            .flatMap((node) => (node.kind === "group" ? node.nodes : []))
            .find((node) => node.kind === "text")
        : null,
    )
    expect(values[0]?.kind).toBe("text")
    if (values[0]?.kind === "text") expect(values[0].text).toBe("3h 20m")

    const split = scene.nodes[1]!
    expect(split.kind).toBe("group")
    if (split.kind !== "group") return
    expect(split.nodes.map((panel) => (panel.kind === "group" ? panel.id : null))).toEqual([
      "menu",
      "sessions",
    ])
    expect(split.title).toBe(" workbench ")
    expect(collectFocusIds(scene.nodes)).toEqual(["menu", "sessions"])
    expect(group(scene.nodes, "menu").borderColor).toBe("accent")
    expect(group(scene.nodes, "sessions").borderColor).toBe("line")

    const detailFocused = compose(0, "sessions")
    expect(group(detailFocused.nodes, "menu").borderColor).toBe("line")
    expect(group(detailFocused.nodes, "sessions").borderColor).toBe("success")
  } finally {
    effect.dispose()
  }
})

test("the workbench table and commands keep working inside the split", async () => {
  const { effect, compose } = await example()
  try {
    const state = { width: 110, height: 40 }
    expect(effect.runCommand("workbench-next", { state, time: 1 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1 })

    const scene = compose(9)
    const sessions = group(scene.nodes, "sessions")
    const body = sessions.nodes.find(
      (node) => node.kind === "group" && node.nodes.some((child) => child.kind === "rect"),
    )
    if (body?.kind !== "group") throw new Error("expected table body")
    const selected = body.nodes.find((node) => node.kind === "text" && node.bg === "accent")
    if (selected?.kind !== "text") throw new Error("expected selected row")
    expect(selected.text.startsWith("Type systems")).toBe(true)
  } finally {
    effect.dispose()
  }
})

test("the packaged workbench loads both presets", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/plugins/examples/scene-workbench", `${dir}/out`)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const loaded = await loadPlugins([built.dir])
    expect(loaded.errors).toEqual([])
    expect(loaded.plugins[0]!.manifest.entry).toBe("plugin.js")
    const effect = await SandboxedPlugin.create(
      loaded.plugins[0]!.bundle,
      loaded.plugins[0]!.manifest,
    )
    try {
      const scene = effect.compose({
        state: { width: 110, height: 40, focusedWindow: "menu" },
        time: 0,
        dt: 0.25,
      }) as { nodes: SceneNode[] }
      expect(scene.nodes).toHaveLength(2)
      expect(collectFocusIds(scene.nodes)).toEqual(["menu", "sessions"])
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

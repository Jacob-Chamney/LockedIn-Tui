import { expect, test } from "bun:test"

import { loadEffectPlugins } from "../../src/ui/effects/loader"
import { SandboxedEffect } from "../../src/ui/effects/sandbox/effect"
import type { SceneNode } from "../../src/ui/effects/scene/model"

const palette = {
  surface: "#15181b",
  foreground: "#e6e6e6",
  muted: "#8a8f98",
  accent: "#e06c75",
}

async function example() {
  const loaded = await loadEffectPlugins(["src/ui/effects/examples/scene-list"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedEffect.create(plugin.bundle, plugin.manifest)
  const compose = (time: number) =>
    effect.compose({
      state: { width: 100, height: 40 },
      time,
      dt: 0.03,
      palette,
    }) as { nodes: SceneNode[] }
  return { plugin, effect, compose }
}

test("the list example selects rows and fades the detail panel in and out", async () => {
  const { plugin, effect, compose } = await example()
  try {
    expect(plugin.manifest.permissions.commands?.map((command) => command.id)).toEqual([
      "list-next",
      "list-prev",
    ])
    expect(plugin.manifest.permissions.scene?.fps).toBe(30)

    // Row 0 is even: no detail panel.
    expect(compose(0).nodes.some((node) => node.kind === "group" && node.id === "detail")).toBe(false)

    // At the switch to row 1 the panel starts invisible, then enters.
    expect(compose(1.6).nodes.some((node) => node.kind === "group" && node.id === "detail")).toBe(false)
    const entering = compose(1.9).nodes.find((node) => node.kind === "group" && node.id === "detail")
    expect(entering?.kind).toBe("group")
    if (entering?.kind !== "group") return
    // Role names are resolved through the palette while fading.
    expect(entering.borderColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(entering.borderColor).not.toBe(palette.accent)
    expect(entering.borderColor).not.toBe(palette.surface)

    // Fully entered after 0.5 s.
    const entered = compose(2.2).nodes.find((node) => node.kind === "group" && node.id === "detail")
    expect(entered?.kind).toBe("group")
    if (entered?.kind !== "group") return
    // Fully opaque: the role passes through untouched.
    expect(entered.borderColor).toBe("accent")

    // Row 2 is even again: the panel leaves and disappears.
    expect(compose(3.2).nodes.some((node) => node.kind === "group" && node.id === "detail")).toBe(true)
    expect(compose(3.55).nodes.some((node) => node.kind === "group" && node.id === "detail")).toBe(false)
  } finally {
    effect.dispose()
  }
})

test("the list body highlights the selected row and the footer lists actions", async () => {
  const { effect, compose } = await example()
  try {
    const scene = compose(2.2)
    const listWindow = scene.nodes.find((node) => node.kind === "group" && node.id === "list")
    expect(listWindow?.kind).toBe("group")
    if (listWindow?.kind !== "group") return
    const body = listWindow.nodes.find(
      (node) => node.kind === "group" && node.nodes.some((child) => child.kind === "text" && child.text.startsWith("▸")),
    )
    expect(body?.kind).toBe("group")
    if (body?.kind !== "group") return
    const rows = body.nodes.filter((node) => node.kind === "text")
    expect(rows).toHaveLength(5)
    expect(rows.filter((node) => node.kind === "text" && node.text.startsWith("▸"))).toHaveLength(1)
    expect(body.nodes.some((node) => node.kind === "rect")).toBe(true)

    const footer = listWindow.nodes.at(-1)
    expect(footer?.kind).toBe("group")
    if (footer?.kind !== "group") return
    const hint = footer.nodes[0]
    expect(hint?.kind).toBe("text")
    if (hint?.kind !== "text") return
    expect(hint.text).toBe("ctrl+n/p select  ·  f6 focus")
  } finally {
    effect.dispose()
  }
})

test("the list commands persist the manual selection", async () => {
  const { effect, compose } = await example()
  try {
    const state = { width: 100, height: 40 }
    expect(effect.runCommand("list-next", { state, time: 1 })).toMatchObject({ ok: true })
    expect(effect.runCommand("list-next", { state, time: 2 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ selected: 2 })
    expect(effect.runCommand("list-prev", { state, time: 3 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1 })

    // A manual selection stops the automatic advance.
    const scene = compose(9)
    const listWindow = scene.nodes.find((node) => node.kind === "group" && node.id === "list")
    if (listWindow?.kind !== "group") throw new Error("expected list window")
    const texts = listWindow.nodes
      .filter((node) => node.kind === "group")
      .flatMap((node) => (node.kind === "group" ? node.nodes : []))
      .filter((node) => node.kind === "text")
    expect(texts.some((node) => node.kind === "text" && node.text.startsWith("▸ Review: type systems"))).toBe(true)
  } finally {
    effect.dispose()
  }
})

test("the packaged list example loads and composes a fading panel", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/effects/examples/scene-list", `${dir}/out`)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const loaded = await loadEffectPlugins([built.dir])
    expect(loaded.errors).toEqual([])
    expect(loaded.plugins[0]!.manifest.entry).toBe("plugin.js")
    const effect = await SandboxedEffect.create(
      loaded.plugins[0]!.bundle,
      loaded.plugins[0]!.manifest,
    )
    try {
      const compose = (time: number) =>
        effect.compose({
          state: { width: 100, height: 40 },
          time,
          dt: 0.03,
          palette,
        }) as { nodes: SceneNode[] }
      // Prime the selection timeline at the row change, then let the panel enter.
      compose(1.6)
      const scene = compose(2.2)
      expect(scene.nodes.map((node) => (node.kind === "group" ? node.id : undefined))).toEqual([
        "list",
        "detail",
      ])
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

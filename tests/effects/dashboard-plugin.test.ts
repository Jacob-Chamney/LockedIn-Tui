import { expect, test } from "bun:test"

import { loadPlugins } from "../../src/ui/plugins/loader"
import { SandboxedPlugin } from "../../src/ui/plugins/sandbox/plugin"
import { collectFocusIds, type SceneGroup, type SceneNode } from "../../src/ui/plugins/scene/model"

async function example() {
  const loaded = await loadPlugins(["src/ui/plugins/examples/scene-dashboard"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedPlugin.create(plugin.bundle, plugin.manifest)
  const compose = (time: number, focusedWindow?: string) =>
    effect.compose({
      state: { width: 110, height: 40, focusedWindow },
      time,
      dt: 0.1,
    }) as { nodes: SceneNode[] }
  return { plugin, effect, compose }
}

function board(nodes: readonly SceneNode[]): SceneGroup {
  const found = nodes.find((node) => node.kind === "group" && node.id === undefined)
  if (found?.kind !== "group") throw new Error("expected dashboard")
  return found
}

function panel(group: SceneGroup, id: string): SceneGroup {
  const found = group.nodes.find((node) => node.kind === "group" && node.id === id)
  if (found?.kind !== "group") throw new Error(`expected panel ${id}`)
  return found
}

test("the dashboard composes two focusable panels with independent focus", async () => {
  const { effect, compose } = await example()
  try {
    const sessionsFocused = board(compose(0, "sessions").nodes)
    expect(sessionsFocused.nodes).toHaveLength(2)
    expect(collectFocusIds([sessionsFocused])).toEqual(["sessions", "detail"])
    expect(panel(sessionsFocused, "sessions").borderColor).toBe("accent")
    expect(panel(sessionsFocused, "detail").borderColor).toBe("line")

    const detailFocused = board(compose(0, "detail").nodes)
    expect(panel(detailFocused, "sessions").borderColor).toBe("line")
    expect(panel(detailFocused, "detail").borderColor).toBe("success")

    // The left panel holds the table and its selected row.
    const body = panel(sessionsFocused, "sessions").nodes.find(
      (node) => node.kind === "group" && node.nodes.some((child) => child.kind === "rect"),
    )
    expect(body?.kind).toBe("group")
    if (body?.kind !== "group") return
    const selected = body.nodes.find((node) => node.kind === "text" && node.bg === "warning")
    if (selected?.kind !== "text") throw new Error("expected selected cell")
    expect(selected.text.startsWith("Deep work")).toBe(true)
  } finally {
    effect.dispose()
  }
})

test("dashboard commands move the row and toggle the secondary pin action", async () => {
  const { effect, compose } = await example()
  try {
    const state = { width: 110, height: 40, focusedWindow: "detail" }
    expect(effect.runCommand("dashboard-next", { state, time: 1 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1 })

    const open = effect.runCommand("dashboard-open", { state, time: 2 })
    expect(open).toMatchObject({ ok: true, message: "Type systems · queued" })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1 })

    const pin = effect.runCommand("dashboard-pin", { state, time: 3 })
    expect(pin).toMatchObject({ ok: true, message: "pinned Type systems" })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1, pinned: "Type systems" })

    // The detail panel reflects the pin and the manual row stops the timer.
    const detail = panel(board(compose(9, "detail").nodes), "detail")
    const texts = detail.nodes.flatMap((node) =>
      node.kind === "group" ? (node.nodes as SceneNode[]) : [node],
    )
    const pinLine = texts.find(
      (node) => node.kind === "text" && node.text.startsWith("pinned ·"),
    )
    if (pinLine?.kind !== "text") throw new Error("expected pin line")
    expect(pinLine.text).toBe("pinned · Type systems")
    const title = texts.find((node) => node.kind === "text" && node.text === "Type systems")
    expect(title?.kind).toBe("text")

    const copy = effect.runCommand("dashboard-copy", { state, time: 4 })
    expect(copy).toMatchObject({
      ok: true,
      message: "copied Type systems",
      copy: "Type systems · 12 cards · queued",
    })

    const unpin = effect.runCommand("dashboard-pin", { state, time: 10 })
    expect(unpin).toMatchObject({ ok: true, message: "unpinned" })
    expect(effect.takeStoreChanges()).toEqual({ selected: 1, pinned: null })

    // Pointer targets arrive from the host as row/column coordinates.
    const click = effect.runCommand("dashboard-click", {
      state,
      time: 4,
      pointer: { type: "click", x: 22, y: 11, window: "sessions", row: 2, column: 1 },
    })
    expect(click).toMatchObject({ ok: true, message: "cell 2:1 · 14:30" })
    expect(effect.takeStoreChanges()).toEqual({ selected: 2, column: 1, pinned: null })
    expect(
      effect.runCommand("dashboard-hover", {
        state,
        time: 5,
        pointer: { type: "hover", x: 22, y: 11, window: "sessions", row: 2, column: 1 },
      }),
    ).toMatchObject({ ok: true })
  } finally {
    effect.dispose()
  }
})

test("the packaged dashboard loads with both panels", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/plugins/examples/scene-dashboard", `${dir}/out`)
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
        state: { width: 110, height: 40, focusedWindow: "sessions" },
        time: 0,
        dt: 0.1,
      }) as { nodes: SceneNode[] }
      const grid = board(scene.nodes)
      expect(grid.nodes).toHaveLength(2)
      expect(collectFocusIds([grid])).toEqual(["sessions", "detail"])
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

test("the wheel scrolls the table and clamps at the ends", async () => {
  const { effect, compose } = await example()
  try {
    const state = { width: 110, height: 40, focusedWindow: "sessions" }
    const wheel = (direction: "up" | "down") =>
      effect.runCommand("dashboard-wheel", {
        state,
        time: 1,
        pointer: {
          type: "wheel",
          x: 22,
          y: 11,
          window: "sessions",
          row: 1,
          column: 1,
          scroll: { direction, delta: 1 },
        },
      })
    expect(wheel("down")).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ scroll: 1 })
    expect(wheel("down")).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ scroll: 2 })
    expect(wheel("up")).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ scroll: 1 })

    // The first visible body row is now row 1.
    const sessions = panel(board(compose(0).nodes), "sessions")
    const body = sessions.nodes.find(
      (node) =>
        node.kind === "group" &&
        node.nodes.some((child) => child.kind === "hit" || child.kind === "rect"),
    )
    if (body?.kind !== "group") throw new Error("expected table body")
    const firstRow = body.nodes.find((node) => node.kind === "text" && node.y === 2)
    if (firstRow?.kind !== "text") throw new Error("expected first row")
    expect(firstRow.text.startsWith("Type systems")).toBe(true)

    // Three down steps reach the last page; further steps stay there.
    for (let index = 0; index < 4; index++) wheel("down")
    expect(effect.takeStoreChanges()).toEqual({ scroll: 3 })
    wheel("down")
    expect(effect.takeStoreChanges()).toEqual({ scroll: 3 })
    wheel("up")
    wheel("up")
    wheel("up")
    wheel("up")
    expect(effect.takeStoreChanges()).toEqual({ scroll: 0 })
  } finally {
    effect.dispose()
  }
})

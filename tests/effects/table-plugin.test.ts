import { expect, test } from "bun:test"

import { loadPlugins } from "../../src/ui/plugins/loader"
import { SandboxedPlugin } from "../../src/ui/plugins/sandbox/plugin"
import type { SceneGroup, SceneNode } from "../../src/ui/plugins/scene/model"

async function example() {
  const loaded = await loadPlugins(["src/ui/plugins/examples/scene-table"])
  expect(loaded.errors).toEqual([])
  const plugin = loaded.plugins[0]!
  const effect = await SandboxedPlugin.create(plugin.bundle, plugin.manifest)
  const compose = (time: number) =>
    effect.compose({ state: { width: 100, height: 40 }, time, dt: 0.1 }) as {
      nodes: SceneNode[]
    }
  return { plugin, effect, compose }
}

function tableWindow(nodes: readonly SceneNode[]): SceneGroup {
  const found = nodes.find((node) => node.kind === "group" && node.id === "table")
  if (found?.kind !== "group") throw new Error("expected table window")
  return found
}

function bodyGroup(windowNode: SceneGroup): SceneGroup {
  const body = windowNode.nodes.find(
    (node) => node.kind === "group" && node.nodes.some((child) => child.kind === "rect"),
  )
  if (body?.kind !== "group") throw new Error("expected table body")
  return body
}

function cursorText(body: SceneGroup): string {
  const row = body.nodes.find((node) => node.kind === "text" && node.bg === "warning")
  if (row?.kind !== "text") throw new Error("expected cursor cell")
  return row.text
}

test("the table example renders headers, aligned columns and a selected cell", async () => {
  const { plugin, effect, compose } = await example()
  try {
    expect(plugin.manifest.permissions.commands?.map((command) => command.id)).toEqual([
      "table-next",
      "table-prev",
      "table-col-next",
      "table-col-prev",
      "table-open",
      "table-select-start",
      "table-select-move",
      "table-select-end",
    ])
    const windowNode = tableWindow(compose(0).nodes)
    const body = bodyGroup(windowNode)
    const texts = body.nodes.filter((node) => node.kind === "text")
    const header = texts[0]!
    if (header.kind !== "text") throw new Error("expected text")
    expect(header.text).toBe("session                   time   state")
    expect(body.nodes.some((node) => node.kind === "rule")).toBe(true)
    // Row bar, then the cursor cell and its own bar.
    expect(body.nodes.filter((node) => node.kind === "rect").map((node) => node.color)).toEqual([
      "accent",
      "warning",
    ])
    const selected = texts[1]!
    if (selected.kind !== "text") throw new Error("expected text")
    expect(selected.text.startsWith("Deep work")).toBe(true)
    expect(selected.bg).toBe("warning")
    expect(selected.fg).toBe("background")
  } finally {
    effect.dispose()
  }
})

test("the table selection advances and commands persist the row and column", async () => {
  const { effect, compose } = await example()
  try {
    const atStart = bodyGroup(tableWindow(compose(0).nodes))
    const atNext = bodyGroup(tableWindow(compose(1.9).nodes))
    expect(cursorText(atStart).startsWith("Deep work")).toBe(true)
    expect(cursorText(atNext).startsWith("Review: type systems")).toBe(true)

    const state = { width: 100, height: 40 }
    expect(effect.runCommand("table-next", { state, time: 2 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ row: 1, column: 0 })

    // Move the cell cursor right; the row is kept.
    const move = effect.runCommand("table-col-next", { state, time: 3 })
    expect(move).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ row: 1, column: 1 })

    // The selected cell drives the open command.
    const open = effect.runCommand("table-open", { state, time: 4 })
    expect(open).toMatchObject({ ok: true, message: "time: 12 cards" })
    expect(effect.takeStoreChanges()).toEqual({ row: 1, column: 1 })

    // A manual row stops the automatic advance: at t=9 the timer would be on
    // row 0, but row 1 stays selected with its time cell highlighted.
    const later = bodyGroup(tableWindow(compose(9).nodes))
    expect(cursorText(later)).toBe("12 car…")
    const after = later.nodes.find(
      (node) => node.kind === "text" && node.x > 20 && node.text.includes("queued"),
    )
    expect(after?.kind).toBe("text")

    expect(effect.runCommand("table-prev", { state, time: 10 })).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ row: 0, column: 1 })
  } finally {
    effect.dispose()
  }
})

test("the packaged table example loads and composes the table", async () => {
  const { buildPlugin } = await import("../../scripts/plugin-build")
  const dir = (await Bun.$`mktemp -d`.text()).trim()
  try {
    const built = await buildPlugin("src/ui/plugins/examples/scene-table", `${dir}/out`)
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
        state: { width: 100, height: 40 },
        time: 0,
        dt: 0.1,
      }) as { nodes: SceneNode[] }
      const body = bodyGroup(tableWindow(scene.nodes))
      const header = body.nodes.find((node) => node.kind === "text")
      expect(header?.kind).toBe("text")
      if (header?.kind !== "text") return
      expect(header.text).toContain("session")
      expect(header.text).toContain("state")
      expect(body.nodes.some((node) => node.kind === "rect" && node.color === "warning")).toBe(true)
    } finally {
      effect.dispose()
    }
  } finally {
    await Bun.$`rm -rf ${dir}`.quiet()
  }
})

test("press/move/release paint a drag-selection range", async () => {
  const { effect, compose } = await example()
  try {
    const state = { width: 110, height: 40 }
    expect(
      effect.runCommand("table-select-start", {
        state,
        pointer: { type: "press", x: 10, y: 10, window: "table", row: 1, column: 0 },
      }),
    ).toMatchObject({ ok: true })
    expect(effect.takeStoreChanges()).toEqual({ row: 1, column: 0 })
    expect(
      effect.runCommand("table-select-move", {
        state,
        pointer: { type: "move", x: 30, y: 12, window: "table", row: 3, column: 2 },
      }),
    ).toMatchObject({ ok: true })
    const end = effect.runCommand("table-select-end", {
      state,
      pointer: { type: "release", x: 30, y: 12, window: "table", row: 3, column: 2 },
    })
    expect(end).toMatchObject({ ok: true, message: "range 1:0 → 3:2" })
    expect(effect.takeStoreChanges()).toEqual({
      row: 3,
      column: 2,
      anchorRow: 1,
      anchorColumn: 0,
      headRow: 3,
      headColumn: 2,
    })

    const body = bodyGroup(tableWindow(compose(0).nodes))
    const selectedCells = body.nodes.filter(
      (node) => node.kind === "text" && node.bg === "secondary",
    )
    expect(selectedCells.length).toBeGreaterThan(0)
    const cursor = body.nodes.find((node) => node.kind === "text" && node.bg === "warning")
    expect(cursor?.kind).toBe("text")
    if (cursor?.kind !== "text") return
    // The moving head is row 3, column 2 ("later").
    expect(cursor.text.trim()).toBe("later")
  } finally {
    effect.dispose()
  }
})

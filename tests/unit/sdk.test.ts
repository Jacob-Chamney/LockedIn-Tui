import { expect, test } from "bun:test"

import {
  defineManifest,
  defineParticleSystem,
  definePlugin,
  card,
  dashboard,
  ease,
  fadeColor,
  fadeIn,
  fadeNode,
  fadeNodes,
  fadeOut,
  footerActions,
  kpiStrip,
  list,
  loop,
  mixHex,
  notice,
  pingPong,
  sidebarMain,
  table,
  window,
} from "../../sdk"

test("the define helpers are identity", () => {
  const plugin = { id: "test.demo", compose: () => ({ nodes: [] }) }
  expect(definePlugin(plugin)).toBe(plugin)
  expect(defineParticleSystem(plugin)).toBe(plugin)
  const manifest = {
    manifestVersion: 1 as const,
    id: "test.demo",
    name: "Demo",
    version: "1.0.0",
    apiVersion: "1.0" as const,
    entry: "effect.ts",
    permissions: {},
  }
  expect(defineManifest(manifest)).toBe(manifest)
})

test("easing and time helpers stay in range", () => {
  expect(ease.linear(0.25)).toBe(0.25)
  for (const value of [0, 0.25, 0.5, 0.75, 1]) {
    for (const curve of [ease.inCubic, ease.outCubic, ease.inOutCubic]) {
      expect(curve(value)).toBeGreaterThanOrEqual(0)
      expect(curve(value)).toBeLessThanOrEqual(1.0001)
    }
  }
  expect(ease.pulse(0, 2)).toBeCloseTo(0.5)
  expect(loop(1, 4)).toBeCloseTo(0.25)
  expect(pingPong(0, 4)).toBe(0)
  expect(pingPong(2, 4)).toBe(1)
  expect(pingPong(3, 4)).toBeCloseTo(0.5)
})

test("the window preset builds slots, scrolls the body and honours focus", () => {
  const preset = window({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 20,
    height: 12,
    padding: 1,
    gap: 1,
    header: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "head" }],
    body: [{ kind: "text", anchor: "top-left", x: 0, y: 3, text: "row" }],
    footer: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "foot" }],
    footerRule: true,
    scroll: 2,
    focused: true,
  })
  expect(preset.kind).toBe("group")
  expect(preset.border).toBe(true)
  expect(preset.borderColor).toBe("accent")
  expect(preset.nodes).toHaveLength(4)

  const header = preset.nodes[0]!
  const body = preset.nodes[1]!
  const rule = preset.nodes[2]!
  const footer = preset.nodes[3]!
  if (header.kind !== "group" || body.kind !== "group" || footer.kind !== "group") {
    throw new Error("expected slot groups")
  }
  // Content 16x8; header 1, footer 2 (text + rule), two gaps -> body 3.
  expect(header.height).toBe(1)
  expect(body.height).toBe(3)
  expect(body.scroll).toBe(2)
  expect((body.nodes[0] as { y: number }).y).toBe(3) // the host applies the scroll
  expect(rule.kind).toBe("rule")
  expect(rule.y).toBe(6)
  expect(footer.y).toBe(7)

  const unfocused = window({ anchor: "absolute", x: 0, y: 0, width: 20, height: 8 })
  expect(unfocused.borderColor).toBe("line")
})

test("mixHex blends theme colours", () => {
  expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000")
  expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff")
  expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080")
  expect(mixHex("#ff0000", "#00ff00", 0.5)).toBe("#808000")
  expect(mixHex("not-a-color", "#ffffff", 0.5)).toBe("not-a-color")
})

test("fadeColor and fadeIn/fadeOut interpolate opacity", () => {
  expect(fadeColor("#ffffff", 1, "#000000")).toBe("#ffffff")
  expect(fadeColor("#ffffff", 0, "#000000")).toBe("#000000")
  expect(fadeColor("#ffffff", 0.5, "#000000")).toBe("#808080")
  expect(fadeIn(0, 0.4)).toBe(0)
  expect(fadeIn(0.4, 0.4)).toBeCloseTo(1)
  expect(fadeIn(0.8, 0.4)).toBe(1)
  expect(fadeIn(0.1, 0)).toBe(1)
  expect(fadeOut(0, 0.4)).toBe(1)
  expect(fadeOut(0.4, 0.4)).toBeCloseTo(0)
})

test("fadeNode blends the node tree toward the background", () => {
  const node = window({
    id: "detail",
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 20,
    height: 8,
    title: "detail",
    borderColor: "#ffffff",
    bg: "#ffffff",
    body: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "hi", fg: "#ffffff" }],
  })
  const faded = fadeNode(node, 0, "#000000")
  expect(faded.kind).toBe("group")
  if (faded.kind !== "group") return
  expect(faded.borderColor).toBe("#000000")
  expect(faded.bg).toBe("#000000")
  const body = faded.nodes.find((child) => child.kind === "group")
  expect(body?.kind).toBe("group")
  if (body?.kind !== "group") return
  const text = body.nodes[0]!
  expect(text.kind).toBe("text")
  if (text.kind !== "text") return
  expect(text.fg).toBe("#000000")

  const nodes = fadeNodes([node], 1, "#000000")
  expect(nodes[0]).toBe(node)
})

test("list highlights the selected row and scrolls it into view", () => {
  const rows = [
    { label: "alpha" },
    { label: "beta", detail: "running" },
    { label: "gamma" },
    { label: "delta" },
    { label: "epsilon" },
  ]
  const nodes = list({ rows, selected: 3, width: 20, height: 3 })
  // One bar for the selected row plus one text per visible row.
  expect(nodes).toHaveLength(4)
  expect(nodes[2]!.kind).toBe("rect")
  const texts = nodes.filter((node) => node.kind === "text")
  if (texts[0]?.kind !== "text") throw new Error("expected text")
  // Selected at index 3 with height 3 -> first visible row is 1.
  expect(texts[0]!.text).toBe("  beta  ·  running")
  const selected = texts[2]!
  if (selected.kind !== "text") throw new Error("expected text")
  expect(selected.text).toBe("▸ delta")
  expect(selected.fg).toBe("foreground")
  expect(selected.bg).toBe("line")
  const plain = texts[1]
  if (plain.kind !== "text") throw new Error("expected text")
  expect(plain.bg).toBeUndefined()

  const explicit = list({ rows, selected: 0, width: 20, height: 2, scroll: 3 })
  const first = explicit.find((node) => node.kind === "text")
  if (first?.kind !== "text") throw new Error("expected text")
  expect(first.text).toBe("  delta")

  expect(list({ rows: [], selected: 0, width: 10 })).toEqual([])
})

test("footerActions renders a hint line", () => {
  const hint = footerActions([
    { key: "j/k", label: "move" },
    { key: "enter", label: "open" },
    { key: "esc", label: "close" },
  ])
  expect(hint.kind).toBe("text")
  expect(hint.text).toBe("j/k move  ·  enter open  ·  esc close")
  expect(hint.fg).toBe("muted")
})

test("fadeColor and fadeNode resolve palette roles", () => {
  const palette = {
    accent: "#ff0000",
    surface: "#000000",
    foreground: "#ffffff",
    muted: "#808080",
  }
  expect(fadeColor("accent", 0, "surface", palette)).toBe("#000000")
  expect(fadeColor("accent", 1, "surface", palette)).toBe("#ff0000")
  expect(fadeColor("accent", 0.5, "surface", palette)).toBe("#800000")
  // Without a palette a role cannot be interpolated and passes through.
  expect(fadeColor("accent", 0.5, "surface")).toBe("accent")
  expect(fadeColor("unknown", 0.5, "surface", palette)).toBe("unknown")
  // The background may be a role too.
  expect(fadeColor("#ffffff", 0.5, "surface", palette)).toBe("#808080")

  const node = window({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 20,
    height: 8,
    borderColor: "accent",
    bg: "surface",
    body: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "hi", fg: "foreground" }],
  })
  const faded = fadeNode(node, 0.5, "surface", palette)
  if (faded.kind !== "group") throw new Error("expected group")
  expect(faded.borderColor).toBe("#800000")
  expect(faded.bg).toBe("#000000")
  const body = faded.nodes.find((child) => child.kind === "group")
  if (body?.kind !== "group") throw new Error("expected body group")
  const text = body.nodes[0]!
  if (text.kind !== "text") throw new Error("expected text")
  expect(text.fg).toBe("#808080")
})

test("table aligns, pads and truncates cells", () => {
  const nodes = table({
    columns: [
      { label: "name", width: 6 },
      { label: "time", width: 5, align: "right" },
      { label: "state", width: 5, align: "center" },
    ],
    rows: [
      { cells: ["alpha", "1:20", "on"] },
      { cells: ["longer name", "12:345", "idle"] },
      { cells: ["gamma", "0:05", "done"] },
    ],
    selected: 1,
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ kind: "text", y: 0, text: "name    time state" })
  expect(nodes[1]).toMatchObject({ kind: "rule", y: 1, width: 18 })
  expect(nodes[2]).toMatchObject({ kind: "text", y: 2, text: "alpha   1:20  on" })
  expect(nodes[3]).toMatchObject({ kind: "rect", y: 3, width: 18 })
  expect(nodes[4]).toMatchObject({
    kind: "text",
    y: 3,
    text: "longe… 12:3… idle",
    bg: "line",
  })
  expect(nodes[5]).toMatchObject({ kind: "text", y: 4, text: "gamma   0:05 done" })
})

test("table headers, scrolling and read-only mode are optional", () => {
  const onlyRows = table({
    columns: [{ label: "name", width: 8 }],
    rows: [{ cells: ["a"] }, { cells: ["b"] }, { cells: ["c"] }],
    header: false,
    height: 2,
    selected: 2,
  })
  // No header: rows start at y 0 and the selection scrolls into view.
  expect(onlyRows.map((node) => node.kind)).toEqual(["text", "rect", "text"])
  expect(onlyRows[0]).toMatchObject({ kind: "text", y: 0, text: "b" })
  expect(onlyRows[1]).toMatchObject({ kind: "rect", y: 1 })

  const readOnly = table({
    columns: [{ label: "name", width: 8 }],
    rows: [{ cells: ["a"] }],
    header: false,
  })
  expect(readOnly.some((node) => node.kind === "rect")).toBe(false)

  expect(table({ columns: [], rows: [{ cells: ["a"] }] })).toEqual([])
})

test("table highlights a single cell of the selected row", () => {
  const nodes = table({
    columns: [
      { label: "name", width: 6 },
      { label: "time", width: 5, align: "right" },
      { label: "state", width: 5, align: "center" },
    ],
    rows: [{ cells: ["alpha", "1:20", "on"] }],
    selected: 0,
    column: 1,
    selectedBg: "accent",
    selectedFg: "surface",
    cursorBg: "warning",
    cursorFg: "background",
  })
  const kinds = nodes.map((node) => node.kind)
  // header text, rule, selection bar, before text, cursor rect, cursor text,
  // after text.
  expect(kinds).toEqual(["text", "rule", "rect", "text", "rect", "text", "text"])
  expect(nodes[1]).toMatchObject({ kind: "rule", y: 1, width: 18 })
  expect(nodes[2]).toMatchObject({ kind: "rect", y: 2, width: 18, color: "accent" })
  expect(nodes[3]).toMatchObject({ kind: "text", x: 0, y: 2, text: "alpha ", bg: "accent" })
  expect(nodes[4]).toMatchObject({ kind: "rect", x: 7, y: 2, width: 5, color: "warning" })
  expect(nodes[5]).toMatchObject({
    kind: "text",
    x: 7,
    y: 2,
    text: " 1:20",
    fg: "background",
    bg: "warning",
  })
  // The remaining column starts after the cursor cell and its gap.
  expect(nodes[6]).toMatchObject({ kind: "text", x: 13, y: 2, text: " on  " })

  // Without a column the row stays one node.
  const plain = table({
    columns: [{ label: "name", width: 6 }],
    rows: [{ cells: ["alpha"] }],
    selected: 0,
  })
  expect(plain.map((node) => node.kind)).toEqual(["text", "rule", "rect", "text"])
})

test("dashboard lays panels out in a shared grid and keeps focus ids", () => {
  const board = dashboard({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    columns: 2,
    gap: 2,
    padding: 1,
    panels: [
      { window: { id: "left", focusable: true, title: " left ", header: [] } },
      { window: { id: "right", focusable: true, title: " right ", header: [] } },
    ],
  })
  expect(board.kind).toBe("group")
  expect(board.nodes).toHaveLength(2)
  // 40 - 2 padding = 38; 38 - 2 gap = 36, so two 18-cell columns.
  expect(board.nodes[0]).toMatchObject({
    kind: "group",
    id: "left",
    focusable: true,
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 18,
    height: 18,
  })
  expect(board.nodes[1]).toMatchObject({
    kind: "group",
    id: "right",
    x: 20,
    y: 0,
    width: 18,
    height: 18,
  })

  // A third panel wraps to a second row automatically.
  const three = dashboard({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 40,
    height: 20,
    columns: 2,
    gap: 2,
    padding: 1,
    panels: [
      { window: { id: "a" } },
      { window: { id: "b" } },
      { window: { id: "c" } },
    ],
  })
  expect(three.nodes).toHaveLength(3)
  expect(three.nodes[2]).toMatchObject({ id: "c", x: 0, y: 10, width: 18, height: 8 })

  // Relative weights and custom rows.
  const weighted = dashboard({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 30,
    height: 10,
    columns: [1, 2],
    rows: 1,
    gap: 0,
    padding: 0,
    panels: [{ window: { id: "narrow" } }, { window: { id: "wide" } }],
  })
  expect(weighted.nodes[0]).toMatchObject({ x: 0, width: 10 })
  expect(weighted.nodes[1]).toMatchObject({ x: 10, width: 20 })
})

test("table cell hits carry row and column coordinates", () => {
  const nodes = table({
    columns: [
      { label: "name", width: 6 },
      { label: "time", width: 5, align: "right" },
    ],
    rows: [{ cells: ["alpha", "1:20"] }, { cells: ["beta", "2:30"] }],
    selected: 0,
    hit: true,
  })
  const hits = nodes.filter((node) => node.kind === "hit")
  expect(hits).toHaveLength(4)
  expect(hits[0]).toMatchObject({ x: 0, y: 2, width: 6, row: 0, column: 0 })
  expect(hits[1]).toMatchObject({ x: 7, y: 2, width: 5, row: 0, column: 1 })
  expect(hits[2]).toMatchObject({ x: 0, y: 3, width: 6, row: 1, column: 0 })
  expect(hits[3]).toMatchObject({ x: 7, y: 3, width: 5, row: 1, column: 1 })
})

test("sidebarMain keeps a fixed sidebar and hands the rest to the main panel", () => {
  const split = sidebarMain({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    padding: 1,
    gap: 2,
    sidebarWidth: 20,
    sidebar: { id: "nav", focusable: true, title: " nav " },
    main: { id: "main", focusable: true, title: " main " },
  })
  expect(split.kind).toBe("group")
  expect(split.nodes).toHaveLength(2)
  // 80 - 2 padding = 78 content; sidebar 20, gap 2, main 56.
  expect(split.nodes[0]).toMatchObject({
    kind: "group",
    id: "nav",
    focusable: true,
    x: 0,
    y: 0,
    width: 20,
    height: 18,
  })
  expect(split.nodes[1]).toMatchObject({
    kind: "group",
    id: "main",
    focusable: true,
    x: 22,
    y: 0,
    width: 56,
    height: 18,
  })

  const automatic = sidebarMain({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    padding: 1,
    gap: 2,
    sidebar: { id: "nav" },
    main: { id: "main" },
  })
  expect(automatic.nodes[0]).toMatchObject({ width: 23 })
  expect(automatic.nodes[1]).toMatchObject({ x: 25, width: 53 })
})

test("kpiStrip lays metric cards out in a row and only ids are focusable", () => {
  const strip = kpiStrip({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 60,
    gap: 1,
    metrics: [
      { label: "focus", value: "3h 20m", detail: "today", color: "success" },
      { label: "streak", value: "12", detail: "days", id: "streak", focusable: true },
      { label: "sessions", value: "4", detail: "done" },
    ],
  })
  expect(strip.kind).toBe("group")
  expect(strip.nodes).toHaveLength(3)
  // 60 wide, two one-cell gaps: 19, 19, 20 after even distribution.
  expect(strip.nodes[0]).toMatchObject({ x: 0, width: 19, height: 6 })
  expect(strip.nodes[1]).toMatchObject({ x: 20, width: 19, id: "streak", focusable: true })
  expect(strip.nodes[2]).toMatchObject({ x: 40, width: 20 })
  expect(strip.nodes[0]?.kind).toBe("group")
  if (strip.nodes[0]?.kind !== "group") return
  expect(strip.nodes[0].title).toBe("focus")
  expect(strip.nodes[0].id).toBeUndefined()
  expect(strip.nodes[0].focusable).toBeUndefined()
  const body = strip.nodes[0].nodes.find((node) => node.kind === "group")
  if (body?.kind !== "group") throw new Error("expected card body")
  expect(body.nodes[0]).toMatchObject({ kind: "text", text: "3h 20m", fg: "success" })
  expect(body.nodes[1]).toMatchObject({ kind: "text", text: "today", fg: "muted" })
})

test("table paints a drag-selection range and the cursor cell on top", () => {
  const nodes = table({
    columns: [
      { label: "name", width: 5 },
      { label: "state", width: 6 },
    ],
    rows: [{ cells: ["a", "on"] }, { cells: ["b", "off"] }],
    selection: { anchor: { row: 0, column: 1 }, head: { row: 1, column: 1 } },
    selectionBg: "primary",
    selectionFg: "background",
    hit: true,
  })
  const texts = nodes.filter((node) => node.kind === "text")
  // header, a, on, b, off
  expect(texts).toHaveLength(5)
  expect(texts[1]).toMatchObject({ text: "a    " })
  expect((texts[1] as { bg?: string }).bg).toBeUndefined()
  expect(texts[2]).toMatchObject({ text: "on    ", bg: "primary", fg: "background" })
  expect(texts[3]).toMatchObject({ text: "b    " })
  expect((texts[3] as { bg?: string }).bg).toBeUndefined()
  expect(texts[4]).toMatchObject({ text: "off   ", bg: "primary", fg: "background" })
  // Hits cover every cell, including the range.
  expect(nodes.filter((node) => node.kind === "hit")).toHaveLength(4)

  const cursor = table({
    columns: [
      { label: "name", width: 5 },
      { label: "state", width: 6 },
    ],
    rows: [{ cells: ["a", "on"] }],
    selected: 0,
    column: 1,
    selection: { anchor: { row: 0, column: 0 }, head: { row: 0, column: 1 } },
    selectionBg: "primary",
    cursorBg: "warning",
    cursorFg: "background",
  })
  const cursorTexts = cursor.filter((node) => node.kind === "text")
  expect(cursorTexts[1]).toMatchObject({ text: "a    ", bg: "primary" })
  expect(cursorTexts[2]).toMatchObject({ text: "on    ", bg: "warning" })
})

test("the notice helper returns a command result", () => {
  expect(notice("saved")).toEqual({ message: "saved", level: "info" })
  expect(notice("careful", "warn")).toEqual({ message: "careful", level: "warn" })
})

test("card computes its height and maps the tone to the frame", () => {
  const saved = card({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 30,
    title: "saved",
    tone: "success",
    lines: ["3 notes updated", "in this session"],
    footer: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "done" }],
  })
  expect(saved.kind).toBe("group")
  expect(saved).toMatchObject({
    width: 30,
    height: 8,
    borderColor: "success",
    padding: 1,
    title: "saved",
  })
  const body = saved.nodes.find((node) => node.kind === "group")
  if (body?.kind !== "group") throw new Error("expected body")
  expect(body.height).toBe(2)
  expect(body.nodes[0]).toMatchObject({ kind: "text", y: 0, text: "3 notes updated" })
  expect(body.nodes[1]).toMatchObject({ kind: "text", y: 1, text: "in this session" })
  expect(saved.nodes.at(-1)?.kind).toBe("group")

  const neutral = card({ anchor: "absolute", x: 0, y: 0, width: 20, tone: "neutral" })
  expect(neutral.borderColor).toBe("line")
  expect(neutral.height).toBe(4)
})

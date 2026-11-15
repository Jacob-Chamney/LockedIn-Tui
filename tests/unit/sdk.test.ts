import { expect, test } from "bun:test"

import {
  defineManifest,
  defineParticleSystem,
  definePlugin,
  accordion,
  actionBar,
  avatar,
  avatarGroup,
  badges,
  bars,
  calendar,
  breadcrumbs,
  callout,
  card,
  checklist,
  chips,
  codeBlock,
  combobox,
  countBadge,
  confirm,
  createCursor,
  dashboard,
  delta,
  deltaText,
  diff,
  divider,
  distribution,
  ease,
  emptyState,
  fadeColor,
  fadeIn,
  fadeNode,
  fadeNodes,
  fadeOut,
  fields,
  gauge,
  heatmap,
  footerActions,
  form,
  log,
  menu,
  pagination,
  prompt,
  progressChip,
  kpiStrip,
  keycaps,
  kanban,
  radio,
  rangeSlider,
  rangeSliderText,
  rating,
  ratingText,
  legend,
  lineChart,
  list,
  loop,
  meter,
  matrix,
  mixHex,
  multiSelect,
  numberStepper,
  numberStepperText,
  outline,
  notice,
  pingPong,
  scrollbar,
  segmented,
  sidebarMain,
  skeleton,
  slider,
  sparkline,
  sparklineText,
  spinner,
  spinnerText,
  statCard,
  splitButton,
  splitButtonText,
  statusDot,
  stepper,
  stats,
  status,
  statusBanner,
  statusBannerText,
  swatches,
  table,
  tabs,
  thresholdBar,
  thresholdBarText,
  tagInput,
  textField,
  timeline,
  toasts,
  toggle,
  tooltip,
  transition,
  tree,
  window,
  wizard,
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
  expect(notice("brief", "info", 4)).toEqual({ message: "brief", level: "info", duration: 4 })
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

  const focusable = card({
    anchor: "absolute", x: 0, y: 0, width: 20, id: "note", focused: true,
  })
  expect(focusable).toMatchObject({ id: "note", focusable: true })

  const neutral = card({ anchor: "absolute", x: 0, y: 0, width: 20, tone: "neutral" })
  expect(neutral.borderColor).toBe("line")
  expect(neutral.height).toBe(4)
})

test("transition runs enter, hold and exit", () => {
  const opts = { enter: 0.4, hold: 1, exit: 0.4, curve: (t: number) => t }
  expect(transition(-1, opts)).toBe(0)
  expect(transition(0.2, opts)).toBeCloseTo(0.5)
  expect(transition(0.4, opts)).toBeCloseTo(1)
  expect(transition(1.0, opts)).toBe(1)
  expect(transition(1.4, opts)).toBe(1)
  expect(transition(1.6, opts)).toBeCloseTo(0.5)
  expect(transition(1.8, opts)).toBeCloseTo(0)
  expect(transition(10, opts)).toBe(0)
  // exit 0 keeps it visible after the hold
  expect(transition(10, { enter: 0.2, hold: 0.5, exit: 0 })).toBe(1)
})

test("createCursor clamps, wraps and reports a fraction", () => {
  const cursor = createCursor(4, { index: 1 })
  expect(cursor.index).toBe(1)
  expect(cursor.next()).toBe(2)
  expect(cursor.next(10)).toBe(3)
  expect(cursor.prev(10)).toBe(0)
  cursor.set(99)
  expect(cursor.index).toBe(3)
  expect(cursor.fraction).toBe(1)
  expect(createCursor(4, { wrap: true }).prev()).toBe(3)
  expect(createCursor(0).next()).toBe(0)
  expect(createCursor(0).fraction).toBe(0)
})

test("fields aligns labels, truncates values and highlights the selection", () => {
  const nodes = fields({
    rows: [
      { label: "theme", value: "crimson" },
      { label: "provider", value: "a very long provider name" },
      { label: "empty" },
    ],
    width: 24,
    labelWidth: 10,
    selected: 1,
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "text", y: 0, text: "theme      crimson" })
  expect(nodes[1]).toMatchObject({ kind: "rect", y: 1, width: 24 })
  expect(nodes[2]).toMatchObject({
    kind: "text",
    y: 1,
    text: "provider   a very long …",
    bg: "line",
  })
  expect(nodes[3]).toMatchObject({ kind: "text", y: 2, text: "empty", fg: "muted" })
})

test("log tails, truncates and highlights recent lines", () => {
  const nodes = log({
    lines: ["one", "two", "a very long line"],
    width: 8,
    height: 2,
    toneFrom: 2,
    tone: "warning",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "text", y: 0, text: "two" })
  expect(nodes[1]).toMatchObject({
    kind: "text",
    y: 1,
    text: "a very …",
    fg: "warning",
  })
  expect(log({ lines: [] })).toEqual([])
})

test("stats right-align values and optionally add detail", () => {
  const nodes = stats({
    width: 20,
    items: [
      { label: "focus", value: "3h", detail: "today" },
      { label: "queue", value: "8", tone: "warning" },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", y: 0, text: "focus             3h" })
  expect(nodes[1]).toMatchObject({ kind: "text", y: 1, text: "today", fg: "muted" })
  expect(nodes[2]).toMatchObject({ kind: "text", y: 2, text: "queue              8", fg: "warning" })
})

test("form builds fields and a footer with computed height", () => {
  const node = form({
    anchor: "absolute",
    x: 0,
    y: 0,
    width: 30,
    title: "settings",
    rows: [
      { label: "theme", value: "crimson" },
      { label: "model", value: "gpt" },
    ],
    selected: 1,
    actions: [{ key: "enter", label: "change" }],
  })
  expect(node).toMatchObject({ kind: "group", width: 30, height: 9 })
  const body = node.nodes.find((child) => child.kind === "group")
  if (body?.kind !== "group") throw new Error("expected body")
  expect(body.height).toBe(2)
  const footer = node.nodes.at(-1)
  expect(footer?.kind).toBe("group")
  if (footer?.kind !== "group") return
  const hint = footer.nodes[0]
  if (hint?.kind !== "text") throw new Error("expected hint")
  expect(hint.text).toBe("enter change")
})

test("host interaction helpers return command results", () => {
  expect(confirm("delete?", "delete-yes", { confirmLabel: "delete" })).toEqual({
    confirm: { message: "delete?", command: "delete-yes", confirmLabel: "delete" },
  })
  expect(prompt("name?", "name-set", { placeholder: "untitled" })).toEqual({
    prompt: { message: "name?", command: "name-set", placeholder: "untitled" },
  })
  expect(menu("pick", ["one", "two"], "picked")).toEqual({
    menu: { title: "pick", options: ["one", "two"], command: "picked" },
  })
  expect(status("synced", "warn")).toEqual({ status: { text: "synced", tone: "warn" } })
  expect(status(null)).toEqual({ status: null })
})

test("meter aligns its label and percentage above the track", () => {
  const nodes = meter({ anchor: "top-left", x: 2, y: 3, width: 20, label: "queue", value: 0.62 })
  expect(nodes).toHaveLength(2)
  const label = nodes[0]!
  const bar = nodes[1]!
  expect(label.kind).toBe("text")
  if (label.kind !== "text") return
  expect(label.y).toBe(3)
  expect(label.text.startsWith("queue")).toBe(true)
  expect(label.text.endsWith("62%")).toBe(true)
  expect(label.text).toHaveLength(20)
  expect(bar).toMatchObject({
    kind: "progress",
    x: 2,
    y: 4,
    width: 20,
    height: 1,
    value: 0.62,
    color: "primary",
    track: "line",
  })
})

test("meter clamps values, accepts custom text and caps the radius", () => {
  const bare = meter({ anchor: "top-left", x: 0, y: 0, width: 6, value: 4 })
  expect(bare).toHaveLength(1)
  expect(bare[0]).toMatchObject({ kind: "progress", y: 0, value: 1, radius: 0 })

  const tuned = meter({
    anchor: "top-left",
    x: 1,
    y: 2,
    width: 12,
    value: -1,
    height: 2,
    radius: 9,
    label: "spent",
    text: "$3",
    tone: "warning",
    track: "muted",
    showPercent: false,
  })
  expect(tuned).toHaveLength(2)
  const caption = tuned[0]!
  expect(caption.kind).toBe("text")
  if (caption.kind !== "text") return
  expect(caption.text).toBe("spent     $3")
  expect(tuned[1]).toMatchObject({ y: 3, height: 2, value: 0, radius: 6, color: "warning", track: "muted" })
})

test("sparkline places the glyph line and sparklineText returns it", () => {
  expect(sparklineText({ values: [1, 2, 3] })).toBe("▃▅█")
  expect(sparkline({ anchor: "top-left", x: 1, y: 2, values: [1, 2, 3], fg: "accent" })).toEqual({
    kind: "text",
    anchor: "top-left",
    x: 1,
    y: 2,
    text: "▃▅█",
    fg: "accent",
  })
  expect(sparkline({ anchor: "top-left", x: 0, y: 0, values: [1] })).toMatchObject({ fg: "primary" })
})

test("tabs fills the active chip and lays the strip out", () => {
  const nodes = tabs({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    tabs: [{ label: "7d" }, { label: "30d", count: 2 }],
    selected: 1,
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: " 7d ", fg: "muted" })
  expect(nodes[1]).toMatchObject({
    kind: "rect",
    x: 6,
    y: 3,
    width: 7,
    height: 1,
    fill: true,
    color: "accent",
  })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 6, text: " 30d 2 ", fg: "background" })
})

test("tabs can paint a background behind every chip and honours colours", () => {
  const nodes = tabs({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    tabs: [{ label: "a" }, { label: "b" }],
    selected: 0,
    bg: "surface",
    selectedBg: "warning",
    selectedFg: "surface",
    fg: "foreground",
  })
  expect(nodes.filter((node) => node.kind === "rect")).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ color: "warning" })
  expect(nodes[2]).toMatchObject({ color: "surface" })
  expect(nodes[1]).toMatchObject({ fg: "surface" })
  expect(nodes[3]).toMatchObject({ fg: "foreground" })
})

test("callout draws its bar and wraps to the block width", () => {
  const one = callout({
    anchor: "top-left",
    x: 1,
    y: 2,
    width: 20,
    tone: "warning",
    message: "all good now",
  })
  expect(one).toHaveLength(1)
  expect(one[0]).toMatchObject({
    kind: "text",
    x: 1,
    y: 2,
    text: "▌ all good now",
    fg: "warning",
  })

  const wrapped = callout({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    tone: "error",
    message: "the budget is nearly spent",
  })
  expect(wrapped.map((node) => (node.kind === "text" ? node.text : ""))).toEqual([
    "▌ the budget",
    "▌ is nearly",
    "▌ spent",
  ])
})

test("callout adds a title and an optional fill", () => {
  const nodes = callout({
    anchor: "top-left",
    x: 0,
    y: 4,
    width: 24,
    tone: "info",
    title: "heads up",
    message: "short",
    bg: "surface",
  })
  expect(nodes[0]).toMatchObject({
    kind: "rect",
    y: 4,
    width: 24,
    height: 2,
    fill: true,
    color: "surface",
  })
  expect(nodes[1]).toMatchObject({ kind: "text", y: 4, text: "▌ heads up", fg: "secondary" })
  expect(nodes[2]).toMatchObject({ kind: "text", y: 5, text: "▌ short", fg: "secondary" })
})

test("an empty callout has no nodes and a long title is fitted", () => {
  expect(callout({ anchor: "top-left", x: 0, y: 0, width: 10, message: "" })).toEqual([])
  const nodes = callout({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    title: "a title that is far too long",
    message: "x",
  })
  expect(nodes[0]!.kind).toBe("text")
  if (nodes[0]!.kind !== "text") return
  expect(nodes[0]!.text.endsWith("…")).toBe(true)
})

test("badges fill each chip with its tone and lay them out", () => {
  const nodes = badges({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    badges: [{ label: "linked", tone: "success" }, { label: "3 models" }],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({
    kind: "rect",
    x: 2,
    y: 3,
    width: 8,
    height: 1,
    fill: true,
    color: "success",
  })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: " linked ", fg: "background" })
  expect(nodes[2]).toMatchObject({ kind: "rect", x: 11, width: 10, color: "line" })
  expect(nodes[3]).toMatchObject({ kind: "text", x: 11, text: " 3 models ", fg: "background" })
})

test("badges accept colour overrides and can be empty", () => {
  const nodes = badges({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 40,
    badges: [{ label: "a", tone: "warning" }],
    bg: "panel",
    fg: "foreground",
  })
  expect(nodes[0]).toMatchObject({ color: "panel" })
  expect(nodes[1]).toMatchObject({ fg: "foreground" })
  expect(badges({ anchor: "top-left", x: 0, y: 0, width: 40, badges: [] })).toEqual([])
})

test("bars lines up labels, progress tracks and values", () => {
  const nodes = bars({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    labelWidth: 10,
    valueWidth: 4,
    items: [
      { label: "gpt-4.1", value: 60, text: "60%" },
      { label: "claude", value: 40, text: "40%" },
    ],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "gpt-4.1   ", fg: "foreground" })
  expect(nodes[1]).toMatchObject({
    kind: "progress",
    x: 13,
    y: 3,
    width: 24,
    height: 1,
    value: 1,
    radius: 0,
    color: "primary",
    track: "line",
  })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 38, y: 3, text: " 60%", fg: "muted" })
  expect(nodes[4]!.kind).toBe("progress")
  if (nodes[4]!.kind !== "progress") return
  expect(nodes[4]!.value).toBeCloseTo(2 / 3)
  expect(nodes[5]).toMatchObject({ x: 38, y: 4, text: " 40%" })
})

test("bars can hide the value column and is empty without items", () => {
  const nodes = bars({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    valueWidth: 0,
    tone: "accent",
    track: "muted",
    items: [{ label: "one", value: 1 }],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[1]).toMatchObject({ kind: "progress", color: "accent", track: "muted" })
  expect(bars({ anchor: "top-left", x: 0, y: 0, width: 30, items: [] })).toEqual([])
})

test("timeline lays out time, glyph, label and a rail", () => {
  const nodes = timeline({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    entries: [
      { time: "10:00", label: "a", glyph: "✓", tone: "success" },
      { time: "10:05", label: "b", detail: "detail", glyph: "×", tone: "error" },
    ],
  })
  expect(nodes).toHaveLength(8)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "10:00", fg: "muted" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 8, y: 3, text: "✓", fg: "success" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 10, y: 3, text: "a", fg: "foreground" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 4, text: "10:05" })
  expect(nodes[4]).toMatchObject({ x: 8, y: 4, text: "×", fg: "error" })
  expect(nodes[5]).toMatchObject({ x: 10, y: 4, text: "b" })
  expect(nodes[6]).toMatchObject({ x: 8, y: 5, text: "│", fg: "muted" })
  expect(nodes[7]).toMatchObject({ x: 10, y: 5, text: "detail", fg: "muted" })
})

test("timeline honours colour overrides and can be empty", () => {
  const nodes = timeline({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 40,
    fg: "primary",
    timeFg: "secondary",
    detailFg: "warning",
    entries: [{ time: "t", label: "a", detail: "d" }],
  })
  expect(nodes[0]).toMatchObject({ fg: "secondary" })
  expect(nodes[2]).toMatchObject({ fg: "primary" })
  expect(nodes[4]).toMatchObject({ fg: "warning" })
  expect(timeline({ anchor: "top-left", x: 0, y: 0, width: 40, entries: [] })).toEqual([])
})

test("emptyState centres a glyph, title and hint", () => {
  const nodes = emptyState({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    glyph: "○",
    title: "no activity",
    hint: "go",
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 9, y: 0, text: "○", fg: "primary" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 4, y: 1, text: "no activity", fg: "muted" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 9, y: 2, text: "go", fg: "primary" })
})

test("emptyState centres vertically in a box and can be text-only", () => {
  const nodes = emptyState({
    anchor: "top-left",
    x: 2,
    y: 1,
    width: 20,
    height: 10,
    title: "nothing",
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ x: 2 + 6, y: 1 + 4, text: "nothing", fg: "muted" })
  expect(emptyState({ anchor: "top-left", x: 0, y: 0, width: 20, title: "" })).toEqual([])
})

test("heatmap groups runs and marks active days", () => {
  const days = (tokens: number[]) => tokens.map((tokens) => ({ runs: tokens > 0 ? 1 : 0, tokens }))
  const nodes = heatmap({
    anchor: "top-left",
    x: 2,
    y: 3,
    labels: false,
    weeks: [days([0, 10, 0, 0, 0, 0, 0]), days([0, 0, 0, 0, 0, 0, 0])],
  })
  expect(nodes).toHaveLength(8)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "··", fg: "muted" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 4, text: "█", fg: "primary" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 3, y: 4, text: "·", fg: "muted" })
})

test("heatmap labels months and weekdays and honours colours", () => {
  const days = (tokens: number[]) =>
    tokens.map((tokens) => ({ runs: tokens > 0 ? 1 : 0, tokens }))
  const empty = () => days([0, 0, 0, 0, 0, 0, 0])
  const nodes = heatmap({
    anchor: "top-left",
    x: 2,
    y: 3,
    tone: "accent",
    muted: "line",
    months: [{ week: 0, label: "Nov" }],
    weeks: [days([5, 0, 0, 0, 0, 0, 0]), empty(), empty(), empty()],
  })
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "  Nov ", fg: "line" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, text: "M ", fg: "line" })
  expect(nodes[2]).toMatchObject({ x: 4, y: 4, text: "█", fg: "accent" })
  expect(nodes[3]).toMatchObject({ x: 5, y: 4, text: "···", fg: "line" })
})

test("stepper joins done, current and pending entries with a rail", () => {
  const nodes = stepper({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    entries: [
      { label: "read", done: true },
      { label: "derive", current: true },
      { label: "write" },
    ],
  })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "  ✓  read", fg: "success" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, text: "  │  ", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 5, text: "▌ ▸  derive", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 6, text: "  │  " })
  expect(nodes[4]).toMatchObject({ x: 2, y: 7, text: "  ○  write", fg: "foreground" })
})

test("stepper adds details and can drop the rails", () => {
  const withDetail = stepper({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    entries: [{ label: "one", current: true, detail: "10 min" }],
  })
  expect(withDetail).toHaveLength(2)
  expect(withDetail[0]).toMatchObject({ y: 0, text: "▌ ▸  one" })
  expect(withDetail[1]).toMatchObject({ y: 1, text: "  │  10 min", fg: "muted" })

  const flat = stepper({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    rails: false,
    entries: [{ label: "a", done: true }, { label: "b" }],
  })
  expect(flat).toHaveLength(2)
  expect(flat[1]).toMatchObject({ y: 1, text: "  ○  b" })
})

test("stepper honours glyph and colour overrides", () => {
  const nodes = stepper({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    glyphs: { done: "D", current: "C", pending: "P", selected: "*", rail: "|" },
    doneFg: "accent",
    currentFg: "warning",
    pendingFg: "secondary",
    railFg: "line",
    detailFg: "foreground",
    entries: [
      { label: "a", done: true, detail: "x" },
      { label: "b", current: true },
    ],
  })
  expect(nodes[0]).toMatchObject({ text: "  D  a", fg: "accent" })
  expect(nodes[1]).toMatchObject({ text: "  |  x", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ text: "  |  ", fg: "line" })
  expect(nodes[3]).toMatchObject({ text: "* C  b", fg: "warning" })
})

test("tree draws guides, carets and a selection marker", () => {
  const nodes = tree({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    selected: 1,
    nodes: [{ id: "a", label: "root", children: [{ id: "a1", label: "child" }] }],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "  ", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 4, y: 3, text: "▾ ", fg: "line" })
  expect(nodes[2]).toMatchObject({ x: 6, y: 3, text: "root", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 4, text: "▌ ", fg: "primary" })
  expect(nodes[4]).toMatchObject({ x: 4, y: 4, text: "  └─", fg: "line" })
  expect(nodes[5]).toMatchObject({ x: 8, y: 4, text: "child", fg: "foreground" })
})

test("tree hides collapsed children and can omit carets", () => {
  const collapsed = tree({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    collapsed: ["a"],
    nodes: [{ id: "a", label: "root", children: [{ id: "a1", label: "child" }] }],
  })
  expect(collapsed.map((node) => (node.kind === "text" ? node.text : ""))).toEqual(["▸ ", "root"])

  const flat = tree({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    carets: false,
    nodes: [{ id: "a", label: "root", children: [{ id: "a1", label: "child" }] }],
  })
  expect(flat[0]).toMatchObject({ x: 0, text: "root", fg: "primary" })
  expect(flat[1]).toMatchObject({ x: 0, text: "  └─", fg: "line" })
  expect(flat[2]).toMatchObject({ x: 4, text: "child", fg: "foreground" })
})

test("tree renders a detail on a second line", () => {
  const nodes = tree({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    fg: "accent",
    detailFg: "warning",
    nodes: [{ id: "a", label: "root", detail: "three files", children: [] }],
  })
  expect(nodes[0]).toMatchObject({ y: 0, text: "root", fg: "primary" })
  expect(nodes[1]).toMatchObject({ y: 1, text: "three files", fg: "warning" })
})

test("gauge draws a track, a filled arc, a percentage and a label", () => {
  const nodes = gauge({
    anchor: "top-left",
    x: 2,
    y: 3,
    size: 10,
    value: 3,
    max: 10,
    label: "3 / 10",
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({
    kind: "arc",
    x: 2,
    y: 3,
    width: 10,
    height: 10,
    value: 1,
    start: -90,
    color: "line",
  })
  expect(nodes[1]).toMatchObject({ kind: "arc", value: 0.3, color: "primary" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 5, y: 8, text: "30%", fg: "foreground" })
  expect(nodes[3]).toMatchObject({ kind: "text", x: 2, y: 13, text: "3 / 10", fg: "muted" })
})

test("gauge can hide the centre text and honours colours", () => {
  const nodes = gauge({
    anchor: "top-left",
    x: 0,
    y: 0,
    size: 1,
    value: 1,
    max: 2,
    showPercent: false,
    tone: "accent",
    track: "muted",
    thickness: 2,
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ width: 3, height: 3, thickness: 2, color: "muted" })
  expect(nodes[1]).toMatchObject({ value: 0.5, color: "accent" })
})

test("gauge keeps the label and percent colours", () => {
  const nodes = gauge({
    anchor: "top-left",
    x: 0,
    y: 0,
    value: 1,
    label: "one",
    percentFg: "warning",
    labelFg: "secondary",
  })
  expect(nodes[2]).toMatchObject({ text: "100%", fg: "warning" })
  expect(nodes[3]).toMatchObject({ text: "one", fg: "secondary" })
})

test("accordion draws headers, hidden items and a selected marker", () => {
  const nodes = accordion({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    collapsed: ["models"],
    selected: { section: "user", item: "name" },
    sections: [
      {
        id: "user",
        title: "USER",
        meta: "2",
        items: [
          { id: "name", label: "Username" },
          { id: "theme", label: "Theme" },
        ],
      },
      { id: "models", title: "MODELS", items: [{ id: "provider", label: "Providers" }] },
    ],
  })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "▾ USER", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 21, y: 3, text: "2", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 4, text: "▌ Username", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 5, text: "  Theme", fg: "foreground" })
  expect(nodes[4]).toMatchObject({ x: 2, y: 6, text: "▸ MODELS", fg: "primary" })
})

test("accordion can hide carets and skip a meta that does not fit", () => {
  const nodes = accordion({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 4,
    carets: false,
    sections: [{ id: "a", title: "A", meta: "long", items: [{ id: "x", label: "X" }] }],
  })
  expect(nodes[0]).toMatchObject({ text: "A", fg: "primary" })
  expect(nodes).toHaveLength(2)
  expect(nodes[1]).toMatchObject({ x: 0, text: "  X" })
})

test("checklist draws markers, boxes and labels", () => {
  const nodes = checklist({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    selected: 0,
    items: [
      { id: "a", label: "notes", checked: true },
      { id: "b", label: "filesystem", checked: false },
      { id: "c", label: "legacy", checked: true, disabled: true },
    ],
  })
  expect(nodes).toHaveLength(9)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "▌ ", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 4, y: 3, text: "[x]", fg: "success" })
  expect(nodes[2]).toMatchObject({ x: 8, y: 3, text: "notes", fg: "primary" })
  expect(nodes[4]).toMatchObject({ x: 4, y: 4, text: "[ ]", fg: "muted" })
  expect(nodes[5]).toMatchObject({ x: 8, y: 4, text: "filesystem", fg: "foreground" })
  expect(nodes[7]).toMatchObject({ x: 4, y: 5, text: "[-]", fg: "muted" })
})

test("checklist honours glyph and colour overrides", () => {
  const nodes = checklist({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    glyphs: { checked: "Y", unchecked: "N", disabled: "-" },
    markerFg: "accent",
    checkedFg: "warning",
    uncheckedFg: "secondary",
    disabledFg: "line",
    fg: "foreground",
    selectedFg: "error",
    items: [
      { id: "a", label: "one", checked: true },
      { id: "b", label: "two", checked: false, disabled: true },
    ],
  })
  expect(nodes[0]).toMatchObject({ text: "Y", fg: "warning" })
  expect(nodes[2]).toMatchObject({ text: "-", fg: "line" })
})

test("breadcrumbs lay out each segment and fit the trail", () => {
  const nodes = breadcrumbs({
    anchor: "top-left",
    x: 2,
    y: 0,
    width: 20,
    items: ["CHILL", "Chat"],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ x: 2, y: 0, text: "CHILL", fg: "muted" })
  expect(nodes[1]).toMatchObject({ x: 7, text: " › ", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 10, text: "Chat", fg: "foreground" })
})

test("breadcrumbs elide the middle and honour colours", () => {
  const nodes = breadcrumbs({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 16,
    items: ["CHILL", "Physics", "Chat"],
    rootFg: "accent",
    currentFg: "warning",
    separatorFg: "line",
    ellipsisFg: "secondary",
  })
  expect(nodes.map((node) => (node.kind === "text" ? node.text : ""))).toEqual([
    "CHILL",
    " › ",
    "…",
    " › ",
    "Chat",
  ])
  expect(nodes[0]).toMatchObject({ fg: "accent" })
  expect(nodes[2]).toMatchObject({ fg: "secondary" })
  expect(nodes[4]).toMatchObject({ fg: "warning" })
  expect(breadcrumbs({ anchor: "top-left", x: 0, y: 0, width: 0, items: ["Chat"] })).toEqual([])
})

test("legend places glyphs and labels with their tones", () => {
  const nodes = legend({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    items: [
      { glyph: "·", label: "less", tone: "muted" },
      { glyph: "█", label: "more", tone: "primary" },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "·", fg: "muted" })
  expect(nodes[1]).toMatchObject({ x: 4, y: 3, text: "less", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 10, y: 3, text: "█", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 12, y: 3, text: "more", fg: "muted" })
})

test("legend can hide labels and override colours", () => {
  const nodes = legend({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    labels: false,
    gap: 1,
    tone: "warning",
    items: [{ glyph: "a" }, { glyph: "b" }],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ x: 0, text: "a", fg: "warning" })
  expect(nodes[1]).toMatchObject({ x: 2, text: "b", fg: "warning" })
  expect(legend({ anchor: "top-left", x: 0, y: 0, width: 10, items: [] })).toEqual([])
})

test("tooltip draws a bordered box, title and body", () => {
  const nodes = tooltip({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    title: "hint",
    text: "short",
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({
    kind: "box",
    x: 2,
    y: 3,
    width: 20,
    height: 4,
    border: true,
    borderStyle: "rounded",
    borderColor: "line",
  })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 4, y: 4, text: "hint", fg: "primary" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 4, y: 5, text: "short", fg: "foreground" })
})

test("tooltip uses shared placement and clips long bodies", () => {
  const placed = tooltip({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    text: "x",
    target: { x: 10, y: 5, width: 10, height: 1 },
    bounds: { width: 40, height: 20 },
  })
  expect(placed[0]).toMatchObject({ x: 5, y: 7 })

  const clipped = tooltip({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    text: "one two three four five six",
    maxLines: 1,
  })
  expect(clipped).toHaveLength(2)
  expect(clipped[1]!.kind).toBe("text")
  if (clipped[1]!.kind !== "text") return
  expect(clipped[1]!.text.endsWith("…")).toBe(true)
})

test("radio draws markers, boxes and labels", () => {
  const nodes = radio({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    selected: 0,
    items: [
      { id: "lockedin", label: "LockedIn Crimson", checked: true },
      { id: "dracula", label: "Dracula" },
    ],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "▌ ", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 4, y: 3, text: "(•)", fg: "success" })
  expect(nodes[2]).toMatchObject({ x: 8, y: 3, text: "LockedIn Crimson", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 4, text: "  " })
  expect(nodes[4]).toMatchObject({ x: 4, y: 4, text: "( )", fg: "muted" })
  expect(nodes[5]).toMatchObject({ x: 8, y: 4, text: "Dracula", fg: "foreground" })
})

test("radio honours glyph and colour overrides without a cursor", () => {
  const nodes = radio({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 30,
    glyphs: { on: "●", off: "○" },
    onFg: "accent",
    offFg: "secondary",
    items: [
      { id: "a", label: "one", checked: true },
      { id: "b", label: "two" },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ x: 0, text: "●", fg: "accent" })
  expect(nodes[1]).toMatchObject({ x: 2, text: "one" })
  expect(nodes[2]).toMatchObject({ x: 0, text: "○", fg: "secondary" })
  expect(radio({ anchor: "top-left", x: 0, y: 0, width: 30, items: [] })).toEqual([])
})

test("distribution draws a full stacked bar and its legend", () => {
  const nodes = distribution({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 24,
    items: [
      { label: "gpt", value: 78 },
      { label: "claude", value: 22 },
    ],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "███████████████████", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 21, y: 3, text: "█████", fg: "secondary" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 4, text: "█", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 4, y: 4, text: "gpt 78%", fg: "muted" })
  expect(nodes[4]).toMatchObject({ x: 13, y: 4, text: "█", fg: "secondary" })
  expect(nodes[5]).toMatchObject({ x: 15, y: 4, text: "claude 22%", fg: "muted" })
})

test("distribution can omit the legend and is empty without values", () => {
  const nodes = distribution({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    legend: false,
    glyph: "▓",
    items: [{ label: "only", value: 1 }],
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ text: "▓▓▓▓▓▓▓▓▓▓", fg: "primary" })
  expect(distribution({ anchor: "top-left", x: 0, y: 0, width: 10, items: [] })).toEqual([])
})

test("diff draws gutters and toned content", () => {
  const nodes = diff({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: " 1    - ", fg: "line" })
  expect(nodes[1]).toMatchObject({ x: 10, y: 3, text: "old", fg: "error" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 4, text: "    1 + ", fg: "line" })
  expect(nodes[3]).toMatchObject({ x: 10, y: 4, text: "new", fg: "success" })
})

test("diff wraps long lines and honours colours", () => {
  const nodes = diff({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    numbers: false,
    addFg: "accent",
    gutterFg: "secondary",
    lines: [{ kind: "add", text: "abcdefghijkl" }],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ x: 0, y: 0, text: "+ ", fg: "secondary" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 0, text: "abcdefghij", fg: "accent" })
  expect(nodes[2]).toMatchObject({ x: 0, y: 1, text: "  ", fg: "secondary" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 1, text: "kl", fg: "accent" })
  expect(diff({ anchor: "top-left", x: 0, y: 0, width: 12, lines: [] })).toEqual([])
})

test("skeleton draws ragged placeholder rows", () => {
  const nodes = skeleton({ anchor: "top-left", x: 2, y: 3, width: 20, rows: 3 })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, fg: "muted" })
  expect(nodes[0]!.kind).toBe("text")
  if (nodes[0]!.kind !== "text") return
  expect(nodes[0]!.text).toHaveLength(20)
  expect(nodes[1]).toMatchObject({ y: 4 })
  expect(nodes[2]).toMatchObject({ y: 5 })
})

test("skeleton honours glyph and tone overrides", () => {
  const nodes = skeleton({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    rows: 2,
    glyph: "█",
    tone: "line",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]!.kind).toBe("text")
  if (nodes[0]!.kind !== "text") return
  expect(nodes[0]!.text).toBe("█".repeat(10))
  expect(nodes[0]!.fg).toBe("line")
  expect(skeleton({ anchor: "top-left", x: 0, y: 0, width: 0, rows: 3 })).toEqual([])
})

test("keycaps fill each cap and keep the chord text", () => {
  const nodes = keycaps({ anchor: "top-left", x: 2, y: 1, width: 14, chord: "␣ c" })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 1, width: 1, color: "line" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 1, text: "␣", fg: "background" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 3, y: 1, text: " ", fg: "muted" })
  expect(nodes[3]).toMatchObject({ kind: "rect", x: 4, width: 1 })
  expect(nodes[4]).toMatchObject({ kind: "text", x: 4, text: "c" })
})

test("keycaps honour colours, truncation and empty chords", () => {
  const nodes = keycaps({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 14,
    chord: "shift+r",
    capBg: "accent",
    capFg: "warning",
    separatorFg: "line",
  })
  expect(nodes[0]).toMatchObject({ width: 5, color: "accent" })
  expect(nodes[1]).toMatchObject({ text: "shift", fg: "warning" })
  expect(nodes[2]).toMatchObject({ text: "+", fg: "line" })

  const clipped = keycaps({ anchor: "top-left", x: 0, y: 0, width: 6, chord: "shift+r" })
  expect(clipped).toHaveLength(2)
  expect(clipped[1]).toMatchObject({ text: "shift" })
  expect(keycaps({ anchor: "top-left", x: 0, y: 0, width: 14, chord: "" })).toEqual([])
})

test("kanban draws counted columns and selected cards", () => {
  const nodes = kanban({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 21,
    selected: "b",
    columns: [
      {
        id: "active",
        title: "ACTIVE",
        cards: [
          { id: "a", title: "build" },
          { id: "b", title: "review" },
        ],
      },
      { id: "done", title: "DONE", cards: [{ id: "c", title: "ship" }] },
    ],
  })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "ACTIVE (2)", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, text: "  build", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 5, text: "▌ review", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 13, y: 3, text: "DONE (1)" })
  expect(nodes[4]).toMatchObject({ x: 13, y: 4, text: "  ship" })
})

test("kanban reports hidden cards and honours colours", () => {
  const nodes = kanban({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 21,
    maxCards: 1,
    titleFg: "accent",
    cardFg: "secondary",
    hiddenFg: "warning",
    columns: [
      { id: "a", title: "A", cards: [{ id: "x", title: "one" }, { id: "y", title: "two" }] },
      { id: "b", title: "B", cards: [] },
    ],
  })
  expect(nodes[0]).toMatchObject({ text: "A (2)", fg: "accent" })
  expect(nodes[1]).toMatchObject({ text: "  one", fg: "secondary" })
  expect(nodes[2]).toMatchObject({ y: 2, text: "+1 more", fg: "warning" })
  expect(kanban({ anchor: "top-left", x: 0, y: 0, width: 20, columns: [] })).toEqual([])
})

test("calendar draws the month, weekdays and marked days", () => {
  const nodes = calendar({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 21,
    month: "2026-11-15",
    marked: ["2026-11-05"],
    today: "2026-11-10",
    todayBg: "surface",
  })
  expect(nodes).toHaveLength(38)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "November 2026", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, text: "Mo", fg: "muted" })
  const day1 = nodes.find((node) => node.kind === "text" && node.text === " 1" && node.y === 5)!
  expect(day1).toMatchObject({ x: 20, fg: "muted" })
  const day5 = nodes.find((node) => node.kind === "text" && node.text === " 5" && node.y === 6)!
  expect(day5).toMatchObject({ x: 11, fg: "primary" })
  const today = nodes.find((node) => node.kind === "text" && node.text === "10")!
  expect(today).toMatchObject({ x: 5, y: 7, fg: "warning", bg: "surface" })
})

test("calendar honours Sunday-first, colours and invalid months", () => {
  const sunday = calendar({ anchor: "top-left", x: 0, y: 0, width: 21, month: "2026-11-01", mondayFirst: false })
  expect(sunday[1]).toMatchObject({ text: "Su" })
  const day1 = sunday.find((node) => node.kind === "text" && node.text === " 1")!
  expect(day1).toMatchObject({ x: 0, y: 2 })

  const custom = calendar({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 21,
    month: "2026-11-01",
    marked: ["2026-11-02"],
    titleFg: "accent",
    markedFg: "success",
    dayFg: "foreground",
  })
  expect(custom[0]).toMatchObject({ fg: "accent" })
  const marked = custom.find((node) => node.kind === "text" && node.text === " 2")!
  expect(marked).toMatchObject({ fg: "success" })
  expect(calendar({ anchor: "top-left", x: 0, y: 0, width: 21, month: "nope" })).toEqual([])
})

test("toggle draws a filled pill and its state text", () => {
  const nodes = toggle({ anchor: "top-left", x: 2, y: 3, width: 6, on: true })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 6, height: 1, color: "success" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 3, text: "● on", fg: "background" })
})

test("toggle honours labels, colours and fitting", () => {
  const off = toggle({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 5,
    on: false,
    onLabel: "yes",
    offLabel: "no",
    offBg: "panel",
    offFg: "secondary",
  })
  expect(off[0]).toMatchObject({ color: "panel" })
  expect(off[1]).toMatchObject({ text: "○ no", fg: "secondary" })

  const clipped = toggle({ anchor: "top-left", x: 0, y: 0, width: 3, on: true })
  expect(clipped[1]).toMatchObject({ text: "● …" })
  expect(toggle({ anchor: "top-left", x: 0, y: 0, width: 0, on: true })).toEqual([])
})

test("chips fill bracketed tokens and mark the active one", () => {
  const nodes = chips({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    items: [
      { id: "a", label: "a.png", removable: true },
      { id: "b", label: "b.png", removable: true, active: true },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 9, color: "surface" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: "[a.png ×]", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 12, width: 9, color: "primary" })
  expect(nodes[3]).toMatchObject({ x: 12, text: "[b.png ×]", fg: "background" })
})

test("chips report hidden tokens and honour overrides", () => {
  const nodes = chips({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 10,
    marker: "x",
    fg: "secondary",
    hiddenFg: "warning",
    items: [
      { id: "a", label: "a", removable: true },
      { id: "b", label: "b", removable: true },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[1]).toMatchObject({ text: "[a x]", fg: "secondary" })
  expect(nodes[2]).toMatchObject({ x: 8, text: "+1", fg: "warning" })
  expect(chips({ anchor: "top-left", x: 0, y: 0, width: 20, items: [] })).toEqual([])
})

test("slider draws the filled track, knob and label", () => {
  const nodes = slider({ anchor: "top-left", x: 2, y: 3, width: 18, value: 0.8 })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "━━━━━━━━━━", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 12, y: 3, text: "●", fg: "primary" })
  expect(nodes[2]).toMatchObject({ x: 13, y: 3, text: "───", fg: "line" })
  expect(nodes[3]).toMatchObject({ x: 17, y: 3, text: "80%", fg: "muted" })
})

test("slider hides the label and honours colours and glyphs", () => {
  const nodes = slider({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    value: 0.5,
    showLabel: false,
    glyphs: { filled: "=", thumb: "O", empty: "-" },
    filledFg: "accent",
    thumbFg: "warning",
    emptyFg: "secondary",
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ text: "=====", fg: "accent" })
  expect(nodes[1]).toMatchObject({ x: 5, text: "O", fg: "warning" })
  expect(nodes[2]).toMatchObject({ x: 6, text: "----", fg: "secondary" })
  expect(slider({ anchor: "top-left", x: 0, y: 0, width: 0, value: 0.5 })).toEqual([])
})

test("scrollbar draws a proportional thumb on a vertical track", () => {
  const nodes = scrollbar({ anchor: "top-left", x: 2, y: 3, length: 10, content: 100, viewport: 10, offset: 45 })
  expect(nodes).toHaveLength(10)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "│", fg: "line" })
  expect(nodes[4]).toMatchObject({ y: 7, text: "│" })
  expect(nodes[5]).toMatchObject({ x: 2, y: 8, text: "█", fg: "primary" })
  expect(nodes[9]).toMatchObject({ y: 12, text: "│" })
})

test("scrollbar can be horizontal, hidden when idle or forced", () => {
  const nodes = scrollbar({
    anchor: "top-left",
    x: 0,
    y: 0,
    length: 4,
    content: 10,
    viewport: 5,
    offset: 5,
    orientation: "horizontal",
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ x: 0, text: "─" })
  expect(nodes[2]).toMatchObject({ x: 2, text: "█" })
  expect(scrollbar({ anchor: "top-left", x: 0, y: 0, length: 4, content: 3, viewport: 5, offset: 0 })).toEqual([])
  const always = scrollbar({ anchor: "top-left", x: 0, y: 0, length: 3, content: 3, viewport: 5, offset: 0, always: true })
  expect(always).toHaveLength(3)
  expect(always.every((node) => node.kind === "text" && node.text === "█")).toBe(true)
})

test("actionBar fills keycaps and keeps labels separate", () => {
  const nodes = actionBar({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 60,
    groups: [
      {
        id: "keys",
        actions: [
          { id: "send", key: "Enter", label: "send" },
          { id: "normal", key: "Esc", label: "normal", disabled: true },
        ],
      },
      { id: "caps", actions: [{ id: "style", label: "style: normal" }] },
    ],
  })
  expect(nodes).toHaveLength(9)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 7, color: "line" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: "[Enter]", fg: "background" })
  expect(nodes[2]).toMatchObject({ x: 9, text: " send", fg: "foreground" })
  expect(nodes[3]).toMatchObject({ x: 14, text: "  ", fg: "line" })
  expect(nodes[4]).toMatchObject({ x: 16, width: 5, color: "line" })
  expect(nodes[5]).toMatchObject({ x: 16, text: "[Esc]", fg: "muted" })
  expect(nodes[6]).toMatchObject({ x: 21, text: " normal", fg: "muted" })
  expect(nodes[7]).toMatchObject({ x: 28, text: " · ", fg: "line" })
  expect(nodes[8]).toMatchObject({ x: 31, text: "style: normal" })
})

test("actionBar honours colours and hides actions that do not fit", () => {
  const nodes = actionBar({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    keyBg: "accent",
    keyFg: "warning",
    disabledFg: "secondary",
    groups: [{ id: "keys", actions: [{ id: "send", key: "Enter", label: "send" }] }],
  })
  expect(nodes[0]).toMatchObject({ color: "accent" })
  expect(nodes[1]).toMatchObject({ fg: "warning" })
  expect(nodes[2]).toMatchObject({ text: " s…" })
  expect(actionBar({ anchor: "top-left", x: 0, y: 0, width: 10, groups: [] })).toEqual([])
})

test("pagination draws dots with the current page in primary", () => {
  const nodes = pagination({ anchor: "top-left", x: 2, y: 0, width: 12, page: 0, total: 3 })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ x: 2, y: 0, text: "●", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 3, text: " ", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 4, text: "○", fg: "muted" })
  expect(nodes[4]).toMatchObject({ x: 6, text: "○" })
})

test("pagination supports counts, fallbacks and colours", () => {
  const count = pagination({ anchor: "top-left", x: 0, y: 0, page: 1, total: 3, style: "count" })
  expect(count).toHaveLength(1)
  expect(count[0]).toMatchObject({ text: "2/3", fg: "foreground" })

  const fallback = pagination({ anchor: "top-left", x: 0, y: 0, width: 3, page: 1, total: 5 })
  expect(fallback).toHaveLength(1)
  expect(fallback[0]).toMatchObject({ text: "2/5" })

  const custom = pagination({
    anchor: "top-left",
    x: 0,
    y: 0,
    page: 0,
    total: 2,
    glyphs: { current: "x", other: "." },
    currentFg: "accent",
    otherFg: "secondary",
  })
  expect(custom[0]).toMatchObject({ text: "x", fg: "accent" })
  expect(custom[2]).toMatchObject({ text: ".", fg: "secondary" })
})

test("codeBlock draws numbered gutters and code", () => {
  const nodes = codeBlock({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 30,
    language: "ts",
    lines: ["const x = 1", "const y = 2"],
  })
  expect(nodes).toHaveLength(5)
  expect(nodes[0]).toMatchObject({ x: 2, y: 3, text: "ts", fg: "muted" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, text: " 1 │ ", fg: "line" })
  expect(nodes[2]).toMatchObject({ x: 7, y: 4, text: "const x = 1", fg: "foreground" })
  expect(nodes[3]).toMatchObject({ x: 2, y: 5, text: " 2 │ " })
  expect(nodes[4]).toMatchObject({ x: 7, y: 5, text: "const y = 2" })
})

test("codeBlock fits long lines and can hide numbers", () => {
  const nodes = codeBlock({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    lines: ["abcdefgh"],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[1]).toMatchObject({ x: 5, text: "abcd…" })

  const plain = codeBlock({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    showNumbers: false,
    codeFg: "accent",
    lines: ["x = 1"],
  })
  expect(plain).toHaveLength(1)
  expect(plain[0]).toMatchObject({ x: 0, text: "x = 1", fg: "accent" })
})

test("swatches draw filled colour cells", () => {
  const nodes = swatches({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 10,
    colors: ["#000", "#111", "#222"],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 2, color: "#000" })
  expect(nodes[1]).toMatchObject({ x: 5, color: "#111" })
  expect(nodes[2]).toMatchObject({ x: 8, color: "#222" })
})

test("swatches fit narrow rows and honour gap/cell width", () => {
  const tight = swatches({ anchor: "top-left", x: 0, y: 0, width: 5, colors: ["a", "b", "c"] })
  expect(tight).toHaveLength(2)
  const narrow = swatches({ anchor: "top-left", x: 0, y: 0, width: 1, colors: ["a", "b"] })
  expect(narrow).toHaveLength(1)
  expect(narrow[0]).toMatchObject({ width: 1 })
  const custom = swatches({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    cellWidth: 3,
    gap: 2,
    colors: ["a", "b"],
  })
  expect(custom.map((node) => (node.kind === "rect" ? node.x : -1))).toEqual([0, 5])
  expect(swatches({ anchor: "top-left", x: 0, y: 0, width: 10, colors: [] })).toEqual([])
})

test("statusDot draws the glyph and an optional label", () => {
  const nodes = statusDot({
    anchor: "top-left",
    x: 2,
    y: 2,
    state: "ok",
    label: "connected",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 2, text: "●", fg: "success" })
  expect(nodes[1]).toMatchObject({ x: 4, y: 2, text: "connected", fg: "muted" })
})

test("statusDot fits labels and honours overrides", () => {
  const tight = statusDot({ anchor: "top-left", x: 0, y: 0, width: 5, state: "warn", label: "slow" })
  expect(tight[1]).toMatchObject({ x: 2, text: "sl…" })
  const custom = statusDot({
    anchor: "top-left",
    x: 0,
    y: 0,
    state: "error",
    glyphs: { error: "!" },
    tones: { error: "accent" },
    labelFg: "secondary",
    label: "down",
  })
  expect(custom[0]).toMatchObject({ text: "!", fg: "accent" })
  expect(custom[1]).toMatchObject({ text: "down", fg: "secondary" })
  expect(statusDot({ anchor: "top-left", x: 0, y: 0, width: 0, state: "ok" })).toEqual([])
})

test("avatar draws a monogram badge", () => {
  const nodes = avatar({
    anchor: "top-left",
    x: 2,
    y: 2,
    name: "Ada Lovelace",
    tone: "accent",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 2, width: 4, height: 1, color: "accent" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 2, text: "[AL]", fg: "background" })
})

test("avatar fits narrow widths and honours colours", () => {
  const tight = avatar({
    anchor: "top-left",
    x: 0,
    y: 0,
    name: "Ada Lovelace",
    width: 2,
    bg: "line",
    fg: "foreground",
  })
  expect(tight[0]).toMatchObject({ width: 2, color: "line" })
  expect(tight[1]).toMatchObject({ text: "[…", fg: "foreground" })
  expect(avatar({ anchor: "top-left", x: 0, y: 0, name: "Ada", width: 0 })).toEqual([])
})

test("segmented fills the selected segment and centres labels", () => {
  const nodes = segmented({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 14,
    options: ["day", "month"],
    selected: 1,
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 2, width: 7, color: "surface" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: "  day  ", fg: "muted" })
  expect(nodes[2]).toMatchObject({ kind: "rect", x: 9, width: 7, color: "primary" })
  expect(nodes[3]).toMatchObject({ kind: "text", x: 9, text: " month ", fg: "background" })
})

test("segmented honours colours and hides when too narrow", () => {
  const nodes = segmented({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 10,
    options: ["a", "b"],
    selected: 0,
    selectedBg: "accent",
    bg: "line",
    selectedFg: "warning",
    fg: "secondary",
  })
  expect(nodes[0]).toMatchObject({ color: "accent" })
  expect(nodes[1]).toMatchObject({ fg: "warning" })
  expect(nodes[2]).toMatchObject({ color: "line" })
  expect(nodes[3]).toMatchObject({ fg: "secondary" })
  expect(segmented({ anchor: "top-left", x: 0, y: 0, width: 1, options: ["a", "b"], selected: 0 })).toEqual([])
})

test("rating splits filled and empty pips", () => {
  const nodes = rating({ anchor: "top-left", x: 2, y: 3, value: 3, max: 5 })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "●●●", fg: "primary" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 5, y: 3, text: "○○", fg: "line" })
})

test("rating shares the text helper and honours overrides", () => {
  expect(ratingText({ value: 2, max: 4 })).toBe("●●○○")
  const nodes = rating({
    anchor: "top-left",
    x: 0,
    y: 0,
    value: 2,
    max: 3,
    glyphs: { filled: "x", empty: "." },
    filledFg: "accent",
    emptyFg: "secondary",
  })
  expect(nodes[0]).toMatchObject({ text: "xx", fg: "accent" })
  expect(nodes[1]).toMatchObject({ text: ".", fg: "secondary" })
  expect(rating({ anchor: "top-left", x: 0, y: 0, value: 2, max: 0 })).toEqual([])
})

test("toasts draw a tone-coded rounded stack", () => {
  const nodes = toasts({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 60,
    toasts: [
      { id: "a", text: "saved", tone: "info" },
      { id: "b", text: "the request failed", tone: "error" },
    ],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({
    kind: "box",
    x: 2,
    y: 2,
    width: 20,
    height: 3,
    border: true,
    borderStyle: "rounded",
    bg: "panel",
  })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 3, y: 3, text: "·", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ kind: "text", x: 5, y: 3, text: "saved" })
  expect(nodes[3]).toMatchObject({ kind: "box", y: 6, width: 22, bg: "error" })
  expect(nodes[4]).toMatchObject({ x: 3, y: 7, text: "×", fg: "background" })
  expect(nodes[5]).toMatchObject({ x: 5, y: 7, text: "the request failed" })
})

test("toasts honour overrides and keep the newest", () => {
  const nodes = toasts({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 40,
    maxVisible: 1,
    fill: "surface",
    ink: "accent",
    borderColor: "warning",
    toasts: [
      { id: "a", text: "old" },
      { id: "b", text: "new", tone: "warn" },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ bg: "surface", borderColor: "warning" })
  expect(nodes[1]).toMatchObject({ text: "!", fg: "accent" })
  expect(nodes[2]).toMatchObject({ text: "new" })
  expect(toasts({ anchor: "top-left", x: 0, y: 0, width: 40, toasts: [] })).toEqual([])
})

test("progressChip draws a tone-filled bar and count", () => {
  const nodes = progressChip({ anchor: "top-left", x: 2, y: 3, done: 2, total: 4 })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 8, color: "primary" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 3, text: "▰▰▱▱ 2/4", fg: "background" })
})

test("progressChip shares tones, fitting and overrides", () => {
  const done = progressChip({ anchor: "top-left", x: 0, y: 0, done: 3, total: 3 })
  expect(done[0]).toMatchObject({ color: "success" })
  const zero = progressChip({ anchor: "top-left", x: 0, y: 0, done: 0, total: 3 })
  expect(zero[0]).toMatchObject({ color: "line" })
  expect(zero[1]).toMatchObject({ fg: "foreground" })
  const clipped = progressChip({ anchor: "top-left", x: 0, y: 0, width: 5, done: 1, total: 2 })
  expect(clipped[0]).toMatchObject({ width: 5 })
  expect(clipped[1]).toMatchObject({ text: "▰▰▱▱…" })
  const custom = progressChip({
    anchor: "top-left",
    x: 0,
    y: 0,
    done: 1,
    total: 2,
    barWidth: 2,
    glyphs: { filled: "=", empty: "-" },
    bg: "accent",
    fg: "warning",
  })
  expect(custom[0]).toMatchObject({ color: "accent" })
  expect(custom[1]).toMatchObject({ text: "=- 1/2", fg: "warning" })
})

test("spinner draws one frame with a fitted label", () => {
  const nodes = spinner({ anchor: "top-left", x: 2, y: 3, frame: 0, label: "loading" })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({
    kind: "text",
    x: 2,
    y: 3,
    text: "⠋ loading",
    fg: "muted",
  })
})

test("spinner wraps frames, fits and honours overrides", () => {
  expect(spinnerText({ frame: 10, label: "x" })).toBe("⠋ x")
  const clipped = spinner({ anchor: "top-left", x: 0, y: 0, frame: 1, label: "loading", width: 5, fg: "accent" })
  expect(clipped[0]).toMatchObject({ text: "⠙ lo…", fg: "accent" })
  const custom = spinner({ anchor: "top-left", x: 0, y: 0, frame: 1, label: "x", frames: [".", "-"] })
  expect(custom[0]).toMatchObject({ text: "- x" })
  expect(spinner({ anchor: "top-left", x: 0, y: 0, frame: 0, width: 0 })).toEqual([])
})

test("divider draws a full rule without a label", () => {
  const nodes = divider({ anchor: "top-left", x: 2, y: 3, width: 10 })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "──────────", fg: "line" })
})

test("divider centres a label between two lines", () => {
  const nodes = divider({ anchor: "top-left", x: 2, y: 3, width: 30, label: "notes" })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ x: 2, text: "───────────", fg: "line" })
  expect(nodes[1]).toMatchObject({ x: 13, text: " notes ", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 20, text: "────────────", fg: "line" })
})

test("divider fits a wide label and honours colours", () => {
  const nodes = divider({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 8,
    label: "a longer label",
    lineFg: "secondary",
    labelFg: "accent",
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ text: "a longe…", fg: "accent" })
  const custom = divider({ anchor: "top-left", x: 0, y: 0, width: 6, glyph: "=", lineFg: "warning" })
  expect(custom[0]).toMatchObject({ text: "======", fg: "warning" })
  expect(divider({ anchor: "top-left", x: 0, y: 0, width: 0 })).toEqual([])
})

test("outline marks depth and the current section", () => {
  const nodes = outline({
    anchor: "top-left",
    x: 2,
    y: 1,
    width: 60,
    current: 1,
    items: [
      { id: "a", label: "Intro", depth: 1 },
      { id: "b", label: "Detail", depth: 2 },
      { id: "c", label: "Deep", depth: 3 },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 1, text: "◆  Intro", fg: "muted" })
  expect(nodes[1]).toMatchObject({ x: 12, y: 1, text: "◇▸ Detail", fg: "primary" })
  expect(nodes[2]).toMatchObject({ x: 23, y: 1, text: "·  Deep", fg: "muted" })
})

test("outline keeps the current item visible and honours colours", () => {
  const nodes = outline({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 14,
    current: 1,
    currentFg: "accent",
    fg: "secondary",
    items: [
      { id: "a", label: "Intro", depth: 1 },
      { id: "b", label: "Detail", depth: 2 },
    ],
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ text: "◇▸ Detail", fg: "accent" })
  expect(outline({ anchor: "top-left", x: 0, y: 0, width: 20, items: [] })).toEqual([])
})

test("delta draws a signed percentage in its tone", () => {
  const nodes = delta({ anchor: "top-left", x: 2, y: 4, value: 12, label: "vs prior 7d" })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({
    kind: "text",
    x: 2,
    y: 4,
    text: "▲ 12% vs prior 7d",
    fg: "success",
  })
})

test("delta flips the healthy direction and honours overrides", () => {
  const spend = delta({ anchor: "top-left", x: 0, y: 0, value: 9, good: "down" })
  expect(spend[0]).toMatchObject({ text: "▲ 9%", fg: "error" })
  const flat = delta({ anchor: "top-left", x: 0, y: 0, value: 0, fg: "accent" })
  expect(flat[0]).toMatchObject({ text: "— 0%", fg: "accent" })
  expect(deltaText({ value: -5 })).toBe("▼ 5%")
  expect(delta({ anchor: "top-left", x: 0, y: 0, value: 2, width: 0 })).toEqual([])
})

test("avatarGroup draws stacked monograms at overlapping offsets", () => {
  const nodes = avatarGroup({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    items: [
      { id: "a", name: "Ada Lovelace" },
      { id: "b", name: "Builder" },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 4, height: 1 })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: "[AL]", fg: "background" })
  expect(nodes[2]).toMatchObject({ x: 5, width: 4 })
  expect(nodes[3]).toMatchObject({ x: 5, text: "[BU]" })
})

test("avatarGroup reports overflow and honours colours", () => {
  const nodes = avatarGroup({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 14,
    fg: "surface",
    overflowFg: "warning",
    items: [
      { id: "a", name: "Ada Lovelace" },
      { id: "b", name: "Builder" },
      { id: "c", name: "Writer" },
      { id: "d", name: "Reviewer" },
      { id: "e", name: "Planner" },
    ],
  })
  expect(nodes).toHaveLength(7)
  expect(nodes[1]).toMatchObject({ fg: "surface" })
  expect(nodes[6]).toMatchObject({ x: 11, text: "+2", fg: "warning" })
  expect(avatarGroup({ anchor: "top-left", x: 0, y: 0, width: 20, items: [] })).toEqual([])
})

test("lineChart draws one text row per plot row", () => {
  const nodes = lineChart({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 14,
    height: 4,
    axis: false,
    values: [0, 10, 5, 20],
    fg: "accent",
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, fg: "accent" })
  expect(nodes[3]).toMatchObject({ y: 6 })
  for (const node of nodes) {
    expect(node.kind).toBe("text")
    if (node.kind === "text") expect(node.text).toHaveLength(14)
  }
  expect(nodes[0]!.kind === "text" ? nodes[0]!.text[3] : "").toBe("•")
})

test("lineChart labels the axis and handles empty input", () => {
  const nodes = lineChart({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    height: 3,
    values: [0, 9],
    labels: ["9", "0"],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]!.kind === "text" ? nodes[0]!.text.startsWith("  9│") : false).toBe(true)
  expect(nodes[2]!.kind === "text" ? nodes[2]!.text.startsWith("  0│") : false).toBe(true)
  expect(lineChart({ anchor: "top-left", x: 0, y: 0, width: 0, values: [1] })).toEqual([])
})

test("tagInput draws tags, the cursor and the input tail", () => {
  const nodes = tagInput({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 40,
    cursor: 1,
    input: "src/",
    tags: [
      { id: "a", label: "notes" },
      { id: "b", label: "files" },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, text: "[notes ×]", fg: "secondary" })
  expect(nodes[1]).toMatchObject({ x: 12, text: "▸[files ×]", fg: "primary" })
  expect(nodes[2]).toMatchObject({ x: 23, text: "src/▏", fg: "foreground" })
})

test("tagInput reports overflow, invalid tags and colours", () => {
  const nodes = tagInput({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    invalidFg: "warning",
    overflowFg: "accent",
    tags: [
      { id: "a", label: "notes", invalid: true },
      { id: "b", label: "files" },
    ],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ text: "[notes ×]", fg: "warning" })
  expect(nodes[1]).toMatchObject({ x: 10, text: "+1", fg: "accent" })
  expect(tagInput({ anchor: "top-left", x: 0, y: 0, width: 0, tags: [] })).toEqual([])
})

test("combobox draws filtered, selected rows", () => {
  const nodes = combobox({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 24,
    query: "",
    selected: 1,
    maxRows: 2,
    options: [
      { id: "sessions", label: "Lock-in sessions" },
      { id: "session", label: "Session settings", secondary: true, group: "sessions" },
      { id: "settings", label: "Open settings" },
    ],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 3, fg: "foreground" })
  expect(nodes[0]!.kind === "text" ? nodes[0]!.text.startsWith("  Lock-in sessions") : false).toBe(true)
  expect(nodes[1]).toMatchObject({ x: 2, y: 4, fg: "primary" })
  expect(nodes[1]!.kind === "text" ? nodes[1]!.text.startsWith("▸ Session settings") : false).toBe(true)
})

test("combobox aligns meta and filters by query", () => {
  const nodes = combobox({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    query: "alpha",
    selected: 0,
    selectedFg: "accent",
    fg: "secondary",
    options: [{ id: "a", label: "alpha", meta: "→ first" }],
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ text: "▸ alpha      → first", fg: "accent" })
  const none = combobox({ anchor: "top-left", x: 0, y: 0, width: 20, query: "zzz", options: [] })
  expect(none).toEqual([])
})

test("textField draws the prefix, caret and right-aligned suffix", () => {
  const nodes = textField({
    anchor: "top-left",
    x: 2,
    y: 1,
    width: 30,
    prefix: "> ",
    value: "unit-4",
    suffix: "scope: notes",
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 1, text: "> ", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 4, text: "unit-4▏", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 20, text: "scope: notes", fg: "muted" })
})

test("textField handles placeholders, invalid values and zero width", () => {
  const placeholder = textField({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    value: "",
    placeholder: "find a file",
    cursor: false,
  })
  expect(placeholder).toHaveLength(1)
  expect(placeholder[0]).toMatchObject({ text: "find a file", fg: "muted" })
  const invalid = textField({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    prefix: "> ",
    value: "nope",
    invalid: true,
  })
  expect(invalid[0]).toMatchObject({ fg: "error" })
  expect(invalid[1]).toMatchObject({ fg: "error" })
  expect(textField({ anchor: "top-left", x: 0, y: 0, width: 0, value: "x" })).toEqual([])
})

test("multiSelect draws checked, selected and disabled rows", () => {
  const nodes = multiSelect({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 40,
    cursor: 1,
    items: [
      { id: "a", label: "notes.md", checked: true },
      { id: "b", label: "diagram.png", checked: false, meta: "12 KB" },
      { id: "c", label: "blocked.bin", checked: false, disabled: true },
    ],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 2, fg: "success" })
  expect(nodes[0]!.kind === "text" ? nodes[0]!.text.startsWith("  [x] notes.md") : false).toBe(true)
  expect(nodes[1]).toMatchObject({ y: 3, fg: "primary" })
  expect(nodes[1]!.kind === "text" ? nodes[1]!.text.startsWith("▌ [ ] diagram.png") : false).toBe(true)
  expect(nodes[2]).toMatchObject({ y: 4, fg: "muted" })
})

test("multiSelect uses a viewport and honours overrides", () => {
  const nodes = multiSelect({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    cursor: 0,
    rows: 4,
    checkedFg: "accent",
    selectedFg: "warning",
    disabledFg: "secondary",
    items: [
      { id: "a", label: "one", checked: true },
      { id: "b", label: "two", checked: false },
      { id: "c", label: "three", checked: false },
      { id: "d", label: "four", checked: false, disabled: true },
    ],
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ y: 0, fg: "warning" })
  expect(nodes[3]).toMatchObject({ y: 3, fg: "secondary" })
  expect(multiSelect({ anchor: "top-left", x: 0, y: 0, width: 20, cursor: 0, items: [] })).toEqual([])
})

test("wizard draws numbered steps with state markers", () => {
  const nodes = wizard({
    anchor: "top-left",
    x: 2,
    y: 1,
    width: 40,
    current: 0,
    steps: [
      { id: "choose", label: "Choose" },
      { id: "review", label: "Review" },
    ],
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 1, text: "● 1 Choose", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 14, text: "○ 2 Review", fg: "muted" })
})

test("wizard marks done steps and keeps the current step visible", () => {
  const nodes = wizard({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    current: 1,
    doneFg: "success",
    currentFg: "accent",
    steps: [
      { id: "choose", label: "Choose" },
      { id: "review", label: "Review" },
    ],
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ text: "● 2 Review", fg: "accent" })
  expect(wizard({ anchor: "top-left", x: 0, y: 0, width: 40, current: 0, steps: [] })).toEqual([])
})

test("statusBanner fills a single line and right-aligns its action", () => {
  const nodes = statusBanner({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    tone: "warning",
    message: "choose a source",
    action: "Esc",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 3, width: 20, height: 1, fill: true, color: "warning" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 3, text: "! choose a sour… Esc", fg: "background" })
})

test("statusBanner honours overrides and empty widths", () => {
  const nodes = statusBanner({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    message: "done",
    tone: "success",
    bg: "panel",
    fg: "accent",
  })
  expect(nodes[0]).toMatchObject({ color: "panel" })
  expect(nodes[1]).toMatchObject({ text: "✓ done", fg: "accent" })
  expect(statusBannerText({ width: 20, message: "plain" })).toBe("· plain")
  expect(statusBanner({ anchor: "top-left", x: 0, y: 0, width: 0, message: "x" })).toEqual([])
})

test("splitButton draws both halves with keycaps and a separator", () => {
  const nodes = splitButton({
    anchor: "top-left",
    x: 2,
    y: 1,
    primary: { key: "Enter", label: "send" },
    secondary: { key: "⇧Enter", label: "newline" },
  })
  expect(nodes).toHaveLength(7)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 1, width: 7, color: "primary" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, text: "[Enter]", fg: "background" })
  expect(nodes[2]).toMatchObject({ x: 9, text: " send", fg: "foreground" })
  expect(nodes[3]).toMatchObject({ x: 14, text: "│", fg: "muted" })
  expect(nodes[4]).toMatchObject({ x: 15, width: 8, color: "line" })
  expect(nodes[5]).toMatchObject({ x: 15, text: "[⇧Enter]", fg: "foreground" })
  expect(nodes[6]).toMatchObject({ x: 23, text: " newline" })
})

test("splitButton drops the second half and honours disabled colours", () => {
  const dropped = splitButton({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    primary: { key: "Enter", label: "send" },
    secondary: { key: "⇧Enter", label: "newline" },
  })
  expect(dropped).toHaveLength(3)
  expect(splitButtonText({ primary: { key: "Enter", label: "send" } })).toBe("[Enter] send")

  const disabled = splitButton({
    anchor: "top-left",
    x: 0,
    y: 0,
    primary: { key: "Enter", label: "send" },
    secondary: { key: "⇧Enter", label: "newline" },
    disabled: true,
    disabledFg: "warning",
  })
  expect(disabled[0]).toMatchObject({ color: "line" })
  expect(disabled[1]).toMatchObject({ fg: "warning" })
})

test("countBadge fills a padded number", () => {
  const nodes = countBadge({ anchor: "top-left", x: 2, y: 1, count: 3 })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ kind: "rect", x: 2, y: 1, width: 3, height: 1, color: "primary" })
  expect(nodes[1]).toMatchObject({ kind: "text", x: 2, y: 1, text: " 3 ", fg: "background" })
})

test("countBadge overflows at the cap and honours overrides", () => {
  const nodes = countBadge({
    anchor: "top-left",
    x: 0,
    y: 0,
    count: 120,
    tone: "warning",
    bg: "panel",
    fg: "accent",
  })
  expect(nodes[0]).toMatchObject({ width: 5, color: "panel" })
  expect(nodes[1]).toMatchObject({ text: " 99+ ", fg: "accent" })
  expect(countBadge({ anchor: "top-left", x: 0, y: 0, count: 3, width: 0 })).toEqual([])
})

test("statCard draws a fitted value, label and detail", () => {
  const nodes = statCard({
    anchor: "top-left",
    x: 2,
    y: 3,
    width: 20,
    value: "14 days",
    label: "best streak",
    detail: "in a row",
    tone: "success",
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 8, y: 3, text: "14 days", fg: "success" })
  expect(nodes[1]).toMatchObject({ x: 6, y: 4, text: "best streak", fg: "muted" })
  expect(nodes[2]).toMatchObject({ x: 8, y: 5, text: "in a row", fg: "muted" })
})

test("statCard aligns and handles empty widths", () => {
  const nodes = statCard({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 20,
    value: "3",
    label: "sessions",
    align: "right",
    mutedFg: "secondary",
  })
  expect(nodes).toHaveLength(2)
  expect(nodes[0]).toMatchObject({ x: 19, fg: "foreground" })
  expect(nodes[1]).toMatchObject({ x: 12, fg: "secondary" })
  expect(statCard({ anchor: "top-left", x: 0, y: 0, width: 0, value: "x", label: "y" })).toEqual([])
})

test("matrix draws a header and toned rows", () => {
  const nodes = matrix({
    anchor: "top-left",
    x: 2,
    y: 1,
    width: 40,
    headerWidth: 11,
    rows: ["chill", "lockin"],
    columns: ["notes", "files"],
    cells: [
      ["any", "any"],
      ["explicit only", "never"],
    ],
    rowTones: ["normal", "muted"],
    notes: ["", "locked"],
  })
  expect(nodes).toHaveLength(3)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 1, fg: "muted" })
  expect(nodes[1]).toMatchObject({ x: 2, y: 2, fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 2, y: 3, fg: "muted" })
  expect(nodes[2]!.kind === "text" ? nodes[2]!.text : "").toContain("locked")
})

test("matrix can hide the header and handles empty input", () => {
  const nodes = matrix({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 40,
    showHeader: false,
    rows: ["a"],
    columns: ["b"],
    cells: [["c"]],
  })
  expect(nodes).toHaveLength(1)
  expect(nodes[0]).toMatchObject({ y: 0, text: "a  c  " })
  expect(matrix({ anchor: "top-left", x: 0, y: 0, width: 40, rows: [], columns: [], cells: [] })).toEqual([])
})

test("rangeSlider draws empty track, handles, fill and label", () => {
  const nodes = rangeSlider({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 18,
    values: [0.8, 1],
  })
  expect(nodes).toHaveLength(6)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 2, text: "──────", fg: "line" })
  expect(nodes[1]).toMatchObject({ x: 8, text: "●", fg: "primary" })
  expect(nodes[2]).toMatchObject({ x: 9, text: "━", fg: "primary" })
  expect(nodes[3]).toMatchObject({ x: 10, text: "●", fg: "primary" })
  expect(nodes[4]).toMatchObject({ x: 11, text: " " })
  expect(nodes[5]).toMatchObject({ x: 12, text: "80%–100%", fg: "muted" })
})

test("rangeSlider honours overrides and empty widths", () => {
  const nodes = rangeSlider({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 14,
    values: [0.5, 0.5],
    showLabel: false,
    emptyFg: "secondary",
    filledFg: "accent",
  })
  expect(nodes[0]).toMatchObject({ fg: "secondary" })
  expect(nodes[1]).toMatchObject({ fg: "accent" })
  expect(rangeSliderText({ width: 20, values: [0, 1] })).toContain("0%–100%")
  expect(rangeSlider({ anchor: "top-left", x: 0, y: 0, width: 0, values: [0, 1] })).toEqual([])
})

test("thresholdBar draws the fill, markers, value and label", () => {
  const nodes = thresholdBar({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 30,
    value: 4.8,
    min: 1,
    max: 21,
    markers: [{ value: 4.5 }, { value: 7 }],
    label: "4.8:1 AA pass",
  })
  expect(nodes).toHaveLength(7)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 2, text: "███", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 5, text: "●", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 6, text: "░", fg: "line" })
  expect(nodes[3]).toMatchObject({ x: 7, text: "┊", fg: "muted" })
  expect(nodes[4]).toMatchObject({ x: 8, text: "░░░░░░░░░░", fg: "line" })
  expect(nodes[5]).toMatchObject({ x: 18, text: " " })
  expect(nodes[6]).toMatchObject({ x: 19, text: "4.8:1 AA pass", fg: "muted" })
})

test("thresholdBar honours overrides and empty widths", () => {
  const nodes = thresholdBar({
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 12,
    value: 99,
    min: 0,
    max: 10,
    showLabel: false,
    filledFg: "accent",
    valueFg: "warning",
    markerFg: "secondary",
    markers: [{ value: 2 }],
  })
  expect(nodes[0]).toMatchObject({ fg: "accent" })
  expect(nodes.some((node) => node.kind === "text" && node.fg === "warning")).toBe(true)
  expect(nodes.some((node) => node.kind === "text" && node.fg === "secondary")).toBe(true)
  expect(thresholdBarText({ width: 20, value: 0.5, label: "half" })).toContain("half")
  expect(thresholdBar({ anchor: "top-left", x: 0, y: 0, width: 0, value: 0 })).toEqual([])
})

test("numberStepper draws minus, value and plus segments", () => {
  const nodes = numberStepper({
    anchor: "top-left",
    x: 2,
    y: 2,
    width: 12,
    value: 5,
    min: 0,
    max: 10,
    text: "$5.00",
  })
  expect(nodes).toHaveLength(4)
  expect(nodes[0]).toMatchObject({ kind: "text", x: 2, y: 2, text: "− ", fg: "primary" })
  expect(nodes[1]).toMatchObject({ x: 4, text: "$5.00", fg: "foreground" })
  expect(nodes[2]).toMatchObject({ x: 9, text: "    " })
  expect(nodes[3]).toMatchObject({ x: 13, text: "+", fg: "primary" })
})

test("numberStepper mutes controls at limits and honours overrides", () => {
  const low = numberStepper({
    anchor: "top-left",
    x: 0,
    y: 0,
    value: 0,
    min: 0,
    max: 10,
    controlFg: "accent",
    valueFg: "warning",
    disabledFg: "secondary",
  })
  expect(low[0]).toMatchObject({ fg: "secondary" })
  expect(low[1]).toMatchObject({ fg: "warning" })
  const disabled = numberStepper({
    anchor: "top-left",
    x: 0,
    y: 0,
    value: 5,
    disabled: true,
  })
  expect(disabled[0]).toMatchObject({ fg: "muted" })
  expect(numberStepperText({ value: 5, precision: 1 })).toBe("− 5.0 +")
  expect(numberStepper({ anchor: "top-left", x: 0, y: 0, width: 0, value: 1 })).toEqual([])
})

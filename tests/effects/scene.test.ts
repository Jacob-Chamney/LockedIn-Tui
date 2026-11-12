import { expect, test } from "bun:test"
import { RGBA, type OptimizedBuffer } from "@opentui/core"

import { crimson } from "../../src/ui/theme/palettes"
import { paintScene } from "../../src/ui/effects/scene/paint"
import { rasterizeShapeImage } from "../../src/ui/effects/scene/image"
import {
  collectFocusIds,
  DEFAULT_SCENE_BUDGET,
  SCENE_ANCHORS,
  resolveAnchor,
  sanitizeScene,
  sanitizeSceneText,
  type SceneNode,
} from "../../src/ui/effects/scene/model"

type Cell = { char: string; fg: RGBA; bg: RGBA }

function mockBuffer(width: number, height: number): { buffer: OptimizedBuffer; cells: Map<string, Cell> } {
  const cells = new Map<string, Cell>()
  const buffer = {
    width,
    height,
    fillRect(x: number, y: number, w: number, h: number, bg: RGBA) {
      for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) cells.set(`${col},${row}`, { char: " ", fg: bg, bg })
      }
    },
    setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA) {
      cells.set(`${x},${y}`, { char, fg, bg })
    },
    drawText(text: string, x: number, y: number, fg: RGBA, bg?: RGBA) {
      let at = x
      for (const char of text) {
        const previous = cells.get(`${at},${y}`)
        cells.set(`${at},${y}`, { char, fg, bg: bg ?? previous?.bg ?? fg })
        at += 1
      }
    },
  } as unknown as OptimizedBuffer
  return { buffer, cells }
}

test("anchors resolve from the edge with inward offsets", () => {
  const viewport = { width: 40, height: 12 }
  expect(resolveAnchor("top-left", 1, 2, 10, 3, viewport)).toEqual({ left: 1, top: 2 })
  expect(resolveAnchor("top-right", 1, 2, 10, 3, viewport)).toEqual({ left: 29, top: 2 })
  expect(resolveAnchor("bottom-left", 1, 2, 10, 3, viewport)).toEqual({ left: 1, top: 7 })
  expect(resolveAnchor("bottom-right", 1, 2, 10, 3, viewport)).toEqual({ left: 29, top: 7 })
  expect(resolveAnchor("top-center", 0, 0, 10, 3, viewport)).toEqual({ left: 15, top: 0 })
  expect(resolveAnchor("bottom-center", 0, 0, 10, 1, viewport)).toEqual({ left: 15, top: 11 })
})

test("the sanitizer strips injection and respects the budgets", () => {
  expect(sanitizeSceneText("he\u001b[31mllo\u202e")).toBe("hello")
  expect(sanitizeSceneText("a\u0000b\nc")).toBe("a b c")
  // Plain spaces are layout, not noise: aligned columns keep their padding.
  expect(sanitizeSceneText("name    time   state")).toBe("name    time   state")
  expect(sanitizeSceneText("\tname\t\ttime")).toBe("name  time")
  const result = sanitizeScene(
    [
      { kind: "text", anchor: "bottom-left", x: 0, y: 0, text: "not granted" },
      { kind: "text", anchor: "top-left", x: 0, y: 0, text: "one" },
      { kind: "text", anchor: "top-left", x: 0, y: 1, text: "two" },
      { kind: "text", anchor: "top-left", x: 0, y: 2, text: "three" },
      { kind: "box", anchor: "top-right", x: 0, y: 0, width: 10, height: 3 },
    ],
    { ...DEFAULT_SCENE_BUDGET, maxNodes: 2, maxText: 20 },
    ["top-left", "top-right"],
    { width: 40, height: 12 },
  )
  expect(result.nodes).toHaveLength(2)
  expect(result.dropped).toBeGreaterThan(0)
  expect(result.issues.join(" ")).toContain("budget")
  expect(result.issues.some((issue) => issue.includes("not granted"))).toBe(true)
})

test("a box paints its corners, fill and title at the anchored cell", () => {
  const { buffer, cells } = mockBuffer(40, 12)
  const nodes: SceneNode[] = [
    { kind: "box", anchor: "top-right", x: 0, y: 0, width: 10, height: 3, title: "hi" },
  ]
  paintScene(buffer, nodes, crimson)
  expect(cells.get("30,0")?.char).toBe("╭")
  expect(cells.get("39,0")?.char).toBe("╮")
  expect(cells.get("30,2")?.char).toBe("╰")
  expect(cells.get("39,2")?.char).toBe("╯")
  expect(cells.get("31,0")?.char).toBe("─")
  expect(cells.get("32,0")?.char).toBe("h")
  expect(cells.get("33,0")?.char).toBe("i")
  expect(cells.get("31,1")?.char).toBe(" ")
})

test("text and rules paint at their anchored cells", () => {
  const { buffer, cells } = mockBuffer(40, 12)
  paintScene(
    buffer,
    [
      { kind: "text", anchor: "bottom-right", x: 1, y: 0, text: "12:34" },
      { kind: "rule", anchor: "top-left", x: 2, y: 1, width: 4 },
      { kind: "rule", anchor: "top-left", x: 0, y: 0, width: 3, vertical: true },
    ],
    crimson,
  )
  expect(cells.get("34,11")?.char).toBe("1")
  expect(cells.get("38,11")?.char).toBe("4")
  expect(cells.get("2,1")?.char).toBe("─")
  expect(cells.get("5,1")?.char).toBe("─")
  expect(cells.get("6,1")).toBeUndefined()
  expect(cells.get("0,0")?.char).toBe("│")
  expect(cells.get("0,2")?.char).toBe("│")
})

test("a box stays inside the viewport when the offset is too large", () => {
  const { buffer, cells } = mockBuffer(20, 6)
  paintScene(
    buffer,
    [{ kind: "box", anchor: "bottom-right", x: 99, y: 99, width: 8, height: 2 }],
    crimson,
  )
  // resolveAnchor clamps to 0, so the box lands at the top-left rather than off-screen.
  expect(cells.get("0,0")?.char).toBe("╭")
})

test("absolute placement needs its own grant", () => {
  const node = { kind: "box", anchor: "absolute", x: 5, y: 3, width: 4, height: 2 }
  const denied = sanitizeScene([node], DEFAULT_SCENE_BUDGET, ["top-left"], { width: 40, height: 12 }, false)
  expect(denied.nodes).toEqual([])
  expect(denied.issues.join(" ")).toContain("absolute")
  const allowed = sanitizeScene([node], DEFAULT_SCENE_BUDGET, [], { width: 40, height: 12 }, true)
  expect(allowed.nodes[0]).toMatchObject({ anchor: "absolute", x: 5, y: 3 })
})

test("an absolute box paints at its exact cell", () => {
  const { buffer, cells } = mockBuffer(20, 6)
  paintScene(buffer, [{ kind: "box", anchor: "absolute", x: 5, y: 2, width: 6, height: 3 }], crimson)
  expect(cells.get("5,2")?.char).toBe("╭")
  expect(cells.get("10,2")?.char).toBe("╮")
  expect(cells.get("5,4")?.char).toBe("╰")
  expect(cells.get("10,4")?.char).toBe("╯")
})

test("an absolute box clips at the viewport edge without drawing a border there", () => {
  const { buffer, cells } = mockBuffer(20, 6)
  paintScene(
    buffer,
    [{ kind: "box", anchor: "absolute", x: 15, y: 1, width: 10, height: 3 }],
    crimson,
  )
  expect(cells.get("15,1")?.char).toBe("╭")
  expect(cells.get("19,1")?.char).not.toBe("╮")
  expect(cells.get("19,1")?.char).toBe("─")
})

test("an absolute text node is clipped at the right edge", () => {
  const { buffer, cells } = mockBuffer(10, 4)
  paintScene(buffer, [{ kind: "text", anchor: "absolute", x: 7, y: 1, text: "abcdef" }], crimson)
  expect(cells.get("7,1")?.char).toBe("a")
  expect(cells.get("9,1")?.char).toBe("c")
  expect(cells.get("10,1")).toBeUndefined()
})

test("primitive shapes are validated and clamped", () => {
  const viewport = { width: 40, height: 12 }
  const result = sanitizeScene(
    [
      { kind: "circle", anchor: "top-left", x: 0, y: 0, radius: 100 },
      { kind: "rect", anchor: "top-left", x: 0, y: 0, width: 8, height: 6, radius: 100 },
      { kind: "triangle", anchor: "top-left", x: 0, y: 0, width: 6, height: 4, direction: "left" },
      {
        kind: "polygon",
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 8,
        height: 6,
        points: [4, 0, 8, 3, 4, 6, 0, 3],
      },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    viewport,
  )
  expect(result.dropped).toBe(0)
  expect(result.nodes).toHaveLength(4)
  const circle = result.nodes[0]!
  if (circle.kind !== "circle") throw new Error("expected circle")
  expect(circle.radius).toBe(6)
  const rect = result.nodes[1]!
  if (rect.kind !== "rect") throw new Error("expected rect")
  expect(rect.radius).toBe(3)
  const polygon = result.nodes[3]!
  if (polygon.kind !== "polygon") throw new Error("expected polygon")
  expect(polygon.points).toEqual([4, 0, 8, 3, 4, 6, 0, 3])
})

test("bad shape geometry is dropped", () => {
  const viewport = { width: 40, height: 12 }
  const result = sanitizeScene(
    [
      { kind: "triangle", anchor: "top-left", x: 0, y: 0, width: 4, height: 4, direction: "sideways" },
      { kind: "polygon", anchor: "top-left", x: 0, y: 0, width: 4, height: 4, points: [0, 0, 1, 1] },
      { kind: "polygon", anchor: "top-left", x: 0, y: 0, width: 4, height: 4, points: [0, 0, 1, "x", 2, 2] },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    viewport,
  )
  expect(result.nodes).toHaveLength(0)
  expect(result.dropped).toBe(3)
})

test("a filled circle uses a solid centre and dotted edges", () => {
  const { buffer, cells } = mockBuffer(20, 12)
  paintScene(
    buffer,
    [{ kind: "circle", anchor: "absolute", x: 2, y: 1, radius: 4, fill: true }],
    crimson,
  )
  // Radius 4: box 8x8 at (2,1); the centre cell is fully inside.
  expect(cells.get("5,4")?.char).toBe("█")
  // The corner is partial coverage: a Braille glyph or nothing, never a block.
  const corner = cells.get("2,1")?.char
  expect(corner === undefined || corner.codePointAt(0)! >= 0x2800).toBe(true)
})

test("a border-only circle leaves the middle empty", () => {
  const { buffer, cells } = mockBuffer(20, 12)
  paintScene(
    buffer,
    [{ kind: "circle", anchor: "absolute", x: 2, y: 1, radius: 4, fill: false, border: true }],
    crimson,
  )
  expect(cells.get("5,4")).toBeUndefined()
  const edge = cells.get("5,1")?.char ?? ""
  expect(edge.codePointAt(0)!).toBeGreaterThanOrEqual(0x2800)
})

test("a corner radius rounds a square", () => {
  const sharp = mockBuffer(20, 12)
  paintScene(
    sharp.buffer,
    [{ kind: "rect", anchor: "absolute", x: 1, y: 1, width: 8, height: 6, radius: 0, fill: true }],
    crimson,
  )
  expect(sharp.cells.get("1,1")?.char).toBe("█")

  const rounded = mockBuffer(20, 12)
  paintScene(
    rounded.buffer,
    [{ kind: "rect", anchor: "absolute", x: 1, y: 1, width: 8, height: 6, radius: 3, fill: true }],
    crimson,
  )
  // The corner cell is no longer fully covered (or is not drawn at all).
  expect(rounded.cells.get("1,1")?.char ?? "").not.toBe("█")
  // The middle is still solid.
  expect(rounded.cells.get("4,3")?.char).toBe("█")
})

test("triangles and polygons rasterise inside their bounds", () => {
  const triangle = mockBuffer(20, 12)
  paintScene(
    triangle.buffer,
    [{ kind: "triangle", anchor: "absolute", x: 1, y: 1, width: 8, height: 6, direction: "up", fill: true }],
    crimson,
  )
  expect(triangle.cells.get("1,1")).toBeUndefined()
  expect(triangle.cells.get("4,6")?.char).toBe("█")

  const diamond = mockBuffer(20, 12)
  paintScene(
    diamond.buffer,
    [
      {
        kind: "polygon",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 8,
        height: 6,
        points: [4, 0, 8, 3, 4, 6, 0, 3],
        fill: true,
      },
    ],
    crimson,
  )
  expect(diamond.cells.get("5,4")?.char).toBe("█")
  expect(diamond.cells.get("1,1")).toBeUndefined()
})

test("a ring and a partial arc draw their angle range", () => {
  const ring = mockBuffer(20, 14)
  paintScene(
    ring.buffer,
    [{ kind: "arc", anchor: "absolute", x: 2, y: 1, width: 10, height: 10, thickness: 1 }],
    crimson,
  )
  // The middle of a ring is empty.
  expect(ring.cells.get("7,6")).toBeUndefined()
  // The top of the ring is drawn.
  expect(ring.cells.get("7,1")).toBeDefined()

  const half = mockBuffer(20, 14)
  paintScene(
    half.buffer,
    [
      {
        kind: "arc",
        anchor: "absolute",
        x: 2,
        y: 1,
        width: 10,
        height: 10,
        start: -90,
        value: 0.5,
        thickness: 1,
      },
    ],
    crimson,
  )
  // A half arc from the top sweeps the right side; the left is untouched.
  expect(half.cells.get("11,6")).toBeDefined()
  expect(half.cells.get("2,6")).toBeUndefined()
})

test("lines and paths rasterise along their segments", () => {
  const line = mockBuffer(20, 14)
  paintScene(
    line.buffer,
    [
      {
        kind: "line",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 10,
        height: 10,
        x1: 0,
        y1: 0,
        x2: 9,
        y2: 9,
        thickness: 0.6,
      },
    ],
    crimson,
  )
  expect(line.cells.get("5,5")).toBeDefined()
  expect(line.cells.get("1,10")).toBeUndefined()

  const path = mockBuffer(20, 14)
  paintScene(
    path.buffer,
    [
      {
        kind: "path",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 12,
        height: 8,
        points: [0, 8, 6, 0, 12, 8],
        thickness: 0.6,
      },
    ],
    crimson,
  )
  expect(path.cells.get("4,5")).toBeDefined() // on the rising segment
  expect(path.cells.get("1,8")).toBeDefined() // near the left foot
})

test("a progress bar fills a fraction and keeps a visible track", () => {
  const { buffer, cells } = mockBuffer(30, 8)
  paintScene(
    buffer,
    [
      {
        kind: "progress",
        anchor: "absolute",
        x: 2,
        y: 2,
        width: 20,
        height: 3,
        value: 0.5,
        radius: 1,
        color: "success",
        track: "line",
      },
    ],
    crimson,
  )
  const filled = cells.get("6,3")
  const track = cells.get("18,3")
  expect(filled).toBeDefined()
  expect(track).toBeDefined()
  expect(filled!.fg.toInts()).not.toEqual(track!.fg.toInts())
})

test("arc, line, path and progress geometry is validated", () => {
  const result = sanitizeScene(
    [
      { kind: "arc", anchor: "top-left", x: 0, y: 0, width: 10, height: 10, value: 3 },
      { kind: "line", anchor: "top-left", x: 0, y: 0, width: 4, height: 4, x1: -99, y1: 99, x2: 2, y2: 2 },
      { kind: "path", anchor: "top-left", x: 0, y: 0, width: 4, height: 4, points: [0, 0, 4, 4] },
      { kind: "progress", anchor: "top-left", x: 0, y: 0, width: 10, height: 2, value: 5, radius: 99 },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  expect(result.dropped).toBe(0)
  const arc = result.nodes[0]!
  if (arc.kind !== "arc") throw new Error("expected arc")
  expect(arc.value).toBe(1)
  expect(arc.sweep).toBe(360)
  const line = result.nodes[1]!
  if (line.kind !== "line") throw new Error("expected line")
  expect(line.x1).toBe(-1)
  expect(line.y1).toBe(5)
  const progress = result.nodes[3]!
  if (progress.kind !== "progress") throw new Error("expected progress")
  expect(progress.value).toBe(1)
  expect(progress.radius).toBe(1)
})

test("groups place children in their content box and clip them", () => {
  const { buffer, cells } = mockBuffer(30, 14)
  paintScene(
    buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 2,
        y: 2,
        width: 20,
        height: 8,
        border: true,
        padding: 1,
        bg: "surface",
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "hello" },
          { kind: "text", anchor: "top-left", x: 0, y: 2, text: "x".repeat(40) },
        ],
      },
    ],
    crimson,
  )
  // Border at (2,2); content starts at (4,4) after border + padding.
  expect(cells.get("2,2")?.char).toBe("╭")
  expect(cells.get("4,4")?.char).toBe("h")
  // The long line stops at the content clip, inside the frame.
  expect(cells.get("4,6")?.char).toBe("x")
  // The text stops at the content clip; the frame's right border survives.
  expect(cells.get("19,6")?.char).toBe("x")
  expect(cells.get("21,6")?.char).toBe("│")
})

test("nested groups compose their offsets", () => {
  const { buffer, cells } = mockBuffer(30, 14)
  paintScene(
    buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 24,
        height: 10,
        padding: 1,
        nodes: [
          {
            kind: "group",
            anchor: "top-left",
            x: 2,
            y: 1,
            width: 12,
            height: 5,
            padding: 1,
            nodes: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "deep" }],
          },
        ],
      },
    ],
    crimson,
  )
  // Outer content (2,2) + inner box (2,1) + padding 1 = (5,4).
  expect(cells.get("5,4")?.char).toBe("d")
})

test("group children share the node and text budgets", () => {
  const result = sanitizeScene(
    [
      {
        kind: "group",
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 20,
        height: 8,
        padding: 1,
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "one" },
          { kind: "text", anchor: "top-left", x: 0, y: 1, text: "two" },
          { kind: "text", anchor: "top-left", x: 0, y: 2, text: "three" },
        ],
      },
    ],
    { ...DEFAULT_SCENE_BUDGET, maxNodes: 3, maxText: 40 },
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  const group = result.nodes[0]!
  if (group.kind !== "group") throw new Error("expected group")
  expect(group.nodes).toHaveLength(2)
  expect(result.dropped).toBeGreaterThan(0)
  expect(result.issues.join(" ")).toContain("budget")
})

test("group nesting is capped", () => {
  const leaf = [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "leaf" }]
  const level = (nodes: unknown[]) => ({
    kind: "group",
    anchor: "top-left",
    x: 0,
    y: 0,
    width: 18,
    height: 10,
    padding: 1,
    nodes,
  })
  const result = sanitizeScene(
    [level([level([level([level(leaf)])])])],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  const walk = (node: unknown): number => {
    if (typeof node !== "object" || node === null || (node as { kind?: string }).kind !== "group") return 0
    const group = node as { nodes: unknown[] }
    return 1 + Math.max(0, ...group.nodes.map(walk))
  }
  expect(walk(result.nodes[0])).toBeLessThanOrEqual(5)
})

test("the image backend rasterises a shape with antialiased alpha", () => {
  const pixels = rasterizeShapeImage(
    { kind: "circle", anchor: "absolute", x: 0, y: 0, radius: 4 },
    40,
    40,
    crimson,
  )
  const alpha = (x: number, y: number) => pixels[(y * 40 + x) * 4 + 3]
  expect(alpha(20, 20)).toBe(255)
  expect(alpha(0, 0)).toBe(0)
  let partial = 0
  for (let index = 3; index < pixels.length; index += 4) {
    const value = pixels[index]!
    if (value > 0 && value < 255) partial += 1
  }
  expect(partial).toBeGreaterThan(0)
})

test("column and row layouts stack children with a gap", () => {
  const column = mockBuffer(30, 16)
  paintScene(
    column.buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 20,
        height: 14,
        layout: "column",
        gap: 1,
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "one" },
          { kind: "rect", anchor: "top-left", x: 0, y: 0, width: 4, height: 2, fill: true, color: "accent" },
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "three" },
        ],
      },
    ],
    crimson,
  )
  expect(column.cells.get("1,1")?.char).toBe("o")
  expect(column.cells.get("1,3")?.char).toBe("█")
  expect(column.cells.get("1,6")?.char).toBe("t")

  const row = mockBuffer(30, 16)
  paintScene(
    row.buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 20,
        height: 6,
        layout: "row",
        gap: 1,
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "ab" },
          { kind: "rect", anchor: "top-left", x: 0, y: 0, width: 3, height: 2, fill: true, color: "accent" },
        ],
      },
    ],
    crimson,
  )
  expect(row.cells.get("1,1")?.char).toBe("a")
  expect(row.cells.get("4,1")?.char).toBe("█")
})

test("window titles can be centred or right-aligned", () => {
  const centre = mockBuffer(30, 10)
  paintScene(
    centre.buffer,
    [{ kind: "box", anchor: "absolute", x: 1, y: 1, width: 12, height: 4, title: "hi", titleAlign: "center" }],
    crimson,
  )
  expect(centre.cells.get("6,1")?.char).toBe("h")
  expect(centre.cells.get("7,1")?.char).toBe("i")

  const right = mockBuffer(30, 10)
  paintScene(
    right.buffer,
    [{ kind: "box", anchor: "absolute", x: 1, y: 1, width: 12, height: 4, title: "hi", titleAlign: "right" }],
    crimson,
  )
  expect(right.cells.get("9,1")?.char).toBe("h")
  expect(right.cells.get("10,1")?.char).toBe("i")
})

test("group layout fields are validated and clamped", () => {
  const result = sanitizeScene(
    [
      {
        kind: "group",
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 20,
        height: 8,
        layout: "column",
        gap: 99,
        align: "center",
        borderStyle: "double",
        titleAlign: "center",
        nodes: [],
      },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  const group = result.nodes[0]!
  if (group.kind !== "group") throw new Error("expected group")
  expect(group.layout).toBe("column")
  expect(group.gap).toBe(10)
  expect(group.titleAlign).toBe("center")
  expect(group.align).toBe("center")
  expect(group.borderStyle).toBe("double")
})

test("shapes rotate around their box centre", () => {
  const flat = mockBuffer(20, 14)
  paintScene(
    flat.buffer,
    [{ kind: "line", anchor: "absolute", x: 1, y: 1, width: 10, height: 10, x1: 0, y1: 5, x2: 10, y2: 5, thickness: 0.8 }],
    crimson,
  )
  expect(flat.cells.get("3,6")).toBeDefined()
  expect(flat.cells.get("6,3")).toBeUndefined()

  const spun = mockBuffer(20, 14)
  paintScene(
    spun.buffer,
    [
      {
        kind: "line",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 10,
        height: 10,
        x1: 0,
        y1: 5,
        x2: 10,
        y2: 5,
        thickness: 0.8,
        rotation: 90,
      },
    ],
    crimson,
  )
  expect(spun.cells.get("6,3")).toBeDefined()
  expect(spun.cells.get("3,6")).toBeUndefined()
})

test("stacked children can be centred on the cross axis", () => {
  const { buffer, cells } = mockBuffer(30, 14)
  paintScene(
    buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 20,
        height: 10,
        layout: "column",
        align: "center",
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "ab" },
          { kind: "rect", anchor: "top-left", x: 0, y: 0, width: 6, height: 2, fill: true, color: "accent" },
        ],
      },
    ],
    crimson,
  )
  expect(cells.get("10,1")?.char).toBe("a")
  expect(cells.get("8,2")?.char).toBe("█")
})

test("windows can use single or double borders", () => {
  const single = mockBuffer(20, 8)
  paintScene(
    single.buffer,
    [{ kind: "box", anchor: "absolute", x: 1, y: 1, width: 10, height: 4, borderStyle: "single" }],
    crimson,
  )
  expect(single.cells.get("1,1")?.char).toBe("┌")

  const double = mockBuffer(20, 8)
  paintScene(
    double.buffer,
    [{ kind: "box", anchor: "absolute", x: 1, y: 1, width: 10, height: 4, borderStyle: "double" }],
    crimson,
  )
  expect(double.cells.get("1,1")?.char).toBe("╔")
  expect(double.cells.get("2,1")?.char).toBe("═")
  expect(double.cells.get("1,2")?.char).toBe("║")
})

test("a group scroll shifts its content and clips the overflow", () => {
  const { buffer, cells } = mockBuffer(30, 14)
  paintScene(
    buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 20,
        height: 8,
        clip: true,
        scroll: 2,
        nodes: [
          { kind: "text", anchor: "top-left", x: 0, y: 0, text: "top" },
          { kind: "text", anchor: "top-left", x: 0, y: 3, text: "three" },
        ],
      },
    ],
    crimson,
  )
  // "top" moves above the clipped group; "three" lands at y=2.
  expect(cells.get("1,2")?.char).toBe("t")
  const topRow = [...cells.entries()]
    .filter(([key]) => key.endsWith(",1"))
    .map(([, cell]) => cell.char)
    .join("")
  expect(topRow).not.toContain("top")
})

test("the image backend can fill its box with the enclosing background", () => {
  const pixels = rasterizeShapeImage(
    { kind: "circle", anchor: "absolute", x: 0, y: 0, radius: 4 },
    20,
    20,
    crimson,
    "surface",
  )
  // A corner is background, fully opaque, with the surface colour.
  const index = 0
  expect(pixels[index + 3]).toBe(255)
  const surface = crimson.surface
  expect(pixels[index]).toBe(Number.parseInt(surface.slice(1, 3), 16))
  expect(pixels[index + 1]).toBe(Number.parseInt(surface.slice(3, 5), 16))
  expect(pixels[index + 2]).toBe(Number.parseInt(surface.slice(5, 7), 16))
})

test("focusable window ids are collected in declaration order", () => {
  const result = sanitizeScene(
    [
      {
        kind: "group",
        id: "main",
        focusable: true,
        anchor: "top-left",
        x: 0,
        y: 0,
        width: 20,
        height: 10,
        nodes: [
          {
            kind: "group",
            id: "inner",
            focusable: true,
            anchor: "top-left",
            x: 0,
            y: 0,
            width: 10,
            height: 5,
            nodes: [],
          },
        ],
      },
      { kind: "group", id: "plain", anchor: "top-left", x: 0, y: 0, width: 10, height: 5, nodes: [] },
      { kind: "group", focusable: true, anchor: "top-left", x: 0, y: 0, width: 10, height: 5, nodes: [] },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  expect(collectFocusIds(result.nodes)).toEqual(["main", "inner"])
})

test("window ids are validated and only id groups can be focusable", () => {
  const result = sanitizeScene(
    [
      { kind: "group", id: "Bad Id", focusable: true, anchor: "top-left", x: 0, y: 0, width: 5, height: 5, nodes: [] },
      { kind: "group", id: "ok", focusable: true, anchor: "top-left", x: 0, y: 0, width: 5, height: 5, nodes: [] },
    ],
    DEFAULT_SCENE_BUDGET,
    [...SCENE_ANCHORS],
    { width: 40, height: 12 },
  )
  const [bad, good] = result.nodes
  if (bad!.kind !== "group" || good!.kind !== "group") throw new Error("expected groups")
  expect(bad.id).toBeUndefined()
  expect(bad.focusable).toBeUndefined()
  expect(good.id).toBe("ok")
  expect(good.focusable).toBe(true)
})

test("text without a bg keeps the panel behind it and an explicit bg wins", () => {
  const { buffer, cells } = mockBuffer(24, 8)
  paintScene(
    buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 18,
        height: 5,
        bg: "surface",
        nodes: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "hi" }],
      },
    ],
    crimson,
  )
  const cell = cells.get("1,1")
  expect(cell?.char).toBe("h")
  // Not the global background: the enclosing panel colour survives.
  expect(cell?.bg.toInts()).toEqual(RGBA.fromHex(crimson.surface).toInts())

  const explicit = mockBuffer(24, 8)
  paintScene(
    explicit.buffer,
    [
      {
        kind: "group",
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 18,
        height: 5,
        bg: "surface",
        nodes: [{ kind: "text", anchor: "top-left", x: 0, y: 0, text: "hi", bg: "accent" }],
      },
    ],
    crimson,
  )
  expect(explicit.cells.get("1,1")?.bg.toInts()).toEqual(RGBA.fromHex(crimson.accent).toInts())
})

test("painting collects hit regions with their enclosing window", () => {
  const { buffer } = mockBuffer(30, 12)
  const hits: import("../../src/ui/effects/scene/paint").SceneHitRegion[] = []
  paintScene(
    buffer,
    [
      {
        kind: "group",
        id: "panel",
        focusable: true,
        anchor: "absolute",
        x: 1,
        y: 1,
        width: 12,
        height: 6,
        nodes: [
          { kind: "hit", anchor: "absolute", x: 2, y: 2, width: 4, height: 1, row: 1, column: 2 },
          { kind: "hit", anchor: "absolute", x: 8, y: 2, width: 2, height: 2, id: "note" },
        ],
      },
    ],
    crimson,
    undefined,
    hits,
  )
  expect(hits).toHaveLength(3)
  expect(hits[0]).toMatchObject({ left: 1, top: 1, right: 13, bottom: 7, window: "panel" })
  expect(hits[1]).toMatchObject({
    left: 3,
    top: 3,
    right: 7,
    bottom: 4,
    window: "panel",
    row: 1,
    column: 2,
  })
  expect(hits[2]).toMatchObject({ left: 9, top: 3, right: 11, bottom: 5, window: "panel", id: "note" })

})

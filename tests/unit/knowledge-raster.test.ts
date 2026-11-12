/** The pixel renderer: real anti-aliased nodes, themed from the palette only. */
import { describe, expect, test } from "bun:test"

import { buildScene, project } from "../../src/ui/knowledge/scene"
import { cameraKey, hexRgba, labelPoints, renderScene } from "../../src/ui/knowledge/raster"
import { noteId, topicId, buildTopics, type KnowledgeGraph } from "../../src/services/knowledge/graph"
import { crimson } from "../../src/ui/theme"

const NOTES = [
  {
    id: noteId("skills", "knowledge/coding/cpp/vector.md"),
    section: "skills" as const,
    path: "knowledge/coding/cpp/vector.md",
    title: "Smart vector growth",
    kind: "concept",
    topics: ["Coding/C++"],
    tags: [],
    updated: 0,
    body: "",
  },
  {
    id: noteId("skills", "knowledge/coding/lua/tables.md"),
    section: "skills" as const,
    path: "knowledge/coding/lua/tables.md",
    title: "Lua tables",
    kind: "concept",
    topics: ["Coding/Lua"],
    tags: [],
    updated: 0,
    body: "",
  },
]

const GRAPH: KnowledgeGraph = {
  topics: buildTopics(NOTES),
  notes: NOTES,
  edges: [{ from: NOTES[0]!.id, to: NOTES[1]!.id }],
  diagnostics: [],
}

describe("pixels", () => {
  test("hex colours become RGBA and an invalid value is black, not a crash", () => {
    expect(hexRgba("#ff8000")).toEqual({ r: 255, g: 128, b: 0, a: 255 })
    expect(hexRgba("#ff8000", 40).a).toBe(40)
    expect(hexRgba("nope")).toEqual({ r: 0, g: 0, b: 0, a: 255 })
  })

  test("a frame has one RGBA pixel per point and starts on the theme background", () => {
    const scene = buildScene(GRAPH, NOTES[0]!.id, 160, 96)
    const frame = renderScene(scene, 160, 96, crimson)
    expect(frame).toHaveLength(160 * 96 * 4)
    const background = hexRgba(crimson.background)
    expect([...frame.slice(0, 4)]).toEqual([background.r, background.g, background.b, 255])
    const last = frame.length - 4
    expect([...frame.slice(last, last + 4)]).toEqual([background.r, background.g, background.b, 255])
  })

  test("a caller can reuse the pixel buffer without changing the frame", () => {
    const scene = buildScene(GRAPH, NOTES[0]!.id, 160, 96)
    const buffer = new Uint8Array(160 * 96 * 4)
    const first = renderScene(scene, 160, 96, crimson, buffer)
    expect(first).toBe(buffer)
    const copy = new Uint8Array(first)
    const second = renderScene(scene, 160, 96, crimson, buffer)
    expect(second).toBe(buffer)
    expect([...second]).toEqual([...copy])
  })

  test("the focused node paints a non-background pixel at its projected centre", () => {
    const scene = buildScene(GRAPH, NOTES[0]!.id, 160, 96)
    const node = scene.nodes.find((entry) => entry.id === NOTES[0]!.id)!
    const point = project(node, scene.camera, 160, 96)
    const frame = renderScene(scene, 160, 96, crimson)
    const at = (Math.round(point.y) * 160 + Math.round(point.x)) * 4
    const background = hexRgba(crimson.background)
    expect([frame[at], frame[at + 1], frame[at + 2]]).not.toEqual([
      background.r,
      background.g,
      background.b,
    ])
  })

  test("labels stay inside the window and the focused node is present", () => {
    const scene = buildScene(GRAPH, NOTES[0]!.id, 640, 384)
    const labels = labelPoints(scene, 80, 24, 640, 384)
    expect(labels.length).toBe(scene.nodes.length)
    for (const label of labels) {
      expect(label.x).toBeGreaterThanOrEqual(-1)
      expect(label.x).toBeLessThanOrEqual(81)
      expect(label.y).toBeGreaterThanOrEqual(-1)
      expect(label.y).toBeLessThanOrEqual(25)
    }
    expect(labels.some((label) => label.focused)).toBe(true)
  })

  test("camera keys change only when the camera moves", () => {
    const first = buildScene(GRAPH, NOTES[0]!.id, 640, 384)
    const second = buildScene(GRAPH, NOTES[1]!.id, 640, 384)
    expect(cameraKey(first.camera)).not.toBe(cameraKey(second.camera))
    expect(cameraKey(first.camera)).toBe(cameraKey(buildScene(GRAPH, NOTES[0]!.id, 640, 384).camera))
  })

  test("a celestial star paints a core and diffraction rays", () => {
    const scene = {
      nodes: [
        {
          id: "star",
          label: "",
          kind: "note" as const,
          x: 0,
          y: 0,
          z: 0,
          radius: 5,
          shape: "star" as const,
          tone: "success" as const,
          weight: 1,
        },
      ],
      edges: [],
      camera: { x: 0, y: 0, z: 0, distance: 760, fov: 760, yaw: 0, pitch: 0 },
      focusId: "star",
      near: new Set(["star"]),
      truncated: 0,
    }
    const frame = renderScene(scene, 160, 96, crimson)
    const point = project(scene.nodes[0]!, scene.camera, 160, 96)
    const pixel = (x: number, y: number) => {
      const at = (Math.round(y) * 160 + Math.round(x)) * 4
      return [frame[at], frame[at + 1], frame[at + 2]] as const
    }
    const background = hexRgba(crimson.background)
    expect(pixel(point.x, point.y)).not.toEqual([background.r, background.g, background.b])
    expect(pixel(point.x + 10, point.y)).not.toEqual([background.r, background.g, background.b])
  })

  test("every scene node id is unique and every edge has two ends", () => {
    const scene = buildScene(GRAPH, NOTES[0]!.id, 640, 384)
    expect(new Set(scene.nodes.map((node) => node.id)).size).toBe(scene.nodes.length)
    const ids = new Set(scene.nodes.map((node) => node.id))
    for (const edge of scene.edges) {
      expect(ids.has(edge.from)).toBe(true)
      expect(ids.has(edge.to)).toBe(true)
    }
    expect(ids.has(topicId("Coding"))).toBe(true)
    expect(ids.has(topicId("Coding/C++"))).toBe(true)
  })
})

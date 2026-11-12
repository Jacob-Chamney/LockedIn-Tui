/**
 * Deterministic 3D layout for the knowledge graph.
 *
 * School and skills are one library: the top layer is the topic forest
 * (`Coding`, `Research`, `Math`, `Gaming`, …). Roots sit on a wide grid, child
 * topics spread in a disc around their parent, and notes orbit the topic that
 * declared them. Links are extra edges; the hierarchy is an edge too, so the
 * picture reads as "big node contains small nodes".
 *
 * There is no physics engine and no randomness: the same graph always lays out
 * the same way.
 */
import type { KnowledgeGraph, KnowledgeNote, KnowledgeTopic } from "../../services/knowledge/graph"
import { GENERAL_TOPIC, noteId, topicId } from "../../services/knowledge/graph"
import { focusNode, primaryTopic } from "./model"

export type SceneNode = {
  id: string
  label: string
  kind: "topic" | "note"
  x: number
  y: number
  z: number
  radius: number
  /** Pixel glyph: both windows use celestial stars; circle remains supported. */
  shape?: "circle" | "star"
  /** Optional semantic tint; the rasteriser maps it to a palette token. */
  tone?: "normal" | "muted" | "success" | "error" | "accent"
  /** Higher draws last, so the focused note is never hidden. */
  weight: number
}

export type SceneEdge = {
  from: string
  to: string
  kind: "hierarchy" | "link"
  /** Highlight this edge even when it does not touch the focus. */
  hot?: boolean
}

export type Camera = {
  /** Look-at point. */
  x: number
  y: number
  z: number
  distance: number
  fov: number
  yaw: number
  pitch: number
}

/** The pixel view is a map, not a full listing; the list/search still has all notes. */
export const MAX_SCENE_NOTES = 400

export type Scene = {
  nodes: SceneNode[]
  edges: SceneEdge[]
  camera: Camera
  focusId: string | null
  /** Ids reachable from the focus, so the renderer can dim the rest. */
  near: Set<string>
  /** Notes left out of the pixel view because the vault is large. */
  truncated: number
}

const GOLDEN = 2.399963229728653
const YAW = 0.32
const PITCH = 0.22

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

/** Place `index` of `count` points on a golden-angle disc. */
function disc(index: number, count: number, spread: number): { x: number; y: number; z: number } {
  const angle = index * GOLDEN
  const radius = spread * Math.sqrt((index + 0.5) / Math.max(1, count))
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.62,
    z: (hash(`${index}:${count}`) - 0.5) * spread * 0.9,
  }
}

function topicRadius(topic: KnowledgeTopic, root = false): number {
  return (root ? 8 : 4) + Math.min(12, Math.sqrt(topic.count) * 1.8)
}

function noteRadius(): number {
  return 2.6
}

function placeChildren(
  nodes: SceneNode[],
  edges: SceneEdge[],
  topics: readonly KnowledgeTopic[],
  parent: { x: number; y: number; z: number },
  parentId: string,
  spread: number,
  depth: number,
): void {
  topics.forEach((topic, index) => {
    const point = disc(index, topics.length, spread)
    const node: SceneNode = {
      id: topic.id,
      label: topic.label,
      kind: "topic",
      x: parent.x + point.x,
      y: parent.y + point.y,
      z: parent.z + point.z,
      radius: topicRadius(topic),
      shape: "star",
      weight: 2 + depth,
    }
    nodes.push(node)
    edges.push({ from: parentId, to: node.id, kind: "hierarchy" })
    placeChildren(nodes, edges, topic.children, node, node.id, Math.max(34, spread * 0.56), depth + 1)
  })
}

function placeNotes(
  nodes: SceneNode[],
  edges: SceneEdge[],
  notes: readonly KnowledgeNote[],
  topic: { x: number; y: number; z: number; id: string },
): void {
  const spread = 18 + Math.sqrt(notes.length) * 7
  notes.forEach((note, index) => {
    const point = disc(index, notes.length, spread)
    nodes.push({
      id: note.id,
      label: note.title,
      kind: "note",
      x: topic.x + point.x * 0.55,
      y: topic.y + point.y * 0.55,
      z: topic.z + point.z,
      radius: noteRadius(),
      shape: "star",
      weight: 6,
    })
    edges.push({ from: topic.id, to: note.id, kind: "hierarchy" })
  })
}

/** Root topics on a wide grid, so the overview reads as a map of subjects. */
function rootPositions(count: number, width: number, height: number): Array<{ x: number; y: number; z: number }> {
  const columns = Math.max(
    1,
    Math.min(count || 1, 6, Math.ceil(Math.sqrt(Math.max(1, count) * 1.7))),
  )
  const rows = Math.max(1, Math.ceil(count / columns))
  const stepX = Math.max(220, Math.min(360, width * 0.28))
  const stepY = Math.max(150, Math.min(260, height * 0.32))
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    return {
      x: (column - (columns - 1) / 2) * stepX,
      y: (row - (rows - 1) / 2) * stepY,
      z: (hash(`root:${index}`) - 0.5) * 120,
    }
  })
}

/**
 * Build the scene for one state. `width`/`height` are the pixel surface the
 * camera frames, so a camera for a wide window still centres the focus.
 */
export function buildScene(
  graph: KnowledgeGraph,
  focusId: string | null,
  width: number,
  height: number,
): Scene {
  const nodes: SceneNode[] = []
  const edges: SceneEdge[] = []
  const byId = new Map<string, SceneNode>()

  const roots = graph.topics
  // Draw a bounded map on a large vault. The focused note is always included,
  // and the list/search paths still reach every note.
  const sceneNotes = new Set<string>()
  for (const note of graph.notes) {
    if (sceneNotes.size >= MAX_SCENE_NOTES) break
    sceneNotes.add(note.id)
  }
  if (focusId !== null) sceneNotes.add(focusId)
  const positions = rootPositions(roots.length, width, height)
  roots.forEach((topic, index) => {
    const point = positions[index]!
    const node: SceneNode = {
      id: topic.id,
      label: topic.label,
      kind: "topic",
      x: point.x,
      y: point.y,
      z: point.z,
      radius: topicRadius(topic, true),
      shape: "star",
      weight: 1,
    }
    nodes.push(node)
    placeChildren(nodes, edges, topic.children, node, node.id, Math.max(120, width * 0.13), 1)
  })

  // Notes attach to the topic that declared their primary path. A note in two
  // topics is still one scene node; the second topic contributes only a count.
  const topicPoints = new Map<string, SceneNode>()
  for (const node of nodes) if (node.kind === "topic") topicPoints.set(node.id, node)
  const walk = (topic: KnowledgeTopic): void => {
    const point = topicPoints.get(topic.id)
    if (point) {
      // A note can appear under several topics. Draw it once, under the first
      // topic it declared, or the scene would hold duplicate nodes that the
      // focus and the raster would both have to disambiguate.
      const own = topic.notes.filter(
        (note) => sceneNotes.has(note.id) && primaryTopic(note) === topic.id,
      )
      placeNotes(nodes, edges, own, point)
    }
    for (const child of topic.children) walk(child)
  }
  for (const topic of roots) walk(topic)

  // A note whose primary topic did not render (should not happen) still gets a
  // node, so a graph read never loses a note.
  for (const note of graph.notes) {
    if (!sceneNotes.has(note.id)) continue
    if (nodes.some((node) => node.id === note.id)) continue
    const parent = topicPoints.get(primaryTopic(note))
    nodes.push({
      id: note.id,
      label: note.title,
      kind: "note",
      x: (parent?.x ?? 0) + (hash(note.id) - 0.5) * 60,
      y: (parent?.y ?? 0) + (hash(`${note.id}y`) - 0.5) * 60,
      z: (parent?.z ?? 0) + (hash(`${note.id}z`) - 0.5) * 60,
      radius: noteRadius(),
      shape: "star",
      weight: 6,
    })
    if (parent) edges.push({ from: parent.id, to: note.id, kind: "hierarchy" })
  }

  const rendered = new Set(nodes.map((node) => node.id))
  for (const edge of graph.edges) {
    if (rendered.has(edge.from) && rendered.has(edge.to)) {
      edges.push({ from: edge.from, to: edge.to, kind: "link" })
    }
  }

  for (const node of nodes) byId.set(node.id, node)

  const focus = focusNode(graph, focusId)
  const focusPoint = focusId ? byId.get(focusId) : undefined
  const rootTopic = focus?.kind === "topic" && focus.topic.path.split("/").length === 1
  const distance =
    focus === null
      ? Math.max(1200, width * 1.15)
      : focus.kind === "topic"
        ? rootTopic
          ? Math.max(1200, width * 1.15)
          : Math.max(520, width * 0.62)
        : Math.max(420, width * 0.5)

  // A top-level topic is a stop on the overview: keep the whole forest framed
  // instead of zooming into one cluster. Drilling into a child or a note moves
  // the camera to that node.
  const camera: Camera = {
    x: rootTopic ? 0 : focusPoint?.x ?? 0,
    y: rootTopic ? 0 : focusPoint?.y ?? 0,
    z: rootTopic ? 0 : focusPoint?.z ?? 0,
    distance,
    fov: 760,
    yaw: YAW,
    pitch: PITCH,
  }

  const near = new Set<string>()
  if (focusId) {
    near.add(focusId)
    for (const edge of edges) {
      if (edge.from === focusId) near.add(edge.to)
      if (edge.to === focusId) near.add(edge.from)
    }
  }

  return {
    nodes,
    edges,
    camera,
    focusId,
    near,
    truncated: Math.max(0, graph.notes.length - sceneNotes.size),
  }
}

export type Projected = {
  x: number
  y: number
  scale: number
  depth: number
  visible: boolean
}

/** Perspective-project one scene point into image pixels. */
export function project(
  point: { x: number; y: number; z: number },
  camera: Camera,
  width: number,
  height: number,
): Projected {
  const dx = point.x - camera.x
  const dy = point.y - camera.y
  const dz = point.z - camera.z

  const cosYaw = Math.cos(camera.yaw)
  const sinYaw = Math.sin(camera.yaw)
  const cosPitch = Math.cos(camera.pitch)
  const sinPitch = Math.sin(camera.pitch)

  const x1 = dx * cosYaw - dz * sinYaw
  const z1 = dx * sinYaw + dz * cosYaw
  const y1 = dy * cosPitch - z1 * sinPitch
  const z2 = dy * sinPitch + z1 * cosPitch

  const depth = z2 + camera.distance
  const visible = depth > 24
  const scale = visible ? camera.fov / depth : 0

  return {
    x: width / 2 + x1 * scale,
    y: height / 2 + y1 * scale,
    scale,
    depth: z2,
    visible,
  }
}

export type Direction = "up" | "down" | "left" | "right"

/**
 * Nearest visible node in a direction, in projected space. The window and the
 * key router use the same geometry, so an arrow key lands where the eye says.
 */
export function directionTarget(
  graph: KnowledgeGraph,
  focusId: string | null,
  direction: Direction,
  columns: number,
  rows: number,
  options: { distance?: number } = {},
): string | null {
  if (focusId === null) return null
  const scene = buildScene(
    graph,
    focusId,
    Math.max(160, columns * 8),
    Math.max(120, rows * 16),
  )
  if (options.distance !== undefined) scene.camera.distance = options.distance
  return directionTargetIn(scene, focusId, direction, columns, rows)
}

/**
 * The same nearest-node rule for a scene that is already laid out — used by
 * surfaces (achievements) that do not build a topic graph.
 */
export function directionTargetIn(
  scene: Scene,
  focusId: string | null,
  direction: Direction,
  columns: number,
  rows: number,
  options: { exclude?: ReadonlySet<string> } = {},
): string | null {
  if (focusId === null) return null
  const width = Math.max(160, columns * 8)
  const height = Math.max(120, rows * 16)
  const focus = scene.nodes.find((node) => node.id === focusId)
  if (!focus) return null
  const origin = project(focus, scene.camera, width, height)

  let best: { id: string; score: number } | null = null
  for (const node of scene.nodes) {
    if (node.id === focusId) continue
    if (options.exclude?.has(node.id)) continue
    const point = project(node, scene.camera, width, height)
    if (!point.visible) continue
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    let along = 0
    let across = 0
    if (direction === "right" && dx > 8) {
      along = dx
      across = dy
    } else if (direction === "left" && dx < -8) {
      along = -dx
      across = dy
    } else if (direction === "down" && dy > 8) {
      along = dy
      across = dx
    } else if (direction === "up" && dy < -8) {
      along = -dy
      across = dx
    } else {
      continue
    }
    const score = along + Math.abs(across) * 1.6
    if (!best || score < best.score) best = { id: node.id, score }
  }
  return best?.id ?? null
}

/** A topic path's label, e.g. `Coding/C++` → `C++`. */
export function labelForPath(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? GENERAL_TOPIC
}

export { noteId, topicId }

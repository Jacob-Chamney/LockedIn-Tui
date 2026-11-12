/**
 * Software rasteriser for the knowledge graph.
 *
 * The terminal stack can blit a raw RGBA frame (Kitty graphics or Sixel), so
 * this draws real anti-aliased stars, circles and lines — no character palette, no
 * Braille. Colours come only from `ThemePalette`.
 *
 * The rasteriser is deliberately small: opaque background, alpha-blended edges,
 * and a radial halo on the focused node. Labels are terminal text layered over
 * the image by the window, which keeps text crisp and themed.
 */
import type { ThemePalette } from "../theme"
import { project, type Camera, type Scene, type SceneNode } from "./scene"

export type Rgba = { r: number; g: number; b: number; a: number }

const FALLBACK: Rgba = { r: 0, g: 0, b: 0, a: 255 }

export function hexRgba(hex: string, alpha = 255): Rgba {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return { ...FALLBACK, a: alpha }
  const value = Number.parseInt(match[1]!, 16)
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
    a: alpha,
  }
}

function blend(buffer: Uint8Array, at: number, colour: Rgba, coverage: number): void {
  const alpha = (colour.a / 255) * Math.max(0, Math.min(1, coverage))
  if (alpha <= 0) return
  const inverse = 1 - alpha
  buffer[at] = Math.round(colour.r * alpha + buffer[at]! * inverse)
  buffer[at + 1] = Math.round(colour.g * alpha + buffer[at + 1]! * inverse)
  buffer[at + 2] = Math.round(colour.b * alpha + buffer[at + 2]! * inverse)
  buffer[at + 3] = 255
}

function fill(buffer: Uint8Array, colour: Rgba): void {
  for (let at = 0; at < buffer.length; at += 4) {
    buffer[at] = colour.r
    buffer[at + 1] = colour.g
    buffer[at + 2] = colour.b
    buffer[at + 3] = colour.a
  }
}

function dot(buffer: Uint8Array, width: number, height: number, x: number, y: number, colour: Rgba, coverage = 1): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  blend(buffer, (y * width + x) * 4, colour, coverage)
}

/** One-pixel anti-aliased segment. */
export function line(
  buffer: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: Rgba,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))))
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    dot(buffer, width, height, Math.round(x0 + dx * t), Math.round(y0 + dy * t), colour)
  }
}

function circle(
  buffer: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  colour: Rgba,
): void {
  const r = Math.max(0.6, radius)
  const from = Math.max(0, Math.floor(cx - r - 1))
  const to = Math.min(width - 1, Math.ceil(cx + r + 1))
  const top = Math.max(0, Math.floor(cy - r - 1))
  const bottom = Math.min(height - 1, Math.ceil(cy + r + 1))
  for (let y = top; y <= bottom; y++) {
    for (let x = from; x <= to; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const coverage = Math.max(0, Math.min(1, r + 0.5 - distance))
      if (coverage > 0) blend(buffer, (y * width + x) * 4, colour, coverage)
    }
  }
}

function ring(
  buffer: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  colour: Rgba,
): void {
  const outer = radius + thickness
  const inner = Math.max(0, radius - thickness)
  const from = Math.max(0, Math.floor(cx - outer - 1))
  const to = Math.min(width - 1, Math.ceil(cx + outer + 1))
  const top = Math.max(0, Math.floor(cy - outer - 1))
  const bottom = Math.min(height - 1, Math.ceil(cy + outer + 1))
  for (let y = top; y <= bottom; y++) {
    for (let x = from; x <= to; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const coverage = Math.max(0, Math.min(1, outer + 0.5 - distance, distance - inner + 0.5))
      if (coverage > 0) blend(buffer, (y * width + x) * 4, colour, coverage)
    }
  }
}

function towardWhite(colour: Rgba, amount: number): Rgba {
  return {
    r: Math.round(colour.r + (255 - colour.r) * amount),
    g: Math.round(colour.g + (255 - colour.g) * amount),
    b: Math.round(colour.b + (255 - colour.b) * amount),
    a: colour.a,
  }
}

/** A celestial star: bright core, soft halo and four diffraction rays. */
function star(
  buffer: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  colour: Rgba,
): void {
  const core = Math.max(1.2, radius * 0.5)
  circle(buffer, width, height, cx, cy, radius * 2.1, { ...colour, a: 18 })
  circle(buffer, width, height, cx, cy, radius * 1.35, { ...colour, a: 34 })
  const longRay = radius * 2.6
  const shortRay = radius * 1.35
  const ray = { ...colour, a: 170 }
  const soft = { ...colour, a: 80 }
  line(buffer, width, height, cx - longRay, cy, cx + longRay, cy, ray)
  line(buffer, width, height, cx, cy - longRay, cx, cy + longRay, ray)
  line(buffer, width, height, cx - shortRay, cy - shortRay, cx + shortRay, cy + shortRay, soft)
  line(buffer, width, height, cx + shortRay, cy - shortRay, cx - shortRay, cy + shortRay, soft)
  circle(buffer, width, height, cx, cy, core, towardWhite(colour, 0.55))
}

function tintFor(node: SceneNode, palette: ThemePalette): Rgba {
  if (node.tone === "muted") return hexRgba(palette.muted)
  if (node.tone === "success") return hexRgba(palette.success)
  if (node.tone === "error") return hexRgba(palette.error)
  if (node.tone === "accent") return hexRgba(palette.accent)
  if (node.kind === "topic") return hexRgba(palette.secondary)
  return hexRgba(palette.foreground)
}

/**
 * Draw one frame. `phase` is seconds, used only for the focused halo, so a
 * still frame and an animated frame differ in one pixel region.
 */
export function renderScene(
  scene: Scene,
  width: number,
  height: number,
  palette: ThemePalette,
  reuse?: Uint8Array,
): Uint8Array {
  const size = width * height * 4
  const buffer = reuse !== undefined && reuse.length === size ? reuse : new Uint8Array(size)
  fill(buffer, hexRgba(palette.background))

  const points = new Map<string, { x: number; y: number; scale: number; depth: number; visible: boolean }>()
  for (const node of scene.nodes) {
    points.set(node.id, project(node, scene.camera, width, height))
  }

  const edgeColour = hexRgba(palette.line, 150)
  const hotEdge = hexRgba(palette.primary, 210)
  for (const edge of scene.edges) {
    const from = points.get(edge.from)
    const to = points.get(edge.to)
    if (!from || !to || !from.visible || !to.visible) continue
    const focusEdge = edge.hot === true || edge.from === scene.focusId || edge.to === scene.focusId
    const near = scene.focusId === null || scene.near.has(edge.from) || scene.near.has(edge.to)
    const colour = focusEdge ? hotEdge : { ...edgeColour, a: near ? edgeColour.a : 40 }
    line(buffer, width, height, from.x, from.y, to.x, to.y, colour)
  }

  const ordered = [...scene.nodes]
    .map((node) => ({ node, point: points.get(node.id)! }))
    .filter((entry) => entry.point.visible)
    .sort((a, b) => b.point.depth - a.point.depth)

  for (const { node, point } of ordered) {
    const focused = node.id === scene.focusId
    const near = scene.focusId === null || scene.near.has(node.id)
    const radius = Math.max(1, node.radius * point.scale)
    const tint = tintFor(node, palette)
    const alpha = near ? 255 : 90

    if (focused) {
      ring(buffer, width, height, point.x, point.y, radius + 4, 1.2, hexRgba(palette.primary, 190))
    }

    if (node.shape === "star") {
      star(buffer, width, height, point.x, point.y, radius, { ...tint, a: alpha })
    } else {
      if (focused) {
        circle(buffer, width, height, point.x, point.y, radius * 2.6, hexRgba(palette.primary, 40))
      }
      circle(buffer, width, height, point.x, point.y, radius, { ...tint, a: alpha })
    }
  }

  return buffer
}

/** Projected cell position of every visible node, for the window's label layer. */
export function labelPoints(
  scene: Scene,
  columns: number,
  rows: number,
  widthPx: number,
  heightPx: number,
): Array<{ id: string; x: number; y: number; depth: number; scale: number; focused: boolean }> {
  const out: Array<{ id: string; x: number; y: number; depth: number; scale: number; focused: boolean }> = []
  for (const node of scene.nodes) {
    const point = project(node, scene.camera, widthPx, heightPx)
    if (!point.visible) continue
    // A node whose centre is off the canvas has no label to place; clamping it
    // to the edge would pile off-screen titles onto the border.
    if (point.x < 0 || point.x > widthPx || point.y < 0 || point.y > heightPx) continue
    out.push({
      id: node.id,
      x: Math.max(0, Math.min(columns - 1, Math.round((point.x / Math.max(1, widthPx)) * columns))),
      y: Math.max(0, Math.min(rows - 1, Math.round((point.y / Math.max(1, heightPx)) * rows))),
      depth: point.depth,
      scale: point.scale,
      focused: node.id === scene.focusId,
    })
  }
  return out.sort((a, b) => b.depth - a.depth)
}

export function cameraKey(camera: Camera): string {
  return `${camera.x.toFixed(1)}:${camera.y.toFixed(1)}:${camera.z.toFixed(1)}:${camera.distance.toFixed(1)}`
}

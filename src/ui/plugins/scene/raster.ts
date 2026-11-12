/**
 * Sub-cell rasteriser for scene shapes.
 *
 * Each terminal cell is sampled as a 2x4 grid and drawn with Braille dots, so a
 * circle or a rounded corner has eight times the resolution of a character.
 * Cells that are fully covered use a solid block. The terminal stays a cell
 * grid; this is the best resolution it offers without a graphics protocol.
 */
import { RGBA, type OptimizedBuffer } from "@opentui/core"

import type { ThemePalette } from "../../theme"
import type { SceneClip, SceneShape } from "./model"

type Point = { x: number; y: number }

/** Braille dot bits, indexed [row][column]; rows are 0..3, columns 0..1. */
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

const SAMPLES: Array<{ dx: number; dy: number; bit: number }> = []
for (let row = 0; row < 4; row++) {
  for (let column = 0; column < 2; column++) {
    SAMPLES.push({
      dx: (column + 0.5) / 2,
      dy: (row + 0.5) / 4,
      bit: DOTS[row]![column]!,
    })
  }
}

function color(value: string | undefined, palette: ThemePalette, fallback: string): RGBA {
  if (value) {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      try {
        return RGBA.fromHex(value)
      } catch {
        // fall through
      }
    }
    if (Object.prototype.hasOwnProperty.call(palette, value)) {
      return RGBA.fromHex(palette[value as keyof ThemePalette])
    }
  }
  return RGBA.fromHex(fallback)
}

export function shapeBox(shape: SceneShape): { width: number; height: number } {
  if (shape.kind === "circle") return { width: shape.radius * 2, height: shape.radius * 2 }
  if (shape.kind === "line") return { width: shape.width, height: shape.height }
  return { width: shape.width, height: shape.height }
}

function trianglePoints(shape: Extract<SceneShape, { kind: "triangle" }>): Point[] {
  const { width: w, height: h } = shape
  switch (shape.direction ?? "up") {
    case "down":
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w / 2, y: h },
      ]
    case "left":
      return [
        { x: w, y: 0 },
        { x: 0, y: h / 2 },
        { x: w, y: h },
      ]
    case "right":
      return [
        { x: 0, y: 0 },
        { x: w, y: h / 2 },
        { x: 0, y: h },
      ]
    default:
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]
  }
}

function pointsOf(flat: number[]): Point[] {
  const points: Point[] = []
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push({ x: flat[index]!, y: flat[index + 1]! })
  }
  return points
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function polygonDistance(p: Point, points: Point[]): number {
  let inside = false
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    nearest = Math.min(nearest, segmentDistance(p, a, b))
    if (
      (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside ? -nearest : nearest
}

function roundRectDistance(x: number, y: number, width: number, height: number, radius: number): number {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
  const qx = Math.abs(x - width / 2) - (width / 2 - r)
  const qy = Math.abs(y - height / 2) - (height / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

function arcDistance(shape: Extract<SceneShape, { kind: "arc" }>, p: Point): number {
  const cx = shape.width / 2
  const cy = shape.height / 2
  const thickness = Math.max(0.1, shape.thickness ?? 0.75)
  const radius = Math.max(0.5, Math.min(shape.width, shape.height) / 2 - thickness / 2)
  const distance = Math.hypot(p.x - cx, p.y - cy) - radius
  const band = Math.abs(distance) - thickness / 2
  const sweep = shape.value !== undefined ? shape.value * 360 : (shape.sweep ?? 360)
  const start = shape.start ?? -90
  const angle = normalizeAngle((Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI)
  const delta = normalizeAngle(angle - start)
  let best = sweep >= 359.999 || delta <= sweep ? band : Number.POSITIVE_INFINITY
  if (shape.rounded) {
    for (const end of [start, start + sweep]) {
      const radians = (end * Math.PI) / 180
      const capX = cx + Math.cos(radians) * radius
      const capY = cy + Math.sin(radians) * radius
      best = Math.min(best, Math.hypot(p.x - capX, p.y - capY) - thickness / 2)
    }
  }
  return best
}

function lineDistance(shape: Extract<SceneShape, { kind: "line" }>, p: Point): number {
  const thickness = Math.max(0.1, shape.thickness ?? 0.75)
  return (
    segmentDistance(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) -
    thickness / 2
  )
}

function pathDistance(shape: Extract<SceneShape, { kind: "path" }>, p: Point): number {
  const points = pointsOf(shape.points)
  if (shape.closed && shape.fill) return polygonDistance(p, points)
  const thickness = Math.max(0.1, shape.thickness ?? 0.75)
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index + 1 < points.length; index++) {
    best = Math.min(best, segmentDistance(p, points[index]!, points[index + 1]!))
  }
  if (shape.closed && points.length > 2) {
    best = Math.min(best, segmentDistance(p, points[points.length - 1]!, points[0]!))
  }
  return best - thickness / 2
}

function rotatePoint(shape: SceneShape, p: Point): Point {
  const rotation = shape.kind === "progress" ? undefined : shape.rotation
  if (!rotation) return p
  const box = shapeBox(shape)
  const angle = (rotation * Math.PI) / 180
  const cx = box.width / 2
  const cy = box.height / 2
  const dx = p.x - cx
  const dy = p.y - cy
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  }
}

/** Signed distance to the shape: negative inside, positive outside. */
function distance(shape: SceneShape, p: Point): number {
  if (shape.kind !== "circle" && shape.kind !== "arc" && shape.kind !== "progress") {
    p = rotatePoint(shape, p)
  }
  if (shape.kind === "circle") {
    return Math.hypot(p.x - shape.radius, p.y - shape.radius) - shape.radius
  }
  if (shape.kind === "rect") {
    return roundRectDistance(
      p.x,
      p.y,
      shape.width,
      shape.height,
      Math.max(0, Math.min(shape.radius ?? 0, Math.min(shape.width, shape.height) / 2)),
    )
  }
  if (shape.kind === "triangle") {
    return polygonDistance(p, trianglePoints(shape))
  }
  if (shape.kind === "arc") return arcDistance(shape, p)
  if (shape.kind === "line") return lineDistance(shape, p)
  if (shape.kind === "path") return pathDistance(shape, p)
  if (shape.kind === "polygon") return polygonDistance(p, pointsOf(shape.points))
  return Number.POSITIVE_INFINITY
}

/** Sample a predicate over a cell box and paint Braille or solid glyphs. */
function paintCells(
  buffer: OptimizedBuffer,
  left: number,
  top: number,
  width: number,
  height: number,
  inside: (p: Point) => boolean,
  fg: RGBA,
  bg: RGBA,
  clip: SceneClip,
): void {
  const firstX = Math.max(clip.left, Math.floor(left))
  const firstY = Math.max(clip.top, Math.floor(top))
  const lastX = Math.min(clip.right - 1, Math.ceil(left + width) - 1)
  const lastY = Math.min(clip.bottom - 1, Math.ceil(top + height) - 1)

  for (let cellY = firstY; cellY <= lastY; cellY++) {
    for (let cellX = firstX; cellX <= lastX; cellX++) {
      let bits = 0
      for (const sample of SAMPLES) {
        if (inside({ x: cellX - left + sample.dx, y: cellY - top + sample.dy })) {
          bits |= sample.bit
        }
      }
      if (bits === 0) continue
      const glyph = bits === 0xff ? "█" : String.fromCodePoint(0x2800 | bits)
      buffer.setCell(cellX, cellY, glyph, fg, bg)
    }
  }
}

function paintProgress(
  buffer: OptimizedBuffer,
  shape: Extract<SceneShape, { kind: "progress" }>,
  left: number,
  top: number,
  palette: ThemePalette,
  clip: SceneClip,
): void {
  const horizontal = shape.orientation !== "vertical"
  const thickness = Math.max(
    0.5,
    Math.min(
      shape.thickness ?? (horizontal ? shape.height : shape.width),
      horizontal ? shape.height : shape.width,
    ),
  )
  const radius = Math.max(0, Math.min(shape.radius ?? 0, thickness / 2))
  const trackWidth = horizontal ? shape.width : thickness
  const trackHeight = horizontal ? thickness : shape.height
  const trackX = horizontal ? 0 : (shape.width - thickness) / 2
  const trackY = horizontal ? (shape.height - thickness) / 2 : 0
  const bg = color(shape.bg, palette, palette.background)
  const trackColor = color(shape.track, palette, palette.line)
  const fillColor = color(shape.color, palette, palette.accent)
  const value = Math.max(0, Math.min(1, shape.value))

  paintCells(
    buffer,
    left,
    top,
    shape.width,
    shape.height,
    (p) => roundRectDistance(p.x - trackX, p.y - trackY, trackWidth, trackHeight, radius) <= 0,
    trackColor,
    bg,
    clip,
  )

  const length = (horizontal ? shape.width : shape.height) * value
  if (length <= 0) return
  const fillWidth = horizontal ? length : thickness
  const fillHeight = horizontal ? thickness : length
  const fillX = horizontal ? 0 : (shape.width - thickness) / 2
  const fillY = horizontal ? (shape.height - thickness) / 2 : 0
  const fillRadius = Math.min(radius, Math.min(fillWidth, fillHeight) / 2)
  paintCells(
    buffer,
    left,
    top,
    shape.width,
    shape.height,
    (p) => roundRectDistance(p.x - fillX, p.y - fillY, fillWidth, fillHeight, fillRadius) <= 0,
    fillColor,
    bg,
    clip,
  )
}

/** True when the sample point is inside the shape's drawn area. */
export function shapeVisible(shape: SceneShape, p: Point): boolean {
  if (shape.kind === "progress") return false
  const fill = shape.fill !== false
  const border = shape.border === true || (!fill && shape.border !== false)
  const band = shape.kind === "arc" || shape.kind === "line" || shape.kind === "path"
  const mode = band ? "band" : fill ? "fill" : border ? "border" : "none"
  if (mode === "none") return false
  const d = distance(shape, p)
  if (mode === "band" || mode === "fill") return d <= 0
  return d <= 0 && d > -(shape.thickness ?? 0.5)
}

/** Paint one shape at an already-resolved top-left cell. */
export function paintShape(
  buffer: OptimizedBuffer,
  shape: SceneShape,
  left: number,
  top: number,
  palette: ThemePalette,
  clip: SceneClip,
): void {
  const { width: boxWidth, height: boxHeight } = shapeBox(shape)
  if (boxWidth < 0.5 || boxHeight < 0.5) return
  if (shape.kind === "progress") {
    paintProgress(buffer, shape, left, top, palette, clip)
    return
  }
  const fg = color(shape.color, palette, palette.accent)
  const bg = color(shape.bg, palette, palette.background)
  paintCells(
    buffer,
    left,
    top,
    boxWidth,
    boxHeight,
    (p) => shapeVisible(shape, p),
    fg,
    bg,
    clip,
  )
}

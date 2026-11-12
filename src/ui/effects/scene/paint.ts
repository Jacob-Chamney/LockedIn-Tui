/**
 * Paint validated scene nodes onto the post-process buffer.
 *
 * Everything here is host-owned: colours are resolved from the palette, boxes
 * are drawn with box-drawing characters, and every write is clipped. A plugin
 * never receives this buffer. Groups are recursive: their children use the
 * group's content box as their viewport and are clipped to it by default.
 */
import { RGBA, type OptimizedBuffer } from "@opentui/core"

import type { ThemePalette } from "../../theme"
import { resolvePosition, type SceneClip, type SceneNode } from "./model"
import { paintShape } from "./raster"
import { drawShapeImage, type SceneImages } from "./image"

type PaintContext = {
  offsetX: number
  offsetY: number
  width: number
  height: number
  clip: SceneClip
  images?: SceneImages
  background?: string
  hits?: SceneHitRegion[]
  /** Focusable window enclosing the current nodes. */
  windowId?: string
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

const BORDERS = {
  rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
} as const
const CORNERS = BORDERS.rounded

function intersect(a: SceneClip, b: SceneClip): SceneClip {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}

function drawBox(
  buffer: OptimizedBuffer,
  left: number,
  top: number,
  width: number,
  height: number,
  border: boolean,
  fg: RGBA,
  bg: RGBA,
  borderColor: RGBA,
  title: string | undefined,
  titleAlign: "left" | "center" | "right" | undefined,
  borderStyle: "single" | "double" | "rounded" | undefined,
  clip: SceneClip,
  openRight: boolean,
  openBottom: boolean,
): void {
  const fillLeft = Math.max(left, clip.left)
  const fillTop = Math.max(top, clip.top)
  const fillRight = Math.min(left + width, clip.right)
  const fillBottom = Math.min(top + height, clip.bottom)
  if (fillRight > fillLeft && fillBottom > fillTop) {
    buffer.fillRect(fillLeft, fillTop, fillRight - fillLeft, fillBottom - fillTop, bg)
  }
  const set = (x: number, y: number, char: string) => {
    if (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return
    buffer.setCell(x, y, char, borderColor, bg)
  }
  if (border && width >= 2 && height >= 2) {
    const chars = BORDERS[borderStyle ?? "rounded"]
    const right = left + width - 1
    const bottom = top + height - 1
    for (let x = left + 1; x < right; x++) {
      set(x, top, chars.h)
      if (!openBottom) set(x, bottom, chars.h)
    }
    for (let y = top + 1; y < bottom; y++) {
      set(left, y, chars.v)
      if (!openRight) set(right, y, chars.v)
    }
    set(left, top, chars.tl)
    if (!openRight) set(right, top, chars.tr)
    if (!openBottom) set(left, bottom, chars.bl)
    if (!openRight && !openBottom) set(right, bottom, chars.br)
  }
  if (title && width > 4 && top >= clip.top && top < clip.bottom) {
    const room = width - 4
    const length = Math.min(title.length, room)
    const origin =
      titleAlign === "center"
        ? left + Math.floor((width - length) / 2)
        : titleAlign === "right"
          ? left + width - length - 2
          : left + 2
    const start = Math.max(origin, clip.left)
    const end = Math.min(origin + length, clip.right)
    if (end > start) {
      const offset = start - origin
      buffer.drawText(title.slice(offset, offset + (end - start)), start, top, fg, bg)
    }
  }
}

function nodeHeight(node: SceneNode): number {
  if (node.kind === "text") return 1
  if (node.kind === "circle") return node.radius * 2
  if (node.kind === "rule") return node.vertical ? node.width : 1
  return node.height
}

function nodeWidth(node: SceneNode): number {
  if (node.kind === "text") return node.text.length
  if (node.kind === "circle") return node.radius * 2
  if (node.kind === "rule") return node.vertical ? 1 : node.width
  return node.width
}

/** Apply `layout` to a group's children; free placement keeps them as written. */
function layoutChildren(
  node: Extract<SceneNode, { kind: "group" }>,
  width: number,
  height: number,
): SceneNode[] {
  if (!node.layout) return node.nodes
  const gap = node.gap ?? 0
  const align = node.align ?? "start"
  let cursor = 0
  return node.nodes.map((child) => {
    if (node.layout === "column") {
      const size = nodeWidth(child)
      const x =
        align === "center"
          ? Math.floor((width - size) / 2)
          : align === "end"
            ? Math.max(0, width - size - child.x)
            : child.x
      const y = cursor
      cursor += nodeHeight(child) + gap
      return { ...child, anchor: "top-left" as const, x, y }
    }
    const size = nodeHeight(child)
    const y =
      align === "center"
        ? Math.floor((height - size) / 2)
        : align === "end"
          ? Math.max(0, height - size - child.y)
          : child.y
    const x = cursor
    cursor += nodeWidth(child) + gap
    return { ...child, anchor: "top-left" as const, x, y }
  })
}

/** One collected pointer target in screen cells. */
export type SceneHitRegion = {
  left: number
  top: number
  right: number
  bottom: number
  /** Enclosing focusable window id, when there is one. */
  window?: string
  row?: number
  column?: number
  id?: string
}

/** Clip a hit rectangle to the current clip; returns null when it is empty. */
function clippedHit(
  left: number,
  top: number,
  width: number,
  height: number,
  ctx: PaintContext,
): { left: number; top: number; right: number; bottom: number } | null {
  const clipped = {
    left: Math.max(left, ctx.clip.left),
    top: Math.max(top, ctx.clip.top),
    right: Math.min(left + width, ctx.clip.right),
    bottom: Math.min(top + height, ctx.clip.bottom),
  }
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : null
}

export function paintScene(
  buffer: OptimizedBuffer,
  nodes: readonly SceneNode[],
  palette: ThemePalette,
  images?: SceneImages,
  hits?: SceneHitRegion[],
): void {
  paintNodes(buffer, nodes, palette, {
    offsetX: 0,
    offsetY: 0,
    width: buffer.width,
    height: buffer.height,
    clip: { left: 0, top: 0, right: buffer.width, bottom: buffer.height },
    background: palette.background,
    ...(images ? { images } : {}),
    ...(hits ? { hits } : {}),
  })
}

function paintNodes(
  buffer: OptimizedBuffer,
  nodes: readonly SceneNode[],
  palette: ThemePalette,
  ctx: PaintContext,
): void {
  for (const node of nodes) {
    if (node.kind === "group") {
      const local = resolvePosition(node.anchor, node.x, node.y, node.width, node.height, {
        width: ctx.width,
        height: ctx.height,
      })
      const left = local.left + ctx.offsetX
      const top = local.top + ctx.offsetY
      const windowId = node.focusable && node.id ? node.id : ctx.windowId
      if (ctx.hits && node.focusable && node.id) {
        const region = clippedHit(left, top, node.width, node.height, ctx)
        if (region) ctx.hits.push({ ...region, window: node.id })
      }
      if (node.border || node.bg || node.title) {
        drawBox(
          buffer,
          left,
          top,
          node.width,
          node.height,
          node.border === true,
          color(node.fg, palette, palette.foreground),
          color(node.bg, palette, palette.surface),
          color(node.borderColor, palette, palette.line),
          node.title,
          node.titleAlign,
          node.borderStyle,
          ctx.clip,
          false,
          false,
        )
      }
      const inset = (node.padding ?? 0) + (node.border ? 1 : 0)
      const contentWidth = node.width - inset * 2
      const contentHeight = node.height - inset * 2
      if (contentWidth <= 0 || contentHeight <= 0) continue
      const contentClip: SceneClip = {
        left: left + inset,
        top: top + inset,
        right: left + inset + contentWidth,
        bottom: top + inset + contentHeight,
      }
      const clip = node.clip === false ? ctx.clip : intersect(ctx.clip, contentClip)
      if (clip.right <= clip.left || clip.bottom <= clip.top) continue
      paintNodes(buffer, layoutChildren(node, contentWidth, contentHeight), palette, {
        offsetX: left + inset,
        offsetY: top + inset - (node.scroll ?? 0),
        width: contentWidth,
        height: contentHeight,
        clip,
        background: node.bg ?? ctx.background,
        windowId,
        ...(ctx.images ? { images: ctx.images } : {}),
        ...(ctx.hits ? { hits: ctx.hits } : {}),
      })
      continue
    }

    if (node.kind === "hit") {
      if (!ctx.hits) continue
      const local = resolvePosition(
        node.anchor,
        node.x,
        node.y,
        node.width,
        node.height,
        { width: ctx.width, height: ctx.height },
      )
      const region = clippedHit(
        local.left + ctx.offsetX,
        local.top + ctx.offsetY,
        node.width,
        node.height,
        ctx,
      )
      if (!region) continue
      ctx.hits.push({
        ...region,
        ...(ctx.windowId ? { window: ctx.windowId } : {}),
        ...(node.row !== undefined ? { row: node.row } : {}),
        ...(node.column !== undefined ? { column: node.column } : {}),
        ...(node.id ? { id: node.id } : {}),
      })
      continue
    }

    if (node.kind === "rule") {
      const length = Math.min(node.width, node.vertical ? ctx.height : ctx.width)
      const local = resolvePosition(
        node.anchor,
        node.x,
        node.y,
        node.vertical ? 1 : length,
        node.vertical ? length : 1,
        { width: ctx.width, height: ctx.height },
      )
      const glyph = node.vertical ? CORNERS.v : CORNERS.h
      const fg = color(node.color, palette, palette.line)
      const bg = color(ctx.background, palette, palette.background)
      for (let index = 0; index < length; index++) {
        const x = (node.vertical ? local.left : local.left + index) + ctx.offsetX
        const y = (node.vertical ? local.top + index : local.top) + ctx.offsetY
        if (x < ctx.clip.left || x >= ctx.clip.right || y < ctx.clip.top || y >= ctx.clip.bottom) {
          continue
        }
        buffer.setCell(x, y, glyph, fg, bg)
      }
      continue
    }

    if (node.kind === "text") {
      const local = resolvePosition(node.anchor, node.x, node.y, node.text.length, 1, {
        width: ctx.width,
        height: ctx.height,
      })
      const left = local.left + ctx.offsetX
      const top = local.top + ctx.offsetY
      if (top < ctx.clip.top || top >= ctx.clip.bottom) continue
      const start = Math.max(left, ctx.clip.left)
      const room = Math.min(left + node.text.length, ctx.clip.right) - start
      if (room <= 0) continue
      const fg = color(node.fg, palette, palette.foreground)
      // An explicit bg is painted; otherwise the cell keeps what is beneath it,
      // so text can sit on a highlight bar without punching a hole in it.
      const bg = node.bg === undefined ? undefined : color(node.bg, palette, palette.background)
      buffer.drawText(node.text.slice(start - left, start - left + room), start, top, fg, bg)
      continue
    }

    if (
      node.kind === "circle" ||
      node.kind === "rect" ||
      node.kind === "triangle" ||
      node.kind === "polygon" ||
      node.kind === "arc" ||
      node.kind === "line" ||
      node.kind === "path" ||
      node.kind === "progress"
    ) {
      const boxWidth = node.kind === "circle" ? node.radius * 2 : node.width
      const boxHeight = node.kind === "circle" ? node.radius * 2 : node.height
      const local = resolvePosition(node.anchor, node.x, node.y, boxWidth, boxHeight, {
        width: ctx.width,
        height: ctx.height,
      })
      const left = local.left + ctx.offsetX
      const top = local.top + ctx.offsetY
      if (
        ctx.images &&
        drawShapeImage(buffer, node, left, top, palette, ctx.images, ctx.clip, ctx.background)
      ) {
        continue
      }
      paintShape(buffer, node, left, top, palette, ctx.clip)
      continue
    }

    if (node.kind !== "box") continue
    const local = resolvePosition(node.anchor, node.x, node.y, node.width, node.height, {
      width: ctx.width,
      height: ctx.height,
    })
    if (node.width < 1 || node.height < 1) continue
    const left = local.left + ctx.offsetX
    const top = local.top + ctx.offsetY
    drawBox(
      buffer,
      left,
      top,
      node.width,
      node.height,
      node.border !== false,
      color(node.fg, palette, palette.foreground),
      color(node.bg, palette, palette.surface),
      color(node.borderColor, palette, palette.line),
      node.title,
      node.titleAlign,
      node.borderStyle,
      ctx.clip,
      left + node.width > ctx.offsetX + ctx.width,
      top + node.height > ctx.offsetY + ctx.height,
    )
  }
}

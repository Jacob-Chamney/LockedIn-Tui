/**
 * Raster shape backend for terminals with a graphics protocol.
 *
 * The same scene nodes are drawn as antialiased RGBA images through Kitty or
 * Sixel when the terminal supports them. Every other terminal keeps the Braille
 * cell rasteriser. Images are cached by geometry and colour, then disposed with
 * the scene layer.
 */
import { NativeImage, RGBA, type OptimizedBuffer } from "@opentui/core"

import type { ThemePalette } from "../../theme"
import type { SceneClip, SceneShape } from "./model"
import { shapeBox, shapeVisible } from "./raster"

export type SceneImages = { cellWidth: number; cellHeight: number }

const MAX_CACHE = 48
const MAX_PIXELS = 240_000
const cache = new Map<string, NativeImage>()

function rgb(value: string | undefined, palette: ThemePalette, fallback: string): [number, number, number] {
  let color = fallback
  if (value) {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) color = value
    else if (Object.prototype.hasOwnProperty.call(palette, value)) {
      color = palette[value as keyof ThemePalette]
    }
  }
  const ints = RGBA.fromHex(color).toInts()
  return [ints[0]!, ints[1]!, ints[2]!]
}

function imageKey(shape: SceneShape, width: number, height: number): string {
  return `${JSON.stringify(shape)}|${width}x${height}`
}

/** RGBA pixels for a shape; exposed for tests and future backends. */
export function rasterizeShapeImage(
  shape: SceneShape,
  pixelWidth: number,
  pixelHeight: number,
  palette: ThemePalette,
  background?: string,
): Uint8Array {
  const box = shapeBox(shape)
  const [r, g, b] = rgb(shape.color, palette, palette.accent)
  const data = new Uint8Array(pixelWidth * pixelHeight * 4)
  if (background) {
    const [br, bg, bb] = rgb(background, palette, palette.background)
    for (let index = 0; index < pixelWidth * pixelHeight; index++) {
      data[index * 4] = br
      data[index * 4 + 1] = bg
      data[index * 4 + 2] = bb
      data[index * 4 + 3] = 255
    }
  }
  // 2x2 samples per pixel give the edge a real alpha ramp.
  for (let py = 0; py < pixelHeight; py++) {
    for (let px = 0; px < pixelWidth; px++) {
      let coverage = 0
      for (const sy of [0.25, 0.75]) {
        for (const sx of [0.25, 0.75]) {
          const p = {
            x: ((px + sx) / pixelWidth) * box.width,
            y: ((py + sy) / pixelHeight) * box.height,
          }
          if (shapeVisible(shape, p)) coverage += 0.25
        }
      }
      if (coverage === 0) continue
      const index = (py * pixelWidth + px) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = Math.round(coverage * 255)
    }
  }
  return data
}

function render(
  shape: SceneShape,
  pixelWidth: number,
  pixelHeight: number,
  palette: ThemePalette,
  background: string | undefined,
): NativeImage {
  return NativeImage.fromRgba(
    rasterizeShapeImage(shape, pixelWidth, pixelHeight, palette, background),
    pixelWidth,
    pixelHeight,
  )
}

/** Draw a shape as an image; false means "use the cell rasteriser instead". */
export function drawShapeImage(
  buffer: OptimizedBuffer,
  shape: SceneShape,
  left: number,
  top: number,
  palette: ThemePalette,
  images: SceneImages,
  clip: SceneClip,
  background?: string,
): boolean {
  if (shape.kind === "progress") return false
  const box = shapeBox(shape)
  const cellsWide = Math.max(1, Math.ceil(box.width))
  const cellsHigh = Math.max(1, Math.ceil(box.height))
  // Images cannot be clipped by the cell clip rect; only use them when the
  // whole shape is inside it.
  if (
    left < clip.left ||
    top < clip.top ||
    left + cellsWide > clip.right ||
    top + cellsHigh > clip.bottom
  ) {
    return false
  }
  const pixelWidth = Math.max(2, Math.round(box.width * images.cellWidth))
  const pixelHeight = Math.max(2, Math.round(box.height * images.cellHeight))
  if (pixelWidth * pixelHeight > MAX_PIXELS) return false

  const key = `${imageKey(shape, pixelWidth, pixelHeight)}|${background ?? ""}`
  let image = cache.get(key)
  if (!image) {
    try {
      image = render(shape, pixelWidth, pixelHeight, palette, background)
    } catch {
      return false
    }
    cache.set(key, image)
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) {
        cache.get(oldest)?.dispose()
        cache.delete(oldest)
      }
    }
  }
  try {
    return buffer.drawImage(
      image,
      left,
      top,
      cellsWide,
      cellsHigh,
      pixelWidth,
      pixelHeight,
      0,
      0,
      pixelWidth,
      pixelHeight,
      "auto",
    )
  } catch {
    return false
  }
}

/** Dispose every cached image; call when the scene layer stops or reloads. */
export function clearSceneImageCache(): void {
  for (const image of cache.values()) image.dispose()
  cache.clear()
}

/**
 * Paint particles, trails and the lab cursor onto an OpenTUI cell buffer.
 *
 * Effects have three text layers:
 *   - around: only blank cells, so text is never touched (the current default)
 *   - under:  preserve the glyph and tint its background
 *   - over:   draw the effect glyph over whatever is there
 *
 * Under mode needs the existing cell style. We snapshot spans once per paint
 * and redraw the same glyph with a blended background.
 */
import { RGBA, type OptimizedBuffer } from "@opentui/core"

import type { ThemePalette } from "../theme"
import type { CursorTrail } from "./cursor"
import type { Particle } from "./particles"

export type TextLayer = "around" | "under" | "over"

type CellStyle = {
  char: string
  fg: RGBA
  bg: RGBA
}

type StyleMap = {
  width: number
  cells: Array<CellStyle | null>
}

function color(hex: string, alpha = 1): RGBA {
  const value = RGBA.fromHex(hex)
  return RGBA.fromValues(value.r, value.g, value.b, Math.max(0, Math.min(1, alpha)))
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const amount = Math.max(0, Math.min(1, t))
  return RGBA.fromValues(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
    a.a + (b.a - a.a) * amount,
  )
}

function charPlane(buffer: OptimizedBuffer): Uint32Array | null {
  try {
    return buffer.buffers.char
  } catch {
    return null
  }
}

function isBlank(chars: Uint32Array | null, width: number, x: number, y: number): boolean {
  if (!chars) return true
  return chars[y * width + x] === 32
}

function snapshot(buffer: OptimizedBuffer): StyleMap | null {
  const chars = charPlane(buffer)
  if (!chars) return null
  const width = buffer.width
  const cells: Array<CellStyle | null> = new Array(width * buffer.height).fill(null)
  let lines
  try {
    lines = buffer.getSpanLines()
  } catch {
    return null
  }
  for (let y = 0; y < Math.min(lines.length, buffer.height); y++) {
    let x = 0
    for (const span of lines[y]!.spans) {
      for (let offset = 0; offset < span.width && x < width; offset++, x++) {
        const code = chars[y * width + x] ?? 0
        // Blank cells have no glyph to preserve; effects draw normally there.
        if (code <= 32 || code > 0x10ffff) continue
        let char: string
        try {
          char = String.fromCodePoint(code)
        } catch {
          // Pooled grapheme ids and other internal values are not Unicode.
          continue
        }
        cells[y * width + x] = { char, fg: span.fg, bg: span.bg }
      }
    }
  }
  return { width, cells }
}

function styleAt(styles: StyleMap | null, x: number, y: number): CellStyle | null {
  if (!styles) return null
  return styles.cells[y * styles.width + x] ?? null
}

function particleColor(particle: Particle, palette: ThemePalette): RGBA {
  if (particle.color) return particle.color
  const t = particle.age / particle.life
  if (particle.mode === "fire") {
    const hot = color(palette.warning)
    const cool = color(palette.error)
    return mix(hot, cool, t)
  }
  if (particle.mode === "snow") {
    return color(palette.foreground, 0.45 + particle.seed * 0.45)
  }
  return mix(color(palette.accent), color(palette.primary), t)
}

export function paintParticles(
  buffer: OptimizedBuffer,
  particles: readonly Particle[],
  palette: ThemePalette,
  layer: TextLayer = "around",
): void {
  const chars = charPlane(buffer)
  // Only systems or particles that ask for `under` pay for the style snapshot.
  const styles = particles.some((particle) => (particle.layer ?? layer) === "under")
    ? snapshot(buffer)
    : null
  const background = color(palette.background)
  for (const particle of particles) {
    const at = particle.layer ?? layer
    const x = Math.round(particle.x)
    const y = Math.round(particle.y)
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) continue
    const blank = isBlank(chars, buffer.width, x, y)
    if (at === "around" && !blank) continue
    const particleTint = particleColor(particle, palette)
    if (at === "under") {
      const style = styleAt(styles, x, y)
      if (style) {
        buffer.setCell(x, y, style.char, style.fg, mix(style.bg, particleTint, 0.55))
      } else {
        buffer.setCell(x, y, particle.glyph, particleTint, background)
      }
      continue
    }
    buffer.setCell(x, y, particle.glyph, particleTint, background)
  }
}

export function paintTrail(
  buffer: OptimizedBuffer,
  trail: CursorTrail,
  palette: ThemePalette,
  layer: TextLayer = "around",
): void {
  const chars = charPlane(buffer)
  const styles = layer === "under" ? snapshot(buffer) : null
  const background = color(palette.background)
  for (const point of trail.points) {
    const x = Math.round(point.x)
    const y = Math.round(point.y)
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) continue
    const blank = isBlank(chars, buffer.width, x, y)
    if (layer === "around" && !blank) continue
    const strength = trail.strength(point)
    const tint = mix(background, color(palette.accent), 0.2 + strength * 0.4)
    if (layer === "under") {
      const style = styleAt(styles, x, y)
      if (style) {
        buffer.setCell(x, y, style.char, style.fg, mix(style.bg, color(palette.accent), 0.2 + strength * 0.4))
      } else {
        buffer.setCell(x, y, " ", background, tint)
      }
      continue
    }
    // Over: a tinted cell is enough; it does not need a glyph.
    buffer.setCell(x, y, " ", background, tint)
  }
}

export function paintCursor(
  buffer: OptimizedBuffer,
  x: number,
  y: number,
  palette: ThemePalette,
  layer: TextLayer = "under",
): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
  const chars = charPlane(buffer)
  if (layer === "around" && !isBlank(chars, buffer.width, x, y)) return
  const styles = layer === "under" ? snapshot(buffer) : null
  const background = color(palette.background)
  const primary = color(palette.primary)
  const style = styleAt(styles, x, y)
  if (layer === "under" && style) {
    buffer.setCell(x, y, style.char, style.fg, mix(style.bg, primary, 0.65))
    return
  }
  buffer.setCell(x, y, "█", primary, background)
}

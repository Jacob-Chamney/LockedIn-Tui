/**
 * Geometric source drawings for the achievement ASCII renderer.
 *
 * Every picture is drawn into an 80x48 RGBA canvas with a small shape toolkit.
 * `ascii.ts` samples that canvas into a printable ASCII grid; nothing here is
 * rendered as an image or a block glyph.
 */
import type { Achievement, AchievementCategory } from "../../domain/achievements";
export const ART_WIDTH = 80
export const ART_HEIGHT = 48

type Rgba = readonly [number, number, number, number]
type Point = readonly [number, number]

const WHITE: Rgba = [240, 244, 248, 255]
const RED: Rgba = [220, 70, 70, 255]

type Palette = {
  main: Rgba
  light: Rgba
  dark: Rgba
  accent: Rgba
}

function hex(value: string): Rgba {
  const clean = value.replace("#", "")
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
    255,
  ]
}

const PALETTES: Record<AchievementCategory, Palette> = {
  starter: { main: hex("f4b860"), light: hex("ffe6b8"), dark: hex("8a5a22"), accent: hex("ff7a59") },
  learning: { main: hex("4fd1c5"), light: hex("b2f5ea"), dark: hex("1d5c56"), accent: hex("38bdf8") },
  work: { main: hex("ff6b6b"), light: hex("ffc1c1"), dark: hex("7a2626"), accent: hex("f59e0b") },
  collection: { main: hex("b794f6"), light: hex("e9d8fd"), dark: hex("4c2f7a"), accent: hex("f472b6") },
}

class Canvas {
  readonly pixels = new Uint8Array(ART_WIDTH * ART_HEIGHT * 4)

  set(x: number, y: number, colour: Rgba): void {
    if (x < 0 || y < 0 || x >= ART_WIDTH || y >= ART_HEIGHT) return
    if (colour[3] === 0) return
    const at = (Math.floor(y) * ART_WIDTH + Math.floor(x)) * 4
    this.pixels[at] = colour[0]
    this.pixels[at + 1] = colour[1]
    this.pixels[at + 2] = colour[2]
    this.pixels[at + 3] = colour[3]
  }

  rect(x: number, y: number, width: number, height: number, colour: Rgba): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) this.set(column, row, colour)
    }
  }

  frame(x: number, y: number, width: number, height: number, thickness: number, colour: Rgba): void {
    this.rect(x, y, width, thickness, colour)
    this.rect(x, y + height - thickness, width, thickness, colour)
    this.rect(x, y, thickness, height, colour)
    this.rect(x + width - thickness, y, thickness, height, colour)
  }

  dot(x: number, y: number, radius: number, colour: Rgba): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + radius) this.set(x + dx, y + dy, colour)
      }
    }
  }

  erase(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= ART_WIDTH || y >= ART_HEIGHT) return
    const at = (Math.floor(y) * ART_WIDTH + Math.floor(x)) * 4
    this.pixels[at] = 0
    this.pixels[at + 1] = 0
    this.pixels[at + 2] = 0
    this.pixels[at + 3] = 0
  }

  eraseRect(x: number, y: number, width: number, height: number): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) this.erase(column, row)
    }
  }

  eraseCircle(cx: number, cy: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius + radius) this.erase(cx + dx, cy + dy)
      }
    }
  }

  circle(cx: number, cy: number, radius: number, colour: Rgba, filled = true): void {
    if (filled) {
      this.dot(cx, cy, radius, colour)
      return
    }
    for (let angle = 0; angle < 360; angle += 2) {
      const radians = (angle * Math.PI) / 180
      this.set(Math.round(cx + Math.cos(radians) * radius), Math.round(cy + Math.sin(radians) * radius), colour)
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, colour: Rgba, thickness = 2): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2
    if (steps === 0) {
      this.dot(x0, y0, Math.max(0, Math.floor(thickness / 2)), colour)
      return
    }
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      this.dot(x, y, Math.max(0, Math.floor(thickness / 2)), colour)
    }
  }

  polygon(points: readonly Point[], colour: Rgba): void {
    if (points.length < 3) return
    const ys = points.map((point) => point[1])
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    for (let y = min; y <= max; y++) {
      const crossings: number[] = []
      for (let index = 0; index < points.length; index++) {
        const a = points[index]!
        const b = points[(index + 1) % points.length]!
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
        }
      }
      crossings.sort((a, b) => a - b)
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        for (let x = Math.ceil(crossings[index]!); x <= Math.floor(crossings[index + 1]!); x++) {
          this.set(x, y, colour)
        }
      }
    }
  }

  text(x: number, y: number, value: string, colour: Rgba, scale = 2): void {
    let cursor = x
    for (const character of value.toUpperCase()) {
      const glyph = FONT[character]
      if (glyph === undefined) {
        cursor += 6 * scale
        continue
      }
      glyph.forEach((row, rowIndex) => {
        row.split("").forEach((cell, columnIndex) => {
          if (cell === "1") this.rect(cursor + columnIndex * scale, y + rowIndex * scale, scale, scale, colour)
        })
      })
      cursor += 6 * scale
    }
  }
}

const FONT: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
}

function star(canvas: Canvas, cx: number, cy: number, radius: number, colour: Rgba): void {
  const points: Point[] = []
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const length = index % 2 === 0 ? radius : radius / 2
    points.push([cx + Math.cos(angle) * length, cy + Math.sin(angle) * length])
  }
  canvas.polygon(points, colour)
}


function drawSun(canvas: Canvas, p: Palette): void {
  canvas.circle(40, 24, 9, p.main)
  for (let angle = 0; angle < 360; angle += 45) {
    const radians = (angle * Math.PI) / 180
    canvas.line(
      Math.round(40 + Math.cos(radians) * 14),
      Math.round(24 + Math.sin(radians) * 14),
      Math.round(40 + Math.cos(radians) * 20),
      Math.round(24 + Math.sin(radians) * 20),
      p.light,
      2,
    )
  }
}

function drawOpenBook(canvas: Canvas, p: Palette): void {
  // Two covers with an open gutter, so the silhouette reads as a book.
  canvas.polygon([[8, 15], [38, 9], [38, 40], [8, 35]], p.main)
  canvas.polygon([[42, 9], [72, 15], [72, 35], [42, 40]], p.main)
  canvas.polygon([[13, 18], [35, 13], [35, 36], [13, 31]], p.light)
  canvas.polygon([[45, 13], [67, 18], [67, 31], [45, 36]], p.light)
  canvas.rect(36, 9, 8, 31, p.dark)
  canvas.line(39, 9, 39, 40, p.accent, 1)
  for (const y of [20, 25, 30]) {
    canvas.line(18, y, 32, y - 2, p.dark, 1)
    canvas.line(48, y - 2, 62, y, p.dark, 1)
  }
  canvas.polygon([[33, 10], [38, 10], [38, 20], [35, 17], [33, 20]], p.accent)
}

function drawPaper(canvas: Canvas, p: Palette): void {
  canvas.rect(22, 7, 36, 36, p.light)
  canvas.frame(22, 7, 36, 36, 2, p.dark)
  canvas.polygon([[50, 7], [58, 7], [58, 15]], p.main)
  for (const y of [18, 24, 30]) canvas.line(28, y, 52, y, p.dark, 1)
}

function drawShovel(canvas: Canvas, p: Palette): void {
  // D-grip, straight shaft, then a pointed spade blade.
  canvas.frame(30, 5, 20, 13, 2, p.main)
  canvas.rect(38, 18, 4, 12, p.dark)
  canvas.polygon([[27, 28], [53, 28], [50, 39], [40, 45], [30, 39]], p.main)
  canvas.polygon([[32, 31], [48, 31], [46, 37], [40, 41], [34, 37]], p.light)
  canvas.line(40, 31, 40, 39, p.dark, 1)
}

function drawBookshelf(canvas: Canvas, p: Palette): void {
  canvas.frame(14, 6, 52, 36, 3, p.dark)
  for (const y of [17, 28]) canvas.rect(17, y, 46, 2, p.dark)
  const books = [
    [18, 8, 6, 9, p.main],
    [25, 10, 5, 7, p.light],
    [31, 7, 7, 10, p.accent],
    [40, 9, 5, 8, p.main],
    [46, 7, 6, 10, p.light],
    [53, 10, 5, 7, p.accent],
    [18, 19, 6, 9, p.accent],
    [25, 21, 5, 7, p.light],
    [31, 19, 7, 9, p.main],
    [40, 20, 6, 8, p.light],
    [47, 19, 5, 9, p.accent],
    [53, 21, 5, 7, p.main],
    [18, 30, 7, 9, p.light],
    [26, 29, 5, 10, p.main],
    [32, 31, 6, 8, p.accent],
    [40, 29, 7, 10, p.light],
    [48, 31, 5, 8, p.main],
    [54, 29, 4, 10, p.accent],
  ] as const
  for (const [x, y, w, h, colour] of books) canvas.rect(x, y, w, h, colour)
}

function drawWrench(canvas: Canvas, p: Palette): void {
  // Open-end wrench: a thick diagonal handle and a C-shaped jaw.
  canvas.line(23, 40, 51, 18, p.dark, 9)
  canvas.line(23, 40, 51, 18, p.main, 6)
  canvas.line(27, 38, 53, 17, p.light, 1)
  canvas.circle(56, 13, 12, p.dark)
  canvas.circle(56, 13, 10, p.main)
  canvas.eraseCircle(56, 13, 5)
  canvas.eraseRect(56, 0, 18, 10)
  canvas.circle(56, 13, 5, p.light, false)
}

function drawApplication(canvas: Canvas, p: Palette): void {
  canvas.rect(20, 6, 40, 36, p.light)
  canvas.frame(20, 6, 40, 36, 2, p.dark)
  canvas.rect(26, 12, 12, 12, WHITE)
  canvas.frame(26, 12, 12, 12, 1, p.dark)
  canvas.line(29, 18, 32, 21, p.main, 2)
  canvas.line(32, 21, 37, 14, p.main, 2)
  for (const y of [14, 18, 22, 28, 32]) canvas.line(42, y, 55, y, p.dark, 1)
  canvas.circle(58, 36, 5, p.accent)
  canvas.line(56, 36, 58, 38, WHITE, 1)
  canvas.line(58, 38, 61, 34, WHITE, 1)
}

function drawShoe(canvas: Canvas, p: Palette): void {
  // Side-view sneaker: ankle collar, laces, toe cap and a thin sole.
  canvas.polygon([[10, 38], [10, 27], [18, 22], [27, 22], [32, 27], [40, 24], [50, 27], [60, 29], [70, 33], [74, 38]], p.main)
  canvas.rect(10, 38, 64, 5, p.dark)
  canvas.line(11, 26, 26, 26, p.dark, 2)
  canvas.line(31, 28, 40, 29, p.light, 1)
  canvas.line(40, 28, 49, 31, p.light, 1)
  canvas.line(60, 31, 72, 36, p.light, 1)
  canvas.line(10, 39, 74, 39, p.light, 1)
}
function drawBoot(canvas: Canvas, p: Palette): void {
  canvas.polygon([[18, 12], [40, 8], [46, 26], [58, 30], [66, 35], [66, 40], [18, 40]], p.main)
  canvas.rect(18, 38, 48, 3, p.dark)
  for (const y of [15, 20, 25]) canvas.line(22, y, 38, y - 2, p.light, 1)
  canvas.line(22, 10, 40, 6, p.light, 2)
}

function drawBareFoot(canvas: Canvas, p: Palette): void {
  // Top-down footprint: five toes, ball, arch, heel and two cuts.
  canvas.polygon([[28, 14], [52, 14], [58, 23], [55, 33], [48, 42], [32, 42], [24, 33], [21, 23]], p.main)
  canvas.circle(40, 39, 7, p.main)
  for (let index = 0; index < 5; index++) {
    canvas.circle(20 + index * 10, 10 - Math.abs(index - 2) * 2, 3, p.light)
  }
  canvas.polygon([[31, 17], [49, 17], [53, 23], [47, 29], [33, 29], [27, 23]], p.light)
  canvas.line(32, 19, 44, 24, RED, 2)
  canvas.line(35, 30, 48, 34, RED, 2)
}
function drawFlashcard(canvas: Canvas, p: Palette): void {
  canvas.rect(16, 10, 48, 28, p.light)
  canvas.frame(16, 10, 48, 28, 2, p.dark)
  for (const y of [17, 23, 29]) canvas.line(23, y, 50, y, p.dark, 1)
  star(canvas, 60, 15, 6, p.accent)
}

function drawScepter(canvas: Canvas, p: Palette): void {
  canvas.line(40, 20, 40, 44, p.main, 4)
  canvas.line(32, 16, 40, 8, p.accent, 2)
  canvas.line(40, 8, 48, 16, p.accent, 2)
  canvas.circle(40, 17, 8, p.main)
  canvas.circle(40, 17, 3, p.light)
  for (const [x, y] of [[28, 10], [52, 10], [26, 24], [54, 24]] as const) star(canvas, x, y, 4, p.accent)
}

function drawCamera(canvas: Canvas, p: Palette): void {
  canvas.rect(14, 16, 52, 24, p.main)
  canvas.rect(20, 11, 16, 6, p.dark)
  canvas.circle(40, 28, 10, p.light)
  canvas.circle(40, 28, 5, p.dark)
  canvas.circle(40, 28, 2, p.light)
  canvas.circle(59, 20, 3, p.accent)
}

function drawUturn(canvas: Canvas, p: Palette): void {
  // A U-turn road sign makes the arrow unmistakable.
  canvas.rect(12, 8, 56, 34, p.light)
  canvas.frame(12, 8, 56, 34, 2, p.dark)
  canvas.line(27, 32, 27, 18, p.main, 5)
  canvas.line(27, 18, 53, 18, p.main, 5)
  canvas.line(53, 18, 53, 27, p.main, 5)
  canvas.polygon([[45, 25], [61, 25], [53, 36]], p.accent)
  canvas.line(24, 30, 24, 21, p.accent, 1)
}
function drawBrain(canvas: Canvas, p: Palette): void {
  // Side-view brain: domed cortex, folded gyri, cerebellum and brain stem.
  canvas.polygon([
    [18, 30], [17, 21], [22, 13], [30, 9], [39, 7], [48, 8], [56, 12],
    [62, 18], [64, 26], [61, 32], [64, 38], [58, 42], [51, 40], [46, 44],
    [40, 40], [33, 43], [26, 39], [20, 36],
  ], p.main)
  canvas.circle(53, 37, 6, p.accent)
  canvas.rect(42, 42, 6, 5, p.dark)
  canvas.line(40, 8, 40, 28, p.dark, 2)
  for (const [x0, y0, x1, y1] of [
    [24, 17, 33, 21], [33, 21, 25, 27], [28, 29, 37, 34],
    [45, 14, 54, 19], [45, 20, 55, 25], [43, 28, 50, 33],
    [32, 36, 38, 30], [48, 30, 53, 35],
  ] as const) canvas.line(x0, y0, x1, y1, p.light, 1)
}
function drawScroll(canvas: Canvas, p: Palette): void {
  canvas.rect(16, 8, 48, 32, p.light)
  canvas.frame(16, 8, 48, 32, 2, p.dark)
  canvas.rect(12, 6, 56, 4, p.main)
  canvas.rect(12, 38, 56, 4, p.main)
  canvas.line(18, 12, 62, 12, p.accent, 1)
  canvas.line(18, 36, 62, 36, p.accent, 1)
  canvas.line(26, 20, 34, 28, p.main, 3)
  canvas.line(34, 28, 54, 16, p.main, 3)
}

function drawMortarboard(canvas: Canvas, p: Palette): void {
  canvas.polygon([[20, 20], [40, 10], [60, 20], [40, 30]], p.main)
  canvas.rect(28, 24, 24, 8, p.dark)
  canvas.line(56, 19, 62, 34, p.accent, 2)
  canvas.circle(22, 38, 5, p.light, false)
  canvas.circle(31, 38, 5, p.light, false)
}

function drawPage(canvas: Canvas, p: Palette): void {
  canvas.rect(20, 7, 40, 35, p.light)
  canvas.frame(20, 7, 40, 35, 2, p.dark)
  for (const y of [16, 22, 28, 34]) canvas.line(27, y, 51, y, p.dark, 1)
  canvas.polygon([[50, 7], [60, 7], [60, 22], [55, 18], [50, 22]], p.accent)
}

function drawHourglass(canvas: Canvas, p: Palette): void {
  canvas.polygon([[24, 7], [56, 7], [42, 23], [42, 27], [56, 41], [24, 41], [38, 27], [38, 23]], p.light)
  canvas.rect(22, 5, 36, 3, p.dark)
  canvas.rect(22, 41, 36, 3, p.dark)
  canvas.polygon([[35, 33], [45, 33], [42, 39], [38, 39]], p.main)
  canvas.circle(40, 18, 3, p.main)
}

function drawMileMarker(canvas: Canvas, p: Palette): void {
  canvas.rect(37, 18, 6, 25, p.dark)
  canvas.rect(15, 8, 50, 18, p.main)
  canvas.frame(15, 8, 50, 18, 2, p.light)
  canvas.text(22, 12, "10K", p.dark, 2)
}

function drawHelmet(canvas: Canvas, p: Palette): void {
  canvas.circle(40, 25, 16, p.main)
  canvas.rect(24, 25, 32, 12, p.main)
  canvas.rect(28, 18, 24, 10, p.dark)
  canvas.line(40, 8, 40, 16, p.accent, 2)
  canvas.line(24, 36, 32, 42, p.light, 2)
  canvas.line(56, 36, 48, 42, p.light, 2)
  canvas.line(34, 30, 46, 30, p.light, 2)
}

function drawMegaphone(canvas: Canvas, p: Palette): void {
  canvas.polygon([[18, 20], [46, 12], [46, 36], [18, 28]], p.main)
  canvas.rect(14, 20, 8, 8, p.dark)
  canvas.rect(28, 28, 8, 12, p.dark)
  for (const radius of [8, 13, 18]) {
    for (let angle = -35; angle <= 35; angle += 6) {
      const radians = (angle * Math.PI) / 180
      canvas.set(Math.round(54 + Math.cos(radians) * radius), Math.round(24 + Math.sin(radians) * radius), p.light)
    }
  }
}

function drawHammerAnvil(canvas: Canvas, p: Palette): void {
  // Toolsmith: the clear open-end wrench plus a small gear.
  drawWrench(canvas, p)
  canvas.circle(64, 37, 6, p.accent)
  canvas.circle(64, 37, 2, p.dark)
  for (let angle = 0; angle < 360; angle += 45) {
    const radians = (angle * Math.PI) / 180
    canvas.rect(Math.round(64 + Math.cos(radians) * 7) - 1, Math.round(37 + Math.sin(radians) * 7) - 1, 3, 3, p.accent)
  }
}
function drawGear(canvas: Canvas, p: Palette): void {
  canvas.circle(40, 24, 13, p.main)
  canvas.circle(40, 24, 6, p.dark)
  for (let angle = 0; angle < 360; angle += 45) {
    const radians = (angle * Math.PI) / 180
    canvas.rect(
      Math.round(40 + Math.cos(radians) * 15) - 3,
      Math.round(24 + Math.sin(radians) * 15) - 3,
      6,
      6,
      p.main,
    )
  }
}

function drawToolbox(canvas: Canvas, p: Palette): void {
  canvas.rect(12, 20, 56, 22, p.main)
  canvas.frame(12, 20, 56, 22, 2, p.dark)
  canvas.rect(28, 10, 24, 10, p.dark)
  canvas.rect(22, 23, 36, 4, p.light)
  canvas.rect(36, 27, 8, 7, p.dark)
}

function drawCompass(canvas: Canvas, p: Palette): void {
  canvas.circle(40, 12, 5, p.main)
  canvas.line(40, 17, 25, 41, p.main, 3)
  canvas.line(40, 17, 55, 41, p.main, 3)
  canvas.line(25, 41, 21, 44, p.light, 2)
  canvas.line(55, 41, 59, 44, p.dark, 2)
  canvas.circle(40, 13, 2, p.light)
  canvas.line(30, 30, 50, 30, p.dark, 1)
}

function drawSkyline(canvas: Canvas, p: Palette): void {
  const buildings = [
    [8, 26, 12, 16], [22, 16, 10, 26], [34, 22, 12, 20],
    [48, 10, 10, 32], [60, 20, 12, 22],
  ] as const
  for (const [x, y, w, h] of buildings) {
    canvas.rect(x, y, w, h, p.main)
    canvas.frame(x, y, w, h, 1, p.dark)
    for (let wy = y + 3; wy < y + h - 2; wy += 5) {
      for (let wx = x + 3; wx < x + w - 2; wx += 5) canvas.rect(wx, wy, 2, 2, p.light)
    }
  }
  canvas.rect(6, 42, 68, 2, p.dark)
}

function drawNetwork(canvas: Canvas, p: Palette): void {
  const nodes: Point[] = [[40, 10], [18, 26], [62, 26], [30, 40], [52, 40]]
  for (const [x, y] of nodes) canvas.circle(x, y, 5, p.main)
  for (let index = 0; index < nodes.length; index++) {
    for (let next = index + 1; next < nodes.length; next++) {
      canvas.line(nodes[index]![0], nodes[index]![1], nodes[next]![0], nodes[next]![1], p.light, 1)
    }
  }
}

function drawBeehive(canvas: Canvas, p: Palette): void {
  // Honeycomb: one large cell with three small cells and a bee.
  const hex = (cx: number, cy: number, radius: number, colour: Rgba): void => {
    canvas.polygon([
      [cx, cy - radius], [cx + radius, cy - radius / 2], [cx + radius, cy + radius / 2],
      [cx, cy + radius], [cx - radius, cy + radius / 2], [cx - radius, cy - radius / 2],
    ], colour)
  }
  hex(40, 26, 20, p.main)
  hex(32, 18, 7, p.dark)
  hex(48, 18, 7, p.dark)
  hex(40, 31, 7, p.accent)
  canvas.circle(66, 12, 3, p.light)
  canvas.line(61, 10, 65, 12, p.light, 1)
  canvas.line(65, 12, 70, 10, p.light, 1)
}
function drawMagnifier(canvas: Canvas, p: Palette): void {
  canvas.rect(16, 10, 34, 30, p.light)
  for (const y of [16, 21, 26, 31]) canvas.line(22, y, 42, y, p.dark, 1)
  canvas.circle(38, 22, 14, p.main, false)
  canvas.line(48, 32, 64, 43, p.dark, 4)
}

function drawLibrary(canvas: Canvas, p: Palette): void {
  canvas.polygon([[12, 18], [40, 6], [68, 18]], p.main)
  canvas.rect(14, 18, 52, 4, p.dark)
  for (const x of [18, 28, 38, 48, 58]) canvas.rect(x, 22, 5, 18, p.light)
  canvas.rect(12, 40, 56, 3, p.dark)
}

function drawLock(canvas: Canvas, p: Palette): void {
  canvas.circle(40, 20, 12, p.main, false)
  canvas.rect(28, 20, 24, 22, p.main)
  canvas.frame(28, 20, 24, 22, 2, p.dark)
  canvas.circle(40, 30, 3, p.dark)
  canvas.rect(39, 31, 3, 6, p.dark)
}

function drawCalendar(canvas: Canvas, p: Palette): void {
  canvas.rect(14, 9, 52, 34, p.light)
  canvas.frame(14, 9, 52, 34, 2, p.dark)
  canvas.rect(14, 9, 52, 8, p.main)
  canvas.rect(22, 5, 4, 8, p.dark)
  canvas.rect(54, 5, 4, 8, p.dark)
  for (const [x, y] of [[24, 25], [34, 25], [44, 25], [24, 33], [34, 33]] as const) canvas.rect(x, y, 3, 3, p.dark)
  canvas.line(46, 34, 50, 38, p.accent, 2)
  canvas.line(50, 38, 58, 27, p.accent, 2)
}

function drawBinder(canvas: Canvas, p: Palette): void {
  canvas.rect(16, 8, 48, 34, p.main)
  canvas.frame(16, 8, 48, 34, 2, p.dark)
  for (const y of [14, 24, 34]) canvas.circle(16, y, 4, p.light)
  for (const [y, colour] of [[12, p.light], [23, p.accent], [34, p.light]] as const) {
    canvas.rect(54, y, 12, 8, colour)
  }
}

function drawOwl(canvas: Canvas, p: Palette): void {
  // Owl bust: big head, ear tufts, face discs, eyes, beak and mortarboard.
  canvas.circle(40, 28, 18, p.main)
  canvas.polygon([[23, 18], [27, 5], [35, 17]], p.main)
  canvas.polygon([[57, 18], [53, 5], [45, 17]], p.main)
  canvas.circle(32, 25, 9, p.light)
  canvas.circle(48, 25, 9, p.light)
  canvas.circle(32, 25, 4, p.dark)
  canvas.circle(48, 25, 4, p.dark)
  canvas.circle(33, 24, 1, p.light)
  canvas.circle(49, 24, 1, p.light)
  canvas.polygon([[36, 30], [44, 30], [40, 36]], p.accent)
  canvas.polygon([[17, 14], [40, 3], [63, 14], [40, 22]], p.accent)
  canvas.line(59, 13, 66, 26, p.accent, 2)
}
function drawIcon(id: string, canvas: Canvas, p: Palette): void {
  switch (id) {
    case "first-light": return drawSun(canvas, p)
    case "open-book": return drawOpenBook(canvas, p)
    case "blank-canvas": return drawPaper(canvas, p)
    case "groundwork": return drawShovel(canvas, p)
    case "well-read": return drawBookshelf(canvas, p)
    case "first-tool": return drawWrench(canvas, p)
    case "first-lesson": { canvas.text(24, 12, "A+", p.main, 4); return }
    case "first-hire": return drawApplication(canvas, p)
    case "first-steps": return drawShoe(canvas, p)
    case "long-march": return drawBoot(canvas, p)
    case "long-walk": return drawBareFoot(canvas, p)
    case "memory-palace": return drawFlashcard(canvas, p)
    case "grandmaster": return drawScepter(canvas, p)
    case "eidetic": return drawCamera(canvas, p)
    case "course-correction": return drawUturn(canvas, p)
    case "lesson-master": return drawBrain(canvas, p)
    case "curriculum-complete": return drawScroll(canvas, p)
    case "lifelong-curriculum": return drawMortarboard(canvas, p)
    case "chapter-and-verse": return drawPage(canvas, p)
    case "shelf-life": return drawHourglass(canvas, p)
    case "ten-runs": return drawMileMarker(canvas, p)
    case "centurion": return drawHelmet(canvas, p)
    case "thousand-voices": return drawMegaphone(canvas, p)
    case "toolsmith": return drawHammerAnvil(canvas, p)
    case "machinist": return drawGear(canvas, p)
    case "workshop": return drawToolbox(canvas, p)
    case "architect": return drawCompass(canvas, p)
    case "metropolis": return drawSkyline(canvas, p)
    case "swarmkeeper": return drawNetwork(canvas, p)
    case "hive-mind": return drawBeehive(canvas, p)
    case "research-desk": return drawMagnifier(canvas, p)
    case "library": return drawLibrary(canvas, p)
    case "locked-in": return drawLock(canvas, p)
    case "semester": return drawCalendar(canvas, p)
    case "curriculum-collector": return drawBinder(canvas, p)
    case "lifelong-learner": return drawOwl(canvas, p)
    default: {
      canvas.text(28, 14, "?", p.main, 3)
      return
    }
  }
}

function framed(source: Canvas): Uint8Array {
  let minX = ART_WIDTH
  let minY = ART_HEIGHT
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < ART_HEIGHT; y++) {
    for (let x = 0; x < ART_WIDTH; x++) {
      if ((source.pixels[(y * ART_WIDTH + x) * 4 + 3] ?? 0) === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return source.pixels

  const padding = 2
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(ART_WIDTH - 1, maxX + padding)
  maxY = Math.min(ART_HEIGHT - 1, maxY + padding)
  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  const targetWidth = ART_WIDTH - 8
  const targetHeight = ART_HEIGHT - 8
  const scale = Math.min(targetWidth / cropWidth, targetHeight / cropHeight)
  const width = Math.max(1, Math.floor(cropWidth * scale))
  const height = Math.max(1, Math.floor(cropHeight * scale))
  const left = Math.floor((ART_WIDTH - width) / 2)
  const top = Math.floor((ART_HEIGHT - height) / 2)
  const out = new Canvas()
  for (let y = 0; y < height; y++) {
    const sourceY = minY + Math.min(cropHeight - 1, Math.floor((y * cropHeight) / height))
    for (let x = 0; x < width; x++) {
      const sourceX = minX + Math.min(cropWidth - 1, Math.floor((x * cropWidth) / width))
      const at = (sourceY * ART_WIDTH + sourceX) * 4
      out.set(left + x, top + y, [
        source.pixels[at] ?? 0,
        source.pixels[at + 1] ?? 0,
        source.pixels[at + 2] ?? 0,
        source.pixels[at + 3] ?? 0,
      ])
    }
  }
  return out.pixels
}

export function achievementArt(achievement: Pick<Achievement, "id" | "category">): {
  pixels: Uint8Array
  width: number
  height: number
} {
  const canvas = new Canvas()
  drawIcon(achievement.id, canvas, PALETTES[achievement.category])
  return { pixels: framed(canvas), width: ART_WIDTH, height: ART_HEIGHT }
}

export const ICON_IDS = [
  "first-light", "open-book", "blank-canvas", "groundwork", "well-read", "first-tool",
  "first-lesson", "first-hire", "first-steps", "long-march", "long-walk", "memory-palace",
  "grandmaster", "eidetic", "course-correction", "lesson-master", "curriculum-complete",
  "lifelong-curriculum", "chapter-and-verse", "shelf-life", "ten-runs", "centurion",
  "thousand-voices", "toolsmith", "machinist", "workshop", "architect", "metropolis",
  "swarmkeeper", "hive-mind", "research-desk", "library", "locked-in", "semester",
  "curriculum-collector", "lifelong-learner",
] as const

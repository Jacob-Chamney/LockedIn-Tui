/**
 * Donut charts: a multi-segment braille ring with a fitted legend.
 *
 * One implementation serves the plugin SDK (`donut()` paints the ring) and the
 * app's Usage panel. Ring cells take the segment whose share contains their
 * clockwise angle; the centre stays hollow. The legend pairs each segment with
 * its rounded percentage and fits long labels with an ellipsis.
 */
export type DonutSegmentInput = {
  label: string
  value: number
}

export type DonutSegment = DonutSegmentInput & {
  index: number
  fraction: number
  percent: number
  start: number
  end: number
}

export type DonutCell = {
  text: string
  x: number
  segment: number
}

export type DonutRow = {
  text: string
  cells: DonutCell[]
}

export type DonutOptions = {
  segments: readonly DonutSegmentInput[]
  /** Character width; defaults 8. Height is about half of this. */
  size?: number
  /** Ring thickness as a share of the radius; defaults 0.36. */
  thickness?: number
}

export type DonutLayout = {
  rows: DonutRow[]
  segments: DonutSegment[]
  total: number
  size: number
  height: number
}

export type DonutLegendRow = {
  text: string
  segment: DonutSegment
  index: number
}

export type DonutLegendOptions = {
  segments: readonly DonutSegment[]
  width: number
  /** Rows kept; defaults 4. */
  maxRows?: number
  /** Bullet glyph; defaults `●`. */
  marker?: string
}

export type DonutLegendLayout = {
  rows: DonutLegendRow[]
  hidden: number
  width: number
}

const DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0x01],
  [0, 1, 0x02],
  [0, 2, 0x04],
  [1, 0, 0x08],
  [1, 1, 0x10],
  [1, 2, 0x20],
  [0, 3, 0x40],
  [1, 3, 0x80],
]

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function donutSegments(segments: readonly DonutSegmentInput[]): DonutSegment[] {
  const values = segments.map((segment) => finite(segment.value))
  const total = values.reduce((sum, value) => sum + value, 0)
  let start = 0
  return segments.map((segment, index) => {
    const fraction = total === 0 ? 0 : values[index]! / total
    const end = start + fraction
    const out: DonutSegment = {
      label: segment.label,
      value: values[index]!,
      index,
      fraction,
      percent: Math.round(fraction * 100),
      start,
      end,
    }
    start = end
    return out
  })
}

export function donutLayout(options: DonutOptions): DonutLayout {
  const size = Math.max(4, Math.floor(options.size ?? 8))
  const height = Math.max(2, Math.round(size / 2))
  const dotWidth = size * 2
  const dotHeight = height * 4
  const centerX = (dotWidth - 1) / 2
  const centerY = (dotHeight - 1) / 2
  const outer = Math.min(dotWidth, dotHeight) / 2 - 0.25
  const thickness = clamp(options.thickness ?? 0.36, 0.1, 0.9)
  const inner = outer * (1 - thickness)
  const segments = donutSegments(options.segments)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const at = (fraction: number): number => {
    if (total <= 0) return -1
    return segments.find((segment) => fraction < segment.end)?.index ?? segments.length - 1
  }

  const rows: DonutRow[] = []
  for (let row = 0; row < height; row++) {
    const cells: DonutCell[] = []
    for (let column = 0; column < size; column++) {
      let bits = 0
      let ring = false
      for (const [dx, dy, bit] of DOTS) {
        const x = column * 2 + dx
        const y = row * 4 + dy
        const distance = Math.hypot(x - centerX, y - centerY)
        if (distance < inner || distance > outer) continue
        bits |= bit
        ring = true
      }
      const cellX = column * 2 + 0.5
      const cellY = row * 4 + 1.5
      const angle = Math.atan2(cellX - centerX, -(cellY - centerY))
      const clockwise = angle < 0 ? angle + Math.PI * 2 : angle
      cells.push({
        text: bits === 0 ? " " : String.fromCharCode(0x2800 + bits),
        x: column,
        segment: ring ? at(clockwise / (Math.PI * 2)) : -1,
      })
    }
    rows.push({ text: cells.map((cell) => cell.text).join(""), cells })
  }

  return { rows, segments, total, size, height }
}

export function donutLegendLayout(options: DonutLegendOptions): DonutLegendLayout {
  const width = Math.max(0, Math.floor(options.width))
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? 4))
  const marker = options.marker ?? "●"
  if (width === 0) return { rows: [], hidden: options.segments.length, width }
  const visible = options.segments.slice(0, maxRows)
  const rows = visible.map((segment) => {
    const share = `${segment.percent}%`
    const room = Math.max(1, width - marker.length - 2 - share.length)
    const text = `${marker} ${fit(segment.label, room).padEnd(room)} ${share}`.slice(0, width)
    return { text, segment, index: segment.index }
  })
  return { rows, hidden: options.segments.length - visible.length, width }
}

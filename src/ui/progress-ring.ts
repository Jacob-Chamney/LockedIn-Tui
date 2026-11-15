/**
 * Progress rings: a braille annulus with a filled arc and a percentage.
 *
 * One implementation serves the plugin SDK (`progressRing()` paints the ring)
 * and the app's Stats hero. The ring is drawn on a braille dot grid, so it
 * stays crisp at small sizes; cells holding ring dots are marked filled when
 * their angle falls inside the progress arc. The centre stays hollow and the
 * label carries the number, so colour is never the only signal.
 */
export type ProgressRingOptions = {
  /** Progress from 0 to 1; clamped. */
  value: number
  /** Character width; defaults 6. Height is about half of this. */
  size?: number
  /** Ring thickness as a share of the radius; defaults 0.36. */
  thickness?: number
  /** Text label; defaults to the rounded percentage. */
  label?: string
}

export type ProgressRingCell = {
  text: string
  x: number
  width: number
  filled: boolean
}

export type ProgressRingRow = {
  text: string
  cells: ProgressRingCell[]
}

export type ProgressRingLayout = {
  rows: ProgressRingRow[]
  value: number
  percent: number
  label: string
  width: number
  height: number
}

/** Braille dot offsets and their bit values within one cell. */
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function progressRingLayout(options: ProgressRingOptions): ProgressRingLayout {
  const value = clamp(Number.isFinite(options.value) ? options.value : 0, 0, 1)
  const width = Math.max(3, Math.floor(options.size ?? 6))
  const height = Math.max(2, Math.round(width / 2))
  const dotWidth = width * 2
  const dotHeight = height * 4
  const centerX = (dotWidth - 1) / 2
  const centerY = (dotHeight - 1) / 2
  const outer = Math.min(dotWidth, dotHeight) / 2 - 0.25
  const thickness = clamp(options.thickness ?? 0.36, 0.1, 0.9)
  const inner = outer * (1 - thickness)
  const percent = Math.round(value * 100)
  const label = options.label ?? `${percent}%`
  const cutoff = value * Math.PI * 2

  const rows: ProgressRingRow[] = []
  for (let row = 0; row < height; row++) {
    const cells: ProgressRingCell[] = []
    for (let column = 0; column < width; column++) {
      let bits = 0
      let ringDots = 0
      for (const [dx, dy, bit] of DOTS) {
        const x = column * 2 + dx
        const y = row * 4 + dy
        const distance = Math.hypot(x - centerX, y - centerY)
        if (distance < inner || distance > outer) continue
        bits |= bit
        ringDots += 1
      }
      const cellX = column * 2 + 0.5
      const cellY = row * 4 + 1.5
      const angle = Math.atan2(cellX - centerX, -(cellY - centerY))
      const clockwise = angle < 0 ? angle + Math.PI * 2 : angle
      const filled = ringDots > 0 && (value >= 1 || (value > 0 && clockwise <= cutoff))
      cells.push({
        text: bits === 0 ? " " : String.fromCharCode(0x2800 + bits),
        x: column,
        width: 1,
        filled,
      })
    }
    rows.push({ text: cells.map((cell) => cell.text).join(""), cells })
  }

  return { rows, value, percent, label, width, height }
}

/** The ring as plain lines, top first. */
export function progressRingText(options: ProgressRingOptions): string {
  return progressRingLayout(options)
    .rows.map((row) => row.text)
    .join("\n")
}

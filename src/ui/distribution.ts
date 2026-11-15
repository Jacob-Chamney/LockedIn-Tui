/**
 * Stacked distribution bars.
 *
 * One implementation serves the plugin SDK (`distribution()` draws the bar and
 * legend) and the app's Stats per-model share. Segments are allocated with the
 * largest-remainder method, so the drawn cells always add up to the full width
 * and no space is lost to rounding.
 */
export type DistributionItem = {
  label: string
  value: number
  /** Palette role; defaults to a cycling tone. */
  tone?: string
}

export type DistributionSegment = {
  index: number
  label: string
  value: number
  /** 0..1 share of the total. */
  fraction: number
  /** First cell in the bar. */
  start: number
  /** Cells assigned to this segment. */
  cells: number
  tone: string
}

export const DISTRIBUTION_TONES = [
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
] as const

export type DistributionOptions = {
  items: readonly DistributionItem[]
  /** Bar width in cells. */
  width: number
  /** Tone cycle for items without a tone. */
  tones?: readonly string[]
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function distributionSegments(options: DistributionOptions): DistributionSegment[] {
  const width = Math.max(0, Math.floor(options.width))
  if (width === 0 || options.items.length === 0) return []
  const values = options.items.map((item) => finite(item.value))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []
  const tones = options.tones ?? DISTRIBUTION_TONES

  const raw = values.map((value) => (value / total) * width)
  const cells = raw.map((value) => Math.floor(value))
  let remaining = width - cells.reduce((sum, value) => sum + value, 0)
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let at = 0; remaining > 0; at += 1, remaining -= 1) {
    cells[byRemainder[at % byRemainder.length]!.index] += 1
  }

  let start = 0
  return options.items.map((item, index) => {
    const segment: DistributionSegment = {
      index,
      label: item.label,
      value: values[index]!,
      fraction: values[index]! / total,
      start,
      cells: cells[index]!,
      tone: item.tone ?? tones[index % tones.length]!,
    }
    start += cells[index]!
    return segment
  })
}

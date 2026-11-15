/**
 * Segmented controls: a small group of exclusive options.
 *
 * One implementation serves the plugin SDK (`segmented()` draws filled
 * segments) and the app's Settings Period row. Segments split the width evenly,
 * labels are centred, and the selected option is reported so a renderer can
 * fill it.
 */
export type SegmentedOptions = {
  options: readonly string[]
  /** Selected option index; clamped. */
  selected: number
  /** Total control width in cells. */
  width: number
}

export type SegmentedSegment = {
  text: string
  x: number
  width: number
  selected: boolean
  index: number
}

export type SegmentedLayout = {
  segments: SegmentedSegment[]
  width: number
  selected: number
  /** Options that could not fit at all. */
  hidden: number
}

function center(label: string, width: number): string {
  const room = Math.max(0, Math.floor(width))
  if (room === 0) return ""
  const text =
    label.length <= room ? label : room === 1 ? "…" : `${label.slice(0, room - 1)}…`
  const left = Math.floor((room - text.length) / 2)
  return `${" ".repeat(left)}${text}`.padEnd(room)
}

export function segmentedLayout(options: SegmentedOptions): SegmentedLayout {
  const count = options.options.length
  const width = Math.max(0, Math.floor(options.width))
  if (count === 0 || width === 0) {
    return { segments: [], width, selected: 0, hidden: count }
  }
  const selected = Math.max(0, Math.min(count - 1, Math.round(options.selected)))
  const base = Math.floor(width / count)
  const segments: SegmentedSegment[] = []
  let x = 0
  for (let index = 0; index < count; index++) {
    const cell = index === count - 1 ? width - x : base
    if (cell <= 0) break
    segments.push({
      text: center(options.options[index] ?? "", cell),
      x,
      width: cell,
      selected: index === selected,
      index,
    })
    x += cell
  }
  return { segments, width, selected, hidden: count - segments.length }
}

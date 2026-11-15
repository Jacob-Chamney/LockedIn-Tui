/**
 * Chip rows: bracketed, optionally removable tokens.
 *
 * One implementation serves the plugin SDK (`chips()` draws filled chips) and
 * the app's chat attachments. Chips are laid left to right with a gap; the
 * first that does not fit ends the row and the rest are counted as hidden. A
 * lone too-wide chip truncates its label rather than disappearing.
 */
export type ChipItem = {
  id: string
  label: string
  /** Show the trailing `×`; defaults false. */
  removable?: boolean
  /** The active chip (the one the next action affects). */
  active?: boolean
  /** Background role; defaults to `primary` for active chips and `surface` otherwise. */
  tone?: string
}

export type Chip = {
  id: string
  label: string
  /** `[label ×]` or `[label]`. */
  text: string
  x: number
  width: number
  removable: boolean
  active: boolean
  tone: string
  index: number
}

export type ChipLayout = {
  chips: Chip[]
  /** Items after the first that did not fit. */
  hidden: number
  width: number
  gap: number
  /** Index of the active chip, or -1. */
  activeIndex: number
}

export type ChipOptions = {
  items: readonly ChipItem[]
  /** Available columns. */
  width: number
  /** Spaces between chips; defaults to 1. */
  gap?: number
  /** Removing marker; defaults to `×`. */
  marker?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function chipText(label: string, removable: boolean, marker: string): string {
  return removable ? `[${label} ${marker}]` : `[${label}]`
}

export function chipLayout(options: ChipOptions): ChipLayout {
  const items = options.items
  const width = Math.max(0, Math.floor(options.width))
  const gap = clamp(Math.floor(options.gap ?? 1), 0, 4)
  const marker = options.marker ?? "×"
  if (items.length === 0 || width === 0) {
    return { chips: [], hidden: items.length, width, gap, activeIndex: -1 }
  }
  const chips: Chip[] = []
  let x = 0
  let activeIndex = -1

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const at = chips.length === 0 ? 0 : x + gap
    let text = chipText(item.label, item.removable === true, marker)
    if (at + text.length > width) {
      if (chips.length > 0) break
      const room = width
      if (room <= 2) break
      const fixed = item.removable === true ? 4 : 2
      text = chipText(fit(item.label, Math.max(1, room - fixed)), item.removable === true, marker)
    }
    chips.push({
      id: item.id,
      label: item.label,
      text,
      x: at,
      width: text.length,
      removable: item.removable === true,
      active: item.active === true,
      tone: item.tone ?? (item.active === true ? "primary" : "surface"),
      index,
    })
    if (item.active === true) activeIndex = index
    x = at + text.length
  }

  return {
    chips,
    hidden: items.length - chips.length,
    width,
    gap,
    activeIndex,
  }
}

/**
 * Tab-strip layout.
 *
 * One implementation serves the plugin SDK (`tabs()` places scene nodes) and
 * the app's Stats header. Chips are laid out left to right with padding and a
 * gap; a chip that does not fit ends the strip instead of being cut in half.
 * When even the first chip is too wide it is truncated with an ellipsis, so a
 * very narrow pane still shows what the strip is.
 */
export type TabSpec = {
  label: string
  /** Optional trailing count, e.g. `work 3`. */
  count?: number
}

export type TabSegment = {
  /** The chip text, including its padding. */
  text: string
  selected: boolean
  /** Offset from the strip's left edge. */
  x: number
  width: number
  /** Index in the original `tabs` array. */
  index: number
}

export type TabLayoutOptions = {
  tabs: readonly TabSpec[]
  selected: number
  /** Available columns for the whole strip. */
  width: number
  /** Spaces on each side of a label; defaults to 1. */
  padding?: number
  /** Spaces between chips; defaults to 0. */
  gap?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function chipText(tab: TabSpec, padding: number): string {
  const label = tab.count === undefined ? tab.label : `${tab.label} ${tab.count}`
  const pad = " ".repeat(padding)
  return `${pad}${label}${pad}`
}

export function tabLayout(options: TabLayoutOptions): TabSegment[] {
  const tabs = options.tabs
  if (tabs.length === 0) return []
  const width = Math.max(0, Math.floor(options.width))
  if (width === 0) return []
  const padding = clamp(Math.floor(options.padding ?? 1), 0, 4)
  const gap = clamp(Math.floor(options.gap ?? 0), 0, 8)
  const selected = clamp(Math.round(options.selected), 0, tabs.length - 1)
  const out: TabSegment[] = []
  let x = 0

  for (let index = 0; index < tabs.length; index++) {
    let text = chipText(tabs[index]!, padding)
    const left = out.length === 0 ? 0 : x + gap
    if (left + text.length > width) {
      if (out.length > 0) break
      const room = width
      if (room <= 1) return []
      text = `${text.slice(0, room - 1)}…`
    }
    const at = out.length === 0 ? 0 : x + gap
    out.push({ text, selected: index === selected, x: at, width: text.length, index })
    x = at + text.length
  }
  return out
}

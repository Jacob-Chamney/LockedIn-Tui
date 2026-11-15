/**
 * Popovers: a bordered title/body box with optional selectable menu rows.
 *
 * One implementation serves the plugin SDK (`popover()` paints the box) and the
 * app's Settings help popover. The layout wraps the body, fits menu labels and
 * reports a total height; placement reuses the tooltip positioner so a popover
 * flips above a target when there is no room below.
 */
import { calloutLines } from "./callout"
import { tooltipPosition, type TooltipTarget } from "./tooltip"

export type PopoverItem = {
  id: string
  label: string
  /** A keycap or short hint shown before the label. */
  key?: string
  disabled?: boolean
}

export type PopoverRowKind = "title" | "body" | "item"

export type PopoverRow = {
  kind: PopoverRowKind
  text: string
  item?: PopoverItem
  selected?: boolean
}

export type PopoverOptions = {
  /** Outer width, including borders and padding. */
  width: number
  title?: string
  body?: string
  items?: readonly PopoverItem[]
  selected?: number
  /** Maximum body lines; defaults 4. */
  maxLines?: number
}

export type PopoverLayout = {
  rows: PopoverRow[]
  width: number
  height: number
  innerWidth: number
  items: readonly PopoverItem[]
  selected: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function popoverLayout(options: PopoverOptions): PopoverLayout {
  const width = Math.max(6, Math.floor(options.width))
  const innerWidth = Math.max(1, width - 4)
  const rows: PopoverRow[] = []
  if (options.title !== undefined && options.title !== "") {
    rows.push({ kind: "title", text: fit(options.title, innerWidth) })
  }
  if (options.body !== undefined && options.body !== "") {
    const lines = calloutLines(options.body, innerWidth).slice(0, Math.max(1, Math.floor(options.maxLines ?? 4)))
    for (const line of lines) rows.push({ kind: "body", text: line })
  }
  const items = options.items ?? []
  const selected = items.length === 0 ? -1 : Math.max(0, Math.min(items.length - 1, Math.round(options.selected ?? 0)))
  items.forEach((item, index) => {
    const marker = index === selected ? "▸ " : "  "
    const key = item.key === undefined || item.key === "" ? "" : `[${item.key}] `
    rows.push({
      kind: "item",
      text: `${marker}${key}${fit(item.label, Math.max(1, innerWidth - marker.length - key.length))}`,
      item,
      selected: index === selected,
    })
  })
  return {
    rows,
    width,
    height: Math.max(2, rows.length + 2),
    innerWidth,
    items,
    selected,
  }
}

export type PopoverPlacement = {
  left: number
  top: number
  side: "below" | "above"
}

/** Place a popover relative to a target, clamped to the bounds. */
export function popoverPosition(options: {
  target: TooltipTarget
  size: { width: number; height: number }
  bounds: { width: number; height: number }
  gap?: number
  prefer?: "below" | "above"
}): PopoverPlacement {
  return tooltipPosition(options)
}

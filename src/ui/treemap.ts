/**
 * Treemaps: a rectangle split into weighted tiles.
 *
 * One implementation serves the plugin SDK (`treemap()` paints the tiles) and
 * the app's Stats BY MODEL block. Items are sorted by value and split
 * alternately along the long axis, so every tile stays in bounds and the total
 * area matches the map. Labels and percentages are fitted inside each tile.
 */
export type TreemapItem = {
  id: string
  label: string
  value: number
}

export type TreemapOptions = {
  items: readonly TreemapItem[]
  width: number
  height: number
}

export type TreemapTile = {
  id: string
  label: string
  value: number
  index: number
  fraction: number
  percent: number
  x: number
  y: number
  width: number
  height: number
  /** The fitted first label line. */
  labelText: string
  /** The fitted percentage line. */
  valueText: string
  showBorder: boolean
  showLabel: boolean
  showValue: boolean
}

export type TreemapLayout = {
  tiles: TreemapTile[]
  width: number
  height: number
  total: number
  /** Items that could not be placed because the map ran out of cells. */
  hidden: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function treemapLayout(options: TreemapOptions): TreemapLayout {
  const width = Math.max(0, Math.floor(options.width))
  const height = Math.max(0, Math.floor(options.height))
  const items = options.items
    .map((item, order) => ({ item, order, value: finite(item.value) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order)
  const total = items.reduce((sum, entry) => sum + entry.value, 0)
  if (width === 0 || height === 0 || items.length === 0) {
    return { tiles: [], width, height, total, hidden: 0 }
  }

  const tiles: TreemapTile[] = []
  let hidden = 0
  let index = 0
  const makeTile = (entry: { item: TreemapItem; value: number }, x: number, y: number, w: number, h: number) => {
    const fraction = entry.value / total
    const innerWidth = Math.max(0, w - 2)
    const showBorder = w >= 2 && h >= 2
    const showLabel = w >= 3 && h >= 3
    const showValue = w >= 3 && h >= 4
    const percentText = `${Math.round(fraction * 100)}%`
    const combined = `${entry.item.label} ${percentText}`
    const labelText =
      showLabel && !showValue
        ? combined.length <= innerWidth
          ? combined
          : innerWidth >= percentText.length + 2
            ? `${fit(entry.item.label, innerWidth - percentText.length - 1)} ${percentText}`
            : fit(percentText, innerWidth)
        : fit(entry.item.label, innerWidth)
    tiles.push({
      id: entry.item.id,
      label: entry.item.label,
      value: entry.value,
      index,
      fraction,
      percent: Math.round(fraction * 100),
      x,
      y,
      width: w,
      height: h,
      labelText,
      valueText: fit(percentText, innerWidth),
      showBorder,
      showLabel,
      showValue,
    })
    index += 1
  }

  const recurse = (
    entries: Array<{ item: TreemapItem; value: number }>,
    x: number,
    y: number,
    w: number,
    h: number,
    vertical: boolean,
  ): void => {
    if (entries.length === 0) return
    if (entries.length === 1) {
      makeTile(entries[0]!, x, y, w, h)
      return
    }
    if (w < 2 && h < 2) {
      makeTile(entries[0]!, x, y, w, h)
      hidden += entries.length - 1
      return
    }
    let axis = vertical
    if (axis && w < 2) axis = false
    if (!axis && h < 2) axis = true
    if (axis && w < 2) {
      makeTile(entries[0]!, x, y, w, h)
      hidden += entries.length - 1
      return
    }
    if (!axis && h < 2) {
      makeTile(entries[0]!, x, y, w, h)
      hidden += entries.length - 1
      return
    }

    const groupTotal = entries.reduce((sum, entry) => sum + entry.value, 0)
    let split = 1
    let acc = entries[0]!.value
    while (split < entries.length - 1 && acc < groupTotal / 2) {
      acc += entries[split]!.value
      split += 1
    }
    const left = entries.slice(0, split)
    const right = entries.slice(split)
    const leftFraction = left.reduce((sum, entry) => sum + entry.value, 0) / groupTotal

    if (axis) {
      const leftWidth = clamp(Math.round(w * leftFraction), 1, w - 1)
      recurse(left, x, y, leftWidth, h, false)
      recurse(right, x + leftWidth, y, w - leftWidth, h, false)
    } else {
      const topHeight = clamp(Math.round(h * leftFraction), 1, h - 1)
      recurse(left, x, y, w, topHeight, true)
      recurse(right, x, y + topHeight, w, h - topHeight, true)
    }
  }

  recurse(items, 0, 0, width, height, true)
  return { tiles, width, height, total, hidden }
}

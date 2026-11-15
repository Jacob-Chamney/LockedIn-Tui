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
  const prefix = new Array<number>(items.length + 1)
  prefix[0] = 0
  for (let index = 0; index < items.length; index++) {
    prefix[index + 1] = prefix[index]! + items[index]!.value
  }
  const total = prefix[items.length]!
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
    start: number,
    end: number,
    x: number,
    y: number,
    w: number,
    h: number,
    vertical: boolean,
  ): void => {
    const count = end - start
    if (count <= 0) return
    if (count === 1) {
      makeTile(items[start]!, x, y, w, h)
      return
    }
    if (w < 2 && h < 2) {
      makeTile(items[start]!, x, y, w, h)
      hidden += count - 1
      return
    }
    let axis = vertical
    if (axis && w < 2) axis = false
    if (!axis && h < 2) axis = true
    if (axis && w < 2) {
      makeTile(items[start]!, x, y, w, h)
      hidden += count - 1
      return
    }
    if (!axis && h < 2) {
      makeTile(items[start]!, x, y, w, h)
      hidden += count - 1
      return
    }

    const groupTotal = prefix[end]! - prefix[start]!
    const half = groupTotal / 2
    let low = start + 1
    let high = end - 1
    let split = start + 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (prefix[middle]! - prefix[start]! >= half) {
        split = middle
        high = middle - 1
      } else {
        low = middle + 1
      }
    }
    split = Math.max(start + 1, Math.min(end - 1, split))
    const leftFraction = (prefix[split]! - prefix[start]!) / groupTotal

    if (axis) {
      const leftWidth = clamp(Math.round(w * leftFraction), 1, w - 1)
      recurse(start, split, x, y, leftWidth, h, false)
      recurse(split, end, x + leftWidth, y, w - leftWidth, h, false)
    } else {
      const topHeight = clamp(Math.round(h * leftFraction), 1, h - 1)
      recurse(start, split, x, y, w, topHeight, true)
      recurse(split, end, x, y + topHeight, w, h - topHeight, true)
    }
  }

  recurse(0, items.length, 0, 0, width, height, true)
  return { tiles, width, height, total, hidden }
}

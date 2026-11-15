/**
 * Tag clouds: wrapped tags with fitted rows and an overflow count.
 *
 * One implementation serves the plugin SDK (`tagCloud()` paints the rows) and
 * the Knowledge reader. Tags flow left to right and wrap to the next row; a tag
 * wider than the row is fitted. When `maxRows` is reached the tail becomes `+N`,
 * keeping the count only when it fits.
 */
export type TagCloudItem = {
  label: string
  /** Optional trailing count. */
  count?: number
}

export type TagCloudRow = {
  text: string
  tokens: Array<{ text: string; x: number; width: number }>
  index: number
}

export type TagCloudOptions = {
  items: readonly TagCloudItem[]
  width: number
  /** Visible rows; defaults 2. */
  maxRows?: number
  /** Spaces between tags; defaults 1. */
  gap?: number
  /** Prefix before each label; defaults `#`. */
  prefix?: string
}

export type TagCloudLayout = {
  rows: TagCloudRow[]
  hidden: number
  width: number
  gap: number
  text: string
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function tagText(item: TagCloudItem, prefix: string): string {
  const count = item.count === undefined ? "" : ` ${item.count}`
  return `${prefix}${item.label}${count}`
}

export function tagCloudLayout(options: TagCloudOptions): TagCloudLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? 2))
  const prefix = options.prefix ?? "#"
  const items = options.items
  if (width === 0 || items.length === 0) {
    return { rows: [], hidden: items.length, width, gap, text: "" }
  }

  const rows: TagCloudRow[] = []
  let row: TagCloudRow = { text: "", tokens: [], index: 0 }
  let x = 0
  let placed = 0
  for (const item of items) {
    let text = tagText(item, prefix)
    if (text.length > width) text = fit(text, width)
    const at = row.tokens.length === 0 ? 0 : x + gap
    if (at + text.length > width) {
      if (rows.length + 1 >= maxRows) break
      rows.push(row)
      row = { text: "", tokens: [], index: rows.length }
      x = 0
      if (text.length > width) text = fit(text, width)
    }
    const tokenX = row.tokens.length === 0 ? 0 : x + gap
    row.tokens.push({ text, x: tokenX, width: text.length })
    row.text = row.tokens.map((token) => token.text).join(" ".repeat(gap))
    x = tokenX + text.length
    placed += 1
  }
  if (row.tokens.length > 0) rows.push(row)

  let hidden = items.length - placed
  if (hidden > 0 && rows.length > 0) {
    const last = rows[rows.length - 1]!
    const overflow = `+${hidden}`
    const room = width - last.text.length
    if (room >= gap + overflow.length) {
      last.tokens.push({ text: overflow, x: last.text.length + gap, width: overflow.length })
      last.text = `${last.text}${" ".repeat(gap)}${overflow}`
      hidden = items.length - placed
    } else {
      // Drop the last tag and try to fit the count in its place.
      const dropped = last.tokens.pop()
      if (dropped !== undefined) {
        placed -= 1
        hidden = items.length - placed
        last.text = last.tokens.map((token) => token.text).join(" ".repeat(gap))
        const count = `+${hidden}`
        if (last.text.length + gap + count.length <= width) {
          last.tokens.push({ text: count, x: last.text.length + gap, width: count.length })
          last.text = `${last.text}${" ".repeat(gap)}${count}`
        }
      }
    }
  }

  return {
    rows,
    hidden,
    width,
    gap,
    text: rows.map((row) => row.text).join("\n"),
  }
}

/** The tag cloud as plain lines. */
export function tagCloudText(options: TagCloudOptions): string[] {
  return tagCloudLayout(options).rows.map((row) => row.text)
}

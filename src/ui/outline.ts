/**
 * Outline strips: a table of contents in one row.
 *
 * One implementation serves the plugin SDK (`outline()` places the segments)
 * and the app's Knowledge reader. Each item shows its depth glyph and, on the
 * current item, a `▸` marker. Entries are laid left to right with a gap; the
 * first that does not fit ends the row and the rest are counted hidden.
 */
export type OutlineGlyphs = {
  /** Depth 1. */
  root: string
  /** Depth 2. */
  child: string
  /** Depth 3 and deeper. */
  leaf: string
  /** Prefix on the current item. */
  current: string
}

export const OUTLINE_GLYPHS: Readonly<OutlineGlyphs> = {
  root: "◆",
  child: "◇",
  leaf: "·",
  current: "▸",
}

export type OutlineItem = {
  id: string
  label: string
  /** One-based heading depth; defaults to 1. */
  depth?: number
}

export type OutlineSegment = {
  id: string
  label: string
  depth: number
  text: string
  x: number
  width: number
  current: boolean
  index: number
}

export type OutlineOptions = {
  items: readonly OutlineItem[]
  /** Available columns. */
  width: number
  /** Index of the current section. */
  current?: number
  /** Spaces between entries; defaults to 2. */
  gap?: number
  glyphs?: Partial<OutlineGlyphs>
}

export type OutlineLayout = {
  segments: OutlineSegment[]
  hidden: number
  width: number
  gap: number
  currentIndex: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function outlineDepthGlyph(depth: number, glyphs: OutlineGlyphs = OUTLINE_GLYPHS): string {
  if (depth <= 1) return glyphs.root
  if (depth === 2) return glyphs.child
  return glyphs.leaf
}

export function outlineLayout(options: OutlineOptions): OutlineLayout {
  const items = options.items
  const width = Math.max(0, Math.floor(options.width))
  const gap = clamp(Math.floor(options.gap ?? 2), 0, 8)
  const glyphs = { ...OUTLINE_GLYPHS, ...options.glyphs }
  const currentIndex = items.length === 0 ? -1 : clamp(Math.round(options.current ?? 0), 0, items.length - 1)
  if (items.length === 0 || width === 0) {
    return { segments: [], hidden: items.length, width, gap, currentIndex }
  }

  const segments: OutlineSegment[] = []
  let x = 0
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const depth = Math.max(1, Math.floor(item.depth ?? 1))
    const current = index === currentIndex
    const text = `${outlineDepthGlyph(depth, glyphs)}${current ? glyphs.current : " "} ${item.label}`
    const at = segments.length === 0 ? 0 : x + gap
    if (at + text.length > width) break
    segments.push({ id: item.id, label: item.label, depth, text, x: at, width: text.length, current, index })
    x = at + text.length
  }

  // The current section is the point of the outline: when it would be cut off,
  // show it alone with a fitted label instead of hiding it.
  if (currentIndex >= 0 && !segments.some((segment) => segment.current)) {
    const item = items[currentIndex]!
    const depth = Math.max(1, Math.floor(item.depth ?? 1))
    const prefix = fit(`${outlineDepthGlyph(depth, glyphs)}${glyphs.current} `, width)
    const room = Math.max(0, width - prefix.length)
    const label = item.label.length <= room ? item.label : room === 0 ? "" : room === 1 ? "…" : `${item.label.slice(0, room - 1)}…`
    const text = `${prefix}${label}`
    return {
      segments: [
        {
          id: item.id,
          label,
          depth,
          text,
          x: 0,
          width: text.length,
          current: true,
          index: currentIndex,
        },
      ],
      hidden: items.length - 1,
      width,
      gap,
      currentIndex,
    }
  }

  return { segments, hidden: items.length - segments.length, width, gap, currentIndex }
}

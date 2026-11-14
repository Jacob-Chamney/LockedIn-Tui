/**
 * Tree rows with guide glyphs and expand/collapse carets.
 *
 * One implementation serves the plugin SDK (`tree()` places scene nodes) and
 * the app's Explorer. Rows are flat with a `depth`, so a caller can preserve
 * its own cursor indexes; `flattenTree()` turns nested nodes into that shape.
 * A row's guides show which ancestors still have siblings below, and the branch
 * glyph shows whether this node is the last child.
 */
export type TreeGlyphs = {
  /** Vertical guide under an ancestor that has more siblings. */
  vertical: string
  /** A non-last child. */
  branch: string
  /** The last child. */
  last: string
  /** Empty guide under a finished ancestor. */
  space: string
  /** An expanded node with children. */
  expanded: string
  /** A collapsed node with children. */
  collapsed: string
  /** A node without children. */
  leaf: string
}

export const TREE_GLYPHS: Readonly<TreeGlyphs> = {
  vertical: "│",
  branch: "├─",
  last: "└─",
  space: "  ",
  expanded: "▾",
  collapsed: "▸",
  leaf: " ",
}

export function treeGlyphs(overrides?: Partial<TreeGlyphs>): TreeGlyphs {
  return { ...TREE_GLYPHS, ...overrides }
}

export type TreeItem = {
  id: string
  label: string
  /** Zero for a root, one for a child, and so on. */
  depth: number
  /** Applies when the item has children; defaults to expanded. */
  expanded?: boolean
  /** Set explicitly for a collapsed parent whose children are not listed. */
  hasChildren?: boolean
  /** A horizontal rule instead of a node. */
  divider?: boolean
  detail?: string
}

export type TreeRow = {
  id: string
  index: number
  depth: number
  divider: boolean
  /** Selection column; empty when the layout is not selectable. */
  marker: string
  /** Guide glyphs for each ancestor level. */
  guides: string
  /** `├─` / `└─` for children, empty for roots. */
  branch: string
  /** `▾`, `▸` or a space. */
  caret: string
  label: string
  detail?: string
  selected: boolean
  /** Cells used before the label starts. */
  prefixWidth: number
}

export type TreeOptions = {
  items: readonly TreeItem[]
  /** Total row width in cells, including the marker column when selectable. */
  width: number
  /** Draw a marker column and mark this row. */
  selected?: number
  marker?: { selected?: string; rest?: string }
  glyphs?: Partial<TreeGlyphs>
  /** Draw expand/collapse carets; defaults true. */
  carets?: boolean
}

export type TreeNode = {
  id: string
  label: string
  detail?: string
  children?: readonly TreeNode[]
}

/** Flatten nested nodes, hiding children of collapsed ids. */
export function flattenTree(
  nodes: readonly TreeNode[],
  collapsed: readonly string[] = [],
): TreeItem[] {
  const closed = new Set(collapsed)
  const out: TreeItem[] = []
  const walk = (list: readonly TreeNode[], depth: number): void => {
    for (const node of list) {
      const children = node.children ?? []
      const expanded = children.length > 0 && !closed.has(node.id)
      out.push({
        id: node.id,
        label: node.label,
        depth,
        hasChildren: children.length > 0,
        expanded,
        ...(node.detail === undefined ? {} : { detail: node.detail }),
      })
      if (expanded) walk(children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/** The next row at or above `depth`, which decides last-child status. */
function nextAtOrAbove(items: readonly TreeItem[], index: number, depth: number): TreeItem | null {
  for (let at = index + 1; at < items.length; at++) {
    if (items[at]!.depth <= depth) return items[at]!
  }
  return null
}

export function treeRows(options: TreeOptions): TreeRow[] {
  const items = options.items
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const glyphs = treeGlyphs(options.glyphs)
  const selectable = options.selected !== undefined
  const selectedMarker = options.marker?.selected ?? "▌ "
  const restMarker = options.marker?.rest ?? "  "
  const lastFlags: boolean[] = []

  return items.map((item, index) => {
    const selected = selectedMarker !== "" && index === options.selected
    const marker = selectable ? (selected ? selectedMarker : restMarker) : ""
    if (item.divider) {
      return {
        id: item.id,
        index,
        depth: 0,
        divider: true,
        marker,
        guides: "",
        branch: "",
        caret: " ",
        label: "─".repeat(Math.max(0, width - marker.length)),
        selected,
        prefixWidth: marker.length,
      }
    }

    const depth = Math.max(0, Math.floor(item.depth))
    lastFlags.length = depth
    const next = nextAtOrAbove(items, index, depth)
    const hasChildren = item.hasChildren ?? (next !== null && next.depth > depth && !next.divider)
    const isLast = next === null || next.depth < depth
    let guides = ""
    for (let level = 0; level < depth; level++) {
      guides += lastFlags[level] ? glyphs.space : `${glyphs.vertical} `
    }
    lastFlags[depth] = isLast
    const branch = depth === 0 ? "" : isLast ? glyphs.last : glyphs.branch
    const carets = options.carets !== false
    const caret = !carets || !hasChildren ? glyphs.leaf : item.expanded === false ? glyphs.collapsed : glyphs.expanded
    const caretWidth = carets && hasChildren ? 2 : 0
    const prefixWidth = marker.length + guides.length + branch.length + caretWidth
    return {
      id: item.id,
      index,
      depth,
      divider: false,
      marker,
      guides,
      branch,
      caret,
      label: fit(item.label, Math.max(1, width - prefixWidth)),
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      selected,
      prefixWidth,
    }
  })
}

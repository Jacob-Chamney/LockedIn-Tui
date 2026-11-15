/**
 * Kanban column layout: titled columns of single-line cards.
 *
 * One implementation serves the plugin SDK (`kanban()` places headers and
 * cards) and the app's Work board. Column widths split the available space
 * evenly; each card row is `▸ ` (selected) or `  ` plus a fitted title. A column
 * longer than `maxCards` keeps the first cards and reports the hidden count.
 */
export type KanbanCard = {
  id: string
  title: string
  /** Palette role for the card text; defaults to the column tone or foreground. */
  tone?: string
}

export type KanbanColumn = {
  id: string
  title: string
  cards: readonly KanbanCard[]
  tone?: string
}

export type KanbanCardRow = {
  id: string
  /** Marker plus fitted title. */
  text: string
  tone: string
  selected: boolean
}

export type KanbanColumnLayout = {
  id: string
  /** Title plus its count, fitted to the column. */
  title: string
  x: number
  width: number
  count: number
  cards: KanbanCardRow[]
  /** Cards not shown because of `maxCards`. */
  hidden: number
}

export type KanbanLayout = {
  columns: KanbanColumnLayout[]
  width: number
  height: number
  gap: number
}

export type KanbanOptions = {
  columns: readonly KanbanColumn[]
  /** Total width in cells. */
  width: number
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Card id to mark with the cursor. */
  selected?: string
  /** Visible cards per column; defaults to all. */
  maxCards?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function kanbanLayout(options: KanbanOptions): KanbanLayout {
  const columns = options.columns
  const width = Math.max(0, Math.floor(options.width))
  if (columns.length === 0 || width === 0) {
    return { columns: [], width, height: 0, gap: 0 }
  }
  const gap = clamp(Math.floor(options.gap ?? 1), 0, 4)
  const columnWidth = Math.max(4, Math.floor((width - gap * (columns.length - 1)) / columns.length))
  const maxCards =
    options.maxCards === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(options.maxCards))
  let height = 1

  const laid = columns.map((column, index) => {
    const visible = column.cards.slice(0, maxCards === Number.POSITIVE_INFINITY ? undefined : maxCards)
    const hidden = column.cards.length - visible.length
    const cards: KanbanCardRow[] = visible.map((card) => {
      const selected = options.selected !== undefined && card.id === options.selected
      return {
        id: card.id,
        text: `${selected ? "▌ " : "  "}${fit(card.title, Math.max(1, columnWidth - 2))}`,
        tone: card.tone ?? column.tone ?? "foreground",
        selected,
      }
    })
    height = Math.max(height, 1 + cards.length + (hidden > 0 ? 1 : 0))
    return {
      id: column.id,
      title: fit(`${column.title} (${column.cards.length})`, columnWidth),
      x: index * (columnWidth + gap),
      width: columnWidth,
      count: column.cards.length,
      cards,
      hidden,
    }
  })

  return { columns: laid, width, height, gap }
}

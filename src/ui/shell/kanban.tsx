/**
 * Kanban columns for app surfaces.
 *
 * The Solid counterpart of the SDK's `kanban()`: widths, counts, fitting and
 * the hidden-card count come from `src/ui/kanban.ts`.
 */
import { kanbanLayout, type KanbanColumn } from "../kanban"
import type { ThemePalette } from "../theme"

export function Kanban(props: {
  theme: ThemePalette
  columns: readonly KanbanColumn[]
  width: number
  gap?: number
  selected?: string
  maxCards?: number
  titleFg?: keyof ThemePalette
  cardFg?: keyof ThemePalette
  selectedFg?: keyof ThemePalette
  hiddenFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    kanbanLayout({
      columns: props.columns,
      width: props.width,
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.maxCards === undefined ? {} : { maxCards: props.maxCards }),
    })
  const ink = (role: keyof ThemePalette | undefined, fallback: keyof ThemePalette) =>
    palette()[role ?? fallback]

  return (
    <box flexDirection="row" flexShrink={0} width={props.width}>
      {layout().columns.map((column, index) => (
        <>
          {index > 0 ? <box width={layout().gap} flexShrink={0} /> : null}
          <box flexDirection="column" width={column.width} flexShrink={0}>
            <text fg={ink(props.titleFg, "primary")} wrapMode="none">
              {column.title}
            </text>
            {column.cards.map((card) => (
              <text
                fg={
                  card.selected
                    ? ink(props.selectedFg, "primary")
                    : card.tone === "foreground"
                      ? ink(props.cardFg, "foreground")
                      : ink(card.tone as keyof ThemePalette, "foreground")
                }
                wrapMode="none"
              >
                {card.text}
              </text>
            ))}
            {column.hidden > 0 ? (
              <text fg={ink(props.hiddenFg, "muted")} wrapMode="none">
                {`+${column.hidden} more`}
              </text>
            ) : null}
          </box>
        </>
      ))}
    </box>
  )
}

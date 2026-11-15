/**
 * Multi-select lists for app surfaces.
 *
 * The Solid counterpart of the SDK's `multiSelect()`: prefix widths, fitted
 * labels and the viewport come from `src/ui/multi-select.ts`.
 */
import { multiSelectLayout, type MultiSelectGlyphs, type MultiSelectItem } from "../multi-select"
import type { ThemePalette } from "../theme"

export function MultiSelectList(props: {
  theme: ThemePalette
  items: readonly MultiSelectItem[]
  width: number
  cursor: number
  offset?: number
  rows?: number
  glyphs?: Partial<MultiSelectGlyphs>
  marker?: string
  checkedFg?: keyof ThemePalette
  selectedFg?: keyof ThemePalette
  fg?: keyof ThemePalette
  disabledFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    multiSelectLayout({
      items: props.items,
      width: props.width,
      cursor: props.cursor,
      ...(props.offset === undefined ? {} : { offset: props.offset }),
      ...(props.rows === undefined ? {} : { rows: props.rows }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
    })
  const ink = (row: (typeof layout extends never ? never : ReturnType<typeof layout>)["rows"][number]) =>
    row.disabled
      ? palette()[props.disabledFg ?? "muted"]
      : row.selected
        ? palette()[props.selectedFg ?? "primary"]
        : row.checked
          ? palette()[props.checkedFg ?? "success"]
          : palette()[props.fg ?? "foreground"]

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <box
          flexDirection="row"
          height={1}
          flexShrink={0}
          backgroundColor={row.selected ? palette().panel : undefined}
        >
          <text fg={ink(row)} wrapMode="none" width={layout().width}>
            {row.text}
          </text>
        </box>
      ))}
    </box>
  )
}

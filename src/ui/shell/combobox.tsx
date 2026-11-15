/**
 * Suggestion lists for app surfaces.
 *
 * The Solid counterpart of the SDK's `combobox()`: ranking, fitting and the
 * selected marker come from `src/ui/combobox.ts`.
 */
import { comboboxLayout, type ComboboxOption } from "../combobox"
import type { ThemePalette } from "../theme"

export function Combobox(props: {
  theme: ThemePalette
  options: readonly ComboboxOption[]
  query: string
  width: number
  selected?: number
  maxRows?: number
  marker?: string
  selectedFg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    comboboxLayout({
      options: props.options,
      query: props.query,
      width: props.width,
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.maxRows === undefined ? {} : { maxRows: props.maxRows }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <text
          fg={palette()[row.selected ? (props.selectedFg ?? "primary") : (props.fg ?? "foreground")]}
          wrapMode="none"
          width={layout().width}
        >
          {row.text}
        </text>
      ))}
    </box>
  )
}

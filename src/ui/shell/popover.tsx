/**
 * Bordered popovers for app surfaces.
 *
 * The Solid counterpart of the SDK's `popover()`: wrapping, sizing and the
 * selected menu row come from `src/ui/popover.ts`.
 */
import { popoverLayout, type PopoverItem } from "../popover"
import type { ThemePalette } from "../theme"

export function Popover(props: {
  theme: ThemePalette
  width: number
  title?: string
  body?: string
  items?: readonly PopoverItem[]
  selected?: number
  maxLines?: number
}) {
  const palette = () => props.theme
  const layout = () =>
    popoverLayout({
      width: props.width,
      ...(props.title === undefined ? {} : { title: props.title }),
      ...(props.body === undefined ? {} : { body: props.body }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.maxLines === undefined ? {} : { maxLines: props.maxLines }),
    })

  return (
    <box
      border={["left", "right", "top", "bottom"]}
      borderStyle="rounded"
      borderColor={palette().line}
      backgroundColor={palette().surface}
      width={layout().width}
      height={layout().height}
      paddingX={1}
      flexDirection="column"
      flexShrink={0}
    >
      {layout().rows.map((row) => (
        <text
          fg={
            row.kind === "title"
              ? palette().primary
              : row.kind === "item"
                ? row.item?.disabled
                  ? palette().muted
                  : row.selected
                    ? palette().primary
                    : palette().foreground
                : palette().foreground
          }
          wrapMode="none"
        >
          {row.text}
        </text>
      ))}
    </box>
  )
}

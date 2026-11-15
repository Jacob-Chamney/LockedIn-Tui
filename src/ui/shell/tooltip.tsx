/**
 * A bordered help tooltip for app surfaces.
 *
 * The Solid counterpart of the SDK's `tooltip()`: wrapping, sizing and title
 * order come from `src/ui/tooltip.ts`.
 */
import { tooltipLayout } from "../tooltip"
import type { ThemePalette } from "../theme"

export function Tooltip(props: {
  theme: ThemePalette
  width: number
  text: string
  title?: string
  maxLines?: number
}) {
  const palette = () => props.theme
  const layout = () =>
    tooltipLayout({
      text: props.text,
      width: props.width,
      ...(props.title === undefined ? {} : { title: props.title }),
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
      {layout().lines.map((line, index) => (
        <text
          fg={index === 0 && props.title !== undefined ? palette().primary : palette().foreground}
          wrapMode="none"
        >
          {line}
        </text>
      ))}
    </box>
  )
}

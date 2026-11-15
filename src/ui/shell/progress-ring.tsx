/**
 * Braille progress rings for app surfaces.
 *
 * The Solid counterpart of the SDK's `progressRing()`: arc, cells and label
 * come from `src/ui/progress-ring.ts`.
 */
import { progressRingLayout } from "../progress-ring"
import type { ThemePalette } from "../theme"

export function ProgressRing(props: {
  theme: ThemePalette
  value: number
  size?: number
  thickness?: number
  label?: string
  filledFg?: keyof ThemePalette
  trackFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    progressRingLayout({
      value: props.value,
      ...(props.size === undefined ? {} : { size: props.size }),
      ...(props.thickness === undefined ? {} : { thickness: props.thickness }),
      ...(props.label === undefined ? {} : { label: props.label }),
    })

  return (
    <box flexDirection="column" height={layout().height} flexShrink={0}>
      {layout().rows.map((row) => (
        <box flexDirection="row" height={1}>
          {row.cells.map((cell, index) =>
            cell.text === " " ? null : (
              <text
                fg={palette()[cell.filled ? (props.filledFg ?? "primary") : (props.trackFg ?? "line")]}
                wrapMode="none"
                width={1}
              >
                {cell.text}
                {index < 0 ? "" : ""}
              </text>
            ),
          )}
        </box>
      ))}
    </box>
  )
}

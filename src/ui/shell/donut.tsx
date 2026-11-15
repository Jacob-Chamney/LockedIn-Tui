/**
 * Donut charts for app surfaces.
 *
 * The Solid counterparts of the SDK's `donut()` / `donutLegend()`: ring cells,
 * slice ownership and legend fitting come from `src/ui/donut.ts`.
 */
import { donutLayout, donutLegendLayout, type DonutSegment, type DonutSegmentInput } from "../donut"
import type { ThemePalette } from "../theme"

const TONES: ReadonlyArray<keyof ThemePalette> = [
  "primary",
  "secondary",
  "success",
  "warning",
  "accent",
]

export function Donut(props: {
  theme: ThemePalette
  segments: readonly DonutSegmentInput[]
  size?: number
  thickness?: number
  tones?: ReadonlyArray<keyof ThemePalette>
  trackFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    donutLayout({
      segments: props.segments,
      ...(props.size === undefined ? {} : { size: props.size }),
      ...(props.thickness === undefined ? {} : { thickness: props.thickness }),
    })
  const tones = () => props.tones ?? TONES
  const ink = (segment: number) =>
    segment < 0
      ? palette()[props.trackFg ?? "line"]
      : palette()[tones()[segment % tones().length] ?? "primary"]

  return (
    <box flexDirection="column" height={layout().height} flexShrink={0}>
      {layout().rows.map((row) => (
        <box flexDirection="row" height={1}>
          {row.cells.map((cell) =>
            cell.text === " " ? (
              <text width={1} wrapMode="none">
                {" "}
              </text>
            ) : (
              <text fg={ink(cell.segment)} wrapMode="none" width={1}>
                {cell.text}
              </text>
            ),
          )}
        </box>
      ))}
    </box>
  )
}

export function DonutLegend(props: {
  theme: ThemePalette
  segments: readonly DonutSegment[]
  width: number
  maxRows?: number
  marker?: string
  tones?: ReadonlyArray<keyof ThemePalette>
}) {
  const palette = () => props.theme
  const layout = () =>
    donutLegendLayout({
      segments: props.segments,
      width: props.width,
      ...(props.maxRows === undefined ? {} : { maxRows: props.maxRows }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
    })
  const tones = () => props.tones ?? TONES

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <text fg={palette()[tones()[row.index % tones().length] ?? "foreground"]} wrapMode="none">
          {row.text}
        </text>
      ))}
      {layout().hidden > 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {`+${layout().hidden} more`}
        </text>
      ) : null}
    </box>
  )
}

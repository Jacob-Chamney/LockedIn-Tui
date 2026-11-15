/**
 * Swatch rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `swatches()`: cell widths, gaps and the
 * hidden count come from `src/ui/swatches.ts`.
 */
import { swatchLayout } from "../swatches"
import type { ThemePalette } from "../theme"

export function Swatches(props: {
  theme: ThemePalette
  colors: readonly string[]
  width: number
  cellWidth?: number
  gap?: number
  glyph?: string
}) {
  const palette = () => props.theme
  const layout = () =>
    swatchLayout({
      colors: props.colors,
      width: props.width,
      ...(props.cellWidth === undefined ? {} : { cellWidth: props.cellWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
    })
  const glyph = () => props.glyph ?? "█"

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().cells.map((cell, index) => (
        <>
          {index > 0 && (props.gap ?? 1) > 0 ? (
            <text fg={palette().muted} wrapMode="none" width={props.gap ?? 1}>
              {" ".repeat(props.gap ?? 1)}
            </text>
          ) : null}
          <text fg={cell.color} wrapMode="none" width={cell.width}>
            {glyph().repeat(cell.width)}
          </text>
        </>
      ))}
    </box>
  )
}

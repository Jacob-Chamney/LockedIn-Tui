/**
 * Status dots for app surfaces.
 *
 * The Solid counterpart of the SDK's `statusDot()`: glyphs, tones and fitting
 * come from `src/ui/status-dot.ts`.
 */
import { statusDotLayout, type StatusDotGlyphs, type StatusDotTones, type StatusState } from "../status-dot"
import type { ThemePalette } from "../theme"

export function StatusDot(props: {
  theme: ThemePalette
  state: StatusState
  label?: string
  width?: number
  glyphs?: Partial<StatusDotGlyphs>
  tones?: Partial<StatusDotTones>
  labelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    statusDotLayout({
      state: props.state,
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
      ...(props.tones === undefined ? {} : { tones: props.tones }),
    })
  const label = () => {
    if (layout().label === "") return ""
    const room =
      props.width === undefined ? layout().label.length : Math.max(0, props.width - layout().glyph.length - 1)
    if (room <= 0) return ""
    return layout().label.length <= room
      ? layout().label
      : room === 1
        ? "…"
        : `${layout().label.slice(0, room - 1)}…`
  }

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <text fg={palette()[layout().tone as keyof ThemePalette]} wrapMode="none">
        {layout().glyph}
      </text>
      {label() !== "" ? (
        <text fg={palette()[props.labelFg ?? "muted"]} wrapMode="none">
          {` ${label()}`}
        </text>
      ) : null}
    </box>
  )
}

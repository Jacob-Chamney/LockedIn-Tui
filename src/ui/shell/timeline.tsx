/**
 * Timeline rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `timeline()`: columns, fitting, the rail
 * and tone roles come from `src/ui/timeline.ts`, so a plugin timeline and the
 * Activity log are the same element.
 */
import { timelineRole, timelineRows, type TimelineEntry, type TimelineTone } from "../timeline"
import type { ThemePalette } from "../theme"

export function Timeline(props: {
  theme: ThemePalette
  entries: readonly TimelineEntry[]
  /** Total row width in cells. */
  width: number
  timeWidth?: number
  glyphWidth?: number
  gap?: number
  selected?: number
  selectable?: boolean
  details?: boolean
}) {
  const palette = () => props.theme
  const rows = () =>
    timelineRows({
      entries: props.entries,
      width: props.width,
      ...(props.timeWidth === undefined ? {} : { timeWidth: props.timeWidth }),
      ...(props.glyphWidth === undefined ? {} : { glyphWidth: props.glyphWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.selected === undefined ? {} : { selected: props.selected }),
      ...(props.selectable === undefined ? {} : { selectable: props.selectable }),
      ...(props.details === undefined ? {} : { details: props.details }),
    })
  const ink = (tone: TimelineTone) =>
    palette()[timelineRole(tone) as keyof ThemePalette] ?? palette().muted
  const gap = () => " ".repeat(props.gap ?? 1)
  const selected = () => props.selected

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows().map((row) => (
        <>
          <box flexDirection="row" height={1} flexShrink={0}>
            {row.marker !== "" ? (
              <text
                fg={row.index === selected() ? palette().primary : palette().foreground}
                wrapMode="none"
              >
                {row.marker}
              </text>
            ) : null}
            {row.timeWidth > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {row.time}
              </text>
            ) : null}
            {row.timeWidth > 0 && row.gap > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {gap()}
              </text>
            ) : null}
            <text fg={ink(row.tone)} wrapMode="none">
              {row.glyph}
            </text>
            {row.gap > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {gap()}
              </text>
            ) : null}
            <text
              fg={row.index === selected() ? palette().primary : palette().foreground}
              wrapMode="none"
            >
              {row.label}
            </text>
          </box>
          {row.detail ? (
            <box flexDirection="row" height={1} flexShrink={0}>
              {row.marker !== "" ? (
                <text fg={palette().muted} wrapMode="none">
                  {" ".repeat(row.marker.length)}
                </text>
              ) : null}
              {row.timeWidth > 0 ? (
                <text fg={palette().muted} wrapMode="none">
                  {" ".repeat(row.timeWidth)}
                </text>
              ) : null}
              {row.timeWidth > 0 && row.gap > 0 ? (
                <text fg={palette().muted} wrapMode="none">
                  {gap()}
                </text>
              ) : null}
              <text fg={palette().line} wrapMode="none">
                {`│`.padEnd(row.glyphWidth)}
              </text>
              {row.gap > 0 ? (
                <text fg={palette().muted} wrapMode="none">
                  {gap()}
                </text>
              ) : null}
              <text fg={palette().muted} wrapMode="none">
                {row.detail}
              </text>
            </box>
          ) : null}
        </>
      ))}
    </box>
  )
}

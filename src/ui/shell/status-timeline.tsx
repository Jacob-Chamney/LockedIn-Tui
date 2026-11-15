/**
 * Vertical status timelines for app surfaces.
 *
 * The Solid counterpart of the SDK's `statusTimeline()`: columns, connectors
 * and tone roles come from `src/ui/status-timeline.ts`.
 */
import {
  statusTimelineLayout,
  statusTimelineRole,
  type StatusTimelineEntry,
} from "../status-timeline"
import type { ThemePalette } from "../theme"

export function StatusTimeline(props: {
  theme: ThemePalette
  entries: readonly StatusTimelineEntry[]
  width: number
  timeWidth?: number
  gap?: number
  details?: boolean
  maxEntries?: number
  timeFg?: keyof ThemePalette
  connectorFg?: keyof ThemePalette
  fg?: keyof ThemePalette
  detailFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    statusTimelineLayout({
      entries: props.entries,
      width: props.width,
      ...(props.timeWidth === undefined ? {} : { timeWidth: props.timeWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.details === undefined ? {} : { details: props.details }),
      ...(props.maxEntries === undefined ? {} : { maxEntries: props.maxEntries }),
    })

  return (
    <box flexDirection="column" flexShrink={0}>
      {layout().rows.map((row) => (
        <box flexDirection="row" height={1}>
          {row.timeWidth > 0 ? (
            <>
              <text fg={palette()[props.timeFg ?? "muted"]} wrapMode="none" width={row.timeWidth}>
                {row.time}
              </text>
              <text wrapMode="none">{" ".repeat(row.gap)}</text>
            </>
          ) : null}
          <text fg={palette()[props.connectorFg ?? "line"]} wrapMode="none" width={row.connectorWidth}>
            {row.connector}
          </text>
          <text wrapMode="none">{" ".repeat(row.gap)}</text>
          <text
            fg={palette()[statusTimelineRole(row.state) as keyof ThemePalette]}
            wrapMode="none"
            width={row.glyphWidth}
          >
            {row.glyph}
          </text>
          <text wrapMode="none">{" ".repeat(row.gap)}</text>
          <text
            fg={palette()[row.kind === "detail" ? (props.detailFg ?? "muted") : (props.fg ?? "foreground")]}
            wrapMode="none"
          >
            {row.label}
          </text>
        </box>
      ))}
    </box>
  )
}

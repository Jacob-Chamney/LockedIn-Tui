/**
 * Month calendars for app surfaces.
 *
 * The Solid counterpart of the SDK's `calendar()`: the month grid, weekday
 * headers and marks come from `src/ui/calendar.ts`.
 */
import { calendarLayout } from "../calendar"
import type { ThemePalette } from "../theme"

export function Calendar(props: {
  theme: ThemePalette
  width: number
  month: string
  marked?: readonly string[]
  today?: string
  mondayFirst?: boolean
  cellWidth?: number
}) {
  const palette = () => props.theme
  const layout = () =>
    calendarLayout({
      month: props.month,
      width: props.width,
      ...(props.marked === undefined ? {} : { marked: props.marked }),
      ...(props.today === undefined ? {} : { today: props.today }),
      ...(props.mondayFirst === undefined ? {} : { mondayFirst: props.mondayFirst }),
      ...(props.cellWidth === undefined ? {} : { cellWidth: props.cellWidth }),
    })
  const dayInk = (tone: "warning" | "primary" | "muted") =>
    tone === "warning" ? palette().warning : tone === "primary" ? palette().primary : palette().muted

  return (
    <box flexDirection="column" flexShrink={0} width={layout().width}>
      <text fg={palette().primary} wrapMode="none">
        {layout().title}
      </text>
      <box flexDirection="row" height={1}>
        {layout().weekdays.map((label) => (
          <text fg={palette().muted} wrapMode="none" width={layout().cellWidth}>
            {label}
          </text>
        ))}
      </box>
      {layout().weeks.map((week) => (
        <box flexDirection="row" height={1}>
          {week.map((cell) => (
            <text
              fg={cell.today ? palette().background : dayInk(cell.tone)}
              bg={cell.today ? palette().warning : undefined}
              wrapMode="none"
              width={layout().cellWidth}
            >
              {cell.glyph}
            </text>
          ))}
        </box>
      ))}
    </box>
  )
}

/**
 * Month-grid calendars.
 *
 * One implementation serves the plugin SDK (`calendar()` draws a month grid)
 * and the app's Recent pane. The layout handles a Monday-first (or Sunday-first)
 * week, marks days with activity and carries a `today` flag the renderers can
 * highlight.
 */
export type CalendarCell = {
  /** `YYYY-MM-DD`, or null for a leading/trailing blank. */
  date: string | null
  day: number | null
  marked: boolean
  today: boolean
  /** Two-digit day text, or spaces for a blank. */
  glyph: string
  /** Palette role: `warning` for today, `primary` when marked, else `muted`. */
  tone: "warning" | "primary" | "muted"
}

export type CalendarLayout = {
  /** `November 2026`. */
  title: string
  /** Weekday headers in display order. */
  weekdays: readonly string[]
  /** Up to six weeks; cells outside the month are null. */
  weeks: CalendarCell[][]
  /** Columns per day; defaults to 3 (two digits and a space). */
  cellWidth: number
  /** Width of the grid in cells. */
  width: number
}

export type CalendarOptions = {
  /** Any ISO date (`YYYY-MM-DD`) in the month to show. */
  month: string
  /** Grid width in cells; `cellWidth` is derived from it. */
  width: number
  /** ISO dates with activity. */
  marked?: readonly string[]
  /** ISO date to mark as today. */
  today?: string
  /** Week starts Monday; defaults true. */
  mondayFirst?: boolean
  /** Columns per day; defaults to 3. */
  cellWidth?: number
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

const MONDAY_FIRST = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const
const SUNDAY_FIRST = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function parseMonth(month: string): { year: number; index: number } | null {
  const match = /^(\d{4})-(\d{2})/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2]) - 1
  if (!Number.isFinite(year) || index < 0 || index > 11) return null
  return { year, index }
}

export function calendarLayout(options: CalendarOptions): CalendarLayout {
  const parsed = parseMonth(options.month)
  if (parsed === null) {
    return {
      title: "",
      weekdays: [],
      weeks: [],
      cellWidth: options.cellWidth ?? 3,
      width: Math.max(0, Math.floor(options.width)),
    }
  }
  const { year, index } = parsed
  const cellWidth = Math.max(2, Math.floor(options.cellWidth ?? 3))
  const marked = new Set(options.marked ?? [])
  const today = options.today
  const mondayFirst = options.mondayFirst !== false
  const weekdays = mondayFirst ? MONDAY_FIRST : SUNDAY_FIRST
  const first = new Date(year, index, 1)
  const offset = mondayFirst ? (first.getDay() + 6) % 7 : first.getDay()
  const days = new Date(year, index + 1, 0).getDate()
  const total = offset + days
  const weekCount = Math.max(1, Math.ceil(total / 7))
  const weeks: CalendarCell[][] = []

  for (let week = 0; week < weekCount; week++) {
    const cells: CalendarCell[] = []
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const at = week * 7 + dayOfWeek
      const dayNumber = at - offset + 1
      if (dayNumber < 1 || dayNumber > days) {
        cells.push({ date: null, day: null, marked: false, today: false, glyph: " ".repeat(2), tone: "muted" })
        continue
      }
      const date = `${year}-${pad(index + 1)}-${pad(dayNumber)}`
      const isToday = today === date
      const isMarked = marked.has(date)
      cells.push({
        date,
        day: dayNumber,
        marked: isMarked,
        today: isToday,
        glyph: String(dayNumber).padStart(2, " "),
        tone: isToday ? "warning" : isMarked ? "primary" : "muted",
      })
    }
    weeks.push(cells)
  }

  return {
    title: `${MONTHS[index]} ${year}`,
    weekdays,
    weeks,
    cellWidth,
    width: Math.max(0, Math.floor(options.width)),
  }
}

/** Local `YYYY-MM-DD` for a date; useful for the today marker. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

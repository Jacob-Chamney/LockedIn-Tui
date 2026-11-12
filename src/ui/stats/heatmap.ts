/** Calendar helpers for the contribution grid. */
import type { ActivityDay, StatsPeriod } from "../../stats/types"

export type HeatDay = { date: string; runs: number; tokens: number } | null
export type Heatmap = {
  weeks: HeatDay[][]
  months: Array<{ week: number; label: string }>
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function monday(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - offset)
  return copy
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  copy.setDate(copy.getDate() + days)
  return copy
}

/** Build at most `maxWeeks` calendar weeks ending with the period's last day. */
export function buildHeatmap(
  activity: readonly ActivityDay[],
  period: StatsPeriod,
  maxWeeks: number,
): Heatmap {
  const from = parseDate(period.from)
  const to = parseDate(period.to)
  if (from === null || to === null || to < from || maxWeeks < 1) {
    return { weeks: [], months: [] }
  }

  const byDate = new Map(activity.map((day) => [day.date, day]))
  const lastWeek = monday(to)
  let firstWeek = monday(from)
  const totalWeeks = Math.floor((lastWeek.getTime() - firstWeek.getTime()) / (7 * 86_400_000)) + 1
  if (totalWeeks > maxWeeks) firstWeek = addDays(lastWeek, -(maxWeeks - 1) * 7)

  const weeks: HeatDay[][] = []
  const months: Array<{ week: number; label: string }> = []
  let previousMonth = -1
  for (let week = 0; week < maxWeeks; week++) {
    const start = addDays(firstWeek, week * 7)
    if (start > to) break
    const days: HeatDay[] = []
    for (let index = 0; index < 7; index++) {
      const date = addDays(start, index)
      if (date < from || date > to) {
        days.push(null)
        continue
      }
      const key = dateKey(date)
      const found = byDate.get(key)
      days.push(found ?? { date: key, runs: 0, tokens: 0 })
      if (index === 0 && date.getMonth() !== previousMonth) {
        months.push({ week, label: MONTHS[date.getMonth()]! })
        previousMonth = date.getMonth()
      }
    }
    weeks.push(days)
  }
  return { weeks, months }
}

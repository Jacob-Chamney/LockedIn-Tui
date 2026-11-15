import { expect, test } from "bun:test"

import { calendarLayout, dateKey } from "../../src/ui/calendar"

test("November 2026 starts on the last Monday-first column", () => {
  const layout = calendarLayout({ month: "2026-11-15", width: 21, cellWidth: 3 })
  expect(layout.title).toBe("November 2026")
  expect(layout.weekdays).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])
  expect(layout.weeks).toHaveLength(6)
  expect(layout.weeks[0]!.slice(0, 6).every((cell) => cell.day === null)).toBe(true)
  expect(layout.weeks[0]![6]).toMatchObject({ date: "2026-11-01", day: 1, tone: "muted" })
  expect(layout.weeks[5]![0]).toMatchObject({ date: "2026-11-30", day: 30 })
  expect(layout.weeks[5]!.slice(1).every((cell) => cell.day === null)).toBe(true)
})

test("marked and today cells carry their tone", () => {
  const layout = calendarLayout({
    month: "2026-11-01",
    width: 21,
    marked: ["2026-11-05", "2026-11-10"],
    today: "2026-11-10",
  })
  const byDate = (date: string) => layout.weeks.flat().find((cell) => cell.date === date)!
  expect(byDate("2026-11-05")).toMatchObject({ marked: true, today: false, tone: "primary" })
  expect(byDate("2026-11-10")).toMatchObject({ marked: true, today: true, tone: "warning" })
})

test("Sunday-first changes the offset", () => {
  const layout = calendarLayout({ month: "2026-11-01", width: 21, mondayFirst: false })
  expect(layout.weekdays[0]).toBe("Su")
  expect(layout.weeks[0]![0]).toMatchObject({ date: "2026-11-01", day: 1 })
  expect(layout.weeks).toHaveLength(5)
})

test("invalid months draw nothing", () => {
  expect(calendarLayout({ month: "nope", width: 21 })).toMatchObject({ title: "", weeks: [] })
})

test("cell width and date keys", () => {
  const layout = calendarLayout({ month: "2026-11-01", width: 14, cellWidth: 2 })
  expect(layout.cellWidth).toBe(2)
  expect(dateKey(new Date(2026, 10, 5))).toBe("2026-11-05")
})

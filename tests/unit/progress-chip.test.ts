import { expect, test } from "bun:test"

import {
  PROGRESS_CHIP_GLYPHS,
  progressChipLayout,
  progressChipStyle,
} from "../../src/ui/progress-chip"

test("a partial chip fills part of the bar", () => {
  expect(progressChipLayout({ done: 2, total: 4 })).toMatchObject({
    fraction: 0.5,
    filled: 2,
    empty: 2,
    count: "2/4",
    text: "▰▰▱▱ 2/4",
    tone: "primary",
    width: 8,
  })
  expect(PROGRESS_CHIP_GLYPHS.empty).toBe("▱")
})

test("zero, complete and missing totals pick a tone", () => {
  expect(progressChipLayout({ done: 0, total: 4 }).tone).toBe("muted")
  expect(progressChipLayout({ done: 4, total: 4 }).tone).toBe("success")
  expect(progressChipLayout({ done: 4, total: 4 }).text).toBe("▰▰▰▰ 4/4")
  expect(progressChipLayout({ done: 0, total: 0 })).toMatchObject({
    fraction: 0,
    count: "—",
    text: "▱▱▱▱ —",
    tone: "muted",
  })
})

test("values are clamped and rounded", () => {
  expect(progressChipLayout({ done: 9, total: 4 }).count).toBe("4/4")
  expect(progressChipLayout({ done: -3, total: 4 }).count).toBe("0/4")
  expect(progressChipLayout({ done: 1, total: 3 }).filled).toBe(1)
  expect(progressChipLayout({ done: 2, total: 3 }).filled).toBe(3)
})

test("a width fits or hides the chip", () => {
  expect(progressChipLayout({ done: 2, total: 4, width: 5 }).text).toBe("▰▰▱▱…")
  expect(progressChipLayout({ done: 2, total: 4, width: 0 }).text).toBe("")
})

test("custom glyphs and bar width are honoured", () => {
  expect(
    progressChipLayout({ done: 1, total: 2, barWidth: 2, glyphs: { filled: "=", empty: "-" } }).text,
  ).toBe("=- 1/2")
})

test("each tone has a fill and ink role", () => {
  expect(progressChipStyle("success")).toEqual({ bg: "success", fg: "background" })
  expect(progressChipStyle("primary")).toEqual({ bg: "primary", fg: "background" })
  expect(progressChipStyle("muted")).toEqual({ bg: "line", fg: "foreground" })
  expect(progressChipStyle()).toEqual({ bg: "line", fg: "foreground" })
})

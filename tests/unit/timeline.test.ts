import { expect, test } from "bun:test"

import { timelineRole, timelineRows } from "../../src/ui/timeline"

test("an empty timeline has no rows", () => {
  expect(timelineRows({ entries: [], width: 40 })).toEqual([])
})

test("times, glyphs and labels share columns", () => {
  const rows = timelineRows({
    entries: [
      { time: "10:00", label: "a" },
      { time: "10:05", label: "b", detail: "detail", tone: "success" },
    ],
    width: 40,
  })
  expect(rows).toHaveLength(2)
  const first = rows[0]!
  expect(first.time).toBe("10:00")
  expect(first.glyph).toBe("●")
  expect(first.label).toBe("a")
  expect(first.detail).toBeUndefined()
  expect(first.y).toBe(0)
  expect(first.timeWidth).toBe(5)
  expect(first.glyphWidth).toBe(1)
  expect(first.contentWidth).toBe(32)
  const second = rows[1]!
  expect(second.y).toBe(1)
  expect(second.detail).toBe("detail")
  expect(second.tone).toBe("success")
})

test("a detail row adds a second line", () => {
  const rows = timelineRows({
    entries: [
      { time: "10:00", label: "a", detail: "one" },
      { time: "10:05", label: "b" },
    ],
    width: 40,
  })
  expect(rows[0]!.y).toBe(0)
  expect(rows[1]!.y).toBe(2)
})

test("selection adds a marker column", () => {
  const rows = timelineRows({
    entries: [{ time: "10:00", label: "a" }, { time: "10:05", label: "b" }],
    width: 40,
    selected: 1,
    selectable: true,
  })
  expect(rows[0]!.marker).toBe("  ")
  expect(rows[1]!.marker).toBe("▸ ")
})

test("long labels truncate with an ellipsis", () => {
  const rows = timelineRows({
    entries: [{ time: "10:00", label: "a-very-long-label-and-more" }],
    width: 20,
  })
  expect(rows[0]!.label.endsWith("…")).toBe(true)
})

test("details can be turned off", () => {
  const rows = timelineRows({
    entries: [
      { time: "10:00", label: "a", detail: "one" },
      { time: "10:05", label: "b", detail: "two" },
    ],
    width: 40,
    details: false,
  })
  expect(rows[0]!.detail).toBeUndefined()
  expect(rows[1]!.y).toBe(1)
})

test("tones map to palette roles with a fallback", () => {
  expect(timelineRole("info")).toBe("secondary")
  expect(timelineRole("success")).toBe("success")
  expect(timelineRole("warning")).toBe("warning")
  expect(timelineRole("error")).toBe("error")
  expect(timelineRole("muted")).toBe("muted")
  expect(timelineRole()).toBe("secondary")
  expect(timelineRole("nope" as never)).toBe("secondary")
})

test("narrow timelines drop columns instead of overflowing", () => {
  for (const width of [1, 2, 3, 4, 5]) {
    const rows = timelineRows({
      width,
      entries: [{ time: "10:00", label: "a long label", detail: "failed run" }],
      selectable: true,
      selected: 0,
    })
    for (const row of rows) {
      const length =
        row.marker.length + row.time.length + row.glyph.length + row.label.length +
        (row.timeWidth > 0 ? row.gap : 0) + (row.glyphWidth > 0 ? row.gap : 0)
      expect(length).toBeLessThanOrEqual(width)
    }
  }
})

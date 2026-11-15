import { expect, test } from "bun:test"

import {
  STATUS_TIMELINE_ROLES,
  statusTimelineGlyph,
  statusTimelineLayout,
  statusTimelineRole,
  statusTimelineText,
} from "../../src/ui/status-timeline"

const ENTRIES = [
  { id: "a", time: "10:00", label: "first model", state: "success" as const },
  { id: "b", time: "11:00", label: "second model", detail: "failed run", state: "error" as const },
]

test("entries share a time, connector, glyph and label rail", () => {
  const layout = statusTimelineLayout({ entries: ENTRIES, width: 40 })
  expect(layout.timeWidth).toBe(5)
  expect(layout.rows.map((row) => [row.kind, row.connector, row.glyph.trim(), row.label])).toEqual([
    ["entry", "├─", "✓", "first model"],
    ["entry", "└─", "×", "second model"],
    ["detail", "  ", "", "failed run"],
  ])
  expect(statusTimelineText({ entries: ENTRIES, width: 40 })).toEqual([
    "10:00 ├─ ✓ first model",
    "11:00 └─ × second model",
    "           failed run",
  ])
})

test("details connect with a rail unless they are last", () => {
  const entries = [...ENTRIES, { id: "c", time: "12:00", label: "third" }]
  const rows = statusTimelineLayout({ entries, width: 40 }).rows
  expect(rows[1]).toMatchObject({ kind: "entry", connector: "├─" })
  expect(rows[2]).toMatchObject({ kind: "detail", connector: "│ " })
  expect(rows[3]).toMatchObject({ kind: "entry", connector: "└─" })
})

test("states choose glyphs, tones and custom glyphs win", () => {
  expect(statusTimelineGlyph("success")).toBe("✓")
  expect(statusTimelineGlyph("error")).toBe("×")
  expect(statusTimelineGlyph("warning")).toBe("!")
  expect(statusTimelineRole("error")).toBe(STATUS_TIMELINE_ROLES.error)
  expect(statusTimelineRole()).toBe("secondary")
  const custom = statusTimelineLayout({
    entries: [{ id: "a", label: "x", state: "warning", glyph: "!" }],
    width: 20,
  })
  expect(custom.rows[0]).toMatchObject({ glyph: "!", state: "warning" })
})

test("labels fit, entries cap and zero width is empty", () => {
  const layout = statusTimelineLayout({ entries: ENTRIES, width: 18 })
  for (const row of layout.rows) {
    expect(row.label.length).toBeLessThanOrEqual(18)
    const time = row.timeWidth > 0 ? `${row.time}${" ".repeat(row.gap)}` : ""
    expect(time.length + row.connectorWidth + row.gap + row.glyphWidth + row.gap + row.label.length).toBeLessThanOrEqual(18)
  }
  const capped = statusTimelineLayout({ entries: ENTRIES, width: 40, maxEntries: 1 })
  expect(capped.rows).toHaveLength(1)
  expect(capped.hidden).toBe(1)
  expect(statusTimelineLayout({ entries: ENTRIES, width: 0 }).rows).toEqual([])
})

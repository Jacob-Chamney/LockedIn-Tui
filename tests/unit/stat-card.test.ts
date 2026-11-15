import { expect, test } from "bun:test"

import { statCardLayout, statCardToneRole } from "../../src/ui/stat-card"

test("value, label and detail centre in the card", () => {
  const layout = statCardLayout({
    width: 20,
    value: "14 days",
    label: "best streak",
    detail: "in a row",
  })
  expect(layout.rows).toEqual([
    { kind: "value", text: "14 days", x: 6, width: 20 },
    { kind: "label", text: "best streak", x: 4, width: 20 },
    { kind: "detail", text: "in a row", x: 6, width: 20 },
  ])
  expect(layout.text).toBe("14 days\nbest streak\nin a row")
})

test("alignment and tone are honoured", () => {
  const left = statCardLayout({ width: 20, value: "3", label: "sessions", align: "left" })
  expect(left.rows.map((row) => row.x)).toEqual([0, 0])
  const right = statCardLayout({ width: 20, value: "3", label: "sessions", align: "right" })
  expect(right.rows.map((row) => row.x)).toEqual([19, 12])
  expect(statCardToneRole("success")).toBe("success")
  expect(statCardToneRole()).toBe("foreground")
})

test("lines fit the width and zero width is empty", () => {
  const layout = statCardLayout({ width: 8, value: "a very long value", label: "label" })
  expect(layout.rows[0]!.text).toBe("a very …")
  expect(statCardLayout({ width: 0, value: "x", label: "y" }).rows).toEqual([])
})

test("an empty detail is omitted", () => {
  expect(statCardLayout({ width: 20, value: "1", label: "one", detail: "" }).rows).toHaveLength(2)
})

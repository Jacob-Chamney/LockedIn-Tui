import { expect, test } from "bun:test"

import { BREADCRUMB_SEPARATOR, breadcrumbs } from "../../src/ui/breadcrumbs"

test("an empty trail has no text", () => {
  expect(breadcrumbs({ items: [], width: 20 })).toEqual({ text: "", segments: [], truncated: false })
  expect(breadcrumbs({ items: ["", ""], width: 20 }).text).toBe("")
})

test("a trail that fits keeps every crumb", () => {
  const layout = breadcrumbs({ items: ["CHILL", "Chat"], width: 20 })
  expect(layout.text).toBe(`CHILL${BREADCRUMB_SEPARATOR}Chat`)
  expect(layout.truncated).toBe(false)
  expect(layout.segments.map((segment) => [segment.kind, segment.text])).toEqual([
    ["crumb", "CHILL"],
    ["separator", BREADCRUMB_SEPARATOR],
    ["crumb", "Chat"],
  ])
  expect(layout.segments[0]!.first).toBe(true)
  expect(layout.segments.at(-1)!.last).toBe(true)
})

test("the middle is elided before the root", () => {
  const items = ["CHILL", "Physics", "Chat"]
  const compact = breadcrumbs({ items, width: 16 })
  expect(compact.text).toBe("CHILL › … › Chat")
  expect(compact.truncated).toBe(true)

  const elided = breadcrumbs({ items, width: 12 })
  expect(elided.text).toBe("… › Chat")
  expect(elided.segments[0]).toMatchObject({ kind: "ellipsis" })
  expect(elided.segments.at(-1)).toMatchObject({ kind: "crumb", last: true })
})

test("a short width truncates the current crumb last", () => {
  expect(breadcrumbs({ items: ["CHILL", "Chat"], width: 5 }).text).toBe("Chat")
  expect(breadcrumbs({ items: ["CHILL", "Chat"], width: 3 }).text).toBe("Ch…")
  expect(breadcrumbs({ items: ["CHILL", "Chat"], width: 1 }).text).toBe("…")
})

test("a zero width is empty", () => {
  expect(breadcrumbs({ items: ["Chat"], width: 0 })).toEqual({ text: "", segments: [], truncated: true })
})

test("custom separators and ellipses are honoured", () => {
  expect(breadcrumbs({ items: ["A", "B"], width: 10, separator: " / " }).text).toBe("A / B")
  expect(breadcrumbs({ items: ["A", "B", "C"], width: 4, separator: ">", ellipsis: "~" }).text).toBe("~>C")
})

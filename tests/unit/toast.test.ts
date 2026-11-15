import { expect, test } from "bun:test"

import {
  TOAST_STYLES,
  toastAvailable,
  toastGlyph,
  toastLines,
  toastStackLayout,
  toastStyle,
  toastWidth,
} from "../../src/ui/toast"

test("each tone has a fill, ink and glyph", () => {
  expect(toastStyle("info")).toEqual({ fill: "panel", ink: "foreground", glyph: "·" })
  expect(toastStyle("warn")).toEqual({ fill: "warning", ink: "background", glyph: "!" })
  expect(toastStyle("error")).toEqual({ fill: "error", ink: "background", glyph: "×" })
  expect(toastStyle("nope" as never)).toBe(TOAST_STYLES.info)
  expect(toastGlyph()).toBe("·")
})

test("toasts may use half the surface width", () => {
  expect(toastAvailable(60)).toBe(30)
  expect(toastAvailable(200)).toBe(52)
  expect(toastAvailable(10)).toBe(5)
})

test("widths fit the text between the minimum and cap", () => {
  expect(toastWidth("hi", 30)).toBe(20)
  expect(toastWidth("a".repeat(20), 30)).toBe(24)
  expect(toastWidth("a".repeat(100), 30)).toBe(30)
  expect(toastWidth("a".repeat(100), 30, { minWidth: 10, maxWidth: 20 })).toBe(20)
})

test("the body wraps inside the glyph column and clips with an ellipsis", () => {
  expect(toastLines("saved", 20)).toEqual(["saved"])
  const lines = toastLines("one two three four five six seven eight nine", 20, 2)
  expect(lines).toHaveLength(2)
  expect(lines[1]!.endsWith("…")).toBe(true)
})

test("the stack keeps the newest and reports the rest", () => {
  const toasts = [
    { id: "a", text: "one", tone: "info" as const },
    { id: "b", text: "two", tone: "warn" as const },
    { id: "c", text: "three", tone: "error" as const },
  ]
  const layout = toastStackLayout({ toasts, width: 60, maxVisible: 2 })
  expect(layout.items.map((item) => item.id)).toEqual(["b", "c"])
  expect(layout.hidden).toBe(1)
  expect(layout.gap).toBe(1)
  expect(layout.items.map((item) => item.tone)).toEqual(["warn", "error"])
  expect(layout.items[1]!.newest).toBe(true)
  expect(layout.items[0]!.y).toBe(0)
  expect(layout.items[1]!.y).toBe(layout.items[0]!.frameHeight + 1)
  expect(layout.totalHeight).toBe(
    layout.items[0]!.frameHeight + 1 + layout.items[1]!.frameHeight,
  )
})

test("wrapped lines set the frame height", () => {
  const layout = toastStackLayout({
    toasts: [{ id: "a", text: "one two three four five six seven eight", tone: "info" }],
    width: 40,
    maxLines: 2,
  })
  expect(layout.items[0]!.lines).toHaveLength(2)
  expect(layout.items[0]!.height).toBe(2)
  expect(layout.items[0]!.frameHeight).toBe(4)
})

test("empty input and zero width produce no rows", () => {
  expect(toastStackLayout({ toasts: [], width: 60 })).toMatchObject({ items: [], hidden: 0 })
  expect(toastStackLayout({ toasts: [{ id: "a", text: "x" }], width: 0 }).items).toEqual([])
  expect(toastStackLayout({ toasts: [{ id: "a", text: "x" }], width: 60, maxVisible: 0 }).items).toEqual([])
})

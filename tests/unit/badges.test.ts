import { expect, test } from "bun:test"

import { badgeLayout, badgeStyle } from "../../src/ui/badges"

test("an empty badge row has no chips", () => {
  expect(badgeLayout({ badges: [], width: 40 })).toEqual([])
  expect(badgeLayout({ badges: [{ label: "linked" }], width: 0 })).toEqual([])
})

test("badges carry padding, a gap and their tone", () => {
  const segments = badgeLayout({
    badges: [{ label: "linked", tone: "success" }, { label: "3 models" }],
    width: 40,
  })
  expect(segments).toEqual([
    { text: " linked ", tone: "success", x: 0, width: 8, index: 0 },
    { text: " 3 models ", tone: "neutral", x: 9, width: 10, index: 1 },
  ])
})

test("the first badge that does not fit ends the row", () => {
  const segments = badgeLayout({
    badges: [{ label: "linked" }, { label: "3 models" }, { label: "active" }],
    width: 19,
  })
  expect(segments.map((segment) => segment.text)).toEqual([" linked ", " 3 models "])
})

test("a lone too-wide badge is truncated", () => {
  const [segment] = badgeLayout({ badges: [{ label: "statistics" }], width: 5 })
  expect(segment!.width).toBe(5)
  expect(segment!.text.endsWith("…")).toBe(true)
})

test("padding and gap are clamped to sane values", () => {
  const segments = badgeLayout({
    badges: [{ label: "a" }, { label: "b" }],
    width: 40,
    padding: -4,
    gap: 99,
  })
  expect(segments[0]!.text).toBe("a")
  expect(segments[1]!.x).toBe(9)
})

test("each tone has a fill and ink pair", () => {
  expect(badgeStyle("success")).toEqual({ bg: "success", fg: "background" })
  expect(badgeStyle("warning")).toEqual({ bg: "warning", fg: "background" })
  expect(badgeStyle("error")).toEqual({ bg: "error", fg: "background" })
  expect(badgeStyle("info")).toEqual({ bg: "primary", fg: "background" })
  expect(badgeStyle("neutral")).toEqual({ bg: "line", fg: "background" })
  expect(badgeStyle()).toEqual({ bg: "line", fg: "background" })
  expect(badgeStyle("nope" as never)).toEqual({ bg: "line", fg: "background" })
})

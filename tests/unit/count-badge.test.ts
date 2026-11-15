import { expect, test } from "bun:test"

import { COUNT_BADGE_STYLES, countBadgeLayout, countBadgePlacement, countBadgeStyle } from "../../src/ui/count-badge"

test("badges pad the number and grow with its digits", () => {
  expect(countBadgeLayout({ count: 3 })).toMatchObject({ display: "3", text: " 3 ", width: 3 })
  expect(countBadgeLayout({ count: 42 })).toMatchObject({ display: "42", text: " 42 ", width: 4 })
  expect(countBadgeLayout({ count: 3, pad: 0 }).text).toBe("3")
})

test("counts above the cap become 99+", () => {
  expect(countBadgeLayout({ count: 100 })).toMatchObject({ display: "99+", overflow: true, text: " 99+ ", width: 5 })
  expect(countBadgeLayout({ count: 10, max: 9 })).toMatchObject({ display: "9+", overflow: true })
  expect(countBadgeLayout({ count: 9, max: 9 })).toMatchObject({ display: "9", overflow: false })
})

test("counts are clamped and a width fits the badge", () => {
  expect(countBadgeLayout({ count: -4 }).display).toBe("0")
  expect(countBadgeLayout({ count: Number.NaN }).display).toBe("0")
  expect(countBadgeLayout({ count: 3, width: 2 }).text).toBe(" …")
  expect(countBadgeLayout({ count: 3, width: 0 }).text).toBe("")
})

test("placement aligns left, right or centre and clamps", () => {
  expect(countBadgePlacement({ container: 10, badge: 3 })).toBe(7)
  expect(countBadgePlacement({ container: 10, badge: 3, inset: 1 })).toBe(6)
  expect(countBadgePlacement({ container: 10, badge: 3, align: "left", inset: 1 })).toBe(1)
  expect(countBadgePlacement({ container: 10, badge: 3, align: "center" })).toBe(3)
  expect(countBadgePlacement({ container: 2, badge: 5, align: "right" })).toBe(0)
})

test("each tone has a fill and ink pair", () => {
  expect(countBadgeStyle("info")).toEqual({ bg: "primary", fg: "background" })
  expect(countBadgeStyle("warning")).toEqual({ bg: "warning", fg: "background" })
  expect(countBadgeStyle("muted")).toEqual({ bg: "line", fg: "foreground" })
  expect(countBadgeStyle("nope" as never)).toBe(COUNT_BADGE_STYLES.info)
})

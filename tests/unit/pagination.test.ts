import { expect, test } from "bun:test"

import { paginationLayout } from "../../src/ui/pagination"

test("dots mark the current page", () => {
  const layout = paginationLayout({ page: 0, total: 3, width: 12 })
  expect(layout.text).toBe("● ○ ○")
  expect(layout.fallback).toBe(false)
  expect(layout.tokens.filter((token) => token.kind === "page" && token.text !== " ").map((token) => token.current)).toEqual([true, false, false])
  expect(paginationLayout({ page: 2, total: 3 }).text).toBe("○ ○ ●")
})

test("numbers list every page", () => {
  const layout = paginationLayout({ page: 1, total: 3, style: "numbers" })
  expect(layout.text).toBe("1 2 3")
  expect(layout.tokens.filter((token) => token.text !== " " && token.current)[0]!.text).toBe("2")
})

test("the count style is one token", () => {
  const layout = paginationLayout({ page: 1, total: 3, style: "count" })
  expect(layout.text).toBe("2/3")
  expect(layout.tokens).toMatchObject([{ kind: "count", text: "2/3", current: true }])
})

test("a narrow width falls back to a fitted count", () => {
  const layout = paginationLayout({ page: 1, total: 5, width: 3 })
  expect(layout.text).toBe("2/5")
  expect(layout.fallback).toBe(true)
  expect(paginationLayout({ page: 1, total: 5, width: 2 }).text).toBe("2…")
})

test("pages are clamped and glyphs can change", () => {
  expect(paginationLayout({ page: -2, total: 3 }).tokens.find((token) => token.current)!.page).toBe(0)
  expect(paginationLayout({ page: 99, total: 3 }).tokens.find((token) => token.current)!.page).toBe(2)
  expect(paginationLayout({ page: 0, total: 2, glyphs: { current: "x", other: "." } }).text).toBe("x .")
})

import { expect, test } from "bun:test"

import { RATING_GLYPHS, ratingLayout } from "../../src/ui/rating"

test("a level fills the first pips", () => {
  expect(ratingLayout({ value: 3, max: 5 })).toEqual({
    value: 3,
    max: 5,
    filled: 3,
    empty: 2,
    text: "●●●○○",
  })
  expect(RATING_GLYPHS.empty).toBe("○")
})

test("levels are clamped and rounded", () => {
  expect(ratingLayout({ value: -2, max: 5 }).text).toBe("○○○○○")
  expect(ratingLayout({ value: 9, max: 5 }).text).toBe("●●●●●")
  expect(ratingLayout({ value: 2.6, max: 4 }).text).toBe("●●●○")
})

test("the default maximum is five", () => {
  expect(ratingLayout({ value: 1 })).toMatchObject({ max: 5, text: "●○○○○" })
})

test("custom glyphs are honoured", () => {
  expect(ratingLayout({ value: 2, max: 3, glyphs: { filled: "x", empty: "." } }).text).toBe("xx.")
})

test("a zero maximum draws nothing", () => {
  expect(ratingLayout({ value: 3, max: 0 })).toMatchObject({ max: 0, filled: 0, empty: 0, text: "" })
})

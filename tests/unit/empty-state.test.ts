import { expect, test } from "bun:test"

import { EMPTY_STATE_GLYPH, emptyStateRows, emptyStateX } from "../../src/ui/empty-state"

test("a glyph, title and hint become rows in order", () => {
  const rows = emptyStateRows({ width: 40, glyph: "○", title: "no activity yet", hint: "run an agent" })
  expect(rows).toEqual([
    { kind: "glyph", text: "○" },
    { kind: "title", text: "no activity yet" },
    { kind: "hint", text: "run an agent" },
  ])
})

test("the glyph is optional", () => {
  expect(emptyStateRows({ width: 40, title: "empty" })).toEqual([{ kind: "title", text: "empty" }])
  expect(emptyStateRows({ width: 40, glyph: "", title: "empty" })).toEqual([
    { kind: "title", text: "empty" },
  ])
})

test("titles and hints wrap to the width", () => {
  const rows = emptyStateRows({
    width: 10,
    title: "nothing here yet",
    hint: "clear the filter",
  })
  expect(rows.map((row) => row.text)).toEqual([
    "nothing",
    "here yet",
    "clear the",
    "filter",
  ])
})

test("a word wider than the width hard-breaks", () => {
  const rows = emptyStateRows({ width: 4, title: "abcdefghij" })
  expect(rows.map((row) => row.text)).toEqual(["abcd", "efgh", "ij"])
})

test("an empty message has no rows", () => {
  expect(emptyStateRows({ width: 40, title: "" })).toEqual([])
  expect(emptyStateRows({ width: 40, title: "", hint: "" })).toEqual([])
})

test("rows centre in the available width", () => {
  const rows = emptyStateRows({ width: 20, glyph: "○", title: "no activity" })
  expect(emptyStateX(rows[0]!, 20)).toBe(9)
  expect(emptyStateX(rows[1]!, 20)).toBe(4)
  expect(EMPTY_STATE_GLYPH).toBe("○")
})

test("a row wider than the width starts at zero", () => {
  expect(emptyStateX({ kind: "title", text: "abcdefghij" }, 4)).toBe(0)
})

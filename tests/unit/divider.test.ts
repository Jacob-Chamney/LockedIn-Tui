import { expect, test } from "bun:test"

import { dividerLayout } from "../../src/ui/divider"

test("an unlabelled divider fills the width", () => {
  expect(dividerLayout({ width: 10 })).toEqual({
    width: 10,
    label: "",
    left: "──────────",
    middle: "",
    right: "",
    text: "──────────",
  })
})

test("a label is centred between the lines", () => {
  const layout = dividerLayout({ width: 30, label: "notes" })
  expect(layout.left).toBe("───────────")
  expect(layout.middle).toBe(" notes ")
  expect(layout.right).toBe("────────────")
  expect(layout.text).toBe("─────────── notes ────────────")
  expect(layout.text).toHaveLength(30)
})

test("a label too wide for the rule is fitted alone", () => {
  expect(dividerLayout({ width: 8, label: "a longer label" }).text).toBe("a longe…")
  expect(dividerLayout({ width: 4, label: "notes" }).text).toBe("not…")
  expect(dividerLayout({ width: 1, label: "notes" }).text).toBe("…")
})

test("custom glyphs and zero width are handled", () => {
  expect(dividerLayout({ width: 6, glyph: "=" }).text).toBe("======")
  expect(dividerLayout({ width: 0 }).text).toBe("")
})

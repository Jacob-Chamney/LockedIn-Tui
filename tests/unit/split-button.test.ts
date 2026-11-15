import { expect, test } from "bun:test"

import { splitButtonLayout, splitButtonText } from "../../src/ui/split-button"

const PRIMARY = { key: "Enter", label: "send" }
const SECONDARY = { key: "⇧Enter", label: "newline" }

test("primary and secondary actions are placed as one unit", () => {
  const layout = splitButtonLayout({ primary: PRIMARY, secondary: SECONDARY })
  expect(layout.text).toBe("[Enter] send│[⇧Enter] newline")
  expect(layout.width).toBe(29)
  expect(layout.secondaryVisible).toBe(true)
  expect(layout.tokens.map((token) => [token.kind, token.text, token.x])).toEqual([
    ["key", "[Enter]", 0],
    ["label", " send", 7],
    ["separator", "│", 12],
    ["key", "[⇧Enter]", 13],
    ["label", " newline", 21],
  ])
})

test("the secondary half is dropped when it does not fit", () => {
  const layout = splitButtonLayout({ primary: PRIMARY, secondary: SECONDARY, width: 20 })
  expect(layout.text).toBe("[Enter] send")
  expect(layout.secondaryVisible).toBe(false)
})

test("a too-narrow button is fitted", () => {
  expect(splitButtonText({ primary: PRIMARY, secondary: SECONDARY, width: 5 })).toBe("[Ent…")
  expect(splitButtonText({ primary: PRIMARY, width: 0 })).toBe("")
})

test("disabled is reported and a custom separator is honoured", () => {
  const layout = splitButtonLayout({ primary: PRIMARY, secondary: SECONDARY, disabled: true, separator: " " })
  expect(layout.disabled).toBe(true)
  expect(layout.text).toBe("[Enter] send [⇧Enter] newline")
})

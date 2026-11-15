import { expect, test } from "bun:test"

import { SPINNER_FRAMES, spinnerLayout, spinnerText } from "../../src/ui/spinner"

test("frames advance and wrap", () => {
  expect(spinnerLayout({ frame: 0 })).toMatchObject({ frame: 0, glyph: "⠋", text: "⠋" })
  expect(spinnerLayout({ frame: 1 }).glyph).toBe("⠙")
  expect(spinnerLayout({ frame: SPINNER_FRAMES.length }).glyph).toBe("⠋")
  expect(spinnerLayout({ frame: -1 }).glyph).toBe(SPINNER_FRAMES.at(-1)!)
})

test("a label follows the glyph", () => {
  const layout = spinnerLayout({ frame: 2, label: "loading" })
  expect(layout.text).toBe("⠹ loading")
  expect(layout.width).toBe(9)
})

test("the text fits the width", () => {
  expect(spinnerText({ frame: 0, label: "discovering plugins", width: 8 })).toBe("⠋ disco…")
  expect(spinnerText({ frame: 0, label: "loading", width: 0 })).toBe("")
})

test("custom frames are honoured", () => {
  expect(spinnerText({ frame: 1, label: "x", frames: [".", "-"] })).toBe("- x")
  expect(spinnerText({ frame: 0, label: "x", frames: [] })).toBe("⠋ x")
})

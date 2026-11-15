import { expect, test } from "bun:test"

import { DELTA_GLYPHS, deltaLayout, deltaText } from "../../src/ui/delta"

test("a rise points up and is a success by default", () => {
  const layout = deltaLayout({ value: 12, label: "vs prior 7d" })
  expect(layout).toMatchObject({
    percent: 12,
    direction: "up",
    tone: "success",
    glyph: "▲",
    text: "▲ 12% vs prior 7d",
  })
  expect(DELTA_GLYPHS.down).toBe("▼")
})

test("a fall is an error unless falling is good", () => {
  expect(deltaLayout({ value: -8 })).toMatchObject({ direction: "down", tone: "error", text: "▼ 8%" })
  expect(deltaLayout({ value: -8, good: "down" })).toMatchObject({ tone: "success" })
  expect(deltaLayout({ value: 8, good: "down" })).toMatchObject({ tone: "error" })
})

test("zero is flat and muted", () => {
  expect(deltaLayout({ value: 0.2 })).toMatchObject({ percent: 0, direction: "flat", tone: "muted", text: "— 0%" })
  expect(deltaLayout({ value: Number.NaN })).toMatchObject({ percent: 0, direction: "flat" })
})

test("values round and the text fits the width", () => {
  expect(deltaLayout({ value: 12.6 }).text).toBe("▲ 13%")
  expect(deltaText({ value: -12, width: 5 })).toBe("▼ 12%")
  expect(deltaText({ value: -12, width: 4 })).toBe("▼ 1…")
  expect(deltaText({ value: 12, width: 0 })).toBe("")
})

test("custom glyphs are honoured", () => {
  expect(deltaText({ value: 4, glyphs: { up: "+" } })).toBe("+ 4%")
})

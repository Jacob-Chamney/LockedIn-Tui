import { expect, test } from "bun:test"

import { statusDotLayout } from "../../src/ui/status-dot"

test("each state has a glyph and tone", () => {
  expect(statusDotLayout({ state: "ok" })).toMatchObject({ glyph: "●", tone: "success" })
  expect(statusDotLayout({ state: "warn" })).toMatchObject({ glyph: "▲", tone: "warning" })
  expect(statusDotLayout({ state: "error" })).toMatchObject({ glyph: "×", tone: "error" })
  expect(statusDotLayout({ state: "idle" })).toMatchObject({ glyph: "○", tone: "muted" })
  expect(statusDotLayout({ state: "info" })).toMatchObject({ glyph: "◆", tone: "primary" })
})

test("a label follows the glyph", () => {
  const layout = statusDotLayout({ state: "ok", label: "connected" })
  expect(layout.text).toBe("● connected")
  expect(layout.width).toBe(11)
})

test("the text fits the width", () => {
  expect(statusDotLayout({ state: "ok", label: "connected", width: 5 }).text).toBe("● co…")
  expect(statusDotLayout({ state: "ok", label: "connected", width: 0 }).text).toBe("")
})

test("custom glyphs and tones are honoured", () => {
  const layout = statusDotLayout({
    state: "warn",
    glyphs: { warn: "!" },
    tones: { warn: "accent" },
    label: "slow",
  })
  expect(layout).toMatchObject({ glyph: "!", tone: "accent", text: "! slow" })
})

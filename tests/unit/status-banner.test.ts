import { expect, test } from "bun:test"

import { STATUS_BANNER_STYLES, statusBannerLayout, statusBannerStyle, statusBannerText } from "../../src/ui/status-banner"

test("tones carry a fill, ink and glyph", () => {
  expect(statusBannerStyle("warning")).toEqual({ fill: "warning", ink: "background", glyph: "!" })
  expect(statusBannerStyle("error")).toEqual({ fill: "error", ink: "background", glyph: "×" })
  expect(statusBannerStyle("success").glyph).toBe("✓")
  expect(statusBannerStyle("nope" as never)).toBe(STATUS_BANNER_STYLES.muted)
  expect(statusBannerStyle()).toBe(STATUS_BANNER_STYLES.muted)
})

test("a message is fitted and an action is right-aligned", () => {
  const layout = statusBannerLayout({ width: 20, tone: "warning", message: "choose a source", action: "Esc" })
  expect(layout.message).toBe("choose a sour…")
  expect(layout.action).toBe("Esc")
  expect(layout.gap).toBe(" ")
  expect(layout.text).toBe("! choose a sour… Esc")
  expect(layout.text).toHaveLength(20)
})

test("without an action the line is just the glyph and message", () => {
  expect(statusBannerText({ width: 40, tone: "error", message: "permission denied" })).toBe("× permission denied")
})

test("an action that does not fit is dropped", () => {
  expect(statusBannerText({ width: 10, message: "blocked", action: "Esc clear" })).toBe("· blocked")
})

test("zero width is empty", () => {
  expect(statusBannerLayout({ width: 0, message: "x" }).text).toBe("")
})

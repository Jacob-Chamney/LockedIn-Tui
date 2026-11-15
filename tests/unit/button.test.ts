import { expect, test } from "bun:test"

import { BUTTON_STYLES, buttonLayout, buttonStyle, buttonText } from "../../src/ui/button"

test("a keycap and label share one row", () => {
  const layout = buttonLayout({ label: "run once", key: "Y" })
  expect(layout.width).toBe(12)
  expect(layout.segments.map((segment) => [segment.kind, segment.text, segment.x, segment.width])).toEqual([
    ["key", "[Y] ", 0, 4],
    ["label", "run once", 4, 8],
  ])
  expect(layout.text).toBe("[Y] run once")
  expect(layout.keyWidth).toBe(3)
})

test("a button without a key is just its label", () => {
  const layout = buttonLayout({ label: "close", tone: "ghost" })
  expect(layout.text).toBe("close")
  expect(layout.segments).toHaveLength(1)
  expect(layout.keyWidth).toBe(0)
  expect(layout.tone).toBe("ghost")
})

test("width fits the key first, then the label", () => {
  expect(buttonText({ label: "run once", key: "Y", width: 8 })).toBe("[Y] run…")
  expect(buttonText({ label: "run once", key: "Y", width: 3 })).toBe("[Y…")
  expect(buttonText({ label: "run once", key: "Y", width: 0 })).toBe("")
  const narrow = buttonLayout({ label: "run once", key: "Y", width: 5 })
  for (const segment of narrow.segments) {
    expect(segment.x + segment.width).toBeLessThanOrEqual(5)
  }
})

test("tones expose a key fill and a label ink", () => {
  expect(buttonStyle("primary")).toEqual({ keyBg: "primary", keyFg: "background", labelFg: "primary" })
  expect(buttonStyle("ghost")).toEqual({ keyBg: "line", keyFg: "foreground", labelFg: "muted" })
  expect(buttonStyle("nope" as never)).toBe(BUTTON_STYLES.primary)
  const disabled = buttonLayout({ label: "run", key: "Y", disabled: true })
  expect(disabled.disabled).toBe(true)
})

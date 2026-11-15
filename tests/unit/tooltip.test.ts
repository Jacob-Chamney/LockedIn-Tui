import { expect, test } from "bun:test"

import { tooltipLayout, tooltipPosition } from "../../src/ui/tooltip"

test("layout wraps the body and sizes the box", () => {
  const layout = tooltipLayout({
    width: 20,
    title: "hint",
    text: "the active provider; Enter links this key",
  })
  expect(layout.width).toBe(20)
  expect(layout.innerWidth).toBe(16)
  expect(layout.lines[0]).toBe("hint")
  expect(layout.lines.length).toBeGreaterThan(2)
  expect(layout.height).toBe(layout.lines.length + 2)
  expect(layout.truncated).toBe(false)
})

test("maxLines clips with an ellipsis", () => {
  const layout = tooltipLayout({
    width: 14,
    text: "one two three four five six seven eight nine",
    maxLines: 2,
  })
  expect(layout.lines).toHaveLength(2)
  expect(layout.lines[1]!.endsWith("…")).toBe(true)
  expect(layout.truncated).toBe(true)
})

test("an empty body still renders the title", () => {
  const layout = tooltipLayout({ width: 20, title: "hint", text: "" })
  expect(layout.lines).toEqual(["hint"])
  expect(layout.height).toBe(3)
})

test("placement centres below the target", () => {
  const placed = tooltipPosition({
    target: { x: 10, y: 5, width: 10, height: 1 },
    size: { width: 8, height: 4 },
    bounds: { width: 40, height: 20 },
  })
  expect(placed).toEqual({ left: 11, top: 7, side: "below" })
})

test("placement flips above when there is no room below", () => {
  const placed = tooltipPosition({
    target: { x: 10, y: 18, width: 10, height: 1 },
    size: { width: 8, height: 4 },
    bounds: { width: 40, height: 20 },
  })
  expect(placed.side).toBe("above")
  expect(placed.top).toBe(13)
})

test("placement clamps to the screen", () => {
  expect(
    tooltipPosition({
      target: { x: 0, y: 2, width: 2, height: 1 },
      size: { width: 10, height: 3 },
      bounds: { width: 20, height: 20 },
    }).left,
  ).toBe(0)
  expect(
    tooltipPosition({
      target: { x: 5, y: 10, width: 5, height: 1 },
      size: { width: 8, height: 15 },
      bounds: { width: 20, height: 20 },
    }),
  ).toEqual({ left: 3, top: 5, side: "below" })
})

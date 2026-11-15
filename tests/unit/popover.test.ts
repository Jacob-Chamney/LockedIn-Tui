import { expect, test } from "bun:test"

import { popoverLayout, popoverPosition } from "../../src/ui/popover"

test("title, body and menu rows make a sized popover", () => {
  const layout = popoverLayout({
    width: 36,
    title: "actions",
    body: "what this row does",
    items: [
      { id: "edit", key: "Enter", label: "edit" },
      { id: "close", key: "Esc", label: "close" },
    ],
    selected: 1,
  })
  expect(layout.width).toBe(36)
  expect(layout.innerWidth).toBe(32)
  expect(layout.height).toBe(6)
  expect(layout.rows.map((row) => row.kind)).toEqual(["title", "body", "item", "item"])
  expect(layout.rows[2]!.text).toBe("  [Enter] edit")
  expect(layout.rows[3]!.text).toBe("▸ [Esc] close")
  expect(layout.rows[3]!.selected).toBe(true)
})

test("body lines are capped and menu labels fit", () => {
  const layout = popoverLayout({
    width: 12,
    body: "one two three four five six seven",
    maxLines: 1,
    items: [{ id: "a", label: "a very long action" }],
  })
  expect(layout.rows.filter((row) => row.kind === "body")).toHaveLength(1)
  expect(layout.rows.at(-1)!.text).toHaveLength(layout.innerWidth)
})

test("placement flips above when needed and clamps", () => {
  expect(
    popoverPosition({
      target: { x: 10, y: 18, width: 10, height: 1 },
      size: { width: 8, height: 4 },
      bounds: { width: 40, height: 20 },
    }),
  ).toEqual({ left: 11, top: 13, side: "above" })
  expect(
    popoverPosition({
      target: { x: 0, y: 2, width: 2, height: 1 },
      size: { width: 10, height: 3 },
      bounds: { width: 20, height: 20 },
    }).left,
  ).toBe(0)
})

test("an empty popover still has a box", () => {
  const layout = popoverLayout({ width: 10 })
  expect(layout.rows).toEqual([])
  expect(layout.height).toBe(2)
})

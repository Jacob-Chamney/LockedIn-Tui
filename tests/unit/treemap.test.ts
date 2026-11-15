import { expect, test } from "bun:test"

import { treemapLayout } from "../../src/ui/treemap"

const ITEMS = [
  { id: "a", label: "alpha", value: 75 },
  { id: "b", label: "beta", value: 25 },
]

test("tiles split by weight and fill the map", () => {
  const layout = treemapLayout({ items: ITEMS, width: 40, height: 10 })
  expect(layout.total).toBe(100)
  expect(layout.tiles).toHaveLength(2)
  expect(layout.tiles[0]).toMatchObject({ id: "a", x: 0, y: 0, width: 30, height: 10 })
  expect(layout.tiles[1]).toMatchObject({ id: "b", x: 30, y: 0, width: 10, height: 10 })
  expect(layout.tiles[0]!.percent).toBe(75)
  expect(layout.tiles[0]!.labelText).toBe("alpha")
  expect(layout.tiles[0]!.valueText).toBe("75%")
  for (const tile of layout.tiles) {
    expect(tile.x + tile.width).toBeLessThanOrEqual(40)
    expect(tile.y + tile.height).toBeLessThanOrEqual(10)
  }
})

test("three tiles do not overlap and cover the map", () => {
  const layout = treemapLayout({
    items: [
      { id: "a", label: "alpha", value: 50 },
      { id: "b", label: "beta", value: 30 },
      { id: "c", label: "gamma", value: 20 },
    ],
    width: 40,
    height: 12,
  })
  expect(layout.tiles).toHaveLength(3)
  const area = layout.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)
  expect(area).toBe(40 * 12)
  for (let i = 0; i < layout.tiles.length; i++) {
    for (let j = i + 1; j < layout.tiles.length; j++) {
      const a = layout.tiles[i]!
      const b = layout.tiles[j]!
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlap).toBe(false)
    }
  }
})

test("labels fit and tiny tiles hide their text", () => {
  const layout = treemapLayout({
    items: [
      { id: "a", label: "a very long model name", value: 90 },
      { id: "b", label: "b", value: 10 },
    ],
    width: 20,
    height: 6,
  })
  for (const tile of layout.tiles) {
    expect(tile.labelText.length).toBeLessThanOrEqual(Math.max(0, tile.width - 2))
  }
  const tiny = treemapLayout({ items: ITEMS, width: 3, height: 3 })
  expect(tiny.tiles.some((tile) => !tile.showLabel)).toBe(true)
})

test("values are weighted by positive numbers and empty maps are safe", () => {
  const layout = treemapLayout({
    items: [
      { id: "zero", label: "zero", value: 0 },
      { id: "bad", label: "bad", value: -2 },
      { id: "ok", label: "ok", value: 5 },
    ],
    width: 20,
    height: 5,
  })
  expect(layout.tiles.map((tile) => tile.id)).toEqual(["ok"])
  expect(layout.total).toBe(5)
  expect(treemapLayout({ items: ITEMS, width: 0, height: 5 }).tiles).toEqual([])
  expect(treemapLayout({ items: [], width: 20, height: 5 }).tiles).toEqual([])
})

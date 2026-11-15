import { expect, test } from "bun:test"

import { swatchLayout } from "../../src/ui/swatches"

const COLORS = ["#000", "#111", "#222"]

test("swatches are cellWidth wide with a gap", () => {
  const layout = swatchLayout({ colors: COLORS, width: 10 })
  expect(layout.cells.map((cell) => [cell.x, cell.width])).toEqual([
    [0, 2],
    [3, 2],
    [6, 2],
  ])
  expect(layout.hidden).toBe(0)
})

test("the first swatch that does not fit ends the row", () => {
  const layout = swatchLayout({ colors: COLORS, width: 5 })
  expect(layout.cells).toHaveLength(2)
  expect(layout.hidden).toBe(1)
})

test("a very narrow row shrinks one swatch", () => {
  const layout = swatchLayout({ colors: COLORS, width: 1 })
  expect(layout.cellWidth).toBe(1)
  expect(layout.cells).toHaveLength(1)
  expect(layout.hidden).toBe(2)
})

test("custom cell width and gap are honoured", () => {
  const layout = swatchLayout({ colors: COLORS, width: 20, cellWidth: 3, gap: 2 })
  expect(layout.cells.map((cell) => cell.x)).toEqual([0, 5, 10])
  expect(layout.cells[0]!.width).toBe(3)
})

test("empty input", () => {
  expect(swatchLayout({ colors: [], width: 10 })).toMatchObject({ cells: [], hidden: 0 })
  expect(swatchLayout({ colors: COLORS, width: 0 }).hidden).toBe(3)
})

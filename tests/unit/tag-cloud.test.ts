import { expect, test } from "bun:test"

import { tagCloudLayout, tagCloudText } from "../../src/ui/tag-cloud"

const ITEMS = [{ label: "cpp" }, { label: "notes" }]

test("tags flow and wrap to another row", () => {
  const layout = tagCloudLayout({ items: ITEMS, width: 12 })
  expect(layout.rows.map((row) => row.text)).toEqual(["#cpp #notes"])
  expect(layout.rows[0]!.tokens.map((token) => [token.text, token.x])).toEqual([
    ["#cpp", 0],
    ["#notes", 5],
  ])
  expect(layout.hidden).toBe(0)
})

test("a long tag starts a new row and counts append", () => {
  const layout = tagCloudLayout({
    items: [{ label: "cpp" }, { label: "big-topic", count: 3 }],
    width: 12,
  })
  expect(layout.rows.map((row) => row.text)).toEqual(["#cpp", "#big-topic 3"])
  expect(layout.rows[1]!.text).toHaveLength(12)
})

test("the tail becomes a count when maxRows is reached", () => {
  const layout = tagCloudLayout({
    items: [{ label: "cpp" }, { label: "notes" }, { label: "long-tag" }, { label: "x" }],
    width: 12,
    maxRows: 1,
  })
  expect(layout.rows).toHaveLength(1)
  expect(layout.hidden).toBeGreaterThan(0)
  expect(layout.rows[0]!.text).toContain("+")
  expect(layout.rows[0]!.text.length).toBeLessThanOrEqual(12)
})

test("custom prefix, gap and zero width are handled", () => {
  expect(tagCloudText({ items: ITEMS, width: 20, prefix: "@", gap: 2 })).toEqual(["@cpp  @notes"])
  expect(tagCloudLayout({ items: ITEMS, width: 0 }).rows).toEqual([])
  expect(tagCloudLayout({ items: [], width: 20 }).hidden).toBe(0)
})

import { expect, test } from "bun:test"

import { flattenTree, treeRows, type TreeNode } from "../../src/ui/tree"

const NODES: TreeNode[] = [
  {
    id: "a",
    label: "project",
    children: [
      { id: "a1", label: "src" },
      { id: "a2", label: "docs", children: [{ id: "a2x", label: "guide.md" }] },
    ],
  },
  { id: "b", label: "archive" },
]

test("flattenTree walks children in order", () => {
  const items = flattenTree(NODES)
  expect(items.map((item) => [item.id, item.depth])).toEqual([
    ["a", 0],
    ["a1", 1],
    ["a2", 1],
    ["a2x", 2],
    ["b", 0],
  ])
})

test("collapsed ids hide their children and turn the caret", () => {
  const items = flattenTree(NODES, ["a"])
  expect(items.map((item) => item.id)).toEqual(["a", "b"])
  const rows = treeRows({ items, width: 30 })
  expect(rows[0]!.caret).toBe("▸")
  expect(rows[0]!.label).toBe("project")
})

test("guides mark parents with siblings and branches mark the last child", () => {
  const rows = treeRows({ items: flattenTree(NODES), width: 30 })
  expect(rows.map((row) => row.branch)).toEqual(["", "├─", "└─", "└─", ""])
  expect(rows.map((row) => row.guides)).toEqual(["", "│ ", "│ ", "│   ", ""])
  expect(rows.map((row) => row.caret)).toEqual(["▾", " ", "▾", " ", " "])
})

test("selection adds a marker column", () => {
  const rows = treeRows({ items: flattenTree(NODES), width: 30, selected: 1 })
  expect(rows[0]!.marker).toBe("  ")
  expect(rows[1]!.marker).toBe("▌ ")
  expect(rows[1]!.selected).toBe(true)
})

test("labels fit and dividers become rules", () => {
  const rows = treeRows({
    items: [
      { id: "long", label: "a-very-long-label-that-does-not-fit", depth: 0 },
      { id: "d", label: "", depth: 0, divider: true },
    ],
    width: 20,
  })
  expect(rows[0]!.label.endsWith("…")).toBe(true)
  expect(rows[1]!.divider).toBe(true)
  expect(rows[1]!.label).toBe("─".repeat(20))
})

test("carets can be turned off without losing guides", () => {
  const rows = treeRows({ items: flattenTree(NODES), width: 30, carets: false })
  expect(rows[0]!.caret).toBe(" ")
  expect(rows[0]!.prefixWidth).toBe(0)
  expect(rows[1]!.guides).toBe("│ ")
})

test("custom glyphs are honoured", () => {
  const rows = treeRows({
    items: flattenTree(NODES),
    width: 30,
    glyphs: { vertical: "|", branch: "+-", last: "`-", expanded: "v", collapsed: ">" },
  })
  expect(rows[0]!.caret).toBe("v")
  expect(rows[1]!.guides).toBe("| ")
  expect(rows[1]!.branch).toBe("+-")
})

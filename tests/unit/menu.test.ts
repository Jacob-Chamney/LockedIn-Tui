import { expect, test } from "bun:test"

import { menuLayout, menuRole, menuText, MENU_ROLES } from "../../src/ui/menu"

const SECTIONS = [
  {
    id: "context",
    title: "CONTEXT",
    entries: [
      { id: "a", key: "j", label: "move down" },
      { id: "b", key: "k", label: "move up", meta: "pane" },
    ],
    separator: true,
  },
  { id: "global", title: "GLOBAL", entries: [{ id: "c", key: "?", label: "help" }] },
]

test("sections, headings and entries share key and label columns", () => {
  const layout = menuLayout({ sections: SECTIONS, width: 30 })
  expect(layout.rows.map((row) => row.kind)).toEqual(["heading", "entry", "entry", "separator", "heading", "entry"])
  expect(layout.entryCount).toBe(3)
  expect(layout.keyWidth).toBe(1)
  expect(layout.rows[0]!.text).toBe("CONTEXT")
  expect(layout.rows[1]!.text).toBe("j move down")
  expect(layout.rows[2]!.text).toBe("k move up                 pane")
  expect(layout.rows[2]!.text).toHaveLength(30)
  expect(layout.rows[2]!.parts.map((part) => part.kind)).toEqual(["key", "label", "meta"])
})

test("selectable menus add a marker and mark one entry", () => {
  const layout = menuLayout({ sections: SECTIONS, width: 30, selectable: true, selected: 1 })
  expect(layout.markerWidth).toBe(2)
  expect(layout.rows[1]!.text.startsWith("  j")).toBe(true)
  expect(layout.rows[2]!.text.startsWith("▸ k")).toBe(true)
  expect(layout.rows[2]!.selected).toBe(true)
})

test("keys can carry a prefix and a fixed width", () => {
  const layout = menuLayout({ sections: SECTIONS, width: 30, keyPrefix: " ", keyWidth: 5, gap: 0 })
  expect(layout.rows[1]!.text.startsWith(" j   move down")).toBe(true)
  expect(layout.rows[2]!.text.startsWith(" k   move up")).toBe(true)
})

test("labels fit, meta drops when there is no room, and rows cap", () => {
  const layout = menuLayout({ sections: SECTIONS, width: 12 })
  for (const row of layout.rows) expect(row.text.length).toBeLessThanOrEqual(12)
  const narrow = menuLayout({
    sections: [{ id: "s", entries: [{ id: "a", key: "x", label: "a long label", meta: "context" }] }],
    width: 12,
    keyWidth: 1,
  })
  expect(narrow.rows[0]!.text).not.toContain("context")
  const capped = menuLayout({ sections: SECTIONS, width: 30, maxRows: 2 })
  expect(capped.rows).toHaveLength(2)
  expect(capped.hidden).toBe(4)
  expect(menuText({ sections: SECTIONS, width: 30 })).toHaveLength(6)
})

test("tones and empty menus are handled", () => {
  expect(menuRole("error")).toBe(MENU_ROLES.error)
  expect(menuRole()).toBe("foreground")
  const layout = menuLayout({
    sections: [{ id: "s", entries: [{ id: "a", label: "gone", disabled: true, tone: "error" }] }],
    width: 20,
  })
  expect(layout.rows[0]!.tone).toBe("muted")
  expect(menuLayout({ sections: [], width: 20 }).rows).toEqual([])
  expect(menuLayout({ sections: SECTIONS, width: 0 }).rows).toEqual([])
})

test("a long key never pushes a row past the width", () => {
  const layout = menuLayout({
    sections: [{ id: "s", entries: [{ id: "a", key: "verylongkey", label: "action" }] }],
    width: 6,
    gap: 1,
  })
  expect(layout.keyWidth).toBeLessThanOrEqual(5)
  for (const row of layout.rows) {
    for (const part of row.parts) expect(part.x + part.width).toBeLessThanOrEqual(6)
  }
})

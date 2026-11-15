import { expect, test } from "bun:test"

import { comboboxLayout, rankOptions } from "../../src/ui/combobox"

const OPTIONS = [
  { id: "sessions", label: "Lock-in sessions" },
  { id: "session", label: "Session settings", secondary: true, group: "sessions" },
  { id: "settings", label: "Open settings" },
  { id: "themes", label: "Theme picker" },
]

test("exact ids win, then prefixes; aliases stay behind real ids", () => {
  const ranked = rankOptions(OPTIONS, "ses", {
    id: (option) => option.id,
    label: (option) => option.label,
    secondary: (option) => option.secondary === true,
    group: (option) => option.group ?? option.id,
  })
  expect(ranked.map((option) => option.id)).toEqual(["sessions"])
})

test("prefix matches suppress substring matches", () => {
  const ranked = rankOptions(OPTIONS, "set", {
    id: (option) => option.id,
    label: (option) => option.label,
  })
  expect(ranked.map((option) => option.id)).toEqual(["settings"])
})

test("descriptions match when the id does not", () => {
  const ranked = rankOptions(OPTIONS, "picker", {
    id: (option) => option.id,
    label: (option) => option.label,
  })
  expect(ranked.map((option) => option.id)).toEqual(["themes"])
})

test("one row per group and an empty query keeps the catalogue", () => {
  const ranked = rankOptions(OPTIONS, "sessions", {
    id: (option) => option.id,
    label: (option) => option.label,
    secondary: (option) => option.secondary === true,
    group: (option) => option.group ?? option.id,
  })
  expect(ranked.map((option) => option.id)).toEqual(["sessions"])
  expect(rankOptions(OPTIONS, "", { id: (option) => option.id, label: (option) => option.label })).toHaveLength(4)
})

test("rows carry a marker, label and right-aligned meta", () => {
  const layout = comboboxLayout({ options: OPTIONS, query: "", width: 24, selected: 1, maxRows: 2 })
  expect(layout.rows).toHaveLength(2)
  expect(layout.selected).toBe(1)
  expect(layout.rows[0]!.text.startsWith("  Lock-in sessions")).toBe(true)
  expect(layout.rows[1]!.text.startsWith("▸ Session settings")).toBe(true)
  expect(layout.rows[1]!.selected).toBe(true)
  expect(layout.hidden).toBe(2)
})

test("meta is placed at the right edge when it fits", () => {
  const layout = comboboxLayout({
    options: [{ id: "a", label: "alpha", meta: "→ first" }],
    query: "",
    width: 20,
  })
  expect(layout.rows[0]!.text).toBe("▸ alpha      → first")
  expect(layout.rows[0]!.meta).toBe("→ first")
})

test("long labels are fitted and zero width is empty", () => {
  const layout = comboboxLayout({
    options: [{ id: "a", label: "a very long option name" }],
    query: "",
    width: 12,
  })
  expect(layout.rows[0]!.text).toHaveLength(12)
  expect(layout.rows[0]!.text.endsWith("…")).toBe(true)
  expect(comboboxLayout({ options: OPTIONS, query: "", width: 0 }).rows).toEqual([])
})

test("the query filters inside the layout", () => {
  const layout = comboboxLayout({ options: OPTIONS, query: "theme", width: 30 })
  expect(layout.rows.map((row) => row.id)).toEqual(["themes"])
  expect(layout.rows[0]!.selected).toBe(true)
})

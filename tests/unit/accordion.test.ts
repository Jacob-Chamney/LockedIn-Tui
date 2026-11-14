import { expect, test } from "bun:test"

import { accordionRows, type AccordionSection } from "../../src/ui/accordion"

const SECTIONS: AccordionSection[] = [
  {
    id: "user",
    title: "USER",
    meta: "2",
    items: [
      { id: "name", label: "Username" },
      { id: "theme", label: "Theme" },
    ],
  },
  { id: "models", title: "MODELS", items: [{ id: "provider", label: "Providers" }] },
]

test("expanded sections list their headers and items in order", () => {
  const rows = accordionRows({ sections: SECTIONS })
  expect(rows.map((row) => (row.kind === "header" ? row.title : row.label))).toEqual([
    "USER",
    "Username",
    "Theme",
    "MODELS",
    "Providers",
  ])
  expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4])
  expect(rows[0]).toMatchObject({ kind: "header", expanded: true, caret: "▾", meta: "2" })
})

test("collapsed sections hide their items and turn the caret", () => {
  const rows = accordionRows({ sections: SECTIONS, collapsed: ["models"] })
  expect(rows.map((row) => (row.kind === "header" ? row.title : row.label))).toEqual([
    "USER",
    "Username",
    "Theme",
    "MODELS",
  ])
  const header = rows.at(-1)!
  expect(header).toMatchObject({ kind: "header", expanded: false, caret: "▸" })
})

test("carets can be turned off", () => {
  const rows = accordionRows({ sections: SECTIONS, carets: false })
  for (const row of rows) if (row.kind === "header") expect(row.caret).toBe("")
})

test("custom carets are honoured", () => {
  const rows = accordionRows({
    sections: SECTIONS,
    collapsed: ["user"],
    glyphs: { expanded: "v", collapsed: ">" },
  })
  expect(rows[0]).toMatchObject({ caret: ">" })
})

test("item rows carry their section and item index", () => {
  const rows = accordionRows({ sections: SECTIONS })
  const item = rows[2]
  expect(item).toMatchObject({ kind: "item", sectionId: "user", sectionTitle: "USER", itemIndex: 1 })
})

test("an empty section renders only its header", () => {
  const rows = accordionRows({ sections: [{ id: "empty", title: "EMPTY", items: [] }] })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ kind: "header", title: "EMPTY" })
})

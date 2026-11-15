import { expect, test } from "bun:test"

import { tagInputLayout } from "../../src/ui/tag-input"

const TAGS = [
  { id: "a", label: "notes" },
  { id: "b", label: "files" },
]

test("tags carry brackets and the remove marker", () => {
  const layout = tagInputLayout({ tags: TAGS, width: 40 })
  expect(layout.segments.map((segment) => segment.text)).toEqual(["[notes ×]", "[files ×]"])
  expect(layout.segments.map((segment) => segment.x)).toEqual([0, 10])
  expect(layout.hidden).toBe(0)
})

test("the cursor marks one tag and the input follows", () => {
  const layout = tagInputLayout({ tags: TAGS, width: 40, cursor: 1, input: "src/" })
  expect(layout.activeIndex).toBe(1)
  expect(layout.segments[1]!.text).toBe("▸[files ×]")
  expect(layout.segments[1]!.tone).toBe("active")
  expect(layout.inputX).toBe(21)
  expect(layout.inputText).toBe("src/▏")
  expect(layout.text).toBe("[notes ×] ▸[files ×] src/▏")
})

test("invalid tags are counted and toned", () => {
  const layout = tagInputLayout({
    tags: [{ id: "a", label: "ok" }, { id: "b", label: "bad", invalid: true }],
    width: 40,
  })
  expect(layout.invalidCount).toBe(1)
  expect(layout.segments[1]!.tone).toBe("invalid")
})

test("the tail becomes an overflow count that fits", () => {
  const layout = tagInputLayout({ tags: TAGS, width: 12 })
  expect(layout.segments).toHaveLength(1)
  expect(layout.hidden).toBe(1)
  expect(layout.overflow).toBe("+1")
  expect(layout.overflowX).toBe(10)
})

test("a placeholder is shown and the first tag can be fitted", () => {
  expect(tagInputLayout({ tags: [], width: 10, input: "", placeholder: "add" }).inputText).toBe("add▏")
  const tight = tagInputLayout({ tags: [{ id: "a", label: "notes" }], width: 5 })
  expect(tight.segments[0]!.width).toBe(5)
  expect(tight.segments[0]!.text.endsWith("…")).toBe(true)
})

test("removable can be turned off and zero width is empty", () => {
  const layout = tagInputLayout({ tags: [{ id: "a", label: "notes", removable: false }], width: 20 })
  expect(layout.segments[0]!.text).toBe("[notes]")
  expect(tagInputLayout({ tags: TAGS, width: 0 }).segments).toEqual([])
})

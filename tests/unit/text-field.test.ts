import { expect, test } from "bun:test"

import { TEXT_FIELD_CARET, textFieldLayout, textFieldText } from "../../src/ui/text-field"

test("prefix, value, caret and suffix share the row", () => {
  const layout = textFieldLayout({
    width: 30,
    prefix: "> ",
    value: "unit-4",
    suffix: "scope: notes",
  })
  expect(layout.text).toBe("> unit-4▏         scope: notes")
  expect(layout.text).toHaveLength(30)
  expect(layout.cursorX).toBe(8)
  expect(layout.gap).toBe(" ".repeat(9))
  expect(TEXT_FIELD_CARET).toBe("▏")
})

test("a placeholder appears only without a cursor", () => {
  const idle = textFieldLayout({ width: 20, prefix: "> ", value: "", placeholder: "find a file", cursor: false })
  expect(idle.value).toBe("find a file")
  expect(idle.placeholder).toBe("find a file")
  expect(idle.caret).toBe("")
  const editing = textFieldLayout({ width: 20, prefix: "> ", value: "", placeholder: "find a file", cursor: true })
  expect(editing.value).toBe("")
  expect(editing.caret).toBe("▏")
})

test("long values keep the tail and the caret", () => {
  const layout = textFieldLayout({ width: 10, value: "abcdefghij" })
  expect(layout.value).toBe("…cdefghij")
  expect(layout.text).toBe("…cdefghij▏")
  expect(layout.cursorX).toBe(9)
})

test("the suffix is dropped when it does not fit", () => {
  const layout = textFieldLayout({ width: 12, value: "unit", suffix: "scope: notes" })
  expect(layout.suffix).toBe("")
  expect(layout.text).toBe("unit▏")
})

test("invalid is reported, and zero width is empty", () => {
  expect(textFieldLayout({ width: 20, value: "x", invalid: true }).invalid).toBe(true)
  expect(textFieldLayout({ width: 0, value: "x" }).text).toBe("")
  expect(textFieldText({ width: 20, value: "hello", cursor: false })).toBe("hello")
})

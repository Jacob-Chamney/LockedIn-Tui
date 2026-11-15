import { expect, test } from "bun:test"

import { codeBlockLayout, codeGutter, fitCodeRuns } from "../../src/ui/code-block"

test("line numbers use a consistent gutter", () => {
  const layout = codeBlockLayout({ lineCount: 9, width: 20 })
  expect(layout.numberWidth).toBe(2)
  expect(layout.gutterWidth).toBe(5)
  expect(layout.contentWidth).toBe(15)
  expect(layout.numbers[0]).toBe(" 1")
  expect(layout.numbers[8]).toBe(" 9")
  expect(codeGutter(layout, 0)).toBe(" 1 │ ")
})

test("a larger start widens the digits", () => {
  const layout = codeBlockLayout({ lineCount: 12, width: 30, start: 99 })
  expect(layout.numberWidth).toBe(3)
  expect(layout.numbers[0]).toBe(" 99")
  expect(layout.numbers[11]).toBe("110")
})

test("numbers can be hidden", () => {
  const layout = codeBlockLayout({ lineCount: 3, width: 20, showNumbers: false })
  expect(layout.numberWidth).toBe(0)
  expect(layout.gutterWidth).toBe(0)
  expect(layout.contentWidth).toBe(20)
  expect(codeGutter(layout, 0)).toBe("")
})

test("runs truncate with an ellipsis and keep their colours", () => {
  const runs = [{ text: "abc", color: "a" }, { text: "def", color: "b" }]
  expect(fitCodeRuns(runs, 10)).toEqual(runs)
  expect(fitCodeRuns(runs, 4)).toEqual([{ text: "abc", color: "a" }, { text: "…", color: "b" }])
  expect(fitCodeRuns(runs, 5)).toEqual([
    { text: "abc", color: "a" },
    { text: "d", color: "b" },
    { text: "…", color: "b" },
  ])
  expect(fitCodeRuns(runs, 0)).toEqual([])
})

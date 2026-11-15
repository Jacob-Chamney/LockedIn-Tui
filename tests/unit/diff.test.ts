import { expect, test } from "bun:test"

import { diffRows, diffTone } from "../../src/ui/diff"

const LINES = [
  { kind: "context" as const, text: "a" },
  { kind: "remove" as const, text: "b" },
  { kind: "add" as const, text: "c" },
  { kind: "context" as const, text: "d" },
]

test("numbers follow each side and the marker names the kind", () => {
  const rows = diffRows({ lines: LINES, width: 40, oldStart: 10, newStart: 20 })
  expect(rows.map((row) => row.gutter)).toEqual([
    "10 20   ",
    "11    - ",
    "   21 + ",
    "12 22   ",
  ])
  expect(rows.map((row) => [row.oldNo, row.newNo])).toEqual([
    [10, 20],
    [11, null],
    [null, 21],
    [12, 22],
  ])
  expect(rows.map((row) => row.text)).toEqual(["a", "b", "c", "d"])
})

test("numbers can be hidden", () => {
  const rows = diffRows({ lines: LINES, width: 20, numbers: false })
  expect(rows.map((row) => row.gutter)).toEqual(["  ", "- ", "+ ", "  "])
})

test("long lines wrap with a blank gutter", () => {
  const rows = diffRows({
    lines: [{ kind: "add", text: "abcdefghijkl" }],
    width: 12,
    numbers: false,
  })
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({ text: "abcdefghij", continuation: false })
  expect(rows[0]!.gutter).toBe("+ ")
  expect(rows[1]).toMatchObject({ text: "kl", continuation: true, oldNo: null, newNo: null })
  expect(rows[1]!.gutter).toBe("  ")
})

test("wrap false ellipsises instead", () => {
  const rows = diffRows({
    lines: [{ kind: "context", text: "abcdefghijkl" }],
    width: 12,
    numbers: false,
    wrap: false,
  })
  expect(rows).toHaveLength(1)
  expect(rows[0]!.text).toBe("abcdefghi…")
})

test("numbers widen for larger hunks", () => {
  const rows = diffRows({ lines: [{ kind: "context", text: "x" }], width: 40, oldStart: 100, newStart: 100 })
  expect(rows[0]!.gutter).toBe("100 100   ")
})

test("tones and empty input", () => {
  expect(diffTone("add")).toBe("success")
  expect(diffTone("remove")).toBe("error")
  expect(diffTone("context")).toBe("muted")
  expect(diffRows({ lines: [], width: 40 })).toEqual([])
})

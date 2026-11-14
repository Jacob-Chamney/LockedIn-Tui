import { expect, test } from "bun:test"

import {
  CALLOUT_GLYPH,
  CALLOUT_ROLES,
  calloutLines,
  calloutRole,
} from "../../src/ui/callout"

test("an empty message has no lines and blank lines survive", () => {
  expect(calloutLines("", 20)).toEqual([])
  expect(calloutLines("a\n\nb", 20)).toEqual(["a", "", "b"])
})

test("a message wraps at the width", () => {
  expect(calloutLines("the budget is nearly spent", 12)).toEqual([
    "the budget",
    "is nearly",
    "spent",
  ])
})

test("a word wider than the line hard-breaks", () => {
  expect(calloutLines("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"])
})

test("a zero width still produces one column", () => {
  expect(calloutLines("ab", 0)).toEqual(["a", "b"])
})

test("each tone maps to a palette role with a safe fallback", () => {
  expect(calloutRole("info")).toBe("secondary")
  expect(calloutRole("success")).toBe("success")
  expect(calloutRole("warning")).toBe("warning")
  expect(calloutRole("error")).toBe("error")
  expect(calloutRole()).toBe("secondary")
  expect(calloutRole("nope" as never)).toBe("secondary")
  expect(CALLOUT_GLYPH).toBe("▌")
  expect(Object.keys(CALLOUT_ROLES)).toEqual(["info", "success", "warning", "error"])
})

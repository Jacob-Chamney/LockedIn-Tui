import { expect, test } from "bun:test"

import {
  STEPPER_GLYPHS,
  STEPPER_PREFIX_WIDTH,
  stepMarker,
  stepPrefix,
  stepRail,
  stepStatus,
  stepperGlyphs,
} from "../../src/ui/stepper"

test("status follows checked first, then the cursor", () => {
  expect(stepStatus(true, true)).toBe("done")
  expect(stepStatus(true, false)).toBe("done")
  expect(stepStatus(false, true)).toBe("current")
  expect(stepStatus(false, false)).toBe("pending")
})

test("the prefix keeps a fixed five-cell width", () => {
  expect(stepPrefix("done", false)).toBe("  ✓  ")
  expect(stepPrefix("current", true)).toBe("▌ ▸  ")
  expect(stepPrefix("pending", false)).toBe("  ○  ")
  for (const text of [stepPrefix("done", true), stepPrefix("pending", true)]) {
    expect(text).toHaveLength(STEPPER_PREFIX_WIDTH)
  }
  expect(stepRail()).toBe("  │  ")
  expect(stepRail()).toHaveLength(STEPPER_PREFIX_WIDTH)
})

test("a done step that is current still reads done", () => {
  expect(stepPrefix("done", true)).toBe("▌ ✓  ")
  expect(stepMarker("done")).toBe("✓")
  expect(stepMarker("current")).toBe("▸")
  expect(stepMarker("pending")).toBe("○")
})

test("glyphs can be overridden", () => {
  const glyphs = stepperGlyphs({ done: "x", current: ">", pending: ".", rail: "|", selected: "*" })
  expect(stepPrefix("done", false, glyphs)).toBe("  x  ")
  expect(stepPrefix("current", true, glyphs)).toBe("* >  ")
  expect(stepRail(glyphs)).toBe("  |  ")
  expect(STEPPER_GLYPHS.done).toBe("✓")
})

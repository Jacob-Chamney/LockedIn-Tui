/** Long-list windows keep the cursor visible. */
import { describe, expect, test } from "bun:test"

const { windowStart } = await import("../../src/ui/panels/select-list")

describe("list windows", () => {
  test("short lists start at zero", () => {
    expect(windowStart(0, 3, 10)).toBe(0)
    expect(windowStart(2, 3, 10)).toBe(0)
  })

  test("long lists centre the cursor and clamp at both ends", () => {
    expect(windowStart(0, 100, 10)).toBe(0)
    expect(windowStart(50, 100, 10)).toBe(45)
    expect(windowStart(99, 100, 10)).toBe(90)
  })
})

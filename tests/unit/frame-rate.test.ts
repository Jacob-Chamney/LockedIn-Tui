import { describe, expect, test } from "bun:test"
import { DEFAULT_FPS, MAX_FPS, MIN_FPS, resolveFrameRate } from "../../src/ui/frame-rate"

describe("frame rate", () => {
  test("defaults to 60", () => {
    expect(resolveFrameRate(undefined)).toBe(DEFAULT_FPS)
    expect(resolveFrameRate("")).toBe(DEFAULT_FPS)
    expect(resolveFrameRate("nope")).toBe(DEFAULT_FPS)
  })

  test("honours the environment override and clamps it", () => {
    expect(resolveFrameRate("120")).toBe(120)
    expect(resolveFrameRate("500")).toBe(500)
    expect(resolveFrameRate("1000")).toBe(MAX_FPS)
    expect(resolveFrameRate("1")).toBe(MIN_FPS)
  })
})

import { describe, expect, test } from "bun:test"

import {
  DEFAULT_ACHIEVEMENT_PIXELS,
  MAX_ACHIEVEMENT_PIXELS,
  MIN_ACHIEVEMENT_PIXELS,
  cellSize,
  imageScale,
  resolveAchievementPixels,
} from "../../src/ui/achievements/image-budget"

describe("the achievement image budget", () => {
  test("defaults to the measured smooth pixel count", () => {
    expect(resolveAchievementPixels("")).toBe(DEFAULT_ACHIEVEMENT_PIXELS)
    expect(resolveAchievementPixels(undefined)).toBe(DEFAULT_ACHIEVEMENT_PIXELS)
    expect(resolveAchievementPixels("not a number")).toBe(DEFAULT_ACHIEVEMENT_PIXELS)
  })

  test("a faster transport can raise the fallback, but an explicit override wins", () => {
    expect(resolveAchievementPixels(undefined, MAX_ACHIEVEMENT_PIXELS)).toBe(MAX_ACHIEVEMENT_PIXELS)
    expect(resolveAchievementPixels("600000", MAX_ACHIEVEMENT_PIXELS)).toBe(600_000)
    expect(resolveAchievementPixels("nonsense", MAX_ACHIEVEMENT_PIXELS)).toBe(MAX_ACHIEVEMENT_PIXELS)
  })

  test("an override is clamped to a usable range", () => {
    expect(resolveAchievementPixels("250000")).toBe(250_000)
    expect(resolveAchievementPixels("1")).toBe(MIN_ACHIEVEMENT_PIXELS)
    expect(resolveAchievementPixels("999999999")).toBe(MAX_ACHIEVEMENT_PIXELS)
    expect(resolveAchievementPixels("250000.4")).toBe(250_000)
  })

  test("a surface that already fits is not scaled", () => {
    expect(imageScale(900, 600, 600_000)).toBe(1)
    expect(imageScale(0, 0, 600_000)).toBe(1)
    expect(imageScale(100, 100, 0)).toBe(1)
  })

  test("a full-screen surface is brought inside the budget", () => {
    const width = 2040
    const height = 1040
    const scale = imageScale(width, height, 600_000)
    const pixels = Math.round(width * scale) * Math.round(height * scale)
    expect(scale).toBeLessThan(1)
    expect(pixels).toBeLessThanOrEqual(600_000 * 1.01)
    expect(pixels).toBeGreaterThan(580_000)
  })
})

describe("terminal cell size", () => {
  test("a valid resolution wins and is remembered", () => {
    const size = cellSize({ width: 960, height: 480 }, 120, 30, null)
    expect(size).toEqual({ width: 8, height: 16 })
  })

  test("a resize that clears the resolution keeps the last real cell size", () => {
    // The old 8x16 fallback here is what made a maximised pane look stretched.
    const previous = { width: 9.6, height: 19.2 }
    expect(cellSize(null, 255, 65, previous)).toEqual(previous)
    expect(cellSize({ width: 0, height: 0 }, 255, 65, previous)).toEqual(previous)
  })

  test("without any measurement there is still a safe fallback", () => {
    expect(cellSize(null, 255, 65, null)).toEqual({ width: 8, height: 16 })
  })
})

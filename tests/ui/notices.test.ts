/** Messages: ten seconds, then a fade. */
import { describe, expect, test } from "bun:test"

const { NOTICE_MS, NOTICE_FADE_MS, NOTICE_MIN_WIDTH, NOTICE_MAX_WIDTH, dismissLatestNotice, pruneNotices, noticeOpacity, noticeGlyph, noticeWidth, noticeColors } = await import(
  "../../src/ui/shell/notice-stack"
)
const { crimson } = await import("../../src/ui/theme")

const notice = (at: number, duration?: number) => ({
  id: "n1",
  text: "hello",
  level: "info" as const,
  at,
  ...(duration === undefined ? {} : { duration }),
})

describe("notice lifetime", () => {
  test("is solid until the last second, then fades to nothing", () => {
    expect(noticeOpacity(notice(0), 0)).toBe(1)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS)).toBe(1)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS / 2)).toBeGreaterThan(0)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS / 2)).toBeLessThan(1)
    // Fades all the way to zero instead of jumping from a visible floor.
    expect(noticeOpacity(notice(0), NOTICE_MS - 1)).toBeLessThan(0.02)
    expect(noticeOpacity(notice(0), NOTICE_MS)).toBe(0)
  })

  test("is pruned after its lifetime", () => {
    expect(pruneNotices([notice(0)], NOTICE_MS - 1)).toHaveLength(1)
    expect(pruneNotices([notice(0)], NOTICE_MS)).toHaveLength(0)
    expect(pruneNotices([notice(0, 3_000)], 2_999)).toHaveLength(1)
    expect(pruneNotices([notice(0, 3_000)], 3_000)).toHaveLength(0)
    expect(noticeOpacity(notice(0, 3_000), 2_500)).toBeCloseTo(0.5)
  })
})

describe("notice bubble", () => {
  test("uses a level glyph", () => {
    expect(noticeGlyph("error")).toBe("×")
    expect(noticeGlyph("warn")).toBe("!")
    expect(noticeGlyph("info")).toBe("·")
  })

  test("fits short messages and wraps at the cap", () => {
    expect(noticeWidth("hi", 60)).toBe(NOTICE_MIN_WIDTH)
    expect(noticeWidth("a".repeat(20), 60)).toBe(24)
    expect(noticeWidth("a".repeat(200), 60)).toBe(NOTICE_MAX_WIDTH)
    expect(noticeWidth("a".repeat(200), 30)).toBe(30)
  })
})

describe("notice fade colours", () => {
  test("blend the fill and ink to the background at zero", () => {
    const full = noticeColors("error", crimson, 1)
    expect(full.fill.toLowerCase()).toBe(crimson.error.toLowerCase())
    expect(full.ink.toLowerCase()).toBe(crimson.background.toLowerCase())
    const gone = noticeColors("error", crimson, 0)
    expect(gone.fill.toLowerCase()).toBe(crimson.background.toLowerCase())
    expect(gone.ink.toLowerCase()).toBe(crimson.background.toLowerCase())
    const half = noticeColors("error", crimson, 0.5)
    expect(half.fill).not.toBe(crimson.error)
    expect(half.fill).not.toBe(crimson.background)
  })
})

test("dismiss removes the newest bubble first", () => {
  const first = { id: "1", text: "one", level: "info" as const, at: 0 }
  const second = { id: "2", text: "two", level: "warn" as const, at: 1 }
  expect(dismissLatestNotice([first, second])).toEqual([first])
  expect(dismissLatestNotice([first])).toEqual([])
  expect(dismissLatestNotice([])).toEqual([])
})

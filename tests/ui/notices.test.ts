/** Messages: ten seconds, then a fade. */
import { describe, expect, test } from "bun:test"

const { NOTICE_MS, NOTICE_FADE_MS, pruneNotices, noticeOpacity } = await import(
  "../../src/ui/shell/notice-stack"
)

const notice = (at: number) => ({ id: "n1", text: "hello", level: "info" as const, at })

describe("notice lifetime", () => {
  test("is solid until the last second, then fades to nothing", () => {
    expect(noticeOpacity(notice(0), 0)).toBe(1)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS)).toBe(1)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS / 2)).toBeGreaterThan(0)
    expect(noticeOpacity(notice(0), NOTICE_MS - NOTICE_FADE_MS / 2)).toBeLessThan(1)
    expect(noticeOpacity(notice(0), NOTICE_MS)).toBe(0)
  })

  test("is pruned after ten seconds", () => {
    expect(pruneNotices([notice(0)], NOTICE_MS - 1)).toHaveLength(1)
    expect(pruneNotices([notice(0)], NOTICE_MS)).toHaveLength(0)
  })
})

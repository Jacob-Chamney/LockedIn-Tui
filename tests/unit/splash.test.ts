/** The startup splash mask and sequence are pure. */
import { describe, expect, test } from "bun:test"

import {
  SPLASH_FADE_IN_MS,
  SPLASH_FADE_OUT_MS,
  SPLASH_STEPS,
  SPLASH_TOTAL_MS,
  SPLASH_WORDMARK,
  lockLayout,
  splashEnabled,
  splashFade,
  splashFrame,
} from "../../src/ui/shell/splash"
import { splashTones } from "../../src/ui/theme/splash"
import { crimson } from "../../src/ui/theme"

const WIDTH = 80
const HEIGHT = 24

function frame(phase: number, tick = 0) {
  return splashFrame({ width: WIDTH, height: HEIGHT, phase, tick })
}

function text(phase: number, tick = 0): string {
  return frame(phase, tick)
    .rows.map((row) => row.map((cell) => cell.ch).join(""))
    .join("\n")
}

function lockCells(phase: number) {
  return frame(phase).rows.flatMap((row, y) =>
    row.flatMap((cell, x) => (cell.tone === "lock" || cell.tone === "lockFlash" ? [{ x, y }] : [])),
  )
}

describe("startup splash", () => {
  test("the wordmark is painted in the first frame", () => {
    expect(SPLASH_WORDMARK).toBe("LOCKEDIN")
    expect(text(0)).toContain("LOCKEDIN")
    expect(text(0)).toContain("learning, locked in")
    expect(text(0)).toContain("Esc to skip")
  })

  test("the field is ASCII and changes between ticks", () => {
    expect(text(0, 0)).not.toBe(text(0, 1))
    for (const row of frame(3).rows) {
      for (const cell of row) expect(cell.ch.charCodeAt(0)).toBeLessThan(128)
    }
  })

  test("the shackle and body assemble before the lock closes", () => {
    expect(lockCells(0)).toHaveLength(0)
    expect(lockCells(1).length).toBeGreaterThan(0)
    expect(lockCells(2).length).toBeGreaterThan(lockCells(1).length)

    const layout = lockLayout(WIDTH, HEIGHT, 3)
    const centerAtTwo = frame(2).rows[layout.lockY + layout.keyY]?.[layout.lockX + layout.keyX]
    const centerAtThree = frame(3).rows[layout.lockY + layout.keyY]?.[layout.lockX + layout.keyX]
    expect(centerAtTwo?.tone).toBe("lock")
    expect(centerAtThree?.tone).toBe("blank")
    expect(frame(3).caption).toBe("unlocked")
  })

  test("the left leg stays hinged while the right leg lifts", () => {
    const layout = lockLayout(WIDTH, HEIGHT, 3)
    const row = layout.lockY + layout.bodyY
    const left = layout.lockX + layout.shackleX
    const right = layout.lockX + layout.shackleX + layout.shackleW - layout.wall
    expect(frame(3).rows[row]?.[left]?.tone).toBe("lock")
    expect(frame(3).rows[row]?.[right]?.tone).toBe("blank")
    expect(frame(6).rows[row]?.[left]?.tone).toBe("lock")
    expect(frame(6).rows[row]?.[right]?.tone).toBe("lock")
  })

  test("the right leg slides down into the body", () => {
    const unlocked = lockLayout(WIDTH, HEIGHT, 3)
    const locked = lockLayout(WIDTH, HEIGHT, 6)
    expect(unlocked.rightLift).toBeGreaterThan(0)
    expect(locked.rightLift).toBe(0)
    expect(locked.rightBottom).toBeGreaterThan(unlocked.rightBottom)
    expect(frame(6).caption).toBe("locked")
    expect(frame(5).rows.flat().some((cell) => cell.tone === "lockFlash")).toBe(true)
  })

  test("the splash fades in, holds, and fades out", () => {
    expect(splashFade(0)).toBe(0)
    expect(splashFade(SPLASH_FADE_IN_MS / 2)).toBeCloseTo(0.5)
    expect(splashFade(SPLASH_FADE_IN_MS)).toBe(1)
    expect(splashFade(SPLASH_TOTAL_MS / 2)).toBe(1)
    expect(splashFade(SPLASH_TOTAL_MS - SPLASH_FADE_OUT_MS / 2)).toBeCloseTo(0.5)
    expect(splashFade(SPLASH_TOTAL_MS)).toBe(0)
    expect(splashTones(crimson, 0).lock.toLowerCase()).toBe(crimson.background.toLowerCase())
    expect(splashTones(crimson, 1).lock.toLowerCase()).toBe(crimson.primary.toLowerCase())
  })

  test("the sequence is quick and monotonic", () => {
    expect(SPLASH_TOTAL_MS).toBeLessThanOrEqual(4_000)
    expect(SPLASH_TOTAL_MS).toBeGreaterThanOrEqual(2_000)
    for (let index = 0; index < SPLASH_STEPS.length; index++) {
      const step = SPLASH_STEPS[index]!
      expect(step.at).toBeLessThan(SPLASH_TOTAL_MS)
      if (index > 0) expect(step.at).toBeGreaterThan(SPLASH_STEPS[index - 1]!.at)
    }
  })

  test("reduced motion and the explicit switch skip the splash", () => {
    expect(splashEnabled({})).toBe(true)
    expect(splashEnabled({ LOCKEDIN_REDUCED_MOTION: "1" })).toBe(false)
    expect(splashEnabled({ LOCKEDIN_NO_SPLASH: "1" })).toBe(false)
    expect(splashEnabled({ NO_COLOR: "1" })).toBe(true)
  })
})

/**
 * The `Thinking…` pulse.
 *
 * The animation is a colour interpolation between two semantic tokens, so the
 * interesting parts are testable without a clock: the endpoints, the amplitude
 * cap, and the reduced-motion switch.
 */
import { describe, expect, test } from "bun:test"
import { mixHex, pulseColour, reducedMotion } from "../../src/ui/chat/pulse"

describe("colour mixing", () => {
  test("the endpoints are exact", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000")
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff")
  })

  test("the middle is halfway in each channel", () => {
    expect(mixHex("#000000", "#ff0000", 0.5)).toBe("#800000")
  })

  test("an out-of-range amount is clamped", () => {
    expect(mixHex("#123456", "#123456", 5)).toBe("#123456")
    expect(mixHex("#123456", "#123456", -1)).toBe("#123456")
  })
})

describe("the pulse", () => {
  test("swings the whole way from muted to foreground", () => {
    expect(pulseColour("#9199a3", "#e7e7e7", 0)).toBe("#9199a3")
    expect(pulseColour("#9199a3", "#e7e7e7", 1)).toBe("#e7e7e7")
    // The midpoint is a real step, not a rounding accident.
    const middle = pulseColour("#9199a3", "#e7e7e7", 0.5)
    expect(middle).toBe(mixHex("#9199a3", "#e7e7e7", 0.5))
    expect(middle).not.toBe("#9199a3")
  })

  test("reduced motion is one environment switch, like the other animations", () => {
    expect(reducedMotion({ LOCKEDIN_REDUCED_MOTION: "1" })).toBe(true)
    expect(reducedMotion({ LOCKEDIN_REDUCED_MOTION: "0" })).toBe(false)
    expect(reducedMotion({})).toBe(false)
  })
})

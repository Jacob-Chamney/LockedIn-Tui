/** Pixel labels: free-floating text drawn into the RGBA frame. */
import { describe, expect, test } from "bun:test"

import { drawPixelText, pixelTextWidth, FONT8 } from "../../src/ui/knowledge/pixel-text"

describe("pixel text", () => {
  test("width is eight pixels per glyph, scaled", () => {
    expect(pixelTextWidth("AB")).toBe(16)
    expect(pixelTextWidth("AB", 2)).toBe(32)
  })

  test("draws the glyph pixels at the requested position", () => {
    const width = 40
    const height = 20
    const buffer = new Uint8Array(width * height * 4)
    drawPixelText(buffer, width, height, 4, 2, "A", { r: 10, g: 200, b: 30, a: 255 })
    const lit = []
    for (let at = 0; at < buffer.length; at += 4) {
      if (buffer[at] === 10 && buffer[at + 1] === 200 && buffer[at + 2] === 30) lit.push(at / 4)
    }
    expect(lit.length).toBeGreaterThan(10)
    expect(lit.every((index) => index % width >= 4 && index % width < 12)).toBe(true)
  })

  test("a fractional offset changes edge coverage instead of jumping a pixel", () => {
    const width = 40
    const height = 20
    const whole = new Uint8Array(width * height * 4)
    const half = new Uint8Array(width * height * 4)
    const white = { r: 255, g: 255, b: 255, a: 255 }
    drawPixelText(whole, width, height, 10, 2, "A", white)
    drawPixelText(half, width, height, 10.5, 2, "A", white)
    expect([...half]).not.toEqual([...whole])
    expect(whole.filter((_value, index) => index % 4 === 3).every((alpha) => alpha === 0 || alpha === 255)).toBe(
      true,
    )
  })

  test("has the printable ASCII range", () => {
    expect(FONT8).toHaveLength(95)
    expect(FONT8[0]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})

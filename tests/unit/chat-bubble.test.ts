/**
 * Chat bubble sizing.
 *
 * The bubble is cells: two cap rows of quadrant glyphs around a filled body.
 * These tests pin the width rules, which are what make the corners read as
 * corners instead of a wide rectangle.
 */
import { describe, expect, test } from "bun:test"
import { bubbleColumns, wrapBubbleText } from "../../src/ui/chat/bubble-geometry"
import { capPixels, cellSizeFor } from "../../src/ui/chat/bubble"

describe("bubble width", () => {
  test("hugs the text and clamps per role", () => {
    expect(bubbleColumns("hello", 100, "user")).toBe(20)
    expect(bubbleColumns("x".repeat(40), 100, "user")).toBe(44)
    expect(bubbleColumns("x".repeat(200), 100, "user")).toBe(72)
    expect(bubbleColumns("x".repeat(200), 100, "assistant")).toBe(85)
  })

  test("identical text always produces identical width", () => {
    const text = "the same words every time"
    expect(bubbleColumns(text, 120, "assistant")).toBe(bubbleColumns(text, 120, "assistant"))
  })
})

describe("wrapping", () => {
  test("wraps at words and keeps an overlong word whole", () => {
    expect(wrapBubbleText("one two three", 7)).toEqual(["one two", "three"])
    expect(wrapBubbleText("abcdefghij", 4)).toEqual(["abcdefghij"])
  })

  test("keeps blank lines between paragraphs", () => {
    expect(wrapBubbleText("a\n\nb", 10)).toEqual(["a", "", "b"])
  })
})


describe("opaque cap image", () => {
  const width = 80
  const capHeight = 16
  const fill = "#d9534f"
  const background = "#0d0f11"

  function pixel(pixels: Uint8Array, row: number, column: number): [number, number, number, number] {
    const index = (row * width + column) * 4
    return [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!, pixels[index + 3]!]
  }

  const top = capPixels({ width, capHeight, fill, background, edge: "top" })

  test("has no transparency at all: the terminal has nothing to composite", () => {
    for (let row = 0; row < capHeight; row++) {
      for (let column = 0; column < width; column++) {
        expect(pixel(top, row, column)[3]).toBe(255)
      }
    }
  })

  test("the outer corner is the chat background, the middle is the fill", () => {
    expect(pixel(top, 0, 0).slice(0, 3)).toEqual([0x0d, 0x0f, 0x11])
    expect(pixel(top, capHeight - 1, width >> 1).slice(0, 3)).toEqual([0xd9, 0x53, 0x4f])
  })

  test("the edge is blended between the two colours", () => {
    const row = 0
    const blended: number[] = []
    for (let column = 0; column < 12; column++) {
      const [r] = pixel(top, row, column)
      if (r > 0x0d && r < 0xd9) blended.push(r)
    }
    expect(blended.length).toBeGreaterThan(0)
  })

  test("the bottom cap mirrors the top", () => {
    const bottom = capPixels({ width, capHeight, fill, background, edge: "bottom" })
    expect(pixel(bottom, capHeight - 1, 0).slice(0, 3)).toEqual([0x0d, 0x0f, 0x11])
    expect(pixel(bottom, 0, width >> 1).slice(0, 3)).toEqual([0xd9, 0x53, 0x4f])
  })
})


describe("cell size detection", () => {
  test("kitty without a pixel reply still gets an image cap", () => {
    expect(
      cellSizeFor({ resolution: null, columns: 80, rows: 24, capabilities: { kitty_graphics: true } as never }),
    ).toEqual({ width: 8, height: 16 })
  })

  test("sixel without a pixel reply waits; blocks and tmux never draw caps", () => {
    expect(
      cellSizeFor({ resolution: null, columns: 80, rows: 24, capabilities: { sixel: true } as never }),
    ).toBeNull()
    expect(cellSizeFor({ resolution: null, columns: 80, rows: 24, capabilities: null })).toBeNull()
    expect(
      cellSizeFor({
        resolution: { width: 800, height: 480 },
        columns: 80,
        rows: 24,
        capabilities: { multiplexer: "tmux", kitty_graphics: true } as never,
      }),
    ).toBeNull()
  })

  test("a measured pixel size divides by the terminal cells", () => {
    expect(
      cellSizeFor({
        resolution: { width: 800, height: 480 },
        columns: 80,
        rows: 24,
        capabilities: { kitty_graphics: true } as never,
      }),
    ).toEqual({ width: 10, height: 20 })
  })

  test("a terminal with no columns has no cell size", () => {
    expect(
      cellSizeFor({ resolution: null, columns: 0, rows: 24, capabilities: { kitty_graphics: true } as never }),
    ).toBeNull()
  })
})

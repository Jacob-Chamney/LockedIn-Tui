/** The keyboard normal form is one function, not a convention per handler. */
import { describe, expect, test } from "bun:test"

const { ARROW_ALIAS, normalisePress, typedText } = await import("../../src/app/keys/press")

describe("press normalisation", () => {
  test("arrows are aliases for j/k", () => {
    expect(normalisePress({ name: "down" }).name).toBe("j")
    expect(normalisePress({ name: "up" }).name).toBe("k")
    expect(ARROW_ALIAS).toEqual({ down: "j", up: "k" })
  })

  test("modifiers and other keys survive untouched", () => {
    expect(normalisePress({ name: "return", ctrl: true, shift: true })).toEqual({
      name: "return",
      rawName: "return",
      ctrl: true,
      shift: true,
      meta: undefined,
    })
    expect(normalisePress({ name: "space" }).name).toBe("space")
  })

  test("typedText keeps the shifted character the terminal sent", () => {
    const shifted = normalisePress({ name: "a", shift: true })
    expect(typedText(shifted, { sequence: "A" })).toBe("A")
    expect(typedText(normalisePress({ name: "a" }), { sequence: "a" })).toBe("a")
    expect(typedText(normalisePress({ name: "space" }), { sequence: " " })).toBe(" ")
    // Control sequences are keys, not text.
    expect(typedText(normalisePress({ name: "up" }), { sequence: "\u001b[A" })).toBeNull()
    expect(typedText(normalisePress({ name: "a", ctrl: true }), { sequence: "\u0001" })).toBeNull()
  })
})

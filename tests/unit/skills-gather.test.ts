/**
 * WP-402 — excerpt rules and the HTML→text path, without a filesystem.
 */

import { describe, expect, test } from "bun:test"

import {
  DEFAULT_EXCERPT_CHARS,
  MIN_EXCERPT_CHARS,
  buildExcerpt,
  cutGraphemes,
  normaliseWhitespace,
  uniqueExcerpts,
} from "../../src/services/skills/excerpt"
import { htmlToText } from "../../src/services/skills/gather"

describe("excerpts", () => {
  test("the default cap is 400 and the minimum is the coverage minimum", () => {
    expect(DEFAULT_EXCERPT_CHARS).toBe(400)
    expect(MIN_EXCERPT_CHARS).toBe(3)
  })

  test("whitespace is normalised so the excerpt reads as one passage", () => {
    expect(normaliseWhitespace("  a\n\n  b\t c  ")).toBe("a b c")
  })

  test("an excerpt is the first slice of the extracted text", () => {
    const outcome = buildExcerpt({ sourceName: "a.md", location: "sources/a.md", text: "x".repeat(1000) })
    if (!outcome.ok) throw new Error("expected an excerpt")
    expect(outcome.excerpt.text).toHaveLength(DEFAULT_EXCERPT_CHARS)
    expect(outcome.excerpt.sourceName).toBe("a.md")
    expect(outcome.excerpt.location).toBe("sources/a.md")
  })

  test("a custom cap is honoured", () => {
    const outcome = buildExcerpt({ sourceName: "a", location: "l", text: "abcdefgh", chars: 4 })
    if (!outcome.ok) throw new Error("expected an excerpt")
    expect(outcome.excerpt.text).toBe("abcd")
  })

  test("four characters is enough to cite", () => {
    const outcome = buildExcerpt({ sourceName: "a", location: "l", text: "abcd" })
    expect(outcome.ok).toBe(true)
  })

  test("text too short to cite is refused with the documented message", () => {
    const outcome = buildExcerpt({ sourceName: "a", location: "l", text: "ab" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe("too-short")
    expect(outcome.message).toBe("not enough text to cite")
  })

  test("a cut never splits a grapheme", () => {
    // "e" + combining acute is one grapheme; a naive slice would orphan the mark.
    const text = `e\u0301${"x".repeat(10)}`
    const cut = cutGraphemes(text, 1)
    expect(cut).toBe("e\u0301")
    expect(cutGraphemes(text, 0)).toBe("")
    expect(cutGraphemes("short", 10)).toBe("short")

    // Surrogate pairs stay whole.
    expect(cutGraphemes("🧠🧠🧠", 2)).toBe("🧠")
  })

  test("duplicate excerpts collapse by hash", () => {
    const a = buildExcerpt({ sourceName: "a", location: "l", text: "same text" })
    const b = buildExcerpt({ sourceName: "a", location: "l", text: "same text" })
    if (!a.ok || !b.ok) throw new Error("expected excerpts")
    expect(uniqueExcerpts([a.excerpt, b.excerpt])).toHaveLength(1)
  })
})

describe("html to text", () => {
  test("drops tags and scripts and decodes the common entities", () => {
    const html =
      '<html><head><style>p{color:red}</style></head><body><h1>Registers</h1><p>A &amp; B</p><script>var x=1</script></body></html>'
    const text = htmlToText(html)
    expect(text).toBe("Registers A & B")
    expect(text).not.toContain("<")
    expect(text).not.toContain("color:red")
  })

  test("collapses whitespace into a single readable line", () => {
    expect(htmlToText("<p>one</p>\n\n<p>two</p>")).toBe("one two")
  })
})

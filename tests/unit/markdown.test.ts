import { describe, expect, test } from "bun:test";
import { extractWikilinks, ok, parseDocument, parseFrontmatter, patchFrontmatter, serializeDocument, splitDocument, type Frontmatter, type Result } from "../../src/domain/markdown";
function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

describe("frontmatter — parse and serialize", () => {
  test("parses scalars, booleans, nulls, arrays and nested maps", () => {
    const raw = [
      "id: 2026-11-01-1430-physics-unit-4",
      "steps: true",
      "count: 12",
      "note: null",
      "tags:",
      "  - physics",
      "  - unit-4",
      "excerpt:",
      "  source: lecture-4.md",
      "  location: p. 12",
    ].join("\n")

    const data = unwrap(parseFrontmatter(raw))
    expect(data.id).toBe("2026-11-01-1430-physics-unit-4")
    expect(data.steps).toBe(true)
    expect(data.count).toBe(12)
    expect(data.note).toBeNull()
    expect(data.tags).toEqual(["physics", "unit-4"])
    expect(data.excerpt).toEqual({ source: "lecture-4.md", location: "p. 12" })
  })

  test("parse -> serialize -> parse is stable for unknown keys", () => {
    const original = [
      "type: session-summary",
      "session: 2026-11-01-1430-physics-unit-4",
      "updated: 2026-11-01T15:00:00Z",
      "future_field: keep me",
      "future_nested:",
      "  alpha: 1",
      "  beta: two",
      "future_list:",
      "  - a",
      "  - b",
    ].join("\n")

    const first = unwrap(parseDocument(`---\n${original}\n---\nbody\n`))
    const text = serializeDocument(first.data, first.body)
    const second = unwrap(parseDocument(text))
    expect(second.data).toEqual(first.data)

    // Byte-stable too: a second round-trip changes nothing.
    expect(serializeDocument(second.data, second.body)).toBe(text)
    expect(second.data.future_field).toBe("keep me")
    expect(second.data.future_nested).toEqual({ alpha: 1, beta: "two" })
    expect(second.body).toBe("body\n")
  })

  test("values that look like syntax are quoted and survive the round-trip", () => {
    const cases = [
      "true",
      "12",
      "",
      " padded ",
      "[[Energy balance]]",
      "a: b",
      "x # y",
      "2026-11-01T15:00:00Z",
      "https://example.test/a:b",
    ]
    for (const value of cases) {
      const data: Frontmatter = { value }
      const text = serializeDocument(data, "body\n")
      const back = unwrap(parseDocument(text))
      expect(back.data.value).toBe(value)
    }
  })

  test("document split keeps the body byte-exact", () => {
    const text = "---\ntype: concept\n---\n\n# Title\n\nbody\n"
    const parsed = unwrap(parseDocument(text))
    expect(parsed.data).toEqual({ type: "concept" })
    expect(parsed.body).toBe("\n# Title\n\nbody\n")
    expect(serializeDocument(parsed.data, parsed.body)).toBe(text)
  })

  test("a document without frontmatter parses as body only", () => {
    const parsed = unwrap(parseDocument("# Just markdown\n"))
    expect(parsed.data).toEqual({})
    expect(parsed.body).toBe("# Just markdown\n")
  })

  test("CRLF input is normalised to LF", () => {
    const document = splitDocument("---\r\ntype: concept\r\n---\r\nbody\r\n")
    expect(document.frontmatter).toBe("type: concept")
    expect(document.body).toBe("body\n")
  })
})

describe("frontmatter — typed errors", () => {
  test("an unterminated block is an error, not a guess", () => {
    const result = parseDocument("---\ntype: concept\nbody without a closing fence\n")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-unterminated")
    if (result.error.kind !== "frontmatter-unterminated") return
    expect(result.error.line).toBe(1)
  })

  test("a line that is not key: value is rejected", () => {
    const result = parseFrontmatter("type: concept\nthis line has no colon")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
    if (result.error.kind !== "frontmatter-invalid") return
    expect(result.error.line).toBe(2)
  })

  test("unexpected indentation is rejected", () => {
    const result = parseFrontmatter("type: concept\n    deeper: value")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
  })

  test("a duplicate key is rejected rather than silently overwritten", () => {
    const result = parseFrontmatter("type: concept\ntype: source")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-duplicate-key")
    if (result.error.kind !== "frontmatter-duplicate-key") return
    expect(result.error.key).toBe("type")
    expect(result.error.line).toBe(2)
  })
})

describe("patchFrontmatter — touches only the named keys", () => {
  test("unknown keys, order and formatting survive a one-field save", () => {
    const text = [
      "---",
      "type: session-summary",
      "# a comment the app does not own",
      "session: 2026-11-01-1430-physics-unit-4",
      "unknown_key: keep me exactly",
      "updated: 2026-11-01T15:00:00Z",
      "---",
      "",
      "# Key points",
      "",
      "- boundary conditions",
      "",
    ].join("\n")

    const patched = unwrap(patchFrontmatter(text, { updated: "2026-11-01T16:00:00Z" }))
    expect(patched).toBe(text.replace("2026-11-01T15:00:00Z", "2026-11-01T16:00:00Z"))
    expect(patched).toContain("# a comment the app does not own")
    expect(unwrap(parseDocument(patched)).data.unknown_key).toBe("keep me exactly")
  })

  test("a key that is not present is appended, not reordered", () => {
    const text = "---\ntype: concept\n---\nbody\n"
    const patched = unwrap(patchFrontmatter(text, { links: ["Energy balance"] }))
    expect(patched).toBe('---\ntype: concept\nlinks:\n  - Energy balance\n---\nbody\n')
  })

  test("replacing a nested value drops its old children", () => {
    const text = "---\nexcerpt:\n  source: a.md\n  text: hello\nkeep: yes\n---\n"
    const patched = unwrap(patchFrontmatter(text, { excerpt: { source: "b.md" } }))
    expect(patched).toBe("---\nexcerpt:\n  source: b.md\nkeep: yes\n---\n")
  })

  test("frontmatter is created when the file has none", () => {
    const patched = unwrap(patchFrontmatter("# Title\n", { type: "concept" }))
    expect(patched).toBe("---\ntype: concept\n---\n# Title\n")
  })

  test("an empty patch is a no-op", () => {
    const text = "---\ntype: concept\n---\nbody\n"
    expect(unwrap(patchFrontmatter(text, {}))).toBe(text)
    expect(unwrap(patchFrontmatter("body\n", {}))).toBe("body\n")
  })
})

describe("wikilinks", () => {
  test("extracts targets, aliases and headings", () => {
    const links = extractWikilinks(
      "See [[Energy balance]] and [[Physics — Unit 4|the unit]] and [[Notes#Reading]].",
    )
    expect(links.map((link) => link.target)).toEqual([
      "Energy balance",
      "Physics — Unit 4",
      "Notes",
    ])
    expect(links[1]?.alias).toBe("the unit")
    expect(links[2]?.heading).toBe("Reading")
    expect(links[0]?.alias).toBeNull()
    expect(links[0]?.heading).toBeNull()
  })

  test("records byte offsets that point at the opening bracket", () => {
    const body = "a\n[[One]] b [[Two]]\n"
    const links = extractWikilinks(body)
    expect(body.slice(links[0]!.index, links[0]!.index + 7)).toBe("[[One]]")
    expect(body.slice(links[1]!.index, links[1]!.index + 7)).toBe("[[Two]]")
  })

  test("ignores links inside fenced code blocks", () => {
    const body = ["[[real]]", "```md", "[[fake]]", "```", "[[also real]]"].join("\n")
    expect(extractWikilinks(body).map((link) => link.target)).toEqual(["real", "also real"])
  })

  test("ignores empty and nested brackets", () => {
    expect(extractWikilinks("[[   ]] [[]] [[a[b]]").map((link) => link.target)).toEqual([])
  })

  test("is stable across repeated calls", () => {
    const body = "[[a]] [[b]]"
    expect(extractWikilinks(body)).toEqual(extractWikilinks(body))
  })
})

test("ok() wraps a value without an error", () => {
  expect(ok(1)).toEqual({ ok: true, value: 1 })
})

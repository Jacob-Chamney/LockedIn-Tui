import { describe, expect, test } from "bun:test"

import {
  DEFAULT_EXCERPT_CHARS,
  KINDS_BY_SIDE,
  dedupeExcerpts,
  isKindAllowed,
  linkNote,
  linkTargets,
  makeExcerpt,
  noteFromFrontmatter,
  noteRelativePath,
  noteToFrontmatter,
  noteToFrontmatterPreserving,
  resolveNoteLinks,
  slugify,
  uniqueSlug,
  type Note,
} from "../../src/domain/note"
import {
  parseDocument,
  parseFrontmatter,
  serializeDocument,
  serializeFrontmatter,
  type Result,
} from "../../src/domain/markdown"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

const NOTE: Note = {
  id: "energy-balance",
  side: "school",
  type: "concept",
  title: "Energy balance",
  body: "See [[Boundary conditions]] and [[Integral limits]].",
  links: ["Boundary conditions", "Integral limits"],
  tags: ["physics", "unit-4"],
  created: "2026-11-01T14:30:00Z",
  updated: "2026-11-01T15:00:00Z",
}

describe("slugify", () => {
  test("folds case, accents and punctuation", () => {
    expect(slugify("Physics — Unit 4")).toBe("physics-unit-4")
    expect(slugify("  Résumé / CV  ")).toBe("resume-cv")
    expect(slugify("A")).toBe("a")
  })

  test("never returns an empty slug", () => {
    expect(slugify("")).toBe("note")
    expect(slugify("— —")).toBe("note")
  })

  test("caps length without leaving a trailing dash", () => {
    const slug = slugify("a".repeat(200))
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug.endsWith("-")).toBe(false)
  })
})

describe("uniqueSlug — stable collision suffixes", () => {
  test("uses the bare slug when it is free", () => {
    expect(uniqueSlug("Energy balance", [])).toBe("energy-balance")
  })

  test("appends -2, -3, … deterministically", () => {
    expect(uniqueSlug("Energy balance", ["energy-balance"])).toBe("energy-balance-2")
    expect(uniqueSlug("Energy balance", ["energy-balance", "energy-balance-2"])).toBe(
      "energy-balance-3",
    )
  })

  test("same input and same taken set always produce the same name", () => {
    const taken = ["energy-balance", "energy-balance-2", "energy-balance-4"]
    const first = uniqueSlug("Energy balance", taken)
    const second = uniqueSlug("Energy balance", [...taken])
    expect(first).toBe(second)
    expect(first).toBe("energy-balance-3")
  })

  test("suffixed slugs stay within the length cap", () => {
    const long = "a".repeat(64)
    const suffixed = uniqueSlug(long, [long])
    expect(suffixed.length).toBeLessThanOrEqual(64)
    expect(suffixed.endsWith("-2")).toBe(true)
  })
})

describe("note paths and kinds", () => {
  test("each kind lands in the folder from the data model", () => {
    expect(unwrap(noteRelativePath("school", "concept", "Energy balance"))).toBe(
      "concepts/energy-balance.md",
    )
    expect(unwrap(noteRelativePath("skills", "knowledge", "Smart Vector"))).toBe(
      "knowledge/smart-vector.md",
    )
    expect(unwrap(noteRelativePath("school", "session-summary", "2026-11-01-1430-x"))).toBe(
      "sessions/2026-11-01-1430-x.md",
    )
    expect(unwrap(noteRelativePath("skills", "goal", "Assembly basics"))).toBe(
      "goals/assembly-basics.md",
    )
    expect(unwrap(noteRelativePath("skills", "source", "Intel SDM"))).toBe("sources/intel-sdm.md")
  })

  test("a goal cannot live on the school side", () => {
    const result = noteRelativePath("school", "goal", "x")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
    expect(result.error.message).toContain("school")
  })

  test("kind allow-lists match the data model", () => {
    expect(isKindAllowed("school", "concept")).toBe(true)
    expect(isKindAllowed("school", "goal")).toBe(false)
    expect(isKindAllowed("skills", "goal")).toBe(true)
    expect(isKindAllowed("skills", "concept")).toBe(false)
    expect(KINDS_BY_SIDE.skills).toEqual(["goal", "knowledge", "source"])
  })
})

describe("excerpts", () => {
  test("caps text at 400 characters by default", () => {
    const text = "x".repeat(1000)
    const excerpt = makeExcerpt({ sourceName: "a.md", location: "p1", text })
    expect(excerpt.text.length).toBe(DEFAULT_EXCERPT_CHARS)
    expect(DEFAULT_EXCERPT_CHARS).toBe(400)
  })

  test("honours a custom cap", () => {
    const text = "abcdef"
    expect(makeExcerpt({ sourceName: "a", location: "l", text, chars: 3 }).text).toBe("abc")
  })

  test("hash covers the full text, not the capped slice", () => {
    const text = "y".repeat(500)
    const short = makeExcerpt({ sourceName: "a", location: "l", text, chars: 10 })
    const long = makeExcerpt({ sourceName: "a", location: "l", text, chars: 400 })
    expect(short.hash).toBe(long.hash)
    expect(short.text).not.toBe(long.text)
  })

  test("de-duplicates by hash, keeping the first and preserving order", () => {
    const one = makeExcerpt({ sourceName: "a.md", location: "p1", text: "same" })
    const two = makeExcerpt({ sourceName: "a.md", location: "p1", text: "same" })
    const other = makeExcerpt({ sourceName: "a.md", location: "p2", text: "same" })
    const deduped = dedupeExcerpts([one, two, other, one])
    expect(deduped).toHaveLength(2)
    expect(deduped[0]).toBe(one)
    expect(deduped[1]).toBe(other)
    expect(deduped[1]!.hash).not.toBe(one.hash)
  })

  test("different locations are different excerpts", () => {
    const a = makeExcerpt({ sourceName: "a.md", location: "p1", text: "t" })
    const b = makeExcerpt({ sourceName: "a.md", location: "p2", text: "t" })
    expect(a.hash).not.toBe(b.hash)
  })

  test("a non-positive cap is a programming error, not a silent clamp", () => {
    expect(() => makeExcerpt({ sourceName: "a", location: "l", text: "t", chars: 0 })).toThrow(
      RangeError,
    )
  })
})

describe("the wall — links never cross sides", () => {
  test("a link to the other side is rejected with a typed error", () => {
    const result = linkNote({ id: "a", side: "school" }, { id: "b", side: "skills" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("cross-side-link")
    if (result.error.kind !== "cross-side-link") return
    expect(result.error.from).toBe("school")
    expect(result.error.to).toBe("skills")
    expect(result.error.target).toBe("b")
  })

  test("rejection is symmetric", () => {
    const result = linkNote({ id: "g", side: "skills" }, { id: "c", side: "school" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("cross-side-link")
  })

  test("a same-side link returns a LinkRef", () => {
    const ref = unwrap(
      linkNote({ id: "a", side: "school" }, { id: "b", side: "school" }, {
        heading: "Reading",
        alias: "the reading",
      }),
    )
    expect(ref).toEqual({
      from: "a",
      to: "b",
      heading: "Reading",
      alias: "the reading",
      broken: false,
    })
  })

  test("a link to a missing note is marked broken, not dropped", () => {
    const refs = unwrap(
      resolveNoteLinks(
        { id: "a", side: "school", body: "[[here]] [[gone]]" },
        (target) => target === "here",
      ),
    )
    expect(refs.map((ref) => [ref.to, ref.broken])).toEqual([
      ["here", false],
      ["gone", true],
    ])
  })

  test("linkTargets lists distinct targets in document order", () => {
    expect(linkTargets("[[b]] [[a]] [[b]]")).toEqual(["b", "a"])
    expect(linkTargets("no links here")).toEqual([])
  })
})

describe("note frontmatter", () => {
  test("round-trips a note and preserves unknown keys", () => {
    const existing = { future_field: "keep me", counter: 3 }
    const data = noteToFrontmatterPreserving(NOTE, existing)
    expect(data.future_field).toBe("keep me")
    expect(data.counter).toBe(3)

    const text = serializeFrontmatter(data)
    const parsed = unwrap(parseFrontmatter(text.split("\n").slice(1, -2).join("\n")))
    expect(parsed.future_field).toBe("keep me")

    const back = unwrap(noteFromFrontmatter(parsed, NOTE.body))
    expect(back).toEqual(NOTE)
  })

  test("unknown keys survive parse -> serialize -> parse on a full document", () => {
    const original =
      "---\nid: energy-balance\nside: school\ntype: concept\ntitle: Energy balance\n" +
      "tags:\n  - physics\nlinks:\n  - Boundary conditions\ncreated: 2026-11-01T14:30:00Z\n" +
      "updated: 2026-11-01T15:00:00Z\nmystery:\n  a: 1\n---\nBody [[Boundary conditions]]\n"

    const first = unwrap(parseDocument(original))
    expect(first.data.mystery).toEqual({ a: 1 })

    const second = unwrap(parseDocument(serializeDocument(first.data, first.body)))
    expect(second.data).toEqual(first.data)
    expect(second.body).toBe(first.body)

    const note = unwrap(noteFromFrontmatter(second.data, second.body))
    expect(note.side).toBe("school")
    expect(note.type).toBe("concept")
    expect(note.links).toEqual(["Boundary conditions"])
    expect(note.body).toBe("Body [[Boundary conditions]]\n")
  })

  test("noteToFrontmatter includes the excerpt as a nested block", () => {
    const excerpt = makeExcerpt({ sourceName: "lecture-4.md", location: "p. 12", text: "limits" })
    const data = noteToFrontmatter({ ...NOTE, excerpt })
    expect(data.excerpt).toEqual({
      source: "lecture-4.md",
      location: "p. 12",
      hash: excerpt.hash,
      text: "limits",
    })
    const back = unwrap(noteFromFrontmatter(data, NOTE.body))
    expect(back.excerpt?.hash).toBe(excerpt.hash)
  })

  test("a note without side is rejected", () => {
    const result = noteFromFrontmatter({ type: "concept" }, "body")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
    expect(result.error.message).toContain("side")
  })

  test("an unknown note type is rejected", () => {
    const result = noteFromFrontmatter({ side: "school", type: "diary" }, "body")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
    expect(result.error.message).toContain("diary")
  })

  test("a kind that does not belong to the side is rejected", () => {
    const result = noteFromFrontmatter({ side: "school", type: "goal" }, "body")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("frontmatter-invalid")
  })

  test("id falls back to a slug of the title, and side may be supplied by the caller", () => {
    const note = unwrap(
      noteFromFrontmatter({ type: "session-summary", title: "Physics — Unit 4" }, "", {
        side: "school",
      }),
    )
    expect(note.id).toBe("physics-unit-4")
    expect(note.side).toBe("school")
  })
})

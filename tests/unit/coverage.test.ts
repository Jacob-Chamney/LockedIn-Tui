import { describe, expect, test } from "bun:test"

import {
  COVERAGE_DOCUMENT_KINDS,
  FIRST_LINE_CHARS,
  MIN_SUBSTRING_LENGTH,
  computeCoverage,
  coverageGaps,
  isFullyCovered,
  type CoverageDocument,
  type CoverageReport,
  type CoverageSource,
} from "../../src/domain/coverage"

const HASH_A = `sha256:${"a".repeat(64)}`
const HASH_B = `sha256:${"b".repeat(64)}`
const HASH_C = `sha256:${"c".repeat(64)}`

function source(name: string, hash: string, origin = `/home/me/input/${name}`): CoverageSource {
  return { name, originalPath: origin, hash }
}

function doc(kind: CoverageDocument["kind"], text: string): CoverageDocument {
  return { kind, text }
}

function byName(report: CoverageReport, name: string) {
  const found = report.sources.find((entry) => entry.name === name)
  if (!found) throw new Error(`no coverage entry for ${name}`)
  return found
}

describe("coverage — counting mentions", () => {
  test("counts a name mentioned across several documents", () => {
    const report = computeCoverage(
      [source("lecture-4.md", HASH_A)],
      [
        doc("steps", "- [ ] Read lecture-4.md before the lab"),
        doc("chat", "As lecture-4.md says, the limits come from the boundary."),
        doc("outputs", "nothing relevant here"),
      ],
    )
    const entry = byName(report, "lecture-4.md")
    expect(entry.count).toBe(2)
    expect(entry.documents).toEqual(["steps", "chat"])
    expect(entry.referenced).toBe(true)
    expect(entry.firstLine).toBe("- [ ] Read lecture-4.md before the lab")
  })

  test("matching is case-insensitive", () => {
    const report = computeCoverage(
      [source("Lecture-4.md", HASH_A)],
      [doc("chat", "LECTURE-4.MD and lecture-4.Md both appear")],
    )
    expect(byName(report, "Lecture-4.md").count).toBe(2)
  })

  test("the origin file name also counts as a mention", () => {
    const report = computeCoverage(
      [source("weeks.pdf", HASH_A, "/home/me/input/notes/physics-week-4.pdf")],
      [
        doc("steps", "Summarise physics-week-4.pdf"),
        doc("chat", "weeks.pdf is the only source"),
      ],
    )
    const entry = byName(report, "weeks.pdf")
    expect(entry.count).toBe(2)
    expect(entry.documents).toEqual(["steps", "chat"])
  })

  test("a name and origin that are the same string count once per occurrence", () => {
    const report = computeCoverage(
      [source("lecture-4.md", HASH_A)],
      [doc("chat", "lecture-4.md")],
    )
    expect(byName(report, "lecture-4.md").count).toBe(1)
  })

  test("occurrences on the same line all count", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A)],
      [doc("chat", "a.md and a.md and a.md")],
    )
    expect(byName(report, "a.md").count).toBe(3)
  })

  test("empty documents and empty text are handled", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A)],
      [doc("steps", ""), doc("chat", "\n\n"), doc("outputs", "   ")],
    )
    const entry = byName(report, "a.md")
    expect(entry.count).toBe(0)
    expect(entry.documents).toEqual([])
    expect(entry.firstLine).toBeNull()
    expect(entry.referenced).toBe(false)
  })

  test("a document mentioning nothing is not listed for any source", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A)],
      [doc("steps", "unrelated"), doc("memory", "a.md noted")],
    )
    expect(byName(report, "a.md").documents).toEqual(["memory"])
  })
})

describe("coverage — ordering is deterministic", () => {
  test("sorts by count descending, then by name", () => {
    const report = computeCoverage(
      [
        source("zebra.md", HASH_A),
        source("alpha.md", HASH_B),
        source("middle.md", HASH_C),
      ],
      [doc("chat", "middle.md middle.md alpha.md zebra.md middle.md")],
    )
    expect(report.sources.map((entry) => entry.name)).toEqual([
      "middle.md",
      "alpha.md",
      "zebra.md",
    ])
    expect(report.sources.map((entry) => entry.count)).toEqual([3, 1, 1])
  })

  test("equal counts fall back to a case-insensitive name, then the hash", () => {
    const report = computeCoverage(
      [
        source("Beta.md", HASH_B),
        source("alpha.md", HASH_A),
        source("Alpha.md", HASH_C),
      ],
      [doc("steps", "Beta.md alpha.md Alpha.md")],
    )
    // "Alpha.md" and "alpha.md" tie on the name, so the hash decides: aaa… first.
    expect(report.sources.map((entry) => entry.name)).toEqual(["alpha.md", "Alpha.md", "Beta.md"])
  })

  test("the same input always produces the same order and values", () => {
    const sources = [source("b.md", HASH_B), source("a.md", HASH_A)]
    const documents = [doc("steps", "a.md"), doc("chat", "b.md b.md")]
    const first = computeCoverage(sources, documents)
    const second = computeCoverage(sources, documents)
    expect(second).toEqual(first)
  })

  test("unreferenced sources are listed explicitly and sorted by name", () => {
    const report = computeCoverage(
      [source("b.md", HASH_B), source("used.md", HASH_A), source("a.md", HASH_C)],
      [doc("steps", "used.md")],
    )
    expect(report.unreferenced.map((entry) => entry.name)).toEqual(["a.md", "b.md"])
    expect(report.referencedCount).toBe(1)
    expect(report.total).toBe(3)
    expect(coverageGaps(report).map((entry) => entry.name)).toEqual(["a.md", "b.md"])
  })
})

describe("coverage — de-duplication and memory", () => {
  test("duplicate hashes are merged, so a repeat add cannot inflate counts", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A), source("a.md", HASH_A, "/elsewhere/a.md")],
      [doc("chat", "a.md")],
    )
    expect(report.total).toBe(1)
    expect(report.sources).toHaveLength(1)
    expect(report.sources[0]?.count).toBe(1)
    expect(report.sources[0]?.originalPath).toBe("/home/me/input/a.md")
  })

  test("same name with different hashes stays two sources", () => {
    const report = computeCoverage(
      [source("notes.md", HASH_A), source("notes.md", HASH_B)],
      [doc("chat", "notes.md")],
    )
    expect(report.total).toBe(2)
    expect(report.sources.map((entry) => entry.hash).sort()).toEqual([HASH_A, HASH_B].sort())
  })

  test("a source mentioned only in memory is not claimed by outputs", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A)],
      [doc("steps", "nothing"), doc("outputs", "nothing"), doc("memory", "- a.md informed this")],
    )
    const entry = byName(report, "a.md")
    expect(entry.documents).toEqual(["memory"])
    expect(entry.documents).not.toContain("outputs")
    expect(entry.fromMemoryOnly).toBe(true)
    expect(entry.referenced).toBe(true)
  })

  test("fromMemoryOnly is false when any other document mentions it", () => {
    const report = computeCoverage(
      [source("a.md", HASH_A)],
      [doc("memory", "a.md"), doc("steps", "a.md")],
    )
    expect(byName(report, "a.md").fromMemoryOnly).toBe(false)
    expect(byName(report, "a.md").documents).toEqual(["memory", "steps"])
  })
})

describe("coverage — short names never match inside words", () => {
  test("the documented threshold is three characters", () => {
    expect(MIN_SUBSTRING_LENGTH).toBe(3)
  })

  test("a two-letter name does not match inside prose", () => {
    const report = computeCoverage([source("ts", HASH_A)], [doc("chat", "stats and cats")])
    expect(byName(report, "ts").count).toBe(0)
  })

  test("a two-letter name still matches as a whole word", () => {
    const report = computeCoverage([source("ts", HASH_A)], [doc("chat", "use ts files")])
    expect(byName(report, "ts").count).toBe(1)
    expect(byName(report, "ts").referenced).toBe(true)
  })

  test("three characters and up match as substrings, by design", () => {
    const report = computeCoverage([source("abc", HASH_A)], [doc("chat", "xabcx")])
    expect(byName(report, "abc").count).toBe(1)
  })

  test("a short origin name is word-matched too", () => {
    // The origin base name "ab" is two characters, so prose cannot match it.
    const embedded = computeCoverage(
      [source("notes.md", HASH_A, "/input/ab")],
      [doc("chat", "about the file, and stab the page")],
    )
    expect(byName(embedded, "notes.md").count).toBe(0)

    const standalone = computeCoverage(
      [source("notes.md", HASH_A, "/input/ab")],
      [doc("chat", "see ab for the detail")],
    )
    expect(byName(standalone, "notes.md").count).toBe(1)
  })
})

describe("coverage — empty and degenerate input", () => {
  test("no sources is a valid empty report, not an error", () => {
    const report = computeCoverage([], [doc("steps", "a.md")])
    expect(report).toEqual({
      sources: [],
      unreferenced: [],
      total: 0,
      referencedCount: 0,
    })
    expect(isFullyCovered(report)).toBe(false)
  })

  test("no documents leaves every source unreferenced", () => {
    const report = computeCoverage([source("a.md", HASH_A)], [])
    expect(report.referencedCount).toBe(0)
    expect(report.unreferenced).toHaveLength(1)
    expect(isFullyCovered(report)).toBe(false)
  })

  test("full coverage requires at least one source and no gaps", () => {
    expect(
      isFullyCovered(
        computeCoverage([source("a.md", HASH_A)], [doc("steps", "a.md"), doc("memory", "a.md")]),
      ),
    ).toBe(true)
    expect(
      isFullyCovered(
        computeCoverage([source("a.md", HASH_A), source("b.md", HASH_B)], [doc("steps", "a.md")]),
      ),
    ).toBe(false)
  })

  test("the document kinds are the four the product names", () => {
    expect(COVERAGE_DOCUMENT_KINDS).toEqual(["steps", "chat", "outputs", "memory"])
  })

  test("firstLine is trimmed and capped", () => {
    const long = `  ${"x".repeat(FIRST_LINE_CHARS + 50)} a.md  `
    const report = computeCoverage([source("a.md", HASH_A)], [doc("chat", long)])
    const line = byName(report, "a.md").firstLine
    expect(line?.startsWith("x")).toBe(true)
    expect(line?.endsWith("…")).toBe(true)
    expect(line?.length).toBe(FIRST_LINE_CHARS + 1)
  })
})

describe("coverage — inputs are not mutated", () => {
  test("neither array nor its entries change", () => {
    const sources = [source("b.md", HASH_B), source("a.md", HASH_A)]
    const documents = [doc("steps", "a.md"), doc("chat", "b.md")]
    const sourcesSnapshot = JSON.parse(JSON.stringify(sources)) as CoverageSource[]
    const documentsSnapshot = JSON.parse(JSON.stringify(documents)) as CoverageDocument[]

    computeCoverage(sources, documents)

    expect(sources).toEqual(sourcesSnapshot)
    expect(documents).toEqual(documentsSnapshot)
    expect(sources.map((entry) => entry.name)).toEqual(["b.md", "a.md"])
  })
})

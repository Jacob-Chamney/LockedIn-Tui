/**
 * WP-302 — toolbox shapes that must hold without a filesystem.
 *
 * The escape matrix and the read/search behaviour are integration tests; what
 * is asserted here is the contract: three read-only specs, no absolute-path
 * parameter anywhere, and history that is always a separate, labelled value.
 */

import { describe, expect, test } from "bun:test"

import {
  READ_CAP_BYTES,
  READABLE_KINDS,
  SEARCH_HIT_CAP,
  TRUNCATION_MARKER,
  toolsForSession,
} from "../../src/services/lockin/toolbox"
import {
  EXTERNAL_LABEL,
  HISTORY_LABEL,
  isExternalExplanation,
  labelPluginOutput,
  relatedHistory,
  type NoteHit,
} from "../../src/services/lockin/history"

describe("tool specs", () => {
  test("exactly three tools, all read-only and school-side", () => {
    const specs = toolsForSession()
    expect(specs.map((spec) => spec.name).sort()).toEqual([
      "list_sources",
      "read_source",
      "search_sources",
    ])
    for (const spec of specs) {
      expect(spec.side).toBe("school")
      expect(spec.write).toBe(false)
      expect(spec.command).toBe(false)
    }
  })

  test("no schema accepts a path, root or directory", () => {
    for (const spec of toolsForSession()) {
      const names = Object.keys(spec.inputSchema.properties)
      for (const name of names) {
        expect(name === "name" || name === "term").toBe(true)
      }
      expect(names).not.toContain("path")
      expect(names).not.toContain("root")
      expect(names).not.toContain("dir")
      expect(spec.inputSchema.additionalProperties).toBe(false)
    }
  })

  test("schemas are plain JSON data", () => {
    const serialised = JSON.stringify(toolsForSession())
    expect(serialised).toContain('"list_sources"')
    expect(serialised).not.toContain("function")
  })

  test("the spec list is a copy: mutating one call cannot change the next", () => {
    const first = toolsForSession()
    first[0]!.name = "mutated"
    expect(toolsForSession()[0]?.name).toBe("list_sources")
  })

  test("the documented caps are stable", () => {
    expect(READ_CAP_BYTES).toBe(65536)
    expect(SEARCH_HIT_CAP).toBe(50)
    expect(TRUNCATION_MARKER).toContain("truncated")
    expect([...READABLE_KINDS]).toEqual(["markdown", "text", "code", "pdf", "docx", "other"])
  })
})

describe("history block", () => {
  const session = { id: "2026-11-01-1430-physics", name: "Physics — Unit 4" }

  const hit: NoteHit = {
    path: "concepts/energy-balance.md",
    title: "Energy balance",
    snippet: "The boundary conditions decide the integral limits.",
    score: 1.2,
    updated: "2026-11-01T15:00:00Z",
  }

  test("is labelled From your history and separate from the sources", async () => {
    const block = await relatedHistory({
      session,
      query: "boundary",
      index: { search: async () => [hit] },
    })
    expect(block.kind).toBe("history")
    expect(block.label).toBe(HISTORY_LABEL)
    expect(block.label).toBe("From your history")
    expect(block.available).toBe(true)
    expect(block.notes).toHaveLength(1)
    // The block is its own value: it has no source, excerpt or hashes.
    expect(block).not.toHaveProperty("sources")
    expect(block).not.toHaveProperty("excerpt")
  })

  test("a missing index is unavailable, not an error", async () => {
    const block = await relatedHistory({ session, query: "x", index: null })
    expect(block).toEqual({
      kind: "history",
      label: HISTORY_LABEL,
      notes: [],
      available: false,
    })
  })

  test("an index that fails or returns null degrades quietly", async () => {
    const throwing = await relatedHistory({
      session,
      query: "x",
      index: {
        search: () => {
          throw new Error("index is corrupt")
        },
      },
    })
    expect(throwing.available).toBe(false)
    expect(throwing.notes).toEqual([])

    const nulled = await relatedHistory({ session, query: "x", index: { search: async () => null } })
    expect(nulled.available).toBe(false)
  })

  test("an empty query falls back to the session name", async () => {
    const seen: string[] = []
    await relatedHistory({
      session,
      query: "   ",
      index: {
        search: async (query) => {
          seen.push(query)
          return []
        },
      },
    })
    expect(seen).toEqual(["Physics — Unit 4"])
  })

  test("results are capped at the limit", async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...hit, path: `n${index}.md` }))
    const block = await relatedHistory({
      session,
      query: "x",
      index: { search: async () => many },
      limit: 3,
    })
    expect(block.notes).toHaveLength(3)
  })
})

describe("plugin labelling", () => {
  test("the label rides on the value", () => {
    const labelled = labelPluginOutput({ text: "from a plugin" })
    expect(labelled.label).toBe(EXTERNAL_LABEL)
    expect(labelled.label).toBe("external explanation")
    expect(labelled.external).toBe(true)
    expect(labelled.value).toEqual({ text: "from a plugin" })
  })

  test("a labelled result is recognisable and a plain one is not", () => {
    expect(isExternalExplanation(labelPluginOutput("x"))).toBe(true)
    expect(isExternalExplanation({ text: "plain" })).toBe(false)
    expect(isExternalExplanation(null)).toBe(false)
  })

  test("a labelled result is not source-shaped, so it cannot be counted as one", () => {
    const labelled = labelPluginOutput("x")
    expect(labelled).not.toHaveProperty("hash")
    expect(labelled).not.toHaveProperty("storedPath")
    expect(Object.keys(labelled).sort()).toEqual(["external", "label", "value"])
  })
})

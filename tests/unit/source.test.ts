import { describe, expect, test } from "bun:test"

import {
  SOURCE_DIRECTORY,
  TEXT_SOURCE_KINDS,
  addSource,
  addSources,
  baseName,
  classifySource,
  isInsideSources,
  isSourceHash,
  isTextSourceKind,
  makeSource,
  progressTargets,
  safeSourceName,
  sameSources,
  storedPathFor,
  type Source,
  type SourceError,
} from "../../src/domain/source"
import { type Result } from "../../src/domain/markdown"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, SourceError>): SourceError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const HASH_A = `sha256:${"a".repeat(64)}`
const HASH_B = `sha256:${"b".repeat(64)}`
const HASH_C = `sha256:${"c".repeat(64)}`

function source(overrides: Partial<Source> = {}): Source {
  return {
    originalPath: "/home/me/input/lecture-4.md",
    storedPath: "sources/lecture-4.md",
    name: "lecture-4.md",
    hash: HASH_A,
    kind: "markdown",
    ...overrides,
  }
}

describe("classifySource", () => {
  test("maps every documented extension", () => {
    expect(classifySource("notes.md")).toBe("markdown")
    expect(classifySource("notes.markdown")).toBe("markdown")
    expect(classifySource("notes.txt")).toBe("text")
    expect(classifySource("snippet.ts")).toBe("code")
    expect(classifySource("paper.pdf")).toBe("pdf")
    expect(classifySource("essay.docx")).toBe("docx")
    expect(classifySource("diagram.png")).toBe("image")
    expect(classifySource("archive.zip")).toBe("other")
  })

  test("is case-insensitive and survives a missing extension", () => {
    expect(classifySource("LECTURE.MD")).toBe("markdown")
    expect(classifySource("Makefile")).toBe("other")
    expect(classifySource(".env")).toBe("other")
  })

  test("every text-bearing kind includes unknown files", () => {
    expect(TEXT_SOURCE_KINDS).toEqual(["markdown", "text", "code", "pdf", "docx", "other"])
    expect(isTextSourceKind("markdown")).toBe(true)
    expect(isTextSourceKind("docx")).toBe(true)
    expect(isTextSourceKind("other")).toBe(true)
    expect(isTextSourceKind("image")).toBe(false)
  })
})

describe("stored paths stay inside sources/", () => {
  test("accepts a plain relative path", () => {
    expect(isInsideSources("sources/lecture-4.md")).toBe(true)
    expect(isInsideSources("sources/deep/nested/file.md")).toBe(true)
  })

  test("rejects absolute paths, traversal, dot segments and backslashes", () => {
    for (const path of [
      "/etc/passwd",
      "../secrets.md",
      "sources/../../etc/passwd",
      "sources/./file.md",
      "sources//file.md",
      "sources",
      "sources/",
      "other/file.md",
      "C:\\Windows\\file.md",
      "sources\\file.md",
      "",
    ]) {
      expect(isInsideSources(path)).toBe(false)
    }
  })

  test("the prefix must be a real segment, not a lookalike", () => {
    expect(isInsideSources("sources-archive/file.md")).toBe(false)
  })
})

describe("storedPathFor and safeSourceName", () => {
  test("uses the source directory and keeps the extension", () => {
    expect(storedPathFor("lecture-4.md")).toBe(`${SOURCE_DIRECTORY}/lecture-4.md`)
  })

  test("a content hash prefixes the name so same-named files cannot collide", () => {
    const path = storedPathFor("lecture-4.md", HASH_A)
    expect(path).toBe("sources/aaaaaaaa-lecture-4.md")
    expect(isInsideSources(path)).toBe(true)
  })

  test("the same bytes give the same stored path", () => {
    expect(storedPathFor("lecture-4.md", HASH_A)).toBe(storedPathFor("lecture-4.md", HASH_A))
    expect(storedPathFor("lecture-4.md", HASH_A)).not.toBe(storedPathFor("lecture-4.md", HASH_B))
  })

  test("unsafe characters are replaced, never passed through", () => {
    expect(safeSourceName("../../etc/passwd")).toBe("passwd")
    expect(safeSourceName("my lecture (4).md")).toBe("my-lecture-4-.md")
    expect(safeSourceName("...")).toBe("source")
    expect(safeSourceName("")).toBe("source")
    expect(safeSourceName("a".repeat(300)).length).toBeLessThanOrEqual(120)
  })

  test("the last path segment wins for either separator style", () => {
    expect(baseName("/a/b/c.md")).toBe("c.md")
    expect(baseName("a\\b\\c.md")).toBe("c.md")
    expect(baseName("c.md")).toBe("c.md")
  })

  test("an invalid hash is ignored rather than trusted", () => {
    expect(storedPathFor("lecture.md", "sha256:nope")).toBe("sources/lecture.md")
    expect(isSourceHash(HASH_A)).toBe(true)
    expect(isSourceHash("sha1:abc")).toBe(false)
    expect(isSourceHash(`sha256:${"A".repeat(64)}`)).toBe(false)
  })
})

describe("makeSource", () => {
  test("builds a valid source and infers kind and stored path", () => {
    const built = unwrap(makeSource({ originalPath: "/home/me/input/lecture-4.md", hash: HASH_A }))
    expect(built).toEqual({
      originalPath: "/home/me/input/lecture-4.md",
      storedPath: "sources/aaaaaaaa-lecture-4.md",
      name: "lecture-4.md",
      hash: HASH_A,
      kind: "markdown",
    })
  })

  test("an image is a valid source", () => {
    const built = unwrap(makeSource({ originalPath: "/home/me/diagram.png", hash: HASH_A }))
    expect(built.kind).toBe("image")
    expect(built.name).toBe("diagram.png")
  })

  test("an unknown type is a valid source", () => {
    const built = unwrap(makeSource({ originalPath: "archive.zip", hash: HASH_A }))
    expect(built.kind).toBe("other")
    expect(built.name).toBe("archive.zip")
  })

  test("a stored path outside sources/ is a typed path error", () => {
    const error = errorOf(
      makeSource({ originalPath: "a.md", hash: HASH_A, storedPath: "../escape.md" }),
    )
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
    expect(error.path).toBe("../escape.md")
    expect(error.message).toContain("sources/")
  })

  test("an absolute stored path is refused", () => {
    const error = errorOf(
      makeSource({ originalPath: "a.md", hash: HASH_A, storedPath: "/tmp/a.md" }),
    )
    expect(error.kind).toBe("path")
  })

  test("a malformed hash is a storage error, not a silent pass", () => {
    const error = errorOf(makeSource({ originalPath: "a.md", hash: "md5:1234" }))
    expect(error.kind).toBe("storage")
    expect(error.message).toContain("sha256")
  })

  test("a source without a name is refused", () => {
    const error = errorOf(makeSource({ originalPath: "", hash: HASH_A }))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("missing")
  })

  test("an explicit kind wins over the extension", () => {
    expect(unwrap(makeSource({ originalPath: "data.bin", hash: HASH_A, kind: "text" })).kind).toBe(
      "text",
    )
    expect(unwrap(makeSource({ originalPath: "data.md", hash: HASH_A, kind: "image" })).kind).toBe(
      "image",
    )
  })
})

describe("addSource — dedupe by hash, order preserved", () => {
  test("a duplicate hash is an idempotent no-op", () => {
    const first = unwrap(makeSource({ originalPath: "/a/lecture-4.md", hash: HASH_A }))
    const again = unwrap(makeSource({ originalPath: "/b/lecture-4.md", hash: HASH_A }))

    const once = unwrap(addSource([], first))
    expect(once.added).toBe(true)

    const twice = unwrap(addSource(once.sources, again))
    expect(twice.added).toBe(false)
    expect(twice.sources).toHaveLength(1)
    expect(twice.sources[0]).toBe(first)
  })

  test("new hashes append and keep insertion order", () => {
    const a = unwrap(makeSource({ originalPath: "a.md", hash: HASH_A }))
    const b = unwrap(makeSource({ originalPath: "b.md", hash: HASH_B }))
    const c = unwrap(makeSource({ originalPath: "c.md", hash: HASH_C }))

    const one = unwrap(addSource([], b))
    const two = unwrap(addSource(one.sources, a))
    const three = unwrap(addSource(two.sources, c))

    expect(three.sources.map((item) => item.hash)).toEqual([HASH_B, HASH_A, HASH_C])
    expect(three.added).toBe(true)
  })

  test("an invalid source is refused before it can enter the list", () => {
    const list = [source()]
    const error = errorOf(addSource(list, source({ hash: HASH_B, storedPath: "/etc/passwd" })))
    expect(error.kind).toBe("path")
    expect(list).toHaveLength(1)
  })

  test("addSources counts only the additions", () => {
    const a = unwrap(makeSource({ originalPath: "a.md", hash: HASH_A }))
    const b = unwrap(makeSource({ originalPath: "b.md", hash: HASH_B }))
    const result = addSources([a], [b, a, b])
    expect(result.added).toBe(1)
    expect(result.sources.map((item) => item.hash)).toEqual([HASH_A, HASH_B])
  })

  test("sameSources compares hashes in order", () => {
    const a = source({ hash: HASH_A })
    const b = source({ hash: HASH_B })
    expect(sameSources([a, b], [a, b])).toBe(true)
    expect(sameSources([a, b], [b, a])).toBe(false)
    expect(sameSources([a], [a, b])).toBe(false)
  })
})

describe("progressTargets — stable display names", () => {
  test("unique names are shown as-is, in source order", () => {
    const targets = progressTargets([
      source({ name: "lecture-4.md", hash: HASH_A }),
      source({ name: "notes.md", hash: HASH_B }),
    ])
    expect(targets.map((target) => target.display)).toEqual(["lecture-4.md", "notes.md"])
  })

  test("duplicated names are disambiguated by a stable hash prefix", () => {
    const targets = progressTargets([
      source({ name: "notes.md", hash: HASH_A }),
      source({ name: "notes.md", hash: HASH_B }),
    ])
    expect(targets[0]?.display).toBe("notes.md (aaaaaaaa)")
    expect(targets[1]?.display).toBe("notes.md (bbbbbbbb)")
  })

  test("a display name does not change when unrelated sources are added", () => {
    const before = progressTargets([source({ name: "notes.md", hash: HASH_A })])
    const after = progressTargets([
      source({ name: "other.md", hash: HASH_B }),
      source({ name: "notes.md", hash: HASH_A }),
    ])
    expect(before[0]?.display).toBe("notes.md")
    expect(after[1]?.display).toBe("notes.md")
    expect(after[1]?.display).toBe(before[0]!.display)
  })

  test("an empty source list has no targets", () => {
    expect(progressTargets([])).toEqual([])
  })
})

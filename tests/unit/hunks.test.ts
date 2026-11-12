/**
 * WP-504 — hunk indices, rendering and strict application.
 *
 * The fixture in `tests/fixtures/diffs/` is the reference: `base.txt` →
 * `proposed.txt` is four single-line edits separated far enough that the
 * three-line context cannot merge them. Every row below is about a property the
 * approval UI depends on:
 *
 * - an index the user saw before a re-render still names the same hunk;
 * - the rendered diff names a relative path and nothing else;
 * - approving everything reproduces `newContent` byte for byte;
 * - approving a subset leaves every unselected region untouched;
 * - a hunk whose context moved is refused, not force-applied.
 *
 * These are pure functions over strings: no temp directory, no filesystem and no
 * clock, so the result cannot vary between machines.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type Result } from "../../src/domain/markdown"
import {
  applyHunks,
  diffContent,
  renderDiff,
  splitLines,
  type Hunk,
  type HunkError,
} from "../../src/services/work/diff"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "diffs")

const BASE = readFileSync(join(FIXTURES, "base.txt"), "utf8")
const PROPOSED = readFileSync(join(FIXTURES, "proposed.txt"), "utf8")
const EXPECTED_1_3 = readFileSync(join(FIXTURES, "expected-hunks-1-3.txt"), "utf8")

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, HunkError>): HunkError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

function allIndices(hunks: readonly Hunk[]): number[] {
  return hunks.map((hunk) => hunk.index)
}

describe("hunk indices", () => {
  test("the fixture splits into the expected four hunks with stable indices", () => {
    const hunks = diffContent(BASE, PROPOSED)

    expect(hunks).toHaveLength(4)
    // Position is the index: 0..3, in file order, no gaps and no reuse.
    expect(hunks.map((hunk) => hunk.index)).toEqual([0, 1, 2, 3])
    expect(hunks.map((hunk) => hunk.oldStart)).toEqual([1, 7, 12, 17])
    // A one-line replacement has equal old/new ranges; nothing is shifted.
    for (const hunk of hunks) expect(hunk.oldCount).toBe(hunk.newCount)

    // The same inputs produce the same hunks, so an index shown before a
    // re-render still refers to the same edit.
    const again = diffContent(BASE, PROPOSED)
    expect(again).toEqual(hunks)
    expect(again.map((hunk) => hunk.index)).toEqual([0, 1, 2, 3])
  })

  test("separate edits stay separate; identical inputs produce no hunk", () => {
    expect(diffContent(BASE, BASE)).toEqual([])
    expect(diffContent("", "")).toEqual([])
    // A missing final newline is preserved rather than normalised away.
    const noNewline = diffContent("a\nb", "a\nb\n")
    expect(noNewline).toHaveLength(1)
    expect(unwrap(applyHunks("a\nb", noNewline, [0]))).toBe("a\nb\n")
  })
})

describe("approved content", () => {
  test("approve-all produces exactly newContent", () => {
    const hunks = diffContent(BASE, PROPOSED)
    const applied = unwrap(applyHunks(BASE, hunks, allIndices(hunks)))

    expect(applied).toBe(PROPOSED)
    expect(applied).not.toBe(BASE)
  })

  test("hunks 1 and 3 leave hunk 2's region byte-identical", () => {
    const hunks = diffContent(BASE, PROPOSED)
    const applied = unwrap(applyHunks(BASE, hunks, [1, 3]))

    // The fixture records the whole expected file, including the trailing byte.
    expect(applied).toBe(EXPECTED_1_3)

    const baseLines = splitLines(BASE)
    const nextLines = splitLines(applied)
    const untouched = hunks[2]
    const start = untouched.oldStart - 1
    const region = baseLines.slice(start, start + untouched.oldCount)

    expect(region).toContain("gamma: old value\n")
    expect(nextLines.slice(start, start + untouched.oldCount)).toEqual(region)
    // The selected hunks did move.
    expect(nextLines).toContain("beta: new value\n")
    expect(nextLines).toContain("delta: new value\n")
    expect(nextLines).toContain("alpha: old value\n")
  })
})

describe("stale hunks", () => {
  test("a selected hunk whose context moved is refused, not force-applied", () => {
    const hunks = diffContent(BASE, PROPOSED)
    // Edit a context line inside hunk 1's old range (lines 7–11).
    const changed = BASE.replace("stable 06\n", "stable 06 edited\n")
    expect(changed).not.toBe(BASE)

    const result = applyHunks(changed, hunks, [1])

    const error = errorOf(result)
    expect(error.kind).toBe("context")
    expect(error.index).toBe(1)
    expect(error.message).toContain("no longer matches")
  })

  test("an unselected stale hunk does not block the hunk that was approved", () => {
    const hunks = diffContent(BASE, PROPOSED)
    // Hunk 3's region moves; hunk 1 is untouched and still applies.
    const changed = BASE.replace("stable 14\n", "stable 14 edited\n")

    const applied = unwrap(applyHunks(changed, hunks, [1]))

    expect(applied).toContain("beta: new value\n")
    expect(applied).toContain("stable 14 edited\n")
    expect(applied).toContain("gamma: old value\n")
    expect(applied).not.toContain("gamma: new value\n")
  })

  test("an index that is not in the proposal is a typed refusal", () => {
    const hunks = diffContent(BASE, PROPOSED)
    const error = errorOf(applyHunks(BASE, hunks, [9]))

    expect(error.kind).toBe("hunk")
    expect(error.index).toBe(9)
  })
})

describe("renderDiff", () => {
  test("headers name the relative path and never an absolute one", () => {
    const hunks = diffContent(BASE, PROPOSED)
    const diff = renderDiff("notes/base.txt", hunks)
    const headers = diff.split("\n").slice(0, 2)

    expect(headers).toEqual(["--- a/notes/base.txt", "+++ b/notes/base.txt"])
    expect(diff).not.toContain(process.cwd())
    expect(diff).not.toContain("/home/")
    expect(diff.split("\n").some((line) => /^(---|\+\+\+) \//.test(line))).toBe(false)

    // One `@@` header per hunk, with the ranges `applyHunks` uses.
    const at = diff.split("\n").filter((line) => line.startsWith("@@"))
    expect(at).toEqual([
      "@@ -1,6 +1,6 @@",
      "@@ -7,5 +7,5 @@",
      "@@ -12,5 +12,5 @@",
      "@@ -17,4 +17,4 @@",
    ])
    // Body lines are prefixed exactly once, so the UI can style them.
    expect(diff).toContain("-alpha: old value\n+alpha: new value\n")
  })

  test("a rendered diff with no hunks is still a header-only value", () => {
    expect(renderDiff("notes/base.txt", [])).toBe("--- a/notes/base.txt\n+++ b/notes/base.txt\n")
  })
})

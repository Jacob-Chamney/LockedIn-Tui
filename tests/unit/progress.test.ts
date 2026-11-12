import { describe, expect, test } from "bun:test"

import {
  isProgressLine,
  mergeSteps,
  parseProgress,
  stepCounts,
  toggle,
  type ParsedProgress,
  type ProgressError,
  type ToggleResult,
} from "../../src/domain/progress"
import { type Result } from "../../src/domain/markdown"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, ProgressError>): ProgressError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

function toggled(raw: string, index: number): ToggleResult {
  return unwrap(toggle(raw, index))
}

const DOC = [
  "# Assignment steps",
  "",
  "> 1 of 4 steps done",
  "",
  "## Understand",
  "",
  "- [x] Read section 4.2 and summarise the boundary conditions",
  "- [ ] Derive the energy balance",
  "",
  "## Solve",
  "",
  "- [ ] Set up the equations",
  "- [ ] Check the units",
  "",
].join("\n")

/** Replace the progress line with a placeholder so diffs ignore its digits. */
function maskProgress(raw: string): string {
  return raw
    .split("\n")
    .map((line) => (isProgressLine(line) ? "> <progress>" : line))
    .join("\n")
}

function changedIndexes(a: string, b: string): number[] {
  const changed: number[] = []
  const length = Math.max(a.length, b.length)
  for (let at = 0; at < length; at++) {
    if (a[at] !== b[at]) changed.push(at)
  }
  return changed
}

describe("parseProgress", () => {
  test("finds task items with line numbers, markers and text", () => {
    const parsed = unwrap(parseProgress(DOC))
    expect(parsed.total).toBe(4)
    expect(parsed.checked).toBe(1)
    expect(parsed.progressLine).toBe(2)
    expect(parsed.items.map((item) => [item.index, item.line, item.checked])).toEqual([
      [0, 6, true],
      [1, 7, false],
      [2, 11, false],
      [3, 12, false],
    ])
    expect(parsed.items[0]?.text).toBe("Read section 4.2 and summarise the boundary conditions")
    expect(parsed.items[0]?.marker).toBe("-")
  })

  test("accepts *, + and uppercase X", () => {
    const parsed = unwrap(parseProgress("* [X] one\n+ [ ] two\n  - [x] three"))
    expect(parsed.items.map((item) => [item.marker, item.checked])).toEqual([
      ["*", true],
      ["+", false],
      ["-", true],
    ])
    expect(parsed.items[2]?.indent).toBe("  ")
  })

  test("does not treat ordered lists or plain bullets as steps", () => {
    const parsed = unwrap(parseProgress("1. [ ] ordered\n- plain bullet\n- [] no space"))
    expect(parsed.total).toBe(0)
  })

  test("a document without a progress line reports null", () => {
    expect(unwrap(parseProgress("- [ ] one")).progressLine).toBeNull()
    expect(unwrap(parseProgress("# Title\n\n- [ ] one")).progressLine).toBeNull()
  })

  test("a malformed progress line is a typed error", () => {
    const error = errorOf(parseProgress("> three of four steps done\n- [ ] one"))
    expect(error.kind).toBe("progress-malformed")
    if (error.kind !== "progress-malformed") return
    expect(error.line).toBe(0)
    expect(error.message).toContain("line 1")
  })

  test("two progress lines are ambiguous, not silently merged", () => {
    const error = errorOf(parseProgress("> 0 of 1 steps done\n- [ ] one\n> 1 of 2 steps done"))
    expect(error.kind).toBe("progress-ambiguous")
    if (error.kind !== "progress-ambiguous") return
    expect(error.lines).toEqual([0, 2])
  })

  test("stepCounts reports the same numbers as the parse", () => {
    expect(unwrap(stepCounts(DOC))).toEqual({ checked: 1, total: 4 })
    expect(errorOf(stepCounts("> ? of ? steps done")).kind).toBe("progress-malformed")
  })
})

describe("toggle — the one-character rule", () => {
  test("changes only the bracket and the progress counts", () => {
    const before = DOC
    const result = toggled(before, 1)
    const after = result.text

    expect(result.checked).toBe(true)
    expect(result.checkedCount).toBe(2)
    expect(result.total).toBe(4)

    // Outside the progress line the documents differ in exactly one character.
    const beforeMasked = maskProgress(before)
    const afterMasked = maskProgress(after)
    expect(beforeMasked.length).toBe(afterMasked.length)
    const changed = changedIndexes(beforeMasked, afterMasked)
    expect(changed).toHaveLength(1)
    // "- [ ] Derive": the bracket character sits at offset 3.
    expect(changed[0]).toBe(beforeMasked.indexOf("- [ ] Derive") + 3)
    expect(beforeMasked[changed[0]!]).toBe(" ")
    expect(afterMasked[changed[0]!]).toBe("x")

    // And the progress line is the only other change.
    expect(after.split("\n")[2]).toBe("> 2 of 4 steps done")
  })

  test("unchecking writes a space, never a different character", () => {
    const result = toggled(DOC, 0)
    expect(result.text).toContain("- [ ] Read section 4.2")
    expect(result.checkedCount).toBe(0)
    expect(result.text.split("\n")[2]).toBe("> 0 of 4 steps done")
  })

  test("is idempotent: toggling twice restores the original bytes", () => {
    for (const index of [0, 1, 2, 3]) {
      const once = toggled(DOC, index)
      const twice = toggled(once.text, index)
      expect(twice.text).toBe(DOC)
    }
  })

  test("hash matches the returned text and changes with the toggle", () => {
    const result = toggled(DOC, 1)
    expect(result.hash.startsWith("sha256:")).toBe(true)
    expect(result.hash).toBe(toggled(DOC, 1).hash)
    expect(result.hash).not.toBe(toggled(DOC, 2).hash)
  })

  test("a document with no progress line is toggled without inventing one", () => {
    const raw = "# Steps\n\n- [ ] one\n- [ ] two\n"
    const result = toggled(raw, 0)
    expect(result.progressLine).toBeNull()
    expect(result.text).toBe("# Steps\n\n- [x] one\n- [ ] two\n")
    expect(result.text.split("\n")).toHaveLength(raw.split("\n").length)
  })

  test("CRLF line endings survive untouched", () => {
    const raw = "# Steps\r\n\r\n> 0 of 2 steps done\r\n\r\n- [ ] one\r\n- [ ] two\r\n"
    const result = toggled(raw, 1)
    expect(result.text).toBe("# Steps\r\n\r\n> 1 of 2 steps done\r\n\r\n- [ ] one\r\n- [x] two\r\n")
    expect(toggled(result.text, 1).text).toBe(raw)
  })

  test("a missing trailing newline is preserved", () => {
    const raw = "> 0 of 1 steps done\n- [ ] one"
    expect(toggled(raw, 0).text).toBe("> 1 of 1 steps done\n- [x] one")
  })

  test("a stale progress count is corrected rather than trusted", () => {
    const raw = "> 7 of 2 steps done\n\n- [ ] one\n- [ ] two\n"
    expect(toggled(raw, 0).text).toBe("> 1 of 2 steps done\n\n- [x] one\n- [ ] two\n")
  })

  test("uppercase X becomes lowercase x when checked through", () => {
    const raw = "> 0 of 1 steps done\n* [X] one\n"
    const twice = toggled(toggled(raw, 0).text, 0)
    // Checked -> unchecked -> checked: the canonical marker is a lowercase x.
    expect(twice.text).toBe("> 1 of 1 steps done\n* [x] one\n")
  })

  test("indented steps keep their indentation", () => {
    const raw = "> 0 of 1 steps done\n  - [ ] nested\n"
    expect(toggled(raw, 0).text).toBe("> 1 of 1 steps done\n  - [x] nested\n")
  })

  test("an out-of-range index is a typed error on both ends", () => {
    const high = errorOf(toggle(DOC, 4))
    expect(high.kind).toBe("index-out-of-range")
    if (high.kind !== "index-out-of-range") return
    expect(high.total).toBe(4)
    expect(high.index).toBe(4)

    const low = errorOf(toggle(DOC, -1))
    expect(low.kind).toBe("index-out-of-range")

    const empty = errorOf(toggle("# nothing here\n", 0))
    expect(empty.kind).toBe("index-out-of-range")
    if (empty.kind !== "index-out-of-range") return
    expect(empty.message).toContain("0 steps")
  })

  test("malformed and ambiguous progress lines are refused before any write", () => {
    expect(errorOf(toggle("> nope steps done\n- [ ] a", 0)).kind).toBe("progress-malformed")
    expect(errorOf(toggle("> 0 of 1 steps done\n- [ ] a\n> 0 of 1 steps done", 0)).kind).toBe(
      "progress-ambiguous",
    )
  })
})

describe("mergeSteps — checked state follows exact text", () => {
  const oldDoc = [
    "# Steps",
    "",
    "> 2 of 3 steps done",
    "",
    "- [x] Read section 4.2",
    "- [ ] Derive the energy balance",
    "- [x] Set up the equations",
    "",
  ].join("\n")

  const freshDoc = [
    "# Steps",
    "",
    "> 0 of 4 steps done",
    "",
    "- [ ] Read section 4.2",
    "- [ ] Model the boundary layer",
    "- [ ] Derive the energy balance",
    "- [ ] Set up the equations",
    "",
  ].join("\n")

  test("keeps completed text, adds new steps unchecked, keeps fresh order", () => {
    const merged = unwrap(mergeSteps(oldDoc, freshDoc))
    expect(merged).toBe(
      [
        "# Steps",
        "",
        "> 2 of 4 steps done",
        "",
        "- [x] Read section 4.2",
        "- [ ] Model the boundary layer",
        "- [ ] Derive the energy balance",
        "- [x] Set up the equations",
        "",
      ].join("\n"),
    )
  })

  test("removed steps disappear and their state is not resurrected", () => {
    const merged = unwrap(mergeSteps(oldDoc, "> 0 of 1 steps done\n- [ ] Brand new\n"))
    expect(merged).toBe("> 0 of 1 steps done\n- [ ] Brand new\n")
  })

  test("an already-correct fresh document is returned unchanged", () => {
    const merged = unwrap(mergeSteps(oldDoc, oldDoc))
    expect(merged).toBe(oldDoc)
  })

  test("matching is by exact text, not by prefix or case", () => {
    const old = "> 1 of 2 steps done\n- [x] Read section\n- [ ] other\n"
    const fresh = "> 0 of 3 steps done\n- [ ] Read section 4.2\n- [ ] read section\n- [ ] Read section\n"
    const merged = unwrap(mergeSteps(old, fresh))
    expect(merged).toBe(
      "> 1 of 3 steps done\n- [ ] Read section 4.2\n- [ ] read section\n- [x] Read section\n",
    )
  })

  test("fresh documents without a progress line are merged without one", () => {
    const merged = unwrap(mergeSteps("> 1 of 1 steps done\n- [x] one\n", "- [ ] one\n"))
    expect(merged).toBe("- [x] one\n")
  })

  test("identical text on several steps shares state, as documented", () => {
    const old = "> 1 of 2 steps done\n- [x] Review\n- [ ] Review\n"
    const merged = unwrap(mergeSteps(old, "> 0 of 2 steps done\n- [ ] Review\n- [ ] Review\n"))
    expect(merged).toBe("> 2 of 2 steps done\n- [x] Review\n- [x] Review\n")
  })

  test("errors from either side propagate", () => {
    expect(errorOf(mergeSteps("> broken steps done", freshDoc)).kind).toBe("progress-malformed")
    expect(errorOf(mergeSteps(oldDoc, "> broken steps done")).kind).toBe("progress-malformed")
  })
})

describe("property: any document, one-character diff only", () => {
  // Deterministic PRNG: no Math.random, so a failure reproduces exactly.
  function rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function buildDocument(random: () => number): { text: string; checked: number; total: number } {
    const lines = ["# Assignment steps", ""]
    const steps: Array<{ checked: boolean; text: string }> = []
    const phases = ["Understand", "Solve", "Check"]
    const total = 1 + Math.floor(random() * 8)

    for (let at = 0; at < total; at++) {
      if (at === 0 || random() < 0.3) {
        lines.push(`## ${phases[Math.floor(random() * phases.length)]}`, "")
      }
      steps.push({
        checked: random() < 0.5,
        text: `Step ${at} ${random() < 0.5 ? "alpha" : "beta"} ${Math.floor(random() * 100)}`,
      })
    }

    const checked = steps.filter((step) => step.checked).length
    const marker = random() < 0.8 ? "-" : "*"
    lines.splice(2, 0, `> ${checked} of ${steps.length} steps done`, "")
    for (const step of steps) lines.push(`${marker} [${step.checked ? "x" : " "}] ${step.text}`)
    return { text: `${lines.join("\n")}\n`, checked, total: steps.length }
  }

  test("200 random documents: one bracket changes, counts stay true, toggle is a fixed point", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed)
      const { text, checked, total } = buildDocument(random)
      const index = Math.floor(random() * total)

      const result = toggled(text, index)
      expect(result.total).toBe(total)
      expect(result.checkedCount).toBe(checked + (result.checked ? 1 : -1))

      const before = maskProgress(text)
      const after = maskProgress(result.text)
      expect(after.length).toBe(before.length)
      const changed = changedIndexes(before, after)
      expect(changed).toHaveLength(1)
      expect(before[changed[0]!]).not.toBe(after[changed[0]!])
      expect([before[changed[0]!], after[changed[0]!]].sort()).toEqual([" ", "x"])

      // The progress line agrees with the items.
      const reparsed = unwrap(parseProgress(result.text))
      expect(reparsed.checked).toBe(result.checkedCount)
      const progress = result.text.split("\n")[result.progressLine!]!
      expect(progress).toContain(`${result.checkedCount} of ${total} steps done`)

      // Fixed point: toggling back restores the original bytes.
      expect(toggled(result.text, index).text).toBe(text)

      // Merging the document with itself changes nothing.
      expect(unwrap(mergeSteps(text, text))).toBe(text)
    }
  })

  test("merge then toggle keeps the same one-character property", () => {
    const random = rng(4242)
    const base = buildDocument(rng(7))
    const fresh = buildDocument(random)
    const merged = unwrap(mergeSteps(base.text, fresh.text))
    const parsed: ParsedProgress = unwrap(parseProgress(merged))
    expect(parsed.total).toBe(fresh.total)
    if (parsed.total === 0) return
    const once = toggled(merged, 0)
    expect(toggled(once.text, 0).text).toBe(merged)
  })
})

/** WP-403 — lesson rendering and validation rules, no filesystem. */

import { describe, expect, test } from "bun:test"

import { AGENT_EXPLANATION } from "../../src/domain/curriculum"
import { type Result } from "../../src/domain/markdown"
import {
  CITATION,
  GENERATED_END,
  GENERATED_START,
  citationsIn,
  isCitable,
  lessonFileName,
  renderGenerated,
  spliceGenerated,
  validateDocument,
  validateDraft,
  type Citation,
  type LessonDraft,
  type LessonError,
} from "../../src/services/skills/lesson"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, LessonError>): LessonError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const CITED = "[src: intel.md] Registers hold working state across calls."
const SOURCES: Citation[] = [
  { name: "intel.md", location: "sources/aa-intel.md", excerpt: "Registers hold working state." },
]

const DRAFT: LessonDraft = {
  exercise: [CITED],
  hints: [`${AGENT_EXPLANATION} Start with the prologue.`],
  checkpoint: [CITED],
}

describe("naming", () => {
  test("a lesson file is NN-<slug>.md from the stage position", () => {
    expect(lessonFileName(2, "Control flow")).toBe("02-control-flow.md")
    expect(lessonFileName(1, "Registers / memory")).toBe("01-registers-memory.md")
  })
})

describe("citations", () => {
  test("a claim is citable only with a citation or the label", () => {
    expect(isCitable(CITED)).toBe(true)
    expect(isCitable(`${AGENT_EXPLANATION} this is my reasoning`)).toBe(true)
    expect(isCitable("Registers hold state.")).toBe(false)
    expect(isCitable("   ")).toBe(false)
  })

  test("citation names are extracted", () => {
    expect(citationsIn("[src: a.md] x and [src: b.md] y")).toEqual(["a.md", "b.md"])
    expect(citationsIn("no citations")).toEqual([])
    expect(CITATION.test("[src: a.md]")).toBe(true)
  })

  test("a draft with a cited and a labelled claim validates", () => {
    expect(unwrap(validateDraft(DRAFT, { sources: SOURCES }))).toEqual(DRAFT)
  })

  test("an uncited claim fails with the section named", () => {
    const error = errorOf(
      validateDraft({ ...DRAFT, hints: ["Registers hold state."] }, { sources: SOURCES }),
    )
    expect(error.kind).toBe("validation")
    if (error.kind !== "validation") return
    expect(error.section).toBe("hints")
    expect(error.message).toContain(AGENT_EXPLANATION)
  })

  test("a citation to an unknown source fails", () => {
    const error = errorOf(
      validateDraft({ ...DRAFT, exercise: ["[src: ghost.md] a fact"] }, { sources: SOURCES }),
    )
    expect(error.kind).toBe("validation")
    if (error.kind !== "validation") return
    expect(error.message).toContain("ghost.md")
  })

  test("a citation to a source with no excerpt fails", () => {
    const error = errorOf(
      validateDraft({ ...DRAFT, exercise: ["[src: empty.md] a fact"] }, {
        sources: [{ name: "empty.md", location: "sources/x.md", excerpt: "   " }],
      }),
    )
    expect(error.kind).toBe("validation")
  })

  test("a solution is validated only when it is included", () => {
    const withBadSolution: LessonDraft = { ...DRAFT, solution: ["just the answer"] }
    expect(validateDraft(withBadSolution, { sources: SOURCES }).ok).toBe(true)
    expect(
      validateDraft(withBadSolution, { sources: SOURCES, includeSolution: true }).ok,
    ).toBe(false)
  })
})

describe("rendering", () => {
  test("order is exercise, hints, checkpoint and the markers wrap it", () => {
    const generated = renderGenerated(DRAFT)
    expect(generated.startsWith(GENERATED_START)).toBe(true)
    expect(generated.endsWith(GENERATED_END)).toBe(true)
    const at = (heading: string) => generated.indexOf(heading)
    expect(at("## Exercise")).toBeLessThan(at("## Hints"))
    expect(at("## Hints")).toBeLessThan(at("## Checkpoint"))
  })

  test("no solution by default; included only when asked", () => {
    expect(renderGenerated(DRAFT)).not.toContain("## Solution")
    const withSolution = renderGenerated(
      { ...DRAFT, solution: [CITED] },
      { includeSolution: true },
    )
    expect(withSolution.indexOf("## Solution")).toBeGreaterThan(withSolution.indexOf("## Checkpoint"))
  })

  test("a document with a solution first is rejected", () => {
    const body = "## Solution\n\nanswer\n\n## Exercise\n\nwork\n"
    const error = errorOf(validateDocument(body, SOURCES))
    expect(error.kind).toBe("validation")
    if (error.kind !== "validation") return
    expect(error.section).toBe("solution")
    expect(error.message).toContain("may not appear before the exercise")
  })

  test("a document with no exercise is rejected", () => {
    expect(errorOf(validateDocument("## Checkpoint\n\n- [ ] x\n", SOURCES)).kind).toBe("validation")
  })

  test("a well-ordered document passes", () => {
    const body = "## Exercise\n\nx\n\n## Hints\n\ny\n\n## Checkpoint\n\nz\n\n## Solution\n\nanswer\n"
    expect(validateDocument(body, SOURCES).ok).toBe(true)
  })

  test("a document citing a source that is not in the goal is rejected", () => {
    const body = "## Exercise\n\n[src: nowhere] a claim\n"
    const error = errorOf(validateDocument(body, SOURCES))
    expect(error.kind).toBe("validation")
    if (error.kind !== "validation") return
    expect(error.message).toContain("nowhere")
  })
})

describe("splicing a rebuild", () => {
  test("only the generated block is replaced", () => {
    const existing = `---\nstage: stage-2\nstatus: ready\n---\n\n# Control flow\n\nMy own note first.\n\n${GENERATED_START}\nold\n${GENERATED_END}\n\nMy own note after.\n`
    const spliced = spliceGenerated(existing, `${GENERATED_START}\nnew\n${GENERATED_END}`)
    expect(spliced).toContain("My own note first.")
    expect(spliced).toContain("My own note after.")
    expect(spliced).toContain("new")
    expect(spliced).not.toContain("old")
  })

  test("a document without markers keeps its body and gains the block", () => {
    const spliced = spliceGenerated("# Control flow\n\nHand written.\n", `${GENERATED_START}\nx\n${GENERATED_END}`)
    expect(spliced).toContain("Hand written.")
    expect(spliced).toContain(GENERATED_START)
  })
})

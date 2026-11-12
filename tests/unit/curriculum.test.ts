import { describe, expect, test } from "bun:test"

import {
  AGENT_EXPLANATION,
  SECTION_ORDER,
  activateStage,
  activeStage,
  canMarkReady,
  checkpointTexts,
  citedSourceIds,
  completeStage,
  countActive,
  curriculumProgress,
  lessonProgress,
  mergeCheckpoints,
  nextPendingStage,
  reopenStage,
  uncitedSources,
  validateCurriculum,
  validateLesson,
  type CurriculumError,
  type CurriculumStage,
  type Lesson,
  type LessonBlock,
} from "../../src/domain/curriculum"
import { type Result } from "../../src/domain/markdown"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, CurriculumError>): CurriculumError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const STAGES: CurriculumStage[] = [
  { id: "stage-1", title: "Registers and memory", milestone: "Explain a stack frame", status: "active" },
  { id: "stage-2", title: "Control flow", milestone: "Trace a loop", status: "pending" },
  { id: "stage-3", title: "Calling conventions", milestone: "Read a prologue", status: "pending" },
]

function block(text: string, overrides: Partial<LessonBlock> = {}): LessonBlock {
  return { text, sourceId: null, claim: false, ...overrides }
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "lesson-1",
    stageId: "stage-1",
    title: "Registers",
    status: "draft",
    sources: [
      {
        id: "src-1",
        name: "Intel SDM §3.4",
        location: "p. 12",
        excerpt: "Registers hold working state.",
      },
    ],
    sections: [
      {
        kind: "exercise",
        blocks: [
          block("Registers hold working state.", { sourceId: "src-1", claim: true }),
          block("Trace the frame by hand."),
        ],
      },
      { kind: "checkpoint", blocks: [block("Explain a stack frame")] },
    ],
    ...overrides,
  }
}

describe("curriculum stages", () => {
  test("validate accepts a well-formed curriculum and returns a fresh array", () => {
    const valid = unwrap(validateCurriculum(STAGES))
    expect(valid).toEqual(STAGES)
    expect(valid).not.toBe(STAGES)
  })

  test("duplicate stage ids are rejected by id", () => {
    const error = errorOf(
      validateCurriculum([...STAGES, { ...STAGES[0]!, title: "again" }]),
    )
    expect(error.kind).toBe("duplicate-stage")
    if (error.kind !== "duplicate-stage") return
    expect(error.id).toBe("stage-1")
  })

  test("an empty stage id is rejected", () => {
    const error = errorOf(validateCurriculum([{ ...STAGES[0]!, id: "  " }]))
    expect(error.kind).toBe("lesson-invalid")
  })

  test("two active stages is a rejected state", () => {
    const error = errorOf(
      validateCurriculum([
        { ...STAGES[0]!, status: "active" },
        { ...STAGES[1]!, status: "active" },
      ]),
    )
    expect(error.kind).toBe("lesson-invalid")
    if (error.kind !== "lesson-invalid") return
    expect(error.field).toBe("stage.status")
  })

  test("an empty curriculum and an all-done curriculum both validate", () => {
    expect(unwrap(validateCurriculum([]))).toEqual([])
    const allDone = STAGES.map((stage) => ({ ...stage, status: "done" as const }))
    expect(unwrap(validateCurriculum(allDone))).toEqual(allDone)
  })

  test("helpers find the active and next pending stage", () => {
    expect(activeStage(STAGES)?.id).toBe("stage-1")
    expect(nextPendingStage(STAGES)?.id).toBe("stage-2")
    expect(activeStage([])).toBeNull()
    expect(nextPendingStage([])).toBeNull()
    expect(countActive(STAGES)).toBe(1)
  })
})

describe("stage transitions keep one active stage", () => {
  test("activating a pending stage demotes the previous active one", () => {
    const next = unwrap(activateStage(STAGES, "stage-2"))
    expect(countActive(next)).toBe(1)
    expect(activeStage(next)?.id).toBe("stage-2")
    expect(next.find((stage) => stage.id === "stage-1")?.status).toBe("pending")
  })

  test("activating the current active stage is a no-op", () => {
    expect(unwrap(activateStage(STAGES, "stage-1"))).toEqual(STAGES)
  })

  test("a done stage cannot be activated without an explicit reopen", () => {
    const done = unwrap(completeStage(STAGES, "stage-1"))
    const error = errorOf(activateStage(done, "stage-1"))
    expect(error.kind).toBe("lesson-invalid")
    expect(unwrap(reopenStage(done, "stage-1")).find((s) => s.id === "stage-1")?.status).toBe(
      "active",
    )
  })

  test("an unknown stage id is a typed error, not a silent no-op", () => {
    for (const call of [activateStage, completeStage, reopenStage]) {
      const error = errorOf(call(STAGES, "stage-404"))
      expect(error.kind).toBe("unknown-stage")
      if (error.kind !== "unknown-stage") return
      expect(error.id).toBe("stage-404")
    }
  })

  test("completing the active stage promotes the next pending stage", () => {
    const next = unwrap(completeStage(STAGES, "stage-1"))
    expect(next.find((stage) => stage.id === "stage-1")?.status).toBe("done")
    expect(activeStage(next)?.id).toBe("stage-2")
  })

  test("completing the last stage leaves nothing active", () => {
    let stages = unwrap(completeStage(STAGES, "stage-1"))
    stages = unwrap(completeStage(stages, "stage-2"))
    stages = unwrap(completeStage(stages, "stage-3"))
    expect(countActive(stages)).toBe(0)
    expect(stages.every((stage) => stage.status === "done")).toBe(true)
    expect(unwrap(validateCurriculum(stages))).toEqual(stages)
  })

  test("completing a pending stage does not disturb the active one", () => {
    const next = unwrap(completeStage(STAGES, "stage-3"))
    expect(activeStage(next)?.id).toBe("stage-1")
    expect(next.find((stage) => stage.id === "stage-3")?.status).toBe("done")
  })

  test("transitions never mutate the input", () => {
    const snapshot = JSON.parse(JSON.stringify(STAGES)) as CurriculumStage[]
    unwrap(completeStage(STAGES, "stage-1"))
    unwrap(activateStage(STAGES, "stage-2"))
    unwrap(reopenStage(STAGES, "stage-1"))
    expect(STAGES).toEqual(snapshot)
  })

  test("progress counts done stages", () => {
    expect(curriculumProgress(STAGES)).toEqual({ done: 0, total: 3, ratio: 0 })
    const one = unwrap(completeStage(STAGES, "stage-1"))
    expect(curriculumProgress(one)).toEqual({ done: 1, total: 3, ratio: 1 / 3 })
    expect(curriculumProgress([])).toEqual({ done: 0, total: 0, ratio: 0 })
  })

  test("property: no sequence of transitions produces two active stages", () => {
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

    for (let seed = 1; seed <= 100; seed++) {
      const random = rng(seed)
      let stages: CurriculumStage[] = STAGES.map((stage) => ({
        ...stage,
        status: "pending" as const,
      }))
      const ids = stages.map((stage) => stage.id)

      for (let step = 0; step < 12; step++) {
        const id = ids[Math.floor(random() * ids.length)]!
        const choice = Math.floor(random() * 3)
        const applied =
          choice === 0
            ? activateStage(stages, id)
            : choice === 1
              ? completeStage(stages, id)
              : reopenStage(stages, id)
        if (!applied.ok) continue
        stages = applied.value

        expect(countActive(stages)).toBeLessThanOrEqual(1)
        expect(unwrap(validateCurriculum(stages))).toEqual(stages)

        const unfinished = stages.filter((stage) => stage.status !== "done")
        if (unfinished.length > 0) expect(countActive(stages)).toBe(1)
        else expect(countActive(stages)).toBe(0)
      }
    }
  })
})

describe("lesson citations", () => {
  test("a cited claim passes and the lesson is returned", () => {
    expect(unwrap(validateLesson(lesson(), STAGES))).toEqual(lesson())
  })

  test("an unsourced claim must carry the agent-explanation label", () => {
    const bad = lesson({
      sections: [
        {
          kind: "exercise",
          blocks: [block("Registers are 64 bits wide.", { claim: true })],
        },
      ],
    })
    const error = errorOf(validateLesson(bad, STAGES))
    expect(error.kind).toBe("citation")
    if (error.kind !== "citation") return
    expect(error.section).toBe(0)
    expect(error.block).toBe(0)
    expect(error.message).toContain(AGENT_EXPLANATION)
  })

  test("the label makes the same claim acceptable", () => {
    const labelled = lesson({
      sections: [
        {
          kind: "exercise",
          blocks: [
            block(`Registers are 64 bits wide. ${AGENT_EXPLANATION}`, { claim: true }),
          ],
        },
      ],
    })
    expect(unwrap(validateLesson(labelled, STAGES))).toEqual(labelled)
  })

  test("a claim citing an undeclared source is rejected", () => {
    const bad = lesson({
      sections: [
        {
          kind: "exercise",
          blocks: [block("A fact.", { sourceId: "src-404", claim: true })],
        },
      ],
    })
    const error = errorOf(validateLesson(bad, STAGES))
    expect(error.kind).toBe("citation")
    if (error.kind !== "citation") return
    expect(error.message).toContain("src-404")
  })

  test("non-claim prose needs no citation", () => {
    const prose = lesson({
      sections: [{ kind: "hint", blocks: [block("Try drawing the stack first.")] }],
    })
    expect(unwrap(validateLesson(prose, STAGES))).toEqual(prose)
  })

  test("a source without a saved excerpt is rejected: a citation must be checkable", () => {
    const bad = lesson({
      sources: [{ id: "src-1", name: "Intel SDM", location: "p. 12", excerpt: "  " }],
    })
    const error = errorOf(validateLesson(bad, STAGES))
    expect(error.kind).toBe("lesson-invalid")
    if (error.kind !== "lesson-invalid") return
    expect(error.field).toBe("lesson.sources")
  })

  test("a source without an id is rejected", () => {
    const bad = lesson({ sources: [{ id: "", name: "x", location: "y", excerpt: "z" }] })
    expect(errorOf(validateLesson(bad, STAGES)).kind).toBe("lesson-invalid")
  })

  test("cited and uncited sources are reported", () => {
    const extra = lesson({
      sources: [
        { id: "src-1", name: "Intel SDM", location: "p. 12", excerpt: "Registers hold state." },
        { id: "src-2", name: "Unused", location: "p. 99", excerpt: "Never cited." },
      ],
    })
    expect(citedSourceIds(extra)).toEqual(["src-1"])
    expect(uncitedSources(extra).map((source) => source.id)).toEqual(["src-2"])
  })
})

describe("lesson ordering", () => {
  test("solution before exercise is rejected", () => {
    const bad = lesson({
      sections: [
        { kind: "solution", blocks: [block("Here is the answer.")] },
        { kind: "exercise", blocks: [block("Do the thing.")] },
      ],
    })
    const error = errorOf(validateLesson(bad, STAGES))
    expect(error.kind).toBe("ordering")
    if (error.kind !== "ordering") return
    expect(error.section).toBe(0)
  })

  test("solution between teaching sections is rejected", () => {
    const bad = lesson({
      sections: [
        { kind: "exercise", blocks: [block("Do the thing.")] },
        { kind: "solution", blocks: [block("Answer.")] },
        { kind: "checkpoint", blocks: [block("Explain it")] },
      ],
    })
    expect(errorOf(validateLesson(bad, STAGES)).kind).toBe("ordering")
  })

  test("solution after every teaching section is fine", () => {
    const good = lesson({
      sections: [
        { kind: "exercise", blocks: [block("Do the thing.")] },
        { kind: "hint", blocks: [block("Look at the prologue.")] },
        { kind: "checkpoint", blocks: [block("Explain it")] },
        { kind: "solution", blocks: [block("Answer.")] },
      ],
    })
    expect(unwrap(validateLesson(good, STAGES))).toEqual(good)
  })

  test("a lesson with only a solution is fine: nothing precedes it", () => {
    const only = lesson({ sections: [{ kind: "solution", blocks: [block("Answer.")] }] })
    expect(unwrap(validateLesson(only, STAGES))).toEqual(only)
  })

  test("the documented section order is exercise, hint, checkpoint, solution", () => {
    expect(SECTION_ORDER).toEqual(["exercise", "hint", "checkpoint", "solution"])
  })
})

describe("lesson stage binding", () => {
  test("a lesson without a stage is rejected", () => {
    const error = errorOf(validateLesson(lesson({ stageId: "  " }), STAGES))
    expect(error.kind).toBe("lesson-without-stage")
  })

  test("a lesson pointing at an unknown stage is rejected", () => {
    const error = errorOf(validateLesson(lesson({ stageId: "stage-99" }), STAGES))
    expect(error.kind).toBe("unknown-stage")
    if (error.kind !== "unknown-stage") return
    expect(error.id).toBe("stage-99")
  })
})

describe("checkpoint progress and merge by exact text", () => {
  const built = lesson({
    sections: [
      { kind: "exercise", blocks: [block("Do the thing.")] },
      {
        kind: "checkpoint",
        blocks: [block("Explain a stack frame"), block("Trace a loop")],
      },
    ],
  })

  test("checkpoint texts are read in document order", () => {
    expect(checkpointTexts(built)).toEqual(["Explain a stack frame", "Trace a loop"])
  })

  test("progress counts completed checkpoints by text", () => {
    expect(lessonProgress(built, [])).toEqual({ checked: 0, total: 2, ratio: 0 })
    expect(lessonProgress(built, ["Trace a loop"])).toEqual({
      checked: 1,
      total: 2,
      ratio: 0.5,
    })
    expect(lessonProgress(built, ["Explain a stack frame", "Trace a loop", "stale"])).toEqual({
      checked: 2,
      total: 2,
      ratio: 1,
    })
    expect(lessonProgress(lesson({ sections: [] }), [])).toEqual({
      checked: 0,
      total: 0,
      ratio: 0,
    })
  })

  test("rebuilt checkpoints that still exist keep their state", () => {
    const rebuilt = lesson({
      sections: [
        { kind: "exercise", blocks: [block("Do the thing.")] },
        {
          kind: "checkpoint",
          blocks: [block("Explain a stack frame"), block("Trace a loop"), block("Name the registers")],
        },
      ],
    })
    const merged = mergeCheckpoints(["Explain a stack frame"], rebuilt)
    expect(merged.checked).toEqual(["Explain a stack frame"])
    expect(merged.dropped).toEqual([])
    expect(lessonProgress(rebuilt, merged.checked)).toEqual({
      checked: 1,
      total: 3,
      ratio: 1 / 3,
    })
  })

  test("a removed checkpoint is dropped, not silently kept", () => {
    const merged = mergeCheckpoints(["Explain a stack frame", "Old checkpoint"], built)
    expect(merged.checked).toEqual(["Explain a stack frame"])
    expect(merged.dropped).toEqual(["Old checkpoint"])
  })

  test("merge matches exact text only", () => {
    const merged = mergeCheckpoints(["explain a stack frame"], built)
    expect(merged.checked).toEqual([])
    expect(merged.dropped).toEqual(["explain a stack frame"])
  })

  test("merge is idempotent", () => {
    const once = mergeCheckpoints(["Explain a stack frame", "Trace a loop"], built)
    const twice = mergeCheckpoints(once.checked, built)
    expect(twice.checked).toEqual(once.checked)
    expect(twice.dropped).toEqual([])

    const third = mergeCheckpoints(twice.checked, built)
    expect(third).toEqual(twice)
  })

  test("duplicate texts in the input collapse to one entry", () => {
    const merged = mergeCheckpoints(["Trace a loop", "Trace a loop"], built)
    expect(merged.checked).toEqual(["Trace a loop"])
  })

  test("merge does not mutate the lesson or the checked list", () => {
    const snapshot = JSON.parse(JSON.stringify(built)) as Lesson
    const checked = ["Explain a stack frame"]
    mergeCheckpoints(checked, built)
    expect(built).toEqual(snapshot)
    expect(checked).toEqual(["Explain a stack frame"])
  })
})

describe("marking a lesson ready", () => {
  test("a valid lesson with a checkpoint becomes ready", () => {
    const ready = unwrap(canMarkReady(lesson(), STAGES))
    expect(ready.status).toBe("ready")
    expect(lesson().status).toBe("draft")
  })

  test("a lesson with no checkpoint cannot be ready", () => {
    const empty = lesson({ sections: [{ kind: "exercise", blocks: [block("Do it")] }] })
    const error = errorOf(canMarkReady(empty, STAGES))
    expect(error.kind).toBe("lesson-invalid")
    if (error.kind !== "lesson-invalid") return
    expect(error.message).toContain("checkpoint")
  })

  test("trust-rule failures block readiness", () => {
    const bad = lesson({
      sections: [
        {
          kind: "exercise",
          blocks: [block("Uncited fact.", { claim: true }), block("Explain a stack frame")],
        },
      ],
    })
    expect(errorOf(canMarkReady(bad, STAGES)).kind).toBe("citation")
  })
})

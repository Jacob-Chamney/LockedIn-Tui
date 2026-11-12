/** WP-404 — progress is derived from status, never a second source of truth. */

import { describe, expect, test } from "bun:test"

import {
  completeStage,
  curriculumProgress,
  reopenStage,
  type CurriculumStage,
} from "../../src/domain/curriculum"
import { isComplete, progressFromStages } from "../../src/services/skills/progress"

const STAGES: CurriculumStage[] = [
  { id: "stage-1", title: "Registers", milestone: "m1", status: "active" },
  { id: "stage-2", title: "Control flow", milestone: "m2", status: "pending" },
  { id: "stage-3", title: "Conventions", milestone: "m3", status: "pending" },
]

function activeCount(stages: readonly CurriculumStage[]): number {
  return stages.filter((stage) => stage.status === "active").length
}

describe("progress map", () => {
  test("is derived from status, one entry per stage", () => {
    expect(progressFromStages(STAGES)).toEqual({
      "stage-1": false,
      "stage-2": false,
      "stage-3": false,
    })
    const done = completeStage(STAGES, "stage-1")
    if (!done.ok) throw new Error("expected ok")
    expect(progressFromStages(done.value)).toEqual({
      "stage-1": true,
      "stage-2": false,
      "stage-3": false,
    })
  })

  test("the map always agrees with the statuses after any transition", () => {
    let stages = STAGES
    const sequence: Array<"done" | "reopen"> = ["done", "done", "reopen", "done", "done"]

    for (const action of sequence) {
      const active = stages.find((stage) => stage.status === "active")
      const target = action === "done" ? (active ?? stages[0]!) : stages[1]!
      const next = action === "done" ? completeStage(stages, target.id) : reopenStage(stages, target.id)
      if (!next.ok) continue
      stages = next.value

      const map = progressFromStages(stages)
      for (const stage of stages) expect(map[stage.id]).toBe(stage.status === "done")
      expect(activeCount(stages)).toBeLessThanOrEqual(1)
    }
  })

  test("the goal is complete only when every stage is done", () => {
    expect(isComplete(STAGES)).toBe(false)
    expect(isComplete([])).toBe(false)
    expect(isComplete(STAGES.map((stage) => ({ ...stage, status: "done" as const })))).toBe(true)
  })
})

describe("the transition table", () => {
  test("completing stage 1 promotes stage 2 and leaves one active", () => {
    const next = completeStage(STAGES, "stage-1")
    if (!next.ok) throw new Error("expected ok")
    expect(next.value.map((stage) => stage.status)).toEqual(["done", "active", "pending"])
    expect(activeCount(next.value)).toBe(1)
  })

  test("completing the last stage leaves zero active and the goal complete", () => {
    let stages = STAGES
    for (const id of ["stage-1", "stage-2", "stage-3"]) {
      const next = completeStage(stages, id)
      if (!next.ok) throw new Error("expected ok")
      stages = next.value
      expect(activeCount(stages)).toBe(stages.every((stage) => stage.status === "done") ? 0 : 1)
    }
    expect(isComplete(stages)).toBe(true)
    expect(curriculumProgress(stages)).toEqual({ done: 3, total: 3, ratio: 1 })
  })

  test("reopening stage 2 demotes stage 3: exactly one active remains", () => {
    const first = completeStage(STAGES, "stage-1")
    if (!first.ok) throw new Error("expected ok")
    const done = completeStage(first.value, "stage-2")
    if (!done.ok) throw new Error("expected ok")
    expect(done.value.map((stage) => stage.status)).toEqual(["done", "done", "active"])

    const reopened = reopenStage(done.value, "stage-2")
    if (!reopened.ok) throw new Error("expected ok")
    expect(reopened.value.map((stage) => stage.status)).toEqual(["done", "active", "pending"])
    expect(activeCount(reopened.value)).toBe(1)
  })

  test("every intermediate state in an 8-step walk keeps at most one active stage", () => {
    let stages = STAGES
    const actions = ["done", "done", "reopen", "done", "reopen", "done", "done", "reopen"] as const
    for (const action of actions) {
      const target =
        action === "done"
          ? (stages.find((stage) => stage.status === "active") ?? stages[0]!).id
          : "stage-2"
      const next = action === "done" ? completeStage(stages, target) : reopenStage(stages, target)
      if (!next.ok) continue
      stages = next.value
      expect(activeCount(stages)).toBeLessThanOrEqual(1)
      const unfinished = stages.filter((stage) => stage.status !== "done")
      if (unfinished.length > 0) expect(activeCount(stages)).toBe(1)
    }
  })
})

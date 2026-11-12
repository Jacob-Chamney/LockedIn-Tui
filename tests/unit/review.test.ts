import { describe, expect, test } from "bun:test"

import { computeCoverage, type CoverageReport } from "../../src/domain/coverage"
import {
  DEFAULT_INTENSITY,
  KIND_PRIORITY,
  MEMORY_LABEL,
  NUDGE_THRESHOLDS,
  buildReviewQueue,
  isDue,
  withMisses,
  type FlashcardState,
  type LockInStepSnapshot,
  type MemoryHit,
  type NudgeIntensity,
  type ReviewInput,
  type ReviewQueue,
  type SkillStageState,
} from "../../src/domain/review"

const HASH_A = `sha256:${"a".repeat(64)}`

const STEPS: LockInStepSnapshot = {
  sessionId: "2026-11-01-1430-physics",
  sessionName: "Physics — Unit 4",
  steps: [
    { index: 0, text: "Read section 4.2", checked: true },
    { index: 1, text: "Derive the energy balance", checked: false },
    { index: 2, text: "Set up the equations", checked: false, misses: 3 },
  ],
}

const DECK: FlashcardState = {
  deckId: "deck-physics",
  deckName: "Physics deck",
  cards: [
    { id: "c1", question: "What does the learning rate control?", missed: true, known: false, misses: 2 },
    { id: "c2", question: "What is a batch?", missed: false, known: true },
    { id: "c3", question: "Never reviewed", missed: false, known: false },
  ],
}

const GOAL: SkillStageState = {
  goalId: "assembly-basics",
  goalName: "Assembly basics",
  stages: [
    { id: "s1", title: "Registers and memory", status: "done" },
    { id: "s2", title: "Control flow", status: "active" },
    { id: "s3", title: "Calling conventions", status: "pending" },
  ],
}

const MEMORY: MemoryHit = {
  sessionId: "2026-11-01-1430-physics",
  sessionName: "Physics — Unit 4",
  noteId: "memory",
  excerpt: "Boundary conditions determine the integral limits.",
}

const COVERAGE: CoverageReport = computeCoverage(
  [
    { name: "lecture-4.md", originalPath: "/input/lecture-4.md", hash: HASH_A },
    { name: "unused.pdf", originalPath: "/input/unused.pdf", hash: `sha256:${"b".repeat(64)}` },
  ],
  [{ kind: "steps", text: "Read lecture-4.md" }],
)

function fullInput(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    steps: [STEPS],
    decks: [DECK],
    goals: [GOAL],
    memory: [MEMORY],
    coverage: COVERAGE,
    ...overrides,
  }
}

function kinds(queue: ReviewQueue): string[] {
  return queue.items.map((item) => item.kind)
}

describe("review queue — composition", () => {
  test("collects the four documented kinds", () => {
    const queue = buildReviewQueue(fullInput())
    expect(kinds(queue)).toEqual(["card", "step", "step", "stage", "stage", "memory"])
    expect(queue.counts).toEqual({
      total: 6,
      byKind: { card: 1, step: 2, stage: 2, memory: 1 },
    })
  })

  test("each item carries id, label, context, reason, priority and origin", () => {
    const queue = buildReviewQueue(fullInput())
    const card = queue.items[0]!
    expect(card).toEqual({
      id: "card:deck-physics:c1",
      kind: "card",
      label: "What does the learning rate control?",
      context: "Physics deck",
      contextId: "deck-physics",
      reason: "missed",
      priority: KIND_PRIORITY.card,
      count: 2,
      origin: "flashcards",
    })
    expect(queue.items.find((item) => item.kind === "step")?.reason).toBe("unchecked")
    expect(queue.items.find((item) => item.kind === "stage")?.reason).toBe("unfinished")
    expect(queue.items.find((item) => item.kind === "memory")?.reason).toBe("memory")
  })

  test("an empty queue is valid", () => {
    const queue = buildReviewQueue({})
    expect(queue.items).toEqual([])
    expect(queue.nudge.due).toEqual([])
    expect(queue.nudge.suggestions).toEqual([])
    expect(queue.coverage).toEqual([])
    expect(queue.counts).toEqual({
      total: 0,
      byKind: { step: 0, card: 0, stage: 0, memory: 0 },
    })
  })

  test("an input with only completed work is an empty queue", () => {
    const queue = buildReviewQueue({
      steps: [{ sessionId: "s", sessionName: "S", steps: [{ index: 0, text: "done", checked: true }] }],
      decks: [
        { deckId: "d", deckName: "D", cards: [{ id: "c", question: "q", missed: false, known: true }] },
      ],
      goals: [{ goalId: "g", goalName: "G", stages: [{ id: "s1", title: "t", status: "done" }] }],
    })
    expect(queue.items).toEqual([])
  })
})

describe("review queue — ordering and identity", () => {
  test("orders cards, steps, stages, then memory", () => {
    const queue = buildReviewQueue(fullInput())
    expect(queue.items.map((item) => item.priority)).toEqual([0, 1, 1, 2, 2, 3])
  })

  test("ties break by context name, then context id, then item id", () => {
    const queue = buildReviewQueue({
      steps: [
        {
          sessionId: "b-session",
          sessionName: "Beta",
          steps: [{ index: 0, text: "beta step", checked: false }],
        },
        {
          sessionId: "a-session",
          sessionName: "alpha",
          steps: [
            { index: 1, text: "alpha second", checked: false },
            { index: 0, text: "alpha first", checked: false },
          ],
        },
      ],
    })
    expect(queue.items.map((item) => item.id)).toEqual([
      "step:a-session:0",
      "step:a-session:1",
      "step:b-session:0",
    ])
  })

  test("the same input always produces the same order", () => {
    const first = buildReviewQueue(fullInput())
    const second = buildReviewQueue(fullInput())
    expect(second).toEqual(first)
  })

  test("input order does not leak into the result", () => {
    const forwards = buildReviewQueue(fullInput())
    const backwards = buildReviewQueue({
      steps: [STEPS],
      decks: [DECK],
      goals: [GOAL],
      memory: [MEMORY],
      coverage: COVERAGE,
    })
    expect(backwards.items.map((item) => item.id)).toEqual(forwards.items.map((item) => item.id))
  })

  test("duplicate ids are collapsed, keeping the first", () => {
    const queue = buildReviewQueue({
      memory: [MEMORY, { ...MEMORY, excerpt: "duplicate note" }],
      decks: [{ ...DECK, cards: [DECK.cards[0]!, DECK.cards[0]!] }],
    })
    expect(queue.items.map((item) => item.id)).toEqual([
      "card:deck-physics:c1",
      "memory:2026-11-01-1430-physics:memory",
    ])
    expect(queue.items[1]?.label).toBe("Boundary conditions determine the integral limits.")
  })
})

describe("review queue — exclusions", () => {
  test("checked steps are excluded", () => {
    const queue = buildReviewQueue({ steps: [STEPS] })
    expect(queue.items.map((item) => item.label)).not.toContain("Read section 4.2")
  })

  test("known cards are excluded even when marked missed", () => {
    const queue = buildReviewQueue({
      decks: [
        {
          deckId: "d",
          deckName: "D",
          cards: [{ id: "c", question: "q", missed: true, known: true }],
        },
      ],
    })
    expect(queue.items).toEqual([])
  })

  test("an unmarked card is not a review item", () => {
    const queue = buildReviewQueue({ decks: [DECK] })
    expect(queue.items.map((item) => item.id)).not.toContain("card:deck-physics:c3")
  })

  test("done stages are excluded, active and pending are not", () => {
    const queue = buildReviewQueue({ goals: [GOAL] })
    expect(queue.items.map((item) => item.id)).toEqual([
      "stage:assembly-basics:s2",
      "stage:assembly-basics:s3",
    ])
  })
})

describe("nudges — thresholds", () => {
  function queueWithStepMisses(misses: number): ReviewQueue {
    return buildReviewQueue({
      steps: [
        {
          sessionId: "s",
          sessionName: "S",
          steps: [{ index: 0, text: "hard step", checked: false, misses }],
        },
      ],
    })
  }

  test("intensity maps to the documented thresholds", () => {
    expect(NUDGE_THRESHOLDS).toEqual({ gentle: 5, balanced: 3, intensive: 2 })
    expect(DEFAULT_INTENSITY).toBe("balanced")
  })

  test("0, 1, threshold-1, threshold and threshold+1 behave as documented", () => {
    const cases: Array<[NudgeIntensity, number, boolean]> = [
      ["balanced", 0, false],
      ["balanced", 1, false],
      ["balanced", 2, false],
      ["balanced", 3, true],
      ["balanced", 4, true],
      ["gentle", 4, false],
      ["gentle", 5, true],
      ["gentle", 6, true],
      ["intensive", 1, false],
      ["intensive", 2, true],
      ["intensive", 3, true],
    ]
    for (const [intensity, misses, expected] of cases) {
      const queue = buildReviewQueue({
        steps: [
          {
            sessionId: "s",
            sessionName: "S",
            steps: [{ index: 0, text: "hard step", checked: false, misses }],
          },
        ],
        intensity,
      })
      expect(queue.nudge.threshold).toBe(NUDGE_THRESHOLDS[intensity])
      expect(queue.nudge.due).toHaveLength(expected ? 1 : 0)
      expect(queue.nudge.suggestions).toHaveLength(expected ? 1 : 0)
      expect(isDue(queue.items[0]!, intensity)).toBe(expected)
    }
  })

  test("below the threshold the item stays in the queue but is not due", () => {
    const queue = queueWithStepMisses(1)
    expect(queue.items).toHaveLength(1)
    expect(queue.nudge.due).toEqual([])
  })

  test("crossing the threshold offers a suggestion with the copy and the count", () => {
    const queue = queueWithStepMisses(3)
    expect(queue.nudge.due).toEqual(["step:s:0"])
    expect(queue.nudge.suggestions[0]).toEqual({
      itemId: "step:s:0",
      label: "hard step",
      context: "S",
      count: 3,
      threshold: 3,
      message: '"hard step" has been missed 3 times (threshold 3). Review it next?',
    })
  })

  test("a nudge is a suggestion: nothing is marked, removed or reordered", () => {
    const quiet = buildReviewQueue({ decks: [DECK], steps: [STEPS] })
    const loud = buildReviewQueue({
      decks: [
        {
          ...DECK,
          cards: [
            { id: "c1", question: "What does the learning rate control?", missed: true, known: false, misses: 9 },
          ],
        },
      ],
      steps: [STEPS],
    })
    expect(loud.items.map((item) => item.id)).toEqual(
      quiet.items
        .filter((item) => item.id === "card:deck-physics:c1" || item.kind === "step")
        .map((item) => item.id),
    )
    expect(loud.items.find((item) => item.id === "card:deck-physics:c1")?.count).toBe(9)
    expect(loud.nudge.suggestions[0]?.itemId).toBe("card:deck-physics:c1")
  })

  test("negative or fractional counts collapse to a sane integer", () => {
    expect(buildReviewQueue({ steps: [{ sessionId: "s", sessionName: "S", steps: [{ index: 0, text: "t", checked: false, misses: -4 }] }] }).items[0]?.count).toBe(0)
    expect(buildReviewQueue({ steps: [{ sessionId: "s", sessionName: "S", steps: [{ index: 0, text: "t", checked: false, misses: 2.7 }] }] }).items[0]?.count).toBe(2)
  })

  test("withMisses is a pure update and clamps", () => {
    const queue = buildReviewQueue({ steps: [STEPS] })
    const item = queue.items[0]!
    const updated = withMisses(item, 5)
    expect(updated.count).toBe(5)
    expect(item.count).toBe(0)
    expect(withMisses(item, -1).count).toBe(0)
  })
})

describe("memory and coverage never mix", () => {
  test("memory items are labelled with the session-memory origin", () => {
    const queue = buildReviewQueue(fullInput())
    const memory = queue.items.filter((item) => item.kind === "memory")
    expect(memory).toHaveLength(1)
    expect(memory[0]?.origin).toBe("session-memory")
    expect(MEMORY_LABEL).toBe("session memory")
  })

  test("no memory item appears in the coverage list", () => {
    const queue = buildReviewQueue(fullInput())
    expect(queue.coverage.map((entry) => entry.name)).toEqual(["unused.pdf"])
    for (const entry of queue.coverage) {
      expect(entry).not.toHaveProperty("excerpt")
      expect(entry).not.toHaveProperty("origin")
    }
  })

  test("coverage gaps are carried separately from the queue items", () => {
    const queue = buildReviewQueue({ coverage: COVERAGE })
    expect(queue.items).toEqual([])
    expect(queue.coverage).toHaveLength(1)
    expect(queue.coverage[0]?.referenced).toBe(false)
    expect(queue.counts.total).toBe(0)
  })

  test("a memory-only mention does not make a source covered", () => {
    const coverage = computeCoverage(
      [{ name: "a.md", originalPath: "/input/a.md", hash: HASH_A }],
      [{ kind: "memory", text: "a.md informed this" }],
    )
    const queue = buildReviewQueue({ coverage })
    expect(queue.coverage).toEqual([])
    expect(coverage.sources[0]?.fromMemoryOnly).toBe(true)
  })
})

describe("purity", () => {
  test("inputs are not mutated", () => {
    const input = fullInput()
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown
    buildReviewQueue(input)
    expect(JSON.parse(JSON.stringify(input)) as unknown).toEqual(snapshot)
  })

  test("the returned items are fresh objects", () => {
    const input = fullInput()
    const queue = buildReviewQueue(input)
    const item = queue.items[0]!
    const mutated = { ...item, label: "changed" }
    expect(mutated.label).toBe("changed")
    expect(queue.items[0]?.label).toBe(item.label)
    expect(input.decks?.[0]?.cards[0]?.question).toBe("What does the learning rate control?")
  })

  test("labels take the first line and are capped, not wrapped", () => {
    const queue = buildReviewQueue({
      memory: [{ ...MEMORY, excerpt: `${"x".repeat(300)}\nsecond line` }],
    })
    const label = queue.items[0]!.label
    expect(label.length).toBe(121)
    expect(label.endsWith("…")).toBe(true)
    expect(label.includes("\n")).toBe(false)
    expect(label.includes("second line")).toBe(false)
  })

  test("a blank leading line is skipped for the label", () => {
    const queue = buildReviewQueue({
      memory: [{ ...MEMORY, excerpt: "\n\n   \nReal content here" }],
    })
    expect(queue.items[0]?.label).toBe("Real content here")
  })
})

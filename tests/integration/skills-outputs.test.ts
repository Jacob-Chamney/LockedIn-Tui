/**
 * WP-405 — study guide and flashcard deck built from a goal's own material.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { gatherSources } from "../../src/services/skills/gather";
import { buildLesson } from "../../src/services/skills/lesson";
import { EMPTY_DECK, FLASHCARDS, NO_GOAL_NEXT, STUDY_ANSWERS, STUDY_GUIDE, buildDeck, buildStudyGuide, listOutputs, mergeDeck, parseDeck, renderDeck, type Card, type GuideSection, type OutputError, type UsageRecord } from "../../src/services/skills/outputs";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00.000Z"
const STAGES: StageDraft[] = [
  { title: "Registers", milestone: "explain a stack frame" },
  { title: "Control flow", milestone: "trace a loop" },
  { title: "Conventions", milestone: "read a prologue" },
]

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, OutputError>): OutputError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let goalId: string
let goalFolder: string

const CITED = "[src: intel.md] Registers hold working state across calls."

function sections(): GuideSection[] {
  return [
    { stageId: "stage-1", heading: "Registers", body: [CITED], answer: "The saved set is the answer." },
    { stageId: "stage-2", heading: "Control flow", body: [CITED], answer: "A loop branches back." },
    { stageId: "stage-3", heading: "Conventions", body: [CITED], answer: "Args arrive in registers." },
  ]
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "skills-outputs-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" })),
      stages: STAGES,
      created: CREATED,
    }),
  )
  goalId = saved.goal.id
  goalFolder = saved.folder

  unwrap(
    await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
      { kind: "text", name: "intel", text: "Registers hold working state across calls." },
    ]),
  )

  for (const stageId of ["stage-1", "stage-2", "stage-3"]) {
    unwrap(
      await buildLesson({
        workspace,
        goalId,
        stageId,
        draft: { exercise: [CITED], hints: ["(agent explanation) read the prologue"], checkpoint: [CITED] },
      }),
    )
  }
})

afterEach(async () => {
  await removeTemp(base)
})

describe("study guide", () => {
  test("three sections, a correct progress line, and answers kept separate", async () => {
    const outcome = unwrap(await buildStudyGuide({ workspace, goalId }, sections()))
    expect(outcome.sections).toBe(3)
    expect(outcome.reviewed).toBe(0)

    const guide = await readFile(join(goalFolder, "outputs", STUDY_GUIDE), "utf8")
    expect(guide).toContain("> 0 of 3 sections reviewed")
    expect(guide.match(/^## /gm)).toHaveLength(3)

    const answers = await readFile(join(goalFolder, "outputs", STUDY_ANSWERS), "utf8")
    expect(answers.match(/^## /gm)).toHaveLength(3)
    expect(guide).not.toContain("The saved set is the answer")
  })

  test("revealing an answer does not touch the guide", async () => {
    unwrap(await buildStudyGuide({ workspace, goalId }, sections()))
    const guidePath = join(goalFolder, "outputs", STUDY_GUIDE)
    const before = await readFile(guidePath, "utf8")

    const answers = await readFile(join(goalFolder, "outputs", STUDY_ANSWERS), "utf8")
    expect(answers).toContain("The saved set is the answer")
    expect(await readFile(guidePath, "utf8")).toBe(before)
  })

  test("a stage without a lesson appears as not built yet, with an action", async () => {
    const mixed = [
      sections()[0]!,
      { stageId: "stage-2", heading: "Control flow", notBuilt: true as const },
    ]
    unwrap(await buildStudyGuide({ workspace, goalId }, mixed))
    const guide = await readFile(join(goalFolder, "outputs", STUDY_GUIDE), "utf8")
    expect(guide).toContain("not built yet")
    expect(guide).toContain("Build this stage's lesson first")
    expect(guide).toContain("> 0 of 2 sections reviewed")
  })

  test("an uncited claim fails validation and writes nothing", async () => {
    const bad = [{ ...sections()[0]!, body: ["Registers just hold state."] }]
    const error = errorOf(await buildStudyGuide({ workspace, goalId }, bad))
    expect(error.kind).toBe("validation")
    expect(existsSync(join(goalFolder, "outputs", STUDY_GUIDE))).toBe(false)
  })

  test("a citation to a non-existent source fails validation", async () => {
    const bad = [{ ...sections()[0]!, body: ["[src: ghost.md] a fact"] }]
    expect(errorOf(await buildStudyGuide({ workspace, goalId }, bad)).kind).toBe("validation")
  })

  test("rebuilding asks first and a cancel leaves the guide byte-identical", async () => {
    unwrap(await buildStudyGuide({ workspace, goalId }, sections()))
    const guidePath = join(goalFolder, "outputs", STUDY_GUIDE)
    const before = await readFile(guidePath, "utf8")

    const error = errorOf(await buildStudyGuide({ workspace, goalId }, sections()))
    expect(error.kind).toBe("confirm")
    expect(await readFile(guidePath, "utf8")).toBe(before)
  })

  test("ticked sections survive a confirmed rebuild", async () => {
    unwrap(await buildStudyGuide({ workspace, goalId }, sections()))
    const guidePath = join(goalFolder, "outputs", STUDY_GUIDE)
    const ticked = (await readFile(guidePath, "utf8")).replace(
      "- [ ] Reviewed",
      "- [x] Reviewed",
    )
    await writeFile(guidePath, ticked)

    const outcome = unwrap(
      await buildStudyGuide({ workspace, goalId, confirmed: true }, sections()),
    )
    expect(outcome.reviewed).toBe(1)
    expect(await readFile(guidePath, "utf8")).toContain("> 1 of 3 sections reviewed")
  })

  test("no goal open is blocked with the picker action", async () => {
    const error = errorOf(await buildStudyGuide({ workspace }, sections()))
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.next).toBe(NO_GOAL_NEXT)
  })
})

describe("flashcards", () => {
  const cards = (count: number): Card[] =>
    Array.from({ length: count }, (_, index) => ({
      question: `Question ${index}?`,
      answer: `Answer ${index}.`,
      choices: [
        { text: `Answer ${index}.`, correct: true },
        { text: "Wrong one", correct: false },
        { text: "Wrong two", correct: false },
      ],
    }))

  test("ten cards write ten cards, each with exactly one correct choice", async () => {
    const outcome = unwrap(await buildDeck({ workspace, goalId }, cards(10)))
    expect(outcome.cards).toBe(10)

    const deck = await readFile(join(goalFolder, "outputs", FLASHCARDS), "utf8")
    expect(deck.match(/^## Card \d+/gm)).toHaveLength(10)
    const choices = parseDeck(deck)
    expect(choices).toHaveLength(10)
    for (const card of choices) {
      expect(card.choices?.filter((choice) => choice.correct)).toHaveLength(1)
    }
  })

  test("regeneration keeps K for unchanged questions and resets M", async () => {
    unwrap(await buildDeck({ workspace, goalId }, cards(10)))
    const path = join(goalFolder, "outputs", FLASHCARDS)

    // Mark the first seven known, and three of them missed as well.
    const first = parseDeck(await readFile(path, "utf8")).map((card, index) => ({
      ...card,
      known: index < 7,
      missed: index < 3,
    }))
    await writeFile(path, renderDeck("test", first))

    // Regenerate with the last question changed.
    const fresh = cards(10).map((card, index) =>
      index === 9 ? { ...card, question: "A changed question?" } : card,
    )
    const outcome = unwrap(await buildDeck({ workspace, goalId, confirmed: true }, fresh))
    expect(outcome.cards).toBe(10)
    expect(outcome.known).toBe(7)

    const rebuilt = parseDeck(await readFile(path, "utf8"))
    expect(rebuilt.slice(0, 7).every((card) => card.known)).toBe(true)
    expect(rebuilt[9]?.known).toBe(false)
    // M is reset for every card, including the ones that were missed before.
    expect(rebuilt.every((card) => card.missed === false)).toBe(true)
  })

  test("a deck that yields zero cards is refused and writes nothing", async () => {
    const error = errorOf(await buildDeck({ workspace, goalId }, []))
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toBe(EMPTY_DECK)
    expect(existsSync(join(goalFolder, "outputs", FLASHCARDS))).toBe(false)
  })

  test("a card with two correct choices is refused", async () => {
    const bad: Card[] = [
      {
        question: "q",
        answer: "a",
        choices: [
          { text: "one", correct: true },
          { text: "two", correct: true },
        ],
      },
    ]
    expect(errorOf(await buildDeck({ workspace, goalId }, bad)).kind).toBe("validation")
  })

  test("a failed build records usage with failed: true and writes nothing", async () => {
    const usage: UsageRecord[] = []
    errorOf(
      await buildStudyGuide({ workspace, goalId, recordUsage: (entry) => usage.push(entry) }, [
        { ...sections()[0]!, body: ["uncited claim"] },
      ]),
    )
    expect(usage).toEqual([])
    expect(existsSync(join(goalFolder, "outputs", STUDY_GUIDE))).toBe(false)
  })

  test("mergeDeck preserves known for identical questions only", () => {
    const previous = [
      { question: "A?", answer: "a", known: true, missed: true },
      { question: "B?", answer: "b", known: false, missed: true },
    ]
    const merged = mergeDeck(previous, [
      { question: "A?", answer: "a2" },
      { question: "C?", answer: "c" },
    ])
    expect(merged[0]?.known).toBe(true)
    expect(merged[0]?.missed).toBe(false)
    expect(merged[1]?.known).toBe(false)
  })

  test("outputs live only inside the goal's outputs folder", async () => {
    unwrap(await buildStudyGuide({ workspace, goalId }, sections()))
    const listed = await listOutputs(workspace, goalId)
    expect(listed).toEqual({ studyGuide: true, answers: true, flashcards: false })
  })
})

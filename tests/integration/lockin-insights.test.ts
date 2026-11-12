/** Session learning side files: questions, calibration, contracts and staleness. */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace } from "../../src/storage/workspace"
import { createLockInSession } from "../../src/services/lockin/create"
import { writeSteps } from "../../src/services/lockin/steps"
import {
  appendMisconception,
  parkQuestion,
  questionCount,
  writeIntakeLevel,
} from "../../src/services/lockin/insights"
import { stampStepsGeneration, stepsAreStale } from "../../src/services/lockin/generation"
import {
  generateSessionDocument,
  loadSessionQuestions,
  loadParkedQuestionCount,
  recordSessionConfidence,
  saveIntakeLevel,
} from "../../src/app/actions/lockin"

const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function setup(prompt = "Study the assignment.") {
  const base = await mkdtemp(join(tmpdir(), "lockin-insights-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Insights",
    prompt,
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  return { workspace: made.value, folder: created.value.folder, id: created.value.session.id }
}

test("questions and misconceptions are append-only session files", async () => {
  const { folder } = await setup()
  expect(await questionCount(folder)).toBe(0)
  expect(await parkQuestion(folder, "Why is i² negative?", "Multiply conjugates")).toBe(1)
  expect(await parkQuestion(folder, "What is the modulus?", "Read magnitude")).toBe(2)
  expect(await questionCount(folder)).toBe(2)
  expect(await readFile(join(folder, "questions.md"), "utf8")).toContain("Why is i² negative?")
  await appendMisconception(folder, "lost the sign in i²", "Multiply conjugates")
  expect(await readFile(join(folder, "misconceptions.md"), "utf8")).toContain("lost the sign")
})

test("intake and confidence are recorded for later calibration", async () => {
  const { workspace, folder, id } = await setup()
  await writeIntakeLevel(folder, "beginner")
  expect(await readFile(join(folder, "intake.md"), "utf8")).toContain("beginner")
  const saved = await saveIntakeLevel(workspace, id, "advanced")
  expect(saved.ok).toBe(true)
  const rated = await recordSessionConfidence({ workspace, id, rating: 4, step: "Multiply conjugates" })
  expect(rated.ok).toBe(true)
  expect(await readFile(join(folder, "confidence.jsonl"), "utf8")).toContain('"rating":4')
  expect((await recordSessionConfidence({ workspace, id, rating: 9 })).ok).toBe(false)
})

test("the questions action reads the parked file", async () => {
  const { workspace, folder, id } = await setup()
  await parkQuestion(folder, "What is the FOIL step?")
  expect(await loadParkedQuestionCount(workspace, id)).toBe(1)
  expect(await loadSessionQuestions(workspace, id)).toContain("FOIL")
})

test("steps become stale when the prompt changes", async () => {
  const { workspace, folder, id } = await setup("Original instructions.")
  await writeSteps(folder, "# Assignment steps\n\n> 0 of 1 steps done\n\n## Work\n\n- [ ] Do the work\n")
  await stampStepsGeneration({ workspace, id, at: "2026-11-07T17:00:00Z" })
  expect(await stepsAreStale(workspace, id)).toBe(false)
  await writeFile(join(folder, "prompt.md"), "Changed instructions.\n")
  expect(await stepsAreStale(workspace, id)).toBe(true)
})

test("generated documents are written into the session", async () => {
  const { workspace, folder, id } = await setup("Implement operator-= and verify it.")
  const prompts: string[] = []
  const result = await generateSessionDocument({
    workspace,
    id,
    kind: "check",
    attempt: "I added operator+= but not operator-=.",
    generate: async (prompt) => {
      prompts.push(prompt)
      return "Correct: the operator signature is there. Gap: subtraction is missing. Question: what should operator-= return?"
    },
  })
  expect(result.ok).toBe(true)
  expect(prompts[0]).toContain("I added operator+= but not operator-=")
  expect(await readFile(join(folder, "check.md"), "utf8")).toContain("Gap: subtraction is missing")
})

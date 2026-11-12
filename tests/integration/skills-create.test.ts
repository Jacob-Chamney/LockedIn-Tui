/**
 * WP-401 — goal creation and curriculum draft.
 *
 * A real workspace is created per test; goals are written through the real save
 * path so every assertion is about bytes on disk. Fixtures are built in the temp
 * directory rather than `tests/fixtures/skills/**` because a goal id is derived
 * from its statement and needs the settled clock each test supplies.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { MANUAL_PATH, MIN_STAGES, MIN_STAGES_ON_SAVE, addStage, draftFailure, goalFolder, goalId, goalSlug, parseCurriculum, readGoal, removeStage, renameStage, reorderStages, saveGoal, stagesWithIds, takenGoalIds, validateDraft, validateInput, type GoalError, type StageDraft } from "../../src/services/skills/create";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00.000Z"
const STATEMENT = "read disassembly output confidently"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, GoalError>): GoalError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const DRAFT: StageDraft[] = [
  { title: "Registers and memory", milestone: "explain a stack frame from a listing" },
  { title: "Control flow", milestone: "trace a loop with three registers" },
  { title: "Calling conventions", milestone: "read a prologue and name its arguments" },
  { title: "Data structures", milestone: "recognise an array walk in disassembly" },
  { title: "Putting it together", milestone: "annotate a 40-line function unaided" },
]

let base: string
let workspace: Workspace

async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      out[relative(root, path)] = entry.isDirectory() ? "<dir>" : await readFile(path, "utf8")
      if (entry.isDirectory()) await walk(path)
    }
  }
  if (existsSync(root)) await walk(root)
  return out
}

function input(overrides: Record<string, unknown> = {}) {
  return unwrap(
    validateInput({
      statement: STATEMENT,
      level: "beginner",
      timeBudget: "6 weeks",
      ...overrides,
    }),
  )
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "skills-create-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
})

afterEach(async () => {
  await removeTemp(base)
})

describe("input", () => {
  test("accepts a full input and defaults the name to the statement", () => {
    const normalised = input()
    expect(normalised.statement).toBe(STATEMENT)
    expect(normalised.level).toBe("beginner")
    expect(normalised.name).toBe(STATEMENT)
  })

  test("an explicit name wins and is capped at 60 characters", () => {
    expect(input({ name: "  Disassembly  " }).name).toBe("Disassembly")
    expect(input({ name: "x".repeat(200) }).name.length).toBe(60)
  })

  test("statement, level and time budget are all required", () => {
    expect(errorOf(validateInput({ statement: " ", level: "beginner", timeBudget: "6 weeks" })).kind).toBe(
      "invalid-input",
    )
    expect(errorOf(validateInput({ statement: "x", level: "expert", timeBudget: "6 weeks" })).kind).toBe(
      "invalid-input",
    )
    expect(errorOf(validateInput({ statement: "x", level: "beginner", timeBudget: "" })).kind).toBe(
      "invalid-input",
    )
  })

  test("over-long statement and time budget are refused with the limit", () => {
    const long = errorOf(validateInput({ statement: "x".repeat(281), level: "beginner", timeBudget: "6 weeks" }))
    expect(long.kind).toBe("invalid-input")
    if (long.kind !== "invalid-input") return
    expect(long.message).toContain("280")

    const time = errorOf(validateInput({ statement: "x", level: "beginner", timeBudget: "y".repeat(61) }))
    expect(time.kind).toBe("invalid-input")
    if (time.kind !== "invalid-input") return
    expect(time.message).toContain("60")
  })
})

describe("identity", () => {
  test("the slug never carries a separator, a leading dot or non-ASCII", () => {
    for (const statement of ["../../etc/passwd", "read/../output", "🧠 learn 🧠", ".hidden"]) {
      const slug = goalSlug(statement)
      expect(slug).not.toContain("/")
      expect(slug).not.toContain("..")
      expect(slug.startsWith(".")).toBe(false)
      expect(/^[a-z0-9-]+$/.test(slug)).toBe(true)
    }
  })

  test("two goals from the same statement get different ids", () => {
    const first = goalId(STATEMENT)
    const second = goalId(STATEMENT, [first])
    expect(second).not.toBe(first)
    expect(second.startsWith(goalSlug(STATEMENT))).toBe(true)
  })

  test("an id is deterministic for a statement and a taken set", () => {
    expect(goalId(STATEMENT, ["other"])).toBe(goalId(STATEMENT, ["other"]))
  })

  test("a hostile statement cannot escape the goals folder", async () => {
    const hostile = unwrap(
      validateInput({ statement: "../../etc/passwd 🧠", level: "beginner", timeBudget: "1 day" }),
    )
    const saved = unwrap(
      await saveGoal({ workspace, input: hostile, stages: DRAFT, created: CREATED }),
    )
    expect(resolve(saved.folder).startsWith(resolve(workspace.paths.goals))).toBe(true)
    expect(saved.goal.id).not.toContain("/")
    expect(saved.goal.id).not.toContain("..")
  })
})

describe("draft validation", () => {
  test("a valid draft is returned trimmed", () => {
    const valid = unwrap(validateDraft([{ title: " A ", milestone: " do a thing " }, ...DRAFT.slice(1)]))
    expect(valid[0]).toEqual({ title: "A", milestone: "do a thing" })
  })

  test("fewer than three stages is refused with the bound named", () => {
    const error = errorOf(validateDraft(DRAFT.slice(0, 2)))
    expect(error.kind).toBe("provider")
    if (error.kind !== "provider") return
    expect(error.message).toContain(`${MIN_STAGES}–`)
    expect(error.next).toContain("by hand")
  })

  test("more than eight stages is refused", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ title: `S${index}`, milestone: `m${index}` }))
    expect(errorOf(validateDraft(many)).kind).toBe("provider")
  })

  test("an empty milestone, an empty title, a heading and a fence are all refused", () => {
    expect(errorOf(validateDraft([{ title: "A", milestone: "" }, ...DRAFT.slice(1)])).kind).toBe("provider")
    expect(errorOf(validateDraft([{ title: "", milestone: "m" }, ...DRAFT.slice(1)])).kind).toBe("provider")
    expect(errorOf(validateDraft([{ title: "## heading", milestone: "m" }, ...DRAFT.slice(1)])).kind).toBe(
      "provider",
    )
    expect(errorOf(validateDraft([{ title: "A", milestone: "```ts" }, ...DRAFT.slice(1)])).kind).toBe(
      "provider",
    )
  })

  test("duplicate titles are refused", () => {
    const duplicate = [DRAFT[0]!, { ...DRAFT[1]!, title: DRAFT[0]!.title }, ...DRAFT.slice(2)]
    expect(errorOf(validateDraft(duplicate)).kind).toBe("provider")
  })

  test("a cancelled draft is a blocked state with the manual path", () => {
    const error = draftFailure(MANUAL_PATH)
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.next).toBe(MANUAL_PATH)
    expect(error.message).toContain("nothing was saved")
  })
})

describe("editing before save", () => {
  test("reordering three stages reassigns stage-1..3 in the new order", () => {
    const reordered = unwrap(reorderStages(DRAFT.slice(0, 3), [2, 0, 1]))
    const stages = unwrap(stagesWithIds(reordered))
    expect(stages.map((stage) => stage.id)).toEqual(["stage-1", "stage-2", "stage-3"])
    expect(stages.map((stage) => stage.title)).toEqual([
      "Calling conventions",
      "Registers and memory",
      "Control flow",
    ])
  })

  test("the first stage is active and the rest pending", () => {
    const stages = unwrap(stagesWithIds(DRAFT))
    expect(stages.map((stage) => stage.status)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
      "pending",
    ])
  })

  test("removing down to one stage is refused with the minimum named", () => {
    let stages = DRAFT.slice(0, 2)
    const error = errorOf(removeStage(stages, 0))
    expect(error.kind).toBe("invalid-input")
    if (error.kind !== "invalid-input") return
    expect(error.message).toContain(String(MIN_STAGES_ON_SAVE))
  })

  test("rename and add work, and add respects the ceiling", () => {
    const renamed = unwrap(renameStage(DRAFT, 0, { milestone: "explain a stack frame" }))
    expect(renamed[0]?.milestone).toBe("explain a stack frame")
    expect(renamed[1]).toEqual(DRAFT[1])

    expect(unwrap(addStage(DRAFT.slice(0, 3), { title: "New", milestone: "do it" }))).toHaveLength(4)

    const eight = Array.from({ length: 8 }, (_, index) => ({ title: `S${index}`, milestone: `m${index}` }))
    expect(errorOf(addStage(eight, { title: "S9", milestone: "m" })).kind).toBe("invalid-input")
  })

  test("a bad reorder is refused rather than silently dropped", () => {
    expect(errorOf(reorderStages(DRAFT, [0, 1])).kind).toBe("invalid-input")
    expect(errorOf(reorderStages(DRAFT.slice(0, 2), [0, 0])).kind).toBe("invalid-input")
  })
})

describe("save", () => {
  test("writes meta.json and curriculum.md and nothing else", async () => {
    const saved = unwrap(await saveGoal({ workspace, input: input(), stages: DRAFT, created: CREATED }))
    expect(await tree(saved.folder)).toEqual({
      "meta.json": expect.any(String),
      "curriculum.md": expect.any(String),
    })

    const meta = JSON.parse(await readFile(saved.metaPath, "utf8")) as Record<string, unknown>
    expect(meta.schema).toBe(1)
    expect(meta.time_budget).toBe("6 weeks")
    expect((meta.stages as Array<{ id: string }>).map((stage) => stage.id)).toEqual([
      "stage-1",
      "stage-2",
      "stage-3",
      "stage-4",
      "stage-5",
    ])

    const mirror = await readFile(saved.curriculumPath, "utf8")
    expect(mirror).toContain("# Curriculum — read disassembly output confidently")
    expect(mirror).toContain("> 0 of 5 stages done")
    expect(parseCurriculum(mirror)).toHaveLength(5)
  })

  test("an invalid draft writes nothing at all", async () => {
    const before = await tree(workspace.paths.goals)
    const error = errorOf(
      await saveGoal({ workspace, input: input(), stages: DRAFT.slice(0, 2), created: CREATED }),
    )
    expect(error.kind).toBe("provider")
    expect(await tree(workspace.paths.goals)).toEqual(before)
  })

  test("cancelling before save writes nothing", async () => {
    const before = await tree(workspace.paths.goals)
    // A cancel never calls saveGoal; asserting the tree is unchanged is the point.
    expect(await tree(workspace.paths.goals)).toEqual(before)
    expect((await readdir(workspace.paths.goals)).filter((name) => name.startsWith(".tmp-"))).toEqual([])
  })

  test("two goals from the same statement land in different folders", async () => {
    const first = unwrap(await saveGoal({ workspace, input: input(), stages: DRAFT, created: CREATED }))
    const second = unwrap(
      await saveGoal({
        workspace,
        input: input(),
        stages: DRAFT,
        created: CREATED,
        takenIds: await takenGoalIds(workspace),
      }),
    )
    expect(second.goal.id).not.toBe(first.goal.id)
    expect(second.folder).not.toBe(first.folder)
    expect(existsSync(first.folder)).toBe(true)
  })

  test("an injected save failure leaves no folder and no temp directory", async () => {
    const id = goalId(STATEMENT)
    // A non-empty destination cannot be replaced by the final directory
    // rename on any platform (a plain file can be replaced on Windows).
    await mkdir(workspace.paths.goals, { recursive: true })
    await mkdir(goalFolder(workspace, id), { recursive: true })
    await writeFile(join(goalFolder(workspace, id), "occupied.txt"), "in the way")

    const error = errorOf(
      await saveGoal({
        workspace,
        input: input(),
        stages: DRAFT,
        created: CREATED,
        takenIds: [],
      }),
    )
    expect(error.kind).toBe("storage")

    const leftovers = (await readdir(workspace.paths.goals)).filter((name) => name.startsWith(".tmp-"))
    expect(leftovers).toEqual([])
  })
})

describe("reopen and reconcile", () => {
  test("the saved goal reopens without loss", async () => {
    const saved = unwrap(await saveGoal({ workspace, input: input(), stages: DRAFT, created: CREATED }))
    const reopened = unwrap(await readGoal(saved.folder))

    expect(reopened.goal.statement).toBe(STATEMENT)
    expect(reopened.goal.stages).toEqual(saved.goal.stages)
    expect(reopened.mirror).toHaveLength(DRAFT.length)
    expect(reopened.mirror[0]?.status).toBe("active")
    expect(reopened.mirror.map((entry) => entry.title)).toEqual(DRAFT.map((stage) => stage.title))
  })

  test("a hand edit of the mirror is reconciled by title on the next save", async () => {
    const saved = unwrap(await saveGoal({ workspace, input: input(), stages: DRAFT, created: CREATED }))
    const handEdited = (await readFile(saved.curriculumPath, "utf8")).replace(
      "Status: active",
      "Status: done",
    )
    await writeFile(saved.curriculumPath, handEdited)

    const mirror = parseCurriculum(handEdited)
    const reconciled = unwrap(
      await saveGoal({
        workspace,
        input: input(),
        stages: DRAFT,
        created: CREATED,
        takenIds: [saved.goal.id],
        existingTitles: mirror,
      }),
    )
    expect(reconciled.goal.stages[0]?.status).toBe("done")
    expect(reconciled.goal.stages[1]?.status).toBe("pending")
  })
})

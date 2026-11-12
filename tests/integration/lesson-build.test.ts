/**
 * WP-403 — building one stage's lesson on a real goal folder.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { gatherSources } from "../../src/services/skills/gather";
import { GENERATED_END, GENERATED_START, buildLesson, parseLesson, type LessonDraft, type LessonError } from "../../src/services/skills/lesson";
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

function errorOf<T>(result: Result<T, LessonError>): LessonError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let goalId: string
let goalFolder: string

const DRAFT: LessonDraft = {
  exercise: ["[src: intel.md] Registers hold working state across calls."],
  hints: ["(agent explanation) Start from the prologue and work down."],
  checkpoint: ["[src: intel.md] Name the registers a call saves."],
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "lesson-build-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(
        validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" }),
      ),
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
})

afterEach(async () => {
  await removeTemp(base)
})

describe("goal ids stay inside the goals root", () => {
  test("a traversing id is refused before any lesson is written", async () => {
    const result = await buildLesson({
      workspace,
      goalId: `../${goalId}`,
      stageId: "stage-2",
      draft: DRAFT,
    })
    expect(result.ok).toBe(false)
    expect(existsSync(join(goalFolder, "lessons"))).toBe(false)
    expect(existsSync(join(workspace.paths.goals, "..", goalId, "lessons"))).toBe(false)
  })
})

describe("build one stage", () => {
  test("stage 2 writes 02-<slug>.md with the sections in order and no solution", async () => {
    const outcome = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    expect(outcome.path.endsWith(join("lessons", "02-control-flow.md"))).toBe(true)

    const text = await readFile(outcome.path, "utf8")
    expect(text.indexOf("## Exercise")).toBeLessThan(text.indexOf("## Hints"))
    expect(text.indexOf("## Hints")).toBeLessThan(text.indexOf("## Checkpoint"))
    expect(text).not.toContain("## Solution")
    expect(text.startsWith("---\nstage: stage-2")).toBe(true)
    expect(text).toContain("status: draft")
  })

  test("a citation resolves to an entry whose excerpt matches the stored source", async () => {
    const outcome = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    const parsed = unwrap(parseLesson(await readFile(outcome.path, "utf8")))
    expect(parsed.citations).toHaveLength(1)
    const [citation] = parsed.citations
    expect(citation?.name).toBe("intel.md")
    expect(citation?.excerpt).toContain("Registers hold working state")
    expect(existsSync(join(goalFolder, citation!.location))).toBe(true)
  })

  test("includeSolution appends a solution after the checkpoint", async () => {
    const outcome = unwrap(
      await buildLesson({
        workspace,
        goalId,
        stageId: "stage-2",
        draft: { ...DRAFT, solution: ["[src: intel.md] The answer is the saved set."] },
        includeSolution: true,
      }),
    )
    const text = await readFile(outcome.path, "utf8")
    expect(text.indexOf("## Solution")).toBeGreaterThan(text.indexOf("## Checkpoint"))
  })

  test("an uncited claim fails validation and writes nothing", async () => {
    const before = existsSync(join(goalFolder, "lessons"))
    const error = errorOf(
      await buildLesson({
        workspace,
        goalId,
        stageId: "stage-2",
        draft: { ...DRAFT, hints: ["Registers just hold state."] },
      }),
    )
    expect(error.kind).toBe("validation")
    expect(existsSync(join(goalFolder, "lessons"))).toBe(before)
  })
})

describe("resumability", () => {
  test("building stage 3 leaves stages 1 and 2 byte-identical", async () => {
    const one = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-1", draft: DRAFT }),
    )
    const two = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    const oneBefore = await readFile(one.path, "utf8")
    const twoBefore = await readFile(two.path, "utf8")

    unwrap(await buildLesson({ workspace, goalId, stageId: "stage-3", draft: DRAFT }))

    expect(await readFile(one.path, "utf8")).toBe(oneBefore)
    expect(await readFile(two.path, "utf8")).toBe(twoBefore)
    expect(await readdir(join(goalFolder, "lessons"))).toHaveLength(3)
  })

  test("a rebuild of a ready lesson asks first, and declining writes nothing", async () => {
    const built = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    const promoted = (await readFile(built.path, "utf8")).replace("status: draft", "status: ready")
    await writeFile(built.path, promoted)

    const error = errorOf(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    expect(error.kind).toBe("confirm")
    if (error.kind !== "confirm") return
    expect(error.status).toBe("ready")
    expect(await readFile(built.path, "utf8")).toBe(promoted)
  })

  test("a confirmed rebuild preserves a user paragraph outside the markers", async () => {
    const built = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    const existing = await readFile(built.path, "utf8")
    await writeFile(
      built.path,
      existing
        .replace("status: draft", "status: ready")
        .replace(GENERATED_END, `${GENERATED_END}\n\nMy own note about this stage.\n`),
    )

    unwrap(
      await buildLesson({
        workspace,
        goalId,
        stageId: "stage-2",
        draft: { ...DRAFT, hints: ["(agent explanation) Work top down."] },
        confirmed: true,
      }),
    )

    const rebuilt = await readFile(built.path, "utf8")
    expect(rebuilt).toContain("My own note about this stage.")
    expect(rebuilt).toContain("Work top down.")
    expect(rebuilt).not.toContain("Start from the prologue")
    expect(rebuilt).toContain(GENERATED_START)
  })

  test("a cancelled build leaves the previous lesson byte-identical", async () => {
    const built = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    const before = await readFile(built.path, "utf8")
    // A cancel never calls buildLesson; the file must still be untouched.
    expect(await readFile(built.path, "utf8")).toBe(before)
    expect(unwrap(parseLesson(before)).status).toBe("draft")
  })

  test("status stays draft until the user marks it read", async () => {
    const built = unwrap(
      await buildLesson({ workspace, goalId, stageId: "stage-2", draft: DRAFT }),
    )
    expect(unwrap(parseLesson(await readFile(built.path, "utf8"))).status).toBe("draft")
  })
})

describe("refusals", () => {
  test("a goal with no usable sources is refused with the actionable sentence", async () => {
    const bare = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(
          validateInput({ statement: "a goal with nothing", level: "beginner", timeBudget: "1 day" }),
        ),
        stages: STAGES,
        created: CREATED,
        takenIds: [goalId],
      }),
    )

    const error = errorOf(
      await buildLesson({ workspace, goalId: bare.goal.id, stageId: "stage-1", draft: DRAFT }),
    )
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.next).toContain("add a source this lesson can cite")
  })

  test("an unknown stage is refused", async () => {
    const error = errorOf(
      await buildLesson({ workspace, goalId, stageId: "stage-9", draft: DRAFT }),
    )
    expect(error.kind).toBe("validation")
  })

  test("building does not change any stage status", async () => {
    const before = JSON.parse(await readFile(join(goalFolder, "meta.json"), "utf8")) as {
      stages: Array<{ status: string }>
    }
    unwrap(await buildLesson({ workspace, goalId, stageId: "stage-1", draft: DRAFT }))
    const after = JSON.parse(await readFile(join(goalFolder, "meta.json"), "utf8")) as {
      stages: Array<{ status: string }>
    }
    expect(after.stages.map((stage) => stage.status)).toEqual(before.stages.map((stage) => stage.status))
  })
})

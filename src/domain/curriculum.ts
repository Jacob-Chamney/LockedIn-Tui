/**
 * Curriculum and lesson domain for skill sessions.
 *
 * `docs/product.md` §7.3 fixes the trust rules: every lesson cites where its
 * facts came from, unsourced claims are labelled `(agent explanation)`, and
 * exercises, hints and checkpoints come before solutions. Those are product
 * invariants, so they live here rather than in a prompt or a renderer.
 *
 * `docs/data-model.md` §5.1–5.3 fixes the shapes: stages carry `pending |
 * active | done`, lessons carry a stage id, status, sources with saved excerpts
 * and sections.
 *
 * Pure: nothing is generated, nothing is read, no input is mutated.
 */

import { err, ok, type Result } from "./markdown"

export type StageStatus = "pending" | "active" | "done"

export type CurriculumStage = {
  id: string
  title: string
  milestone: string
  status: StageStatus
}

export type CurriculumError =
  | { kind: "unknown-stage"; id: string; message: string }
  | { kind: "duplicate-stage"; id: string; message: string }
  | { kind: "lesson-without-stage"; message: string }
  | { kind: "citation"; section: number; block: number; message: string }
  | { kind: "ordering"; section: number; message: string }
  | { kind: "lesson-invalid"; field: string; message: string }

export const MAX_TITLE_CHARS = 120

/** The label every unsourced factual claim must carry, verbatim. */
export const AGENT_EXPLANATION = "(agent explanation)"

// ------------------------------------------------------------------ stages

export function countActive(stages: readonly CurriculumStage[]): number {
  return stages.filter((stage) => stage.status === "active").length
}

/** The single active stage, or null when the curriculum is not started. */
export function activeStage(stages: readonly CurriculumStage[]): CurriculumStage | null {
  return stages.find((stage) => stage.status === "active") ?? null
}

/** First stage that is not done, in curriculum order. */
export function nextPendingStage(stages: readonly CurriculumStage[]): CurriculumStage | null {
  return stages.find((stage) => stage.status === "pending") ?? null
}

/**
 * Validate a curriculum: unique non-empty ids, at most one active stage, and a
 * stage list where nothing is active once everything is done.
 */
export function validateCurriculum(
  stages: readonly CurriculumStage[],
): Result<CurriculumStage[], CurriculumError> {
  const seen = new Set<string>()
  for (const stage of stages) {
    if (stage.id.trim() === "") {
      return err({ kind: "lesson-invalid", field: "stage.id", message: "a stage needs an id" })
    }
    if (seen.has(stage.id)) {
      return err({
        kind: "duplicate-stage",
        id: stage.id,
        message: `duplicate stage id "${stage.id}"`,
      })
    }
    seen.add(stage.id)
  }

  if (countActive(stages) > 1) {
    return err({
      kind: "lesson-invalid",
      field: "stage.status",
      message: `${countActive(stages)} stages are active; a curriculum has one active stage`,
    })
  }
  return ok([...stages])
}

/**
 * Make `id` the active stage, demoting any other active stage to `pending`.
 * A `done` stage stays done: reopening is a separate, explicit call.
 */
export function activateStage(
  stages: readonly CurriculumStage[],
  id: string,
): Result<CurriculumStage[], CurriculumError> {
  const stage = stages.find((item) => item.id === id)
  if (!stage) {
    return err({ kind: "unknown-stage", id, message: `no stage "${id}" in this curriculum` })
  }
  if (stage.status === "done") {
    return err({
      kind: "lesson-invalid",
      field: "stage.status",
      message: `stage "${id}" is done; reopen it explicitly first`,
    })
  }
  return ok(
    stages.map((item) => {
      if (item.id === id) return { ...item, status: "active" as const }
      if (item.status === "active") return { ...item, status: "pending" as const }
      return { ...item }
    }),
  )
}

/**
 * Complete a stage. When the completed stage was the active one, the first
 * pending stage becomes active so the curriculum never stalls with work left.
 */
export function completeStage(
  stages: readonly CurriculumStage[],
  id: string,
): Result<CurriculumStage[], CurriculumError> {
  const stage = stages.find((item) => item.id === id)
  if (!stage) {
    return err({ kind: "unknown-stage", id, message: `no stage "${id}" in this curriculum` })
  }

  const completed = stages.map((item) =>
    item.id === id ? { ...item, status: "done" as const } : { ...item },
  )
  if (countActive(completed) > 0) return ok(completed)

  const next = completed.find((item) => item.status === "pending")
  if (next === undefined) return ok(completed)
  return ok(
    completed.map((item) =>
      item.id === next.id ? { ...item, status: "active" as const } : item,
    ),
  )
}

/**
 * Explicit reopen: a done stage becomes the single active stage again.
 *
 * This is the one transition allowed to take a `done` stage back, which is why
 * it does not delegate to `activateStage`.
 */
export function reopenStage(
  stages: readonly CurriculumStage[],
  id: string,
): Result<CurriculumStage[], CurriculumError> {
  if (!stages.some((stage) => stage.id === id)) {
    return err({ kind: "unknown-stage", id, message: `no stage "${id}" in this curriculum` })
  }
  return ok(
    stages.map((item) => {
      if (item.id === id) return { ...item, status: "active" as const }
      if (item.status === "active") return { ...item, status: "pending" as const }
      return { ...item }
    }),
  )
}

export type CurriculumProgress = { done: number; total: number; ratio: number }

export function curriculumProgress(stages: readonly CurriculumStage[]): CurriculumProgress {
  const total = stages.length
  const done = stages.filter((stage) => stage.status === "done").length
  return { done, total, ratio: total === 0 ? 0 : done / total }
}

// ------------------------------------------------------------------ lessons

export type LessonStatus = "draft" | "ready"

/** Order the product requires: all teaching sections before any solution. */
export const SECTION_ORDER: readonly LessonSectionKind[] = [
  "exercise",
  "hint",
  "checkpoint",
  "solution",
]

export type LessonSectionKind = "exercise" | "hint" | "checkpoint" | "solution"

export type LessonBlock = {
  /** Markdown body of one claim or instruction. */
  text: string
  /**
   * A source id from `lesson.sources`, or null when the text is not a factual
   * claim. A claim with `sourceId: null` must carry `(agent explanation)`.
   */
  sourceId: string | null
  /** True when this block states a fact that must be cited or labelled. */
  claim: boolean
}

export type LessonSection = {
  kind: LessonSectionKind
  blocks: LessonBlock[]
}

export type LessonSource = {
  /** Stable id referenced by blocks; the excerpt is what the user can check. */
  id: string
  name: string
  location: string
  excerpt: string
}

export type Lesson = {
  id: string
  stageId: string
  title: string
  status: LessonStatus
  sources: LessonSource[]
  sections: LessonSection[]
}

/** Checkpoint texts are the merge key: exact text, nothing else. */
export function checkpointTexts(lesson: Lesson): string[] {
  const texts: string[] = []
  for (const section of lesson.sections) {
    if (section.kind !== "checkpoint") continue
    for (const block of section.blocks) texts.push(block.text)
  }
  return texts
}

export type LessonProgress = { checked: number; total: number; ratio: number }

/** Progress by checkpoint text, against the texts the user has completed. */
export function lessonProgress(lesson: Lesson, checked: readonly string[]): LessonProgress {
  const texts = checkpointTexts(lesson)
  const done = new Set(checked)
  const passed = texts.filter((text) => done.has(text)).length
  return {
    checked: passed,
    total: texts.length,
    ratio: texts.length === 0 ? 0 : passed / texts.length,
  }
}

/**
 * Carry completed checkpoints onto a rebuilt lesson by exact text.
 * Idempotent: merging the result again changes nothing, and a checkpoint that
 * no longer exists is reported as dropped rather than silently kept.
 */
export function mergeCheckpoints(
  previousChecked: readonly string[],
  fresh: Lesson,
): { checked: string[]; dropped: string[] } {
  const previous = new Set(previousChecked)
  const texts = checkpointTexts(fresh)
  const kept = new Set<string>()
  const checked: string[] = []
  for (const text of texts) {
    if (!previous.has(text) || kept.has(text)) continue
    kept.add(text)
    checked.push(text)
  }
  const dropped = [...new Set(previousChecked)].filter((text) => !texts.includes(text))
  return { checked, dropped }
}

const TEACHING_KINDS: readonly LessonSectionKind[] = ["exercise", "hint", "checkpoint"]

/**
 * Validate one lesson against the curriculum and the trust rules.
 *
 * Rejections, in the order the product states them:
 * 1. the lesson must belong to a known stage;
 * 2. a solution may not appear before every exercise, hint and checkpoint;
 * 3. a factual claim must cite a declared source or carry `(agent explanation)`.
 */
export function validateLesson(
  lesson: Lesson,
  stages: readonly CurriculumStage[],
): Result<Lesson, CurriculumError> {
  if (lesson.stageId.trim() === "") {
    return err({
      kind: "lesson-without-stage",
      message: `lesson "${lesson.id}" has no stage; build lessons stage by stage`,
    })
  }
  if (!stages.some((stage) => stage.id === lesson.stageId)) {
    return err({
      kind: "unknown-stage",
      id: lesson.stageId,
      message: `lesson "${lesson.id}" points at unknown stage "${lesson.stageId}"`,
    })
  }

  const sourceIds = new Set<string>()
  for (const source of lesson.sources) {
    if (source.id.trim() === "") {
      return err({ kind: "lesson-invalid", field: "lesson.sources", message: "a source needs an id" })
    }
    if (source.excerpt.trim() === "") {
      return err({
        kind: "lesson-invalid",
        field: "lesson.sources",
        message: `source "${source.id}" has no saved excerpt; a citation must be checkable`,
      })
    }
    sourceIds.add(source.id)
  }

  let lastTeaching = -1
  const firstSolution = lesson.sections.findIndex((section) => section.kind === "solution")
  for (const [index, section] of lesson.sections.entries()) {
    if ((TEACHING_KINDS as readonly string[]).includes(section.kind)) lastTeaching = index
  }
  if (firstSolution !== -1 && firstSolution < lastTeaching) {
    return err({
      kind: "ordering",
      section: firstSolution,
      message:
        "a solution appears before an exercise, hint or checkpoint; " +
        "teaching sections must come first",
    })
  }

  for (const [sectionIndex, section] of lesson.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (!block.claim) continue
      if (block.sourceId === null) {
        if (!block.text.includes(AGENT_EXPLANATION)) {
          return err({
            kind: "citation",
            section: sectionIndex,
            block: blockIndex,
            message:
              `factual claim without a source or the ${AGENT_EXPLANATION} label: ` +
              `"${block.text.slice(0, 60)}"`,
          })
        }
        continue
      }
      if (!sourceIds.has(block.sourceId)) {
        return err({
          kind: "citation",
          section: sectionIndex,
          block: blockIndex,
          message: `claim cites "${block.sourceId}", which is not one of the lesson sources`,
        })
      }
    }
  }

  return ok(lesson)
}

/** Every source id a lesson actually cites, in first-use order. */
export function citedSourceIds(lesson: Lesson): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const section of lesson.sections) {
    for (const block of section.blocks) {
      if (block.sourceId === null || seen.has(block.sourceId)) continue
      seen.add(block.sourceId)
      ids.push(block.sourceId)
    }
  }
  return ids
}

/** Declared but never cited: useful for the lesson editor, not an error. */
export function uncitedSources(lesson: Lesson): LessonSource[] {
  const cited = new Set(citedSourceIds(lesson))
  return lesson.sources.filter((source) => !cited.has(source.id))
}

/** A lesson can be marked ready only when it passes every trust rule. */
export function canMarkReady(
  lesson: Lesson,
  stages: readonly CurriculumStage[],
): Result<Lesson, CurriculumError> {
  const valid = validateLesson(lesson, stages)
  if (!valid.ok) return valid
  if (checkpointTexts(lesson).length === 0) {
    return err({
      kind: "lesson-invalid",
      field: "lesson.sections",
      message: "a ready lesson needs at least one checkpoint",
    })
  }
  return ok({ ...lesson, status: "ready" })
}

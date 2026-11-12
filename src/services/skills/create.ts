/**
 * Goal creation and curriculum draft for skill sessions.
 *
 * The model proposes stages; this service decides what is stored. All stage
 * rules — ids, ordering, status, the one-active invariant — come from
 * `src/domain/curriculum.ts` (WP-120) and are called here, never reimplemented.
 *
 * An unsaved draft lives in memory only. Nothing reaches disk until save, and a
 * failed save leaves no half-written goal folder (`AGENTS.md` §2.9).
 */

import { readFile, rename, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { slugify } from "../../domain/note"
import {
  MAX_TITLE_CHARS,
  validateCurriculum,
  type CurriculumStage,
  type StageStatus,
} from "../../domain/curriculum"
import type { Workspace } from "../../storage/workspace"
import { confinedJoin } from "../../storage/paths"

export type SkillLevel = "beginner" | "intermediate" | "advanced"

export const LEVELS: readonly SkillLevel[] = ["beginner", "intermediate", "advanced"]
export const MAX_STATEMENT = 280
export const MAX_TIME_BUDGET = 60
export const MIN_STAGES = 3
export const MAX_STAGES = 8
/** Editing may remove stages, but never below this. */
export const MIN_STAGES_ON_SAVE = 2
export const MAX_MILESTONE = 160
export const GOAL_SCHEMA = 1
export const CURRICULUM_FILE = "curriculum.md"
export const GOAL_META_FILE = "meta.json"

export type GoalError =
  | { kind: "invalid-input"; field: string; message: string }
  | { kind: "provider"; message: string; next: string }
  | { kind: "blocked"; message: string; next: string }
  | { kind: "storage"; path: string; message: string }

export type CreateGoalInput = {
  statement: string
  level: SkillLevel | string
  timeBudget: string
  /** Optional display name; defaults to the statement, truncated. */
  name?: string
}

export type NormalisedInput = {
  statement: string
  level: SkillLevel
  timeBudget: string
  name: string
}

export type StageDraft = { title: string; milestone: string }

export type SkillGoal = {
  schema: number
  id: string
  name: string
  statement: string
  level: SkillLevel
  timeBudget: string
  created: string
  pinned: boolean
  archived: boolean
  stages: CurriculumStage[]
  sources: string[]
  chats: string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Windows can briefly refuse a directory rename while a scanner holds it. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as { code?: string }).code
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error
      await Bun.sleep(25)
    }
  }
}

// ------------------------------------------------------------------ input

export function validateInput(input: CreateGoalInput): Result<NormalisedInput, GoalError> {
  const statement = input.statement.trim()
  if (statement === "") {
    return err({ kind: "invalid-input", field: "statement", message: "a goal needs a statement" })
  }
  if (statement.length > MAX_STATEMENT) {
    return err({
      kind: "invalid-input",
      field: "statement",
      message: `a statement is at most ${MAX_STATEMENT} characters; this one is ${statement.length}`,
    })
  }

  const level = input.level as SkillLevel
  if (!LEVELS.includes(level)) {
    return err({
      kind: "invalid-input",
      field: "level",
      message: `level must be one of ${LEVELS.join(", ")}`,
    })
  }

  const timeBudget = input.timeBudget.trim()
  if (timeBudget === "") {
    return err({ kind: "invalid-input", field: "timeBudget", message: "a time budget is required" })
  }
  if (timeBudget.length > MAX_TIME_BUDGET) {
    return err({
      kind: "invalid-input",
      field: "timeBudget",
      message: `a time budget is at most ${MAX_TIME_BUDGET} characters`,
    })
  }

  const name = (input.name?.trim() || statement).slice(0, 60)
  return ok({ statement, level, timeBudget, name })
}

// ------------------------------------------------------------------ identity

/** ASCII kebab slug: no separator, no leading dot, no non-ASCII survives. */
export function goalSlug(statement: string): string {
  return slugify(statement, 48)
}

function shortHash(statement: string, salt: number): string {
  const digest = new Bun.CryptoHasher("sha256").update(`${statement}\u0000${salt}`).digest("hex")
  return digest.slice(0, 6)
}

/**
 * `<slug>-<6 hex>`, hashed from the statement so it is deterministic, and
 * salted until it is free so two goals from one statement differ.
 */
export function goalId(statement: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const slug = goalSlug(statement)
  for (let salt = 0; ; salt++) {
    const candidate = `${slug}-${shortHash(statement, salt)}`
    if (!used.has(candidate)) return candidate
  }
}

// ------------------------------------------------------------------ draft

/**
 * Validate a model's stage list. Rejections are one actionable `provider`
 * error, because the caller is a generation step and nothing may be written.
 */
export function validateDraft(stages: readonly StageDraft[]): Result<StageDraft[], GoalError> {
  const fail = (message: string): Result<StageDraft[], GoalError> =>
    err({
      kind: "provider",
      message,
      next: "Draft again, or write the stages by hand in the curriculum editor.",
    })

  if (stages.length < MIN_STAGES || stages.length > MAX_STAGES) {
    return fail(`a curriculum needs ${MIN_STAGES}–${MAX_STAGES} stages; this draft has ${stages.length}`)
  }

  const titles = new Set<string>()
  for (const stage of stages) {
    const title = stage.title.trim()
    const milestone = stage.milestone.trim()
    if (title === "") return fail("every stage needs a title")
    if (title.length > MAX_TITLE_CHARS) {
      return fail(`stage "${title.slice(0, 20)}…" is longer than ${MAX_TITLE_CHARS} characters`)
    }
    if (title.startsWith("#")) return fail(`stage "${title}" starts with a Markdown heading`)
    if (title.includes("```") || milestone.includes("```")) {
      return fail(`stage "${title}" contains a code fence`)
    }
    if (titles.has(title.toLowerCase())) return fail(`two stages are both called "${title}"`)
    titles.add(title.toLowerCase())
    if (milestone === "") return fail(`stage "${title}" needs a milestone; a topic is not a milestone`)
    if (milestone.length > MAX_MILESTONE) {
      return fail(`the milestone for "${title}" is longer than ${MAX_MILESTONE} characters`)
    }
  }

  return ok(stages.map((stage) => ({ title: stage.title.trim(), milestone: stage.milestone.trim() })))
}

/** A cancelled or failed draft is not a dead end. */
export function draftFailure(next: string): GoalError {
  return {
    kind: "blocked",
    message: "the curriculum draft did not finish, so nothing was saved",
    next,
  }
}

export const MANUAL_PATH = "write the stages by hand in the curriculum editor"

// ------------------------------------------------------------------ editing

export function reorderStages(
  stages: readonly StageDraft[],
  order: readonly number[],
): Result<StageDraft[], GoalError> {
  if (order.length !== stages.length || new Set(order).size !== order.length) {
    return err({
      kind: "invalid-input",
      field: "order",
      message: "reordering needs one position for every stage",
    })
  }
  const reordered = order.map((index) => stages[index])
  if (reordered.some((stage) => stage === undefined)) {
    return err({ kind: "invalid-input", field: "order", message: "reordering pointed at a missing stage" })
  }
  return ok(reordered as StageDraft[])
}

export function renameStage(
  stages: readonly StageDraft[],
  index: number,
  patch: Partial<StageDraft>,
): Result<StageDraft[], GoalError> {
  if (index < 0 || index >= stages.length) {
    return err({ kind: "invalid-input", field: "index", message: "there is no stage at that position" })
  }
  const next = stages.map((stage, at) => (at === index ? { ...stage, ...patch } : { ...stage }))
  return ok(next)
}

export function removeStage(
  stages: readonly StageDraft[],
  index: number,
): Result<StageDraft[], GoalError> {
  if (index < 0 || index >= stages.length) {
    return err({ kind: "invalid-input", field: "index", message: "there is no stage at that position" })
  }
  if (stages.length - 1 < MIN_STAGES_ON_SAVE) {
    return err({
      kind: "invalid-input",
      field: "stages",
      message: `a curriculum keeps at least ${MIN_STAGES_ON_SAVE} stages`,
    })
  }
  return ok(stages.filter((_, at) => at !== index).map((stage) => ({ ...stage })))
}

export function addStage(stages: readonly StageDraft[], stage: StageDraft): Result<StageDraft[], GoalError> {
  if (stages.length + 1 > MAX_STAGES) {
    return err({
      kind: "invalid-input",
      field: "stages",
      message: `a curriculum holds at most ${MAX_STAGES} stages`,
    })
  }
  return ok([...stages.map((item) => ({ ...item })), { title: stage.title, milestone: stage.milestone }])
}

/**
 * Assign the ids the domain expects: `stage-1`…`stage-n` in final order, first
 * active and the rest pending, so reordering cannot orphan a reference.
 */
export function stagesWithIds(
  stages: readonly StageDraft[],
  statuses: readonly StageStatus[] = [],
): Result<CurriculumStage[], GoalError> {
  if (stages.length < MIN_STAGES_ON_SAVE) {
    return err({
      kind: "invalid-input",
      field: "stages",
      message: `a curriculum keeps at least ${MIN_STAGES_ON_SAVE} stages`,
    })
  }

  const built: CurriculumStage[] = stages.map((stage, index) => ({
    id: `stage-${index + 1}`,
    title: stage.title.trim(),
    milestone: stage.milestone.trim(),
    status: statuses[index] ?? (index === 0 ? "active" : "pending"),
  }))

  const validated = validateCurriculum(built)
  if (!validated.ok) {
    return err({ kind: "invalid-input", field: "stages", message: validated.error.message })
  }
  return ok(validated.value)
}

// ------------------------------------------------------------------ files

export const CURRICULUM_TITLE = "# Curriculum"

/** The readable mirror of `meta.json`. */
export function renderCurriculum(goal: Pick<SkillGoal, "name" | "stages">): string {
  const done = goal.stages.filter((stage) => stage.status === "done").length
  const lines = [
    `${CURRICULUM_TITLE} — ${goal.name}`,
    "",
    `> ${done} of ${goal.stages.length} stages done`,
    "",
  ]
  for (const [index, stage] of goal.stages.entries()) {
    lines.push(
      `## ${index + 1}. ${stage.title}`,
      "",
      `Milestone: ${stage.milestone}`,
      "",
      `Status: ${stage.status}`,
      "",
    )
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`
}

export type CurriculumMirror = { title: string; milestone: string; status: StageStatus }

/** Read the mirror back, so a hand edit can be reconciled by title. */
export function parseCurriculum(markdown: string): CurriculumMirror[] {
  const mirrors: CurriculumMirror[] = []
  let current: CurriculumMirror | null = null

  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(?:\d+\.\s*)?(.+)$/.exec(line)
    if (heading) {
      if (current) mirrors.push(current)
      current = { title: heading[1]!.trim(), milestone: "", status: "pending" }
      continue
    }
    if (current === null) continue
    const milestone = /^Milestone:\s*(.*)$/.exec(line.trim())
    if (milestone) current.milestone = milestone[1]!.trim()
    const status = /^Status:\s*(pending|active|done)\s*$/.exec(line.trim())
    if (status) current.status = status[1] as StageStatus
  }
  if (current) mirrors.push(current)
  return mirrors
}

/**
 * Reconcile a hand-edited mirror with the stages being saved: status follows the
 * title, order still comes from the caller (meta.json is authoritative).
 */
export function reconcileStatuses(
  stages: readonly StageDraft[],
  existingMirror: readonly CurriculumMirror[],
): StageStatus[] {
  const byTitle = new Map(existingMirror.map((entry) => [entry.title.toLowerCase(), entry.status]))
  return stages.map((stage, index) => byTitle.get(stage.title.toLowerCase()) ?? (index === 0 ? "active" : "pending"))
}

export function goalFolder(workspace: Workspace, id: string): string {
  return confinedJoin(workspace.paths.goals, id) ?? join(workspace.paths.goals, ".invalid-goal")
}

export type SaveInput = {
  workspace: Workspace
  input: NormalisedInput
  stages: readonly StageDraft[]
  /** Caller supplies the clock; nothing here reads one. */
  created: string
  takenIds?: Iterable<string>
  /** Existing folder names, for collision handling and reconciliation. */
  existingTitles?: readonly CurriculumMirror[]
}

export type SaveOutcome = { goal: SkillGoal; folder: string; metaPath: string; curriculumPath: string }

/**
 * Save a goal: build in a temporary folder beside the destination, write both
 * files, then rename. A failure removes the temporary folder.
 */
export async function saveGoal(input: SaveInput): Promise<Result<SaveOutcome, GoalError>> {
  const statuses = input.existingTitles
    ? reconcileStatuses(input.stages, input.existingTitles)
    : []
  const stages = stagesWithIds(input.stages, statuses)
  if (!stages.ok) return stages

  const draft = validateDraft(input.stages)
  if (!draft.ok) return draft

  const id = goalId(input.input.statement, input.takenIds ?? [])
  const folder = goalFolder(input.workspace, id)
  const temporary = join(input.workspace.paths.goals, `.tmp-${id}-${crypto.randomUUID()}`)

  const goal: SkillGoal = {
    schema: GOAL_SCHEMA,
    id,
    name: input.input.name,
    statement: input.input.statement,
    level: input.input.level,
    timeBudget: input.input.timeBudget,
    created: input.created,
    pinned: false,
    archived: false,
    stages: stages.value,
    sources: [],
    chats: [],
  }

  try {
    await mkdir(temporary, { recursive: true })
    await writeFile(join(temporary, GOAL_META_FILE), `${JSON.stringify(toMetaJson(goal), null, 2)}\n`, "utf8")
    await writeFile(join(temporary, CURRICULUM_FILE), renderCurriculum(goal), "utf8")
    await renameWithRetry(temporary, folder)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    return err({ kind: "storage", path: folder, message: messageOf(error) })
  }

  return ok({
    goal,
    folder,
    metaPath: join(folder, GOAL_META_FILE),
    curriculumPath: join(folder, CURRICULUM_FILE),
  })
}

/** `docs/data-model.md` §5.1 is snake_case on disk. */
export function toMetaJson(goal: SkillGoal): Record<string, unknown> {
  return {
    schema: goal.schema,
    id: goal.id,
    name: goal.name,
    statement: goal.statement,
    level: goal.level,
    time_budget: goal.timeBudget,
    created: goal.created,
    pinned: goal.pinned,
    archived: goal.archived,
    stages: goal.stages,
    sources: goal.sources,
    chats: goal.chats,
  }
}

export function fromMetaJson(raw: unknown): Result<{ goal: SkillGoal; mirror: CurriculumMirror[] | null }, GoalError> {
  if (typeof raw !== "object" || raw === null) {
    return err({ kind: "storage", path: GOAL_META_FILE, message: "meta.json is not an object" })
  }
  const record = raw as Record<string, unknown>
  if (record.schema !== GOAL_SCHEMA) {
    return err({
      kind: "storage",
      path: GOAL_META_FILE,
      message: `unsupported goal schema ${JSON.stringify(record.schema)}`,
    })
  }

  const stages = Array.isArray(record.stages) ? (record.stages as CurriculumStage[]) : []
  const validated = validateCurriculum(stages)
  if (!validated.ok) {
    return err({ kind: "storage", path: GOAL_META_FILE, message: validated.error.message })
  }

  const goal: SkillGoal = {
    schema: GOAL_SCHEMA,
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    statement: String(record.statement ?? ""),
    level: (record.level as SkillLevel) ?? "beginner",
    timeBudget: String(record.time_budget ?? ""),
    created: String(record.created ?? ""),
    pinned: record.pinned === true,
    archived: record.archived === true,
    stages: validated.value,
    sources: Array.isArray(record.sources) ? (record.sources as string[]) : [],
    chats: Array.isArray(record.chats) ? (record.chats as string[]) : [],
  }
  return ok({ goal, mirror: null })
}

/** Reopen a saved goal: `meta.json` first, the mirror for a readable second read. */
export async function readGoal(
  folder: string,
): Promise<Result<{ goal: SkillGoal; mirror: CurriculumMirror[] }, GoalError>> {
  let meta: unknown
  try {
    meta = JSON.parse(await readFile(join(folder, GOAL_META_FILE), "utf8"))
  } catch (error) {
    return err({ kind: "storage", path: join(folder, GOAL_META_FILE), message: messageOf(error) })
  }
  const parsed = fromMetaJson(meta)
  if (!parsed.ok) return err(parsed.error)

  let mirror: CurriculumMirror[] = []
  try {
    mirror = parseCurriculum(await readFile(join(folder, CURRICULUM_FILE), "utf8"))
  } catch (error) {
    return err({ kind: "storage", path: join(folder, CURRICULUM_FILE), message: messageOf(error) })
  }
  return ok({ goal: parsed.value.goal, mirror })
}

/** Existing goal ids, so a new id cannot collide. */
export async function takenGoalIds(workspace: Workspace): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(workspace.paths.goals, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
  } catch {
    return []
  }
}

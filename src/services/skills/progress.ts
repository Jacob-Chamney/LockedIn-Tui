/**
 * Stage progress and the goal manager service.
 *
 * Stage transitions belong to `src/domain/curriculum.ts` (WP-120): exactly one
 * active stage, completing promotes the next pending one, reopen is explicit.
 * This module persists the result, derives the progress map and emits one event —
 * it never invents a second source of truth.
 */

import { open, readFile, readdir, rename, stat } from "node:fs/promises"
import { join } from "node:path"
import { confinedJoin } from "../../storage/paths"

import { err, ok, type Result } from "../../domain/markdown"
import { completeStage, reopenStage, type CurriculumStage } from "../../domain/curriculum"
import type { Workspace } from "../../storage/workspace"
import { GOAL_META_FILE, fromMetaJson, type SkillGoal } from "./create"

export type ProgressError =
  | { kind: "storage"; path: string; message: string }
  | { kind: "blocked"; message: string; next: string }
  | { kind: "invalid"; message: string }

export type GoalEvent = { type: "goal.updated"; id: string; action: "stage" | "archive" | "restore" | "delete" | "chat" }
export type Emit = (event: GoalEvent) => void

export type GoalMetaRecord = Record<string, unknown>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function goalFolderFor(workspace: Workspace, goalId: string): string {
  // `goalId` can come from a hand-edited or imported meta.json. Contain it.
  return confinedJoin(workspace.paths.goals, goalId) ?? join(workspace.paths.goals, ".invalid-goal")
}

/** The progress map is derived from status: never stored separately. */
export function progressFromStages(stages: readonly CurriculumStage[]): Record<string, boolean> {
  const progress: Record<string, boolean> = {}
  for (const stage of stages) progress[stage.id] = stage.status === "done"
  return progress
}

export function isComplete(stages: readonly CurriculumStage[]): boolean {
  return stages.length > 0 && stages.every((stage) => stage.status === "done")
}

export async function readMeta(folder: string): Promise<Result<{ meta: GoalMetaRecord; goal: SkillGoal }, ProgressError>> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(folder, GOAL_META_FILE), "utf8"))
  } catch (error) {
    return err({ kind: "storage", path: join(folder, GOAL_META_FILE), message: messageOf(error) })
  }
  const parsed = fromMetaJson(raw)
  if (!parsed.ok) return err({ kind: "invalid", message: parsed.error.message })
  return ok({ meta: raw as GoalMetaRecord, goal: parsed.value.goal })
}

/** Atomic replace of `meta.json`, with the derived fields refreshed. */
export async function writeMeta(
  folder: string,
  meta: GoalMetaRecord,
  stages: readonly CurriculumStage[],
): Promise<Result<void, ProgressError>> {
  const target = join(folder, GOAL_META_FILE)
  const temporary = join(folder, `.${GOAL_META_FILE}.tmp-${crypto.randomUUID()}`)
  const payload = {
    ...meta,
    stages,
    progress: progressFromStages(stages),
    complete: isComplete(stages),
  }
  try {
    await Bun.write(temporary, `${JSON.stringify(payload, null, 2)}\n`)
    const handle = await open(temporary, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    return ok(undefined)
  } catch (error) {
    return err({ kind: "storage", path: target, message: messageOf(error) })
  }
}

export type TransitionAction = "done" | "reopen" | "markOpened"

export type TransitionOutcome = {
  stages: CurriculumStage[]
  progress: Record<string, boolean>
  complete: boolean
  activeStageId: string | null
}

/**
 * Apply one transition.
 *
 * `done` completes the stage and lets the domain promote the next pending one.
 * `reopen` makes the stage active again and demotes any later active stage, so
 * exactly one stage is ever active.
 */
export async function applyTransition(input: {
  workspace: Workspace
  goalId: string
  stageId: string
  action: TransitionAction
  now?: string
  emit?: Emit
}): Promise<Result<TransitionOutcome, ProgressError>> {
  const folder = goalFolderFor(input.workspace, input.goalId)
  const loaded = await readMeta(folder)
  if (!loaded.ok) return loaded
  const { meta } = loaded.value

  if (input.action === "markOpened") {
    const touched = { ...meta, last_opened_at: input.now ?? meta.last_opened_at ?? "" }
    const written = await writeMeta(folder, touched, loaded.value.goal.stages)
    if (!written.ok) return written
    return ok(outcome(loaded.value.goal.stages))
  }

  const stages =
    input.action === "done"
      ? completeStage(loaded.value.goal.stages, input.stageId)
      : reopenStage(loaded.value.goal.stages, input.stageId)

  if (!stages.ok) {
    return err({ kind: "invalid", message: stages.error.message })
  }

  // A reopened stage must demote anything active after it. `reopenStage` already
  // demotes every active stage, so the invariant holds by construction.
  const written = await writeMeta(folder, meta, stages.value)
  if (!written.ok) return written

  input.emit?.({ type: "goal.updated", id: input.goalId, action: "stage" })
  return ok(outcome(stages.value))
}

function outcome(stages: readonly CurriculumStage[]): TransitionOutcome {
  return {
    stages: [...stages],
    progress: progressFromStages(stages),
    complete: isComplete(stages),
    activeStageId: stages.find((stage) => stage.status === "active")?.id ?? null,
  }
}

// ------------------------------------------------------------------ manager

export type SortKey = "opened" | "name" | "progress"

export type GoalRow = {
  id: string
  name: string
  statement: string
  level: string
  archived: boolean
  stageCount: number
  stagesDone: number
  /** Present when the folder is a course (chapters, not curriculum stages). */
  chapters?: { done: number; total: number }
  lastOpenedAt: string
  chatCount: number
  broken: boolean
  reason?: string
}

async function chatCount(folder: string): Promise<number> {
  try {
    const entries = await readdir(join(folder, "chats"))
    return entries.filter((name) => name.endsWith(".jsonl")).length
  } catch {
    return 0
  }
}

async function folderSize(folder: string): Promise<number> {
  let total = 0
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      try {
        total += (await stat(path)).size
      } catch {
        // Vanished mid-walk.
      }
    }
  }
  await walk(folder)
  return total
}

/** Every goal, from one read per folder. A corrupt meta is a broken row. */
export async function listGoals(input: {
  workspace: Workspace
  archiveRoot?: string
  sort?: SortKey
  query?: string
}): Promise<GoalRow[]> {
  const roots: Array<{ root: string; archived: boolean }> = [
    { root: input.workspace.paths.goals, archived: false },
  ]
  if (input.archiveRoot) roots.push({ root: join(input.archiveRoot, "skills"), archived: true })

  const rows: GoalRow[] = []
  for (const { root, archived } of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("."))) {
      const folder = join(root, entry.name)
      const loaded = await readMeta(folder)
      if (!loaded.ok) {
        rows.push({
          id: entry.name,
          name: "",
          statement: "",
          level: "",
          archived,
          stageCount: 0,
          stagesDone: 0,
          lastOpenedAt: "",
          chatCount: 0,
          broken: true,
          reason: loaded.error.message,
        })
        continue
      }
      const { goal, meta } = loaded.value
      const rawChapters = (meta as { chapters?: unknown }).chapters
      const courseChapters = Array.isArray(rawChapters)
        ? rawChapters.filter((chapter) => typeof chapter === "object" && chapter !== null)
        : null
      rows.push({
        id: goal.id,
        name: goal.name,
        statement: goal.statement,
        level: goal.level,
        archived,
        stageCount: goal.stages.length,
        stagesDone: goal.stages.filter((stage) => stage.status === "done").length,
        ...(courseChapters
          ? {
              chapters: {
                done: courseChapters.filter((chapter) => (chapter as { done?: unknown }).done === true).length,
                total: courseChapters.length,
              },
            }
          : {}),
        // A goal that has never been opened still has a date; the manager
        // column is a day, not a blank slot.
        lastOpenedAt:
          (typeof meta.last_opened_at === "string" ? meta.last_opened_at : "") ||
          (typeof meta.created === "string" ? meta.created : ""),
        chatCount: await chatCount(folder),
        broken: false,
      })
    }
  }

  const query = (input.query ?? "").trim().toLowerCase()
  const filtered =
    query === ""
      ? rows
      : rows.filter(
          (row) =>
            row.name.toLowerCase().includes(query) || row.statement.toLowerCase().includes(query),
        )

  const sort = input.sort ?? "opened"
  filtered.sort((a, b) => {
    if (sort === "name") {
      const left = a.name.toLowerCase()
      const right = b.name.toLowerCase()
      if (left !== right) return left < right ? -1 : 1
    } else if (sort === "progress") {
      const ratio = (row: GoalRow) =>
        row.chapters
          ? row.chapters.total === 0
            ? 0
            : row.chapters.done / row.chapters.total
          : row.stageCount === 0
            ? 0
            : row.stagesDone / row.stageCount
      const left = ratio(a)
      const right = ratio(b)
      if (left !== right) return right - left
    } else {
      if (a.lastOpenedAt !== b.lastOpenedAt) return a.lastOpenedAt < b.lastOpenedAt ? 1 : -1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return filtered
}

/** Size of a goal folder, for the manager's secondary line. */
export async function goalSize(workspace: Workspace, goalId: string): Promise<number> {
  return folderSize(goalFolderFor(workspace, goalId))
}

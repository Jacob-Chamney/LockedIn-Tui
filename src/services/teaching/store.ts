/**
 * Teaching state on disk.
 *
 * `skills/goals/<id>/teaching.json`, beside `meta.json` and `sources/`. It is
 * the session's own record: the goal the measure made concrete, what the
 * learner holds, the plan, and — once a check runs — which steps landed.
 *
 * Markdown is the source of truth for notes (`docs/data-model.md` §1); this is
 * structured session state, the same kind of record `meta.json` and
 * `progress.jsonl` already are, so a JSON file with a `schema` field is the
 * right shape. It is written atomically (temp + fsync + rename) and a missing
 * file is a valid "not measured yet".
 */
import { rename, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "../../domain/markdown";
import type {
  TeachingCheck,
  TeachingProblem,
  TeachingState,
  TeachingStepBody,
} from "../../domain/teaching";

export const TEACHING_FILE = "teaching.json";

/** One completed check, kept so a step is not re-taught after a restart. */
export type TeachingCheckRecord = {
  stepId: string
  verdict: TeachingCheck["verdict"]
  correction: string
  /** The learner's reasoning, when they wrote any. */
  thinking?: string
  /** Self-reported 1–5 confidence, when they gave one. */
  confidence?: number
  at: string
}

/** One attempt at a practice problem. */
export type PracticeAttempt = {
  problemId: string
  verdict: "solved" | "missed"
  at: string
}

export type PracticeState = {
  problems: TeachingProblem[]
  attempts: PracticeAttempt[]
  generatedAt: string
}

export type TeachingRecord = {
  schema: 1
  state: TeachingState
  /** The step on screen, if one was opened and not yet passed. */
  current?: TeachingStepBody
  checks: TeachingCheckRecord[]
  /** The practice set, once asked for. Absent means "not generated yet". */
  practice?: PracticeState
}

export type TeachingStoreError = { kind: "storage"; path: string; message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function teachingPath(folder: string): string {
  return join(folder, TEACHING_FILE)
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

/** The record, or null when the session has not been measured yet. */
export async function readTeaching(
  folder: string,
): Promise<Result<TeachingRecord | null, TeachingStoreError>> {
  let text: string
  try {
    text = await readFile(teachingPath(folder), "utf8")
  } catch (error) {
    // Only ENOENT is "not measured yet". An unreadable record is an error: the
    // next write would otherwise replace a session's plan with a fresh one.
    if (codeOf(error) === "ENOENT") return { ok: true, value: null }
    return {
      ok: false,
      error: {
        kind: "storage",
        path: teachingPath(folder),
        message: `the teaching record cannot be read (${messageOf(error)}); fix its permissions`,
      },
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "storage",
        path: teachingPath(folder),
        message: `teaching.json is not valid JSON (${messageOf(error)})`,
      },
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      error: { kind: "storage", path: teachingPath(folder), message: "teaching.json is not an object" },
    }
  }
  const record = parsed as Partial<TeachingRecord>
  if (record.schema !== 1 || record.state === undefined || !Array.isArray(record.checks)) {
    return {
      ok: false,
      error: {
        kind: "storage",
        path: teachingPath(folder),
        message: "teaching.json does not have the teaching record shape",
      },
    }
  }
  return { ok: true, value: record as TeachingRecord }
}

/** Write the record atomically: a crash leaves the old one or the new one. */
export async function writeTeaching(
  folder: string,
  record: TeachingRecord,
): Promise<Result<TeachingRecord, TeachingStoreError>> {
  const target = teachingPath(folder)
  const temporary = `${target}.tmp-${crypto.randomUUID()}`
  const body = `${JSON.stringify(record, null, 2)}\n`
  try {
    await writeFile(temporary, body, "utf8")
    const handle = await import("node:fs/promises").then((fs) => fs.open(temporary, "r+"))
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return {
      ok: false,
      error: { kind: "storage", path: target, message: messageOf(error) },
    }
  }
  return { ok: true, value: record }
}

/**
 * The step that is next: the first unpassed step whose prerequisites are held.
 *
 * The plan is a map, so this is not "the next row". A branch that does not
 * depend on the step just passed becomes available immediately; a step whose
 * prerequisite is still open waits, even if it sits earlier in the list.
 * Records written before `requires` existed are read as a chain.
 */
export function nextStepIndex(record: TeachingRecord): number {
  const plan = record.state.plan
  const passed = new Set(
    record.checks.filter((check) => check.verdict === "correct").map((check) => check.stepId),
  )
  const requiresOf = (index: number): string[] => {
    const step = plan[index]!
    if (step.requires !== undefined) return step.requires
    return index === 0 ? [] : [plan[index - 1]!.id]
  }
  const index = plan.findIndex(
    (step, position) => !passed.has(step.id) && requiresOf(position).every((id) => passed.has(id)),
  )
  if (index !== -1) return index
  // A valid plan always has an available root; this only happens on a damaged
  // record, where the first unpassed step is the least surprising answer.
  const firstOpen = plan.findIndex((step) => !passed.has(step.id))
  return firstOpen === -1 ? plan.length : firstOpen
}

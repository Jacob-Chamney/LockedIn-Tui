/**
 * Assignment steps: generate, merge and toggle `assignment-steps.md`.
 *
 * The file is the truth (`docs/product.md` §5.1). This service owns validation,
 * rendering and the atomic write; the checkbox rules themselves live in
 * `src/domain/progress.ts` and are only called here, never re-implemented.
 *
 * A failed or unconfirmed regeneration writes nothing: the previous bytes stay
 * exactly as they were (`AGENTS.md` §2.9).
 */

import { open, readFile, rename, rm } from "node:fs/promises"
import { basename, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import {
  mergeSteps,
  parseProgress,
  renderProgress,
  toggle,
  type ProgressFormat,
  type ToggleResult,
} from "../../domain/progress"
import { SESSION_FILES } from "../../domain/session"

export type StepsError =
  | { kind: "provider"; message: string; next: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "confirm"; message: string; kept: number; lost: number; lostTexts: string[] }
  | { kind: "blocked"; message: string }

export type StepDepth = "deep" | "light"

export type StepDraft = { phase: string; items: string[] }
export type StepPlan = { phases: StepDraft[] }

export const MAX_ITEMS = 200
export const MIN_ITEMS = 4
export const MAX_ITEM_CHARS = 300
export const MAX_PHASE_CHARS = 80
export const STEPS_TITLE = "# Assignment steps"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function stepsPath(folder: string): string {
  return join(folder, SESSION_FILES.steps)
}

/** Read the file, or null when it does not exist yet. */
export async function readSteps(folder: string): Promise<string | null> {
  try {
    return await readFile(stepsPath(folder), "utf8")
  } catch {
    return null
  }
}

/**
 * Validate a plan before anything is written.
 *
 * Rejections are one actionable `provider` error, because the caller is a
 * generation step that should retry or report — never a half-written file.
 */
export function validatePlan(plan: StepPlan): Result<StepPlan, StepsError> {
  const fail = (message: string): Result<StepPlan, StepsError> =>
    err({ kind: "provider", message, next: "Regenerate the steps, or turn steps off for this session." })

  const items = plan.phases.flatMap((phase) => phase.items)
  if (plan.phases.length === 0 || items.length < MIN_ITEMS) {
    return fail(`a plan needs at least ${MIN_ITEMS} steps; this one has ${items.length}`)
  }
  if (items.length > MAX_ITEMS) {
    return fail(`a plan may hold at most ${MAX_ITEMS} steps; this one has ${items.length}`)
  }

  for (const phase of plan.phases) {
    const name = phase.phase.trim()
    if (name === "") return fail("every phase needs a heading")
    if (name.length > MAX_PHASE_CHARS) {
      return fail(`phase "${name.slice(0, 20)}…" is longer than ${MAX_PHASE_CHARS} characters`)
    }
    // `#` is legal inside a heading (`## C# basics`); only line breaks can
    // break the rendered structure.
    if (/[\r\n]/.test(name)) {
      return fail(`phase "${name}" cannot contain line breaks`)
    }
    for (const item of phase.items) {
      const text = item.trim()
      if (text === "") return fail(`phase "${name}" has an empty step`)
      if (text.length > MAX_ITEM_CHARS) {
        return fail(`step "${text.slice(0, 30)}…" is longer than ${MAX_ITEM_CHARS} characters`)
      }
      if (/^\s*[-*+]\s+\[[ xX]\]/.test(text) || /^\s*[-*+]\s/.test(text)) {
        return fail(`step "${text.slice(0, 30)}…" is a nested list item; steps are flat`)
      }
      if (text.includes("```") || text.includes("~~~")) {
        return fail(`step "${text.slice(0, 30)}…" contains a code fence; steps are plain text`)
      }
      if (/[\r\n]/.test(text)) {
        return fail(`step "${text.slice(0, 30)}…" spans several lines; steps are one line each`)
      }
    }
  }

  return ok(plan)
}

/** A step that names no concrete object and starts with a generic study verb. */
const VAGUE_START =
  /^(review|understand|study|read|familiarize|explore|learn|research|look at|go over|think about)\b/i
const CONCRETE =
  /(`[^`]+`|\b[\w-]+\.(?:h|hpp|c|cc|cpp|py|ts|tsx|js|java|rs|go|md|txt|pdf|docx)\b|\b\d+\b|\b[A-Za-z_]\w*\s*\(|\boperator\s*[-+*/=<>!]+)/

export type BroadStep = { phase: string; text: string; reason: string }

/** A deterministic quality check; the model never gets to grade its own plan. */
export function broadSteps(plan: StepPlan): BroadStep[] {
  const out: BroadStep[] = []
  for (const phase of plan.phases) {
    for (const raw of phase.items) {
      const text = raw.trim()
      if (VAGUE_START.test(text) && !CONCRETE.test(text)) {
        out.push({ phase: phase.phase, text, reason: "generic study verb with no concrete object" })
      }
    }
  }
  return out
}

const PROGRESS_TEMPLATE: ProgressFormat = {
  prefix: "> ",
  glue: " of ",
  unit: " steps done",
  suffix: "",
}

/** Render a plan as the documented Markdown. The progress line is computed here. */
export function renderSteps(plan: StepPlan, checked = 0): string {
  const total = plan.phases.reduce((count, phase) => count + phase.items.length, 0)
  const lines = [STEPS_TITLE, "", renderProgress(PROGRESS_TEMPLATE, checked, total), ""]

  for (const phase of plan.phases) {
    lines.push(`## ${phase.phase.trim()}`, "")
    for (const item of phase.items) lines.push(`- [ ] ${item.trim()}`)
    lines.push("")
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`
}

export type MergePreview = {
  /** Checked steps whose exact text survives. */
  kept: number
  /** Checked steps whose text is gone (edited or removed). */
  lost: number
  lostTexts: string[]
}

/** What a regeneration would keep, so the confirmation can name the numbers. */
export function previewMerge(existing: string | null, fresh: string): MergePreview {
  if (existing === null) return { kept: 0, lost: 0, lostTexts: [] }

  const before = parseProgress(existing)
  const after = parseProgress(fresh)
  if (!before.ok || !after.ok) return { kept: 0, lost: 0, lostTexts: [] }

  const freshTexts = new Set(after.value.items.map((item) => item.text))
  const checkedTexts = before.value.items.filter((item) => item.checked).map((item) => item.text)
  const kept = checkedTexts.filter((text) => freshTexts.has(text)).length
  const lostTexts = checkedTexts.filter((text) => !freshTexts.has(text))

  return { kept, lost: lostTexts.length, lostTexts }
}

/** Atomic replace: temp file in the same folder, then rename. */
export async function writeSteps(folder: string, markdown: string): Promise<Result<string, StepsError>> {
  const target = stepsPath(folder)
  // Dot-prefixed: archives and exports skip it, even after a crash.
  const temporary = join(folder, `.${basename(target)}.tmp-${crypto.randomUUID()}`)
  try {
    await Bun.write(temporary, markdown)
    const handle = await open(temporary, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
    return ok(target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return err({ kind: "storage", path: target, message: messageOf(error) })
  }
}

export type GenerateOutcome = {
  markdown: string
  written: boolean
  kept: number
  lost: number
}

export type GenerateInput = {
  folder: string
  plan: StepPlan
  /** True once the user accepted that checked work will be lost. */
  confirmed?: boolean
  /** Pass the current file to skip a read; null means "no file yet". */
  existing?: string | null
}

/**
 * Generate `assignment-steps.md` from a validated plan.
 *
 * Order: validate → render → preview the merge → require confirmation when
 * checked work would change → merge → write. Anything that fails earlier leaves
 * the previous file untouched.
 */
export async function generateSteps(
  input: GenerateInput,
): Promise<Result<GenerateOutcome, StepsError>> {
  const valid = validatePlan(input.plan)
  if (!valid.ok) return valid

  const existing = input.existing === undefined ? await readSteps(input.folder) : input.existing
  const fresh = renderSteps(input.plan)
  const preview = previewMerge(existing, fresh)

  if (existing !== null && preview.kept + preview.lost > 0 && input.confirmed !== true) {
    return err({
      kind: "confirm",
      message:
        `This session already has steps, and ${preview.kept + preview.lost} of them are ` +
        `checked. Regenerating keeps ${preview.kept} and drops ${preview.lost}.`,
      kept: preview.kept,
      lost: preview.lost,
      lostTexts: preview.lostTexts,
    })
  }

  // Merging with itself is a no-op, so the first generation takes the same path.
  const merged = mergeSteps(existing ?? fresh, fresh)
  if (!merged.ok) {
    return err({ kind: "storage", path: stepsPath(input.folder), message: merged.error.message })
  }

  const written = await writeSteps(input.folder, merged.value)
  if (!written.ok) return written

  return ok({
    markdown: merged.value,
    written: true,
    kept: preview.kept,
    lost: preview.lost,
  })
}

/**
 * Toggle one step and write the result.
 *
 * The snapshot comes from `progress.toggle`: the caller renders those numbers
 * instead of re-parsing the file to guess the new state.
 */
export async function toggleStep(input: {
  folder: string
  index: number
}): Promise<Result<ToggleResult, StepsError>> {
  const current = await readSteps(input.folder)
  if (current === null) {
    return err({
      kind: "blocked",
      message: "this session has no assignment steps yet; build them first",
    })
  }

  const toggled = toggle(current, input.index)
  if (!toggled.ok) {
    return err({ kind: "blocked", message: toggled.error.message })
  }

  const written = await writeSteps(input.folder, toggled.value.text)
  if (!written.ok) return written
  return ok(toggled.value)
}

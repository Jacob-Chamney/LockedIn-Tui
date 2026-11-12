/**
 * Staged lessons: one stage at a time, every claim cited or labelled.
 *
 * The trust rules live in `src/domain/curriculum.ts` (WP-120) and are called
 * here — section order, checkpoint text, status. This module owns the file shape
 * (`lessons/NN-<slug>.md`, `docs/data-model.md` §5.3), the generated-section
 * markers so a rebuild never eats the user's own writing, and the write.
 *
 * Nothing is written on a validation failure, a refusal or a declined rebuild.
 */

import { mkdir, readFile, rename } from "node:fs/promises"
import { join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { AGENT_EXPLANATION, checkpointTexts } from "../../domain/curriculum"
import { slugify } from "../../domain/note"
import type { Workspace } from "../../storage/workspace"
import { readGoal, goalFolder, type GoalError } from "./create"
import type { SkillSource } from "./gather"

export const GENERATED_START = "<!-- generated:start -->"
export const GENERATED_END = "<!-- generated:end -->"
export const LESSONS_DIR = "lessons"
export const LESSON_SECTIONS = ["exercise", "hints", "checkpoint"] as const

export type LessonError =
  | { kind: "blocked"; message: string; next: string }
  | { kind: "validation"; message: string; section?: string }
  | { kind: "confirm"; message: string; status: string }
  | { kind: "storage"; path: string; message: string }

export type LessonSectionName = "exercise" | "hints" | "checkpoint" | "solution"

export type LessonDraft = {
  exercise: string[]
  hints: string[]
  checkpoint: string[]
  solution?: string[]
}

export type Citation = { name: string; location: string; excerpt: string }

const HEADINGS: Record<LessonSectionName, string> = {
  exercise: "## Exercise",
  hints: "## Hints",
  checkpoint: "## Checkpoint",
  solution: "## Solution",
}

export const CITATION = /\[src:\s*([^\]]+)\]/

/** `02-<slug>.md`: the stage's position in the curriculum, 1-based. */
export function lessonFileName(position: number, title: string): string {
  const index = String(position).padStart(2, "0")
  return `${index}-${slugify(title, 48)}.md`
}

/** A claim is citable when it cites a source or is labelled an explanation. */
export function isCitable(paragraph: string): boolean {
  const text = paragraph.trim()
  if (text === "") return false
  if (text.startsWith(AGENT_EXPLANATION)) return true
  return CITATION.test(text)
}

/** Names cited by a paragraph, for resolving them against the goal's sources. */
export function citationsIn(paragraph: string): string[] {
  const names: string[] = []
  for (const match of paragraph.matchAll(new RegExp(CITATION.source, "g"))) {
    names.push(match[1]!.trim())
  }
  return names
}

function frontmatter(stage: string, sources: readonly Citation[], status: string): string {
  const lines = ["---", `stage: ${stage}`, "sources:"]
  for (const source of sources) {
    lines.push(`  - name: ${JSON.stringify(source.name)}`, `    location: ${JSON.stringify(source.location)}`)
    lines.push(`    excerpt: ${JSON.stringify(source.excerpt)}`)
  }
  lines.push(`status: ${status}`, "---", "")
  return lines.join("\n")
}

function sectionBody(name: LessonSectionName, paragraphs: readonly string[]): string {
  if (paragraphs.length === 0) return ""
  return `${HEADINGS[name]}\n\n${paragraphs.map((line) => line.trim()).join("\n\n")}\n`
}

/**
 * The generated body, between markers.
 *
 * Order is fixed here: exercise, hints, checkpoint, then an optional solution.
 * A build without `includeSolution` omits the section entirely rather than
 * writing "omitted", so the document never implies a solution exists.
 */
export function renderGenerated(
  sections: LessonDraft,
  options: { includeSolution?: boolean } = {},
): string {
  const parts = [
    sectionBody("exercise", sections.exercise),
    sectionBody("hints", sections.hints),
    sectionBody("checkpoint", sections.checkpoint),
  ]
  if (options.includeSolution === true) parts.push(sectionBody("solution", sections.solution ?? []))
  return `${GENERATED_START}\n${parts.filter((part) => part !== "").join("\n")}${GENERATED_END}`
}

export type ValidateOptions = {
  /** Sources the lesson may cite, by name. */
  sources: readonly Citation[]
  /** True when `## Solution` is allowed to appear at all. */
  includeSolution?: boolean
}

/**
 * Validate a draft before rendering: every claim cited or labelled, and every
 * citation resolvable to a source with a saved excerpt.
 */
export function validateDraft(
  draft: LessonDraft,
  options: ValidateOptions,
): Result<LessonDraft, LessonError> {
  const byName = new Map(options.sources.map((source) => [source.name, source]))

  const check = (paragraphs: readonly string[], section: LessonSectionName): Result<void, LessonError> => {
    for (const paragraph of paragraphs) {
      if (!isCitable(paragraph)) {
        return err({
          kind: "validation",
          section,
          message:
            `${section}: "${paragraph.slice(0, 60)}" is a factual claim with neither a ` +
            `[src: name] citation nor the ${AGENT_EXPLANATION} label`,
        })
      }
      for (const name of citationsIn(paragraph)) {
        const source = byName.get(name)
        if (!source) {
          return err({
            kind: "validation",
            section,
            message: `${section} cites "${name}", which is not one of this goal's sources`,
          })
        }
        if (source.excerpt.trim() === "") {
          return err({
            kind: "validation",
            section,
            message: `${section} cites "${name}", whose source has no saved excerpt`,
          })
        }
      }
    }
    return ok(undefined)
  }

  for (const section of LESSON_SECTIONS) {
    const checked = check(draft[section], section)
    if (!checked.ok) return checked
  }

  if (options.includeSolution === true) {
    const checked = check(draft.solution ?? [], "solution")
    if (!checked.ok) return checked
  }

  return ok(draft)
}

export type LessonDocument = {
  stage: string
  status: "draft" | "ready"
  citations: Citation[]
  /** Everything after the frontmatter. */
  body: string
}

/** Read a lesson file back. The frontmatter is parsed by hand: it is a fixed shape. */
export function parseLesson(text: string): Result<LessonDocument, LessonError> {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) {
    return err({ kind: "validation", message: "a lesson needs frontmatter and a body" })
  }
  const header = match[1]!
  const body = match[2]!

  const stage = /^stage:\s*(.+)$/m.exec(header)?.[1]?.trim() ?? ""
  const status = (/^status:\s*(draft|ready)$/m.exec(header)?.[1] ?? "draft") as "draft" | "ready"

  const citations: Citation[] = []
  const names = [...header.matchAll(/^\s+- name:\s*(.+)$/gm)]
  for (const entry of names) {
    const rest = header.slice(entry.index! + entry[0].length)
    const location = /^\s+location:\s*(.+)$/m.exec(rest.split(/\n\s+- name:/)[0]!)?.[1]?.trim() ?? ""
    const excerpt = /^\s+excerpt:\s*(.+)$/m.exec(rest.split(/\n\s+- name:/)[0]!)?.[1]?.trim() ?? ""
    citations.push({
      name: unquote(entry[1]!),
      location: unquote(location),
      excerpt: unquote(excerpt),
    })
  }

  return ok({ stage, status, citations, body })
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === "string") return parsed
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

export type DocumentCheck = { sections: LessonSectionName[]; ok: true } | { ok: false; message: string }

/** Section order and citation rules for a whole document body. */
export function validateDocument(body: string, sources: readonly Citation[]): Result<void, LessonError> {
  const byName = new Map(sources.map((source) => [source.name, source]))
  for (const line of body.split("\n")) {
    for (const name of citationsIn(line)) {
      const source = byName.get(name)
      if (!source) {
        return err({
          kind: "validation",
          message: `the document cites "${name}", which is not one of this goal's sources`,
        })
      }
      if (source.excerpt.trim() === "") {
        return err({
          kind: "validation",
          message: `the document cites "${name}", whose source has no saved excerpt`,
        })
      }
    }
  }

  const order: LessonSectionName[] = []
  for (const name of ["exercise", "hints", "checkpoint", "solution"] as LessonSectionName[]) {
    const at = body.indexOf(HEADINGS[name])
    if (at !== -1) order.push(name)
  }

  if (order.length === 0) {
    return err({ kind: "validation", message: "a lesson needs an exercise section" })
  }
  if (order[0] !== "exercise") {
    return err({ kind: "validation", message: "a lesson starts with ## Exercise", section: order[0] })
  }

  const solutionAt = order.indexOf("solution")
  const checkpointAt = order.indexOf("checkpoint")
  if (solutionAt !== -1 && (checkpointAt === -1 || solutionAt < checkpointAt)) {
    return err({
      kind: "validation",
      section: "solution",
      message: "a solution may not appear before the exercise, hints and checkpoint",
    })
  }

  return ok(undefined)
}

/**
 * Replace the YAML header, keeping the body. A rebuild must not keep citing the
 * sources it had before the user added another one.
 */
export function withFrontmatter(existing: string, header: string): string {
  if (existing.startsWith("---\n")) {
    const end = existing.indexOf("\n---", 4)
    if (end !== -1) {
      const after = existing.indexOf("\n", end + 4)
      const body = existing.slice(after === -1 ? end + 4 : after + 1).replace(/^\n+/, "")
      return `${header}${body}`
    }
  }
  return `${header}${existing}`
}

/** Replace only the generated block, leaving the user's own text untouched. */
export function spliceGenerated(existing: string, generated: string): string {
  const start = existing.indexOf(GENERATED_START)
  const end = existing.indexOf(GENERATED_END)
  if (start === -1 || end === -1 || end < start) {
    // No markers yet: keep the existing body and append the generated block.
    return `${existing.replace(/\n+$/, "")}\n\n${generated}\n`
  }
  return `${existing.slice(0, start)}${generated}${existing.slice(end + GENERATED_END.length)}`
}

export type BuildInput = {
  workspace: Workspace
  goalId: string
  stageId: string
  draft: LessonDraft
  includeSolution?: boolean
  /** Required to replace an existing `ready` lesson. */
  confirmed?: boolean
}

export type BuildOutcome = {
  path: string
  markdown: string
  status: "draft" | "ready"
  citations: Citation[]
}

/**
 * Build or rebuild one stage's lesson.
 *
 * Order: locate the stage → require a citable source → validate the draft →
 * render → refuse if a ready lesson exists and the rebuild is unconfirmed →
 * replace only the generated block → write atomically.
 */
export async function buildLesson(input: BuildInput): Promise<Result<BuildOutcome, LessonError>> {
  const folder = goalFolder(input.workspace, input.goalId)
  const goal = await readGoal(folder)
  if (!goal.ok) return err(toLessonError(goal.error))

  const position = goal.value.goal.stages.findIndex((stage) => stage.id === input.stageId)
  const stage = goal.value.goal.stages[position]
  if (!stage) {
    return err({
      kind: "validation",
      message: `there is no stage "${input.stageId}" in this goal`,
    })
  }

  const meta = JSON.parse(
    await readFile(join(folder, "meta.json"), "utf8"),
  ) as { sources?: SkillSource[] }
  const usable = (meta.sources ?? []).filter((source) => !source.unusable && source.excerpt !== null)
  if (usable.length === 0) {
    return err({
      kind: "blocked",
      message: "this goal has no source this lesson can cite",
      next: "add a source this lesson can cite, then build the stage again",
    })
  }

  const citations: Citation[] = usable.map((source) => ({
    name: source.name,
    location: source.storedPath,
    excerpt: source.excerpt!.text,
  }))

  const valid = validateDraft(input.draft, {
    sources: citations,
    includeSolution: input.includeSolution,
  })
  if (!valid.ok) return valid

  const lessonsDir = join(folder, LESSONS_DIR)
  const path = join(lessonsDir, lessonFileName(position + 1, stage.title))

  let existing: string | null = null
  try {
    existing = await readFile(path, "utf8")
  } catch {
    existing = null
  }

  let existingStatus: "draft" | "ready" = "draft"
  if (existing !== null) {
    const parsed = parseLesson(existing)
    if (parsed.ok) {
      existingStatus = parsed.value.status
      if (parsed.value.status === "ready" && input.confirmed !== true) {
        return err({
          kind: "confirm",
          status: "ready",
          message: `"${stage.title}" already has a ready lesson. Rebuilding replaces its generated sections.`,
        })
      }
    }
  }

  const generated = renderGenerated(input.draft, { includeSolution: input.includeSolution })
  const header = frontmatter(stage.id, citations, existingStatus)
  const markdown =
    existing === null
      ? `${header}# ${stage.title}\n\n${generated}\n`
      : spliceGenerated(withFrontmatter(existing, header), generated)

  const parsedMarkdown = parseLesson(markdown)
  const bodyForCheck = parsedMarkdown.ok ? parsedMarkdown.value.body : markdown
  const checked = validateDocument(bodyForCheck, citations)
  if (!checked.ok) return checked

  try {
    await mkdir(lessonsDir, { recursive: true })
    const temporary = `${path}.tmp-${crypto.randomUUID()}`
    await Bun.write(temporary, markdown)
    await rename(temporary, path)
  } catch (error) {
    return err({
      kind: "storage",
      path,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return ok({ path, markdown, status: existingStatus, citations })
}

function toLessonError(error: GoalError): LessonError {
  if (error.kind === "storage") return error
  return { kind: "validation", message: error.message }
}

/** Checkpoint texts a lesson offers, for WP-404's progress. */
export function lessonCheckpoints(draft: LessonDraft): string[] {
  return checkpointTexts({
    id: "draft",
    stageId: "stage",
    title: "draft",
    status: "draft",
    sources: [],
    sections: draft.checkpoint.map((text) => ({ kind: "checkpoint" as const, blocks: [{ text, sourceId: null, claim: false }] })),
  })
}

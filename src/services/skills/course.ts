/**
 * Skill courses.
 *
 * A skill session is a goal plus a lesson plan: chapters, each with a lesson you
 * read and a practical you work through. The plan is authored once (today from
 * a template; a model fills it in when one is configured) and lives as Markdown
 * on disk — `meta.json` is the index, the chapter files are the content.
 *
 * Layout:
 *
 *   skills/goals/<goalId>/
 *     meta.json
 *     chapters/01-<slug>.md              the lesson
 *     chapters/01-<slug>-practical.md    the exercise
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { confinedJoin } from "../../storage/paths"

import type { Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"

export type Chapter = {
  id: string
  title: string
  /** File names inside `chapters/`; the reader opens these. */
  guide: string
  practical: string
  done: boolean
}

export type Course = {
  schema: 1
  id: string
  name: string
  goal: string
  /** What the learner already knows; empty when they skipped it. */
  prior: string
  created: string
  chapters: Chapter[]
  /** Whether the plan came from the model or the built-in template. */
  plan?: "model" | "template"
}

export type CourseError = { kind: "path" | "storage" | "invalid"; message: string }

export const COURSE_SCHEMA = 1
export const META_FILE = "meta.json"
export const CHAPTERS_DIR = "chapters"

export function courseSlug(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug === "" ? "skill" : slug
}

export function courseId(goal: string, taken: Iterable<string> = []): string {
  const base = courseSlug(goal)
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`
    if (!used.has(candidate)) return candidate
  }
}

export function chapterFileName(index: number, title: string, practical = false): string {
  const number = String(index + 1).padStart(2, "0")
  return `${number}-${courseSlug(title)}${practical ? "-practical" : ""}.md`
}

/**
 * A chapter plan.
 *
 * Until a model writes the plan, this is a small, honest outline: one opening
 * chapter that names the goal, the learner's prior knowledge, and what "done"
 * means. It is deliberately not padded with invented chapters.
 */
export function planChapters(goal: string, prior: string): Array<{ title: string; guide: string; practical: string }> {
  const title = "Getting started"
  const priorLine =
    prior.trim() === ""
      ? "You are starting from scratch, so the first chapter assumes nothing."
      : `You already know: ${prior.trim()}`
  return [
    {
      title,
      guide: [
        `# Lesson: ${title}`,
        "",
        `> Goal: ${goal}`,
        "",
        priorLine,
        "",
        "## What you are learning",
        "",
        `This chapter opens the plan for “${goal}”. Work through it in order: read the`,
        "lesson, then do the practical. Mark the chapter complete when you can explain",
        "it back in your own words without looking.",
        "",
        "## How the plan works",
        "",
        "- Each chapter has a **lesson** (what to read) and a **practical** (what to build or solve).",
        "- The practical never gives you the answer; ask in the chat and it will nudge you.",
        "- Completion is yours to mark: the checkbox in the reader is the record.",
        "",
        "## Checks",
        "",
        "- [ ] I can say what the goal is in one sentence.",
        "- [ ] I know what the first practical will ask me to do.",
        "- [ ] I have written down one question to ask in the chat.",
        "",
      ].join("\n"),
      practical: [
        `# Practical: ${title}`,
        "",
        `> Goal: ${goal}`,
        "",
        "## Exercise",
        "",
        "Write, in your own words, what you expect to be able to do by the end of",
        `“${goal}”. Then list the two things you think will be hardest.`,
        "",
        "## When you are stuck",
        "",
        "Ask in the chat with the chapter open. It will ask you questions rather",
        "than hand you the answer.",
        "",
      ].join("\n"),
    },
  ]
}

export function courseFolder(workspace: Workspace, id: string): string {
  // An id read back from meta.json is untrusted; a bad one must never escape
  // the goals root. The sentinel keeps reads/writes contained and empty.
  return confinedJoin(workspace.paths.goals, id) ?? join(workspace.paths.goals, ".invalid-goal")
}

function chapterFile(folder: string, name: string): string {
  return confinedJoin(join(folder, CHAPTERS_DIR), name) ?? join(folder, CHAPTERS_DIR, ".invalid-chapter")
}

export function coursePaths(workspace: Workspace, course: Course) {
  const folder = courseFolder(workspace, course.id)
  return {
    folder,
    meta: join(folder, META_FILE),
    chapters: join(folder, CHAPTERS_DIR),
    guide: (chapter: Chapter) => chapterFile(folder, chapter.guide),
    practical: (chapter: Chapter) => chapterFile(folder, chapter.practical),
  }
}

export type GeneratedChapter = { title: string; guide: string; practical: string }

/**
 * The seam for a model-written plan.
 *
 * The generator gets the goal and what the learner already knows, and returns
 * chapters in the same shape the template produces. Anything malformed is
 * rejected by `createCourse`, which falls back to the template rather than
 * writing a half-parsed course.
 */
export type PlanGenerator = (input: { goal: string; prior: string }) => Promise<GeneratedChapter[]>

/** Accept only chapters that carry a title and some text in both parts. */
export function usablePlan(chapters: readonly GeneratedChapter[]): chapters is GeneratedChapter[] {
  return (
    chapters.length > 0 &&
    chapters.every(
      (chapter) =>
        typeof chapter.title === "string" &&
        chapter.title.trim() !== "" &&
        typeof chapter.guide === "string" &&
        chapter.guide.trim() !== "" &&
        typeof chapter.practical === "string" &&
        chapter.practical.trim() !== "",
    )
  )
}

/** Write the course and its chapters atomically: temp folder, then rename. */
export async function createCourse(input: {
  workspace: Workspace
  goal: string
  prior?: string
  created: string | Date
  takenIds?: Iterable<string>
  /** A model may write the plan; without one the template is used. */
  generate?: PlanGenerator
}): Promise<Result<Course, CourseError>> {
  const goal = input.goal.trim()
  if (goal === "") {
    return { ok: false, error: { kind: "invalid", message: "A skill session needs a goal." } }
  }
  const prior = (input.prior ?? "").trim()
  const id = courseId(goal, input.takenIds ?? [])
  const created = (typeof input.created === "string" ? new Date(input.created) : input.created).toISOString()

  let plan: GeneratedChapter[] = planChapters(goal, prior)
  let planSource: "model" | "template" = "template"
  if (input.generate) {
    try {
      const generated = await input.generate({ goal, prior })
      if (usablePlan(generated)) {
        plan = generated
        planSource = "model"
      }
    } catch {
      // A failed generation is the template, never a half-written course; the
      // caller can see that from `plan` and tell the user.
    }
  }
  const chapters: Chapter[] = plan.map((entry, index) => ({
    id: `ch-${index + 1}`,
    title: entry.title,
    guide: chapterFileName(index, entry.title),
    practical: chapterFileName(index, entry.title, true),
    done: false,
  }))
  const course: Course = {
    schema: COURSE_SCHEMA,
    id,
    name: goal.slice(0, 60),
    goal,
    prior,
    created,
    chapters,
    plan: planSource,
  }

  const folder = courseFolder(input.workspace, id)
  const temporary = join(input.workspace.paths.goals, `.tmp-${id}-${crypto.randomUUID()}`)
  try {
    await mkdir(join(temporary, CHAPTERS_DIR), { recursive: true })
    for (const [index, entry] of plan.entries()) {
      await writeFile(join(temporary, CHAPTERS_DIR, chapters[index]!.guide), entry.guide, "utf8")
      await writeFile(join(temporary, CHAPTERS_DIR, chapters[index]!.practical), entry.practical, "utf8")
    }
    await writeFile(join(temporary, META_FILE), `${JSON.stringify(course, null, 2)}\n`, "utf8")
    await rename(temporary, folder)
    return { ok: true, value: course }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      error: { kind: "storage", message: `Could not write ${folder}: ${String(error).slice(0, 120)}` },
    }
  }
}

export async function readCourse(workspace: Workspace, id: string): Promise<Result<Course, CourseError>> {
  const folder = courseFolder(workspace, id)
  try {
    const raw = await readFile(join(folder, META_FILE), "utf8")
    const parsed = JSON.parse(raw) as Course
    if (parsed.schema !== COURSE_SCHEMA || !Array.isArray(parsed.chapters)) {
      return { ok: false, error: { kind: "invalid", message: `${id} is not a course this build understands.` } }
    }
    const chaptersDir = join(folder, CHAPTERS_DIR)
    const valid = parsed.chapters.every(
      (chapter) =>
        chapter &&
        typeof chapter.id === "string" &&
        typeof chapter.title === "string" &&
        typeof chapter.guide === "string" &&
        typeof chapter.practical === "string" &&
        // File names come from disk; never let one point outside chapters/.
        confinedJoin(chaptersDir, chapter.guide) !== null &&
        confinedJoin(chaptersDir, chapter.practical) !== null,
    )
    if (!valid) {
      return { ok: false, error: { kind: "invalid", message: `${id} has a malformed chapter index.` } }
    }
    // Older indexes predate the boolean; a missing flag means "not done".
    const chapters = parsed.chapters.map((chapter) => ({ ...chapter, done: chapter.done === true }))
    return { ok: true, value: { ...parsed, chapters } }
  } catch {
    return { ok: false, error: { kind: "storage", message: `No course at ${folder}.` } }
  }
}

export async function readChapter(course: Course, paths: ReturnType<typeof coursePaths>, chapterId: string, practical = false): Promise<Result<string, CourseError>> {
  const chapter = course.chapters.find((entry) => entry.id === chapterId)
  if (!chapter) return { ok: false, error: { kind: "invalid", message: "No such chapter." } }
  try {
    return { ok: true, value: await readFile(practical ? paths.practical(chapter) : paths.guide(chapter), "utf8") }
  } catch {
    return { ok: false, error: { kind: "storage", message: `Could not read ${practical ? "practical" : "guide"}.` } }
  }
}

/** Marking completion rewrites only `meta.json`, never the chapter text. */
export async function markChapter(input: {
  workspace: Workspace
  course: Course
  chapterId: string
  done: boolean
}): Promise<Result<Course, CourseError>> {
  // Re-read before writing: the caller's snapshot may be stale, and an
  // unknown chapter must not report success for a no-op.
  const loaded = await readCourse(input.workspace, input.course.id)
  if (!loaded.ok) return loaded
  const current = loaded.value
  if (!current.chapters.some((chapter) => chapter.id === input.chapterId)) {
    return { ok: false, error: { kind: "invalid", message: "No such chapter." } }
  }
  const chapters = current.chapters.map((chapter) =>
    chapter.id === input.chapterId ? { ...chapter, done: input.done } : chapter,
  )
  const next: Course = { ...current, chapters }
  const paths = coursePaths(input.workspace, next)
  const temporary = `${paths.meta}.tmp-${crypto.randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8")
    await rename(temporary, paths.meta)
    return { ok: true, value: next }
  } catch {
    await rm(temporary, { force: true }).catch(() => {})
    return { ok: false, error: { kind: "storage", message: "Could not save chapter progress." } }
  }
}

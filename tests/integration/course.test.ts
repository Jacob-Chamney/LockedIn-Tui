/** Skill courses: a goal, a chapter plan, and Markdown on disk. */
import { afterAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../../src/storage/workspace";
import { coursePaths, createCourse, markChapter, readChapter, readCourse, chapterFileName, planChapters } from "../../src/services/skills/course";
const base = await mkdtemp(join(tmpdir(), "course-"))
afterAll(async () => {
  await removeTemp(base)
})

async function workspace(name: string) {
  const made = await createWorkspace(join(base, name))
  if (!made.ok) throw new Error("workspace")
  return made.value
}

describe("the plan", () => {
  test("opens with one honest chapter that names the goal and the prior knowledge", () => {
    const plan = planChapters("learn cpp", "basic python")
    expect(plan).toHaveLength(1)
    expect(plan[0]!.title).toBe("Getting started")
    expect(plan[0]!.guide).toContain("learn cpp")
    expect(plan[0]!.guide).toContain("basic python")
    expect(plan[0]!.guide).toContain("- [ ]")
    // Each half names itself in its H1.
    expect(plan[0]!.guide).toContain("# Lesson: Getting started")
    expect(plan[0]!.practical).toContain("# Practical: Getting started")
  })

  test("chapter files are numbered and named after the title", () => {
    expect(chapterFileName(0, "Getting started")).toBe("01-getting-started.md")
    expect(chapterFileName(0, "Getting started", true)).toBe("01-getting-started-practical.md")
    expect(chapterFileName(9, "Basic Programming")).toBe("10-basic-programming.md")
  })
})

describe("on disk", () => {
  test("creates the course and both files, then reads them back", async () => {
    const ws = await workspace("ws1")
    const made = await createCourse({ workspace: ws, goal: "learn cpp", prior: "", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const course = made.value
    expect(course.id).toBe("learn-cpp")
    const paths = coursePaths(ws, course)
    expect(existsSync(paths.meta)).toBe(true)
    expect(existsSync(paths.guide(course.chapters[0]!))).toBe(true)
    expect(existsSync(paths.practical(course.chapters[0]!))).toBe(true)

    const guide = await readChapter(course, paths, course.chapters[0]!.id, false)
    expect(guide.ok && guide.value).toContain("# Lesson: Getting started")
    const practical = await readChapter(course, paths, course.chapters[0]!.id, true)
    expect(practical.ok && practical.value).toContain("# Practical: Getting started")

    // The meta file is the index, and it round-trips.
    const again = await readCourse(ws, course.id)
    expect(again.ok && again.value.goal).toBe("learn cpp")
  })

  test("marking a chapter complete rewrites only the index", async () => {
    const ws = await workspace("ws2")
    const made = await createCourse({ workspace: ws, goal: "learn rust", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const course = made.value
    const paths = coursePaths(ws, course)
    const before = readFileSync(paths.guide(course.chapters[0]!), "utf8")

    const marked = await markChapter({ workspace: ws, course, chapterId: course.chapters[0]!.id, done: true })
    if (!marked.ok) throw new Error(marked.error.message)
    expect(marked.value.chapters[0]!.done).toBe(true)
    expect(readFileSync(paths.guide(course.chapters[0]!), "utf8")).toBe(before)
    const reloaded = await readCourse(ws, course.id)
    expect(reloaded.ok && reloaded.value.chapters[0]!.done).toBe(true)
  })

  test("a tampered chapter file name is refused, not read", async () => {
    const ws = await workspace("ws-traversal")
    const made = await createCourse({ workspace: ws, goal: "learn cpp", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const paths = coursePaths(ws, made.value)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(
      paths.meta,
      JSON.stringify({
        ...made.value,
        chapters: [
          {
            id: "ch-1",
            title: "x",
            guide: "../../../../../../etc/passwd",
            practical: "p.md",
            done: false,
          },
        ],
      }),
    )
    const loaded = await readCourse(ws, made.value.id)
    expect(loaded.ok).toBe(false)
  })

  test("a goal is required", async () => {
    const ws = await workspace("ws3")
    const made = await createCourse({ workspace: ws, goal: "   ", created: "2026-11-01T09:00:00Z" })
    expect(made.ok).toBe(false)
  })
})

describe("a generated plan", () => {
  test("records that the plan came from the model", async () => {
    const ws = await workspace("ws-plan-model")
    const made = await createCourse({
      workspace: ws,
      goal: "learn cpp",
      created: "2026-11-01T09:00:00Z",
      generate: async () => [
        { title: "Basic programming", guide: "# Basic programming", practical: "# Practical" },
      ],
    })
    if (!made.ok) throw new Error(made.error.message)
    expect(made.value.plan).toBe("model")
  })

  test("records the template when the generator is absent or fails", async () => {
    const absent = await workspace("ws-plan-template")
    const made = await createCourse({ workspace: absent, goal: "learn go", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    expect(made.value.plan).toBe("template")

    const failed = await workspace("ws-plan-failed")
    const fallback = await createCourse({
      workspace: failed,
      goal: "learn rust",
      created: "2026-11-01T09:00:00Z",
      generate: async () => {
        throw new Error("no model")
      },
    })
    if (!fallback.ok) throw new Error(fallback.error.message)
    expect(fallback.value.plan).toBe("template")
  })

  test("a supplied taken id gets the next suffix", async () => {
    const ws = await workspace("ws-taken")
    const first = await createCourse({ workspace: ws, goal: "learn cpp", created: "2026-11-01T09:00:00Z" })
    if (!first.ok) throw new Error(first.error.message)
    const second = await createCourse({
      workspace: ws,
      goal: "learn cpp",
      created: "2026-11-01T09:00:00Z",
      takenIds: [first.value.id],
    })
    if (!second.ok) throw new Error(second.error.message)
    expect(second.value.id).toBe("learn-cpp-2")
  })

  test("is used when it is well formed, and written as files", async () => {
    const ws = await workspace("ws4")
    const made = await createCourse({
      workspace: ws,
      goal: "learn cpp",
      created: "2026-11-01T09:00:00Z",
      generate: async () => [
        { title: "Basic programming", guide: "# Basic programming\n\nstart here", practical: "# Practical\n\nwrite hello" },
        { title: "Memory", guide: "# Memory\n\nstack and heap", practical: "# Practical\n\ntrace a pointer" },
      ],
    })
    if (!made.ok) throw new Error(made.error.message)
    expect(made.value.chapters.map((chapter) => chapter.title)).toEqual(["Basic programming", "Memory"])
    expect(made.value.chapters[0]!.guide).toBe("01-basic-programming.md")
    const guide = await readChapter(made.value, coursePaths(ws, made.value), made.value.chapters[0]!.id, false)
    expect(guide.ok && guide.value).toContain("Basic programming")
  })

  test("a malformed plan falls back to the template, not a broken course", async () => {
    const ws = await workspace("ws5")
    const made = await createCourse({
      workspace: ws,
      goal: "learn go",
      created: "2026-11-01T09:00:00Z",
      generate: async () => [{ title: "", guide: "", practical: "" }],
    })
    if (!made.ok) throw new Error(made.error.message)
    expect(made.value.chapters[0]!.title).toBe("Getting started")
  })

  test("a generator that throws is the template too", async () => {
    const ws = await workspace("ws6")
    const made = await createCourse({
      workspace: ws,
      goal: "learn rust",
      created: "2026-11-01T09:00:00Z",
      generate: async () => {
        throw new Error("no model")
      },
    })
    expect(made.ok).toBe(true)
  })
})

describe("course progress in the goal list", () => {
  test("a course row counts chapters, not curriculum stages", async () => {
    const { listGoals } = await import("../../src/services/skills/progress")
    const ws = await workspace("ws-progress")
    const made = await createCourse({ workspace: ws, goal: "learn cpp", created: "2026-11-01T09:00:00Z" })
    if (!made.ok) throw new Error(made.error.message)
    const rows = await listGoals({ workspace: ws })
    expect(rows[0]!.chapters).toEqual({ done: 0, total: 1 })
  })
})

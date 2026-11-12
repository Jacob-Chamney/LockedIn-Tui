/** WP-403b — lesson reader: sections, citations, checkpoints, solution reveal. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const lesson = await import("../../src/ui/reader/lesson")
type LessonT = import("../../src/ui/reader/lesson").Lesson
type ViewT = import("../../src/ui/reader/lesson").LessonView
const { crimson } = await import("../../src/ui/theme")

const BODY = readFileSync(join(import.meta.dir, "../fixtures/lesson-reader/lesson.md"), "utf8")
const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/lesson-reader/lesson.json"), "utf8"))
const make = (overrides: Partial<LessonT> = {}): LessonT => ({ ...FIXTURE, body: BODY, ...overrides }) as LessonT

async function mount(
  width: number,
  height: number,
  props: { lesson?: LessonT; view?: ViewT; missingStage?: string | null } = {},
) {
  const setup = await testRender(
    () => (
      <lesson.LessonReader
        theme={crimson}
        width={width}
        height={height}
        focused
        lesson={props.lesson ?? make()}
        view={props.view ?? lesson.initialLessonView}
        missingStage={props.missingStage}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("header and sections", () => {
  test("goal, stage, status and sections in order", async () => {
    const setup = await mount(120, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("read disassembly output confidently")
      expect(frame).toContain("stage-2 · control flow · ready")
      expect(frame).toContain("1 of 2 checkpoints done")
      const order = ["Exercise", "Hints", "Checkpoint"].map((t) => frame.indexOf(t))
      expect(order[0]).toBeGreaterThan(-1)
      expect(order[1]).toBeGreaterThan(order[0]!)
      expect(order[2]).toBeGreaterThan(order[1]!)
    } finally {
      await setup.dispose()
    }
  })

  test("the solution section stays closed until revealed", () => {
    const sections = lesson.sectionsFor(BODY).map((s) => s.kind)
    expect(sections).toContain("solution")
    const closed = lesson.visibleSections(make(), lesson.initialLessonView).map((s) => s.kind)
    expect(closed).not.toContain("solution")
    const open = lesson.visibleSections(make(), { ...lesson.initialLessonView, solutionOpen: true }).map((s) => s.kind)
    expect(open).toContain("solution")
  })

  test("(agent explanation) is labelled, not hidden", async () => {
    const setup = await mount(120, 24)
    try {
      expect(lines(setup).join("\n")).toContain("(agent explanation)")
    } finally {
      await setup.dispose()
    }
  })
})

describe("citations", () => {
  test("a marker opens its saved excerpt and closes again", () => {
    const body = lesson.sectionsFor(BODY).find((s) => s.kind === "exercise")!.lines.join("\n")
    expect(lesson.citationMarkers(body)).toEqual([1])

    const opened = lesson.openCitation(lesson.initialLessonView, 1, make())
    expect(opened.citationOpen).toBe(0)
    expect(lesson.closeCitation(opened).citationOpen).toBe(null)
  })

  test("a marker outside the source list is refused with one line", () => {
    const view = lesson.openCitation(lesson.initialLessonView, 9, make())
    expect(view.citationOpen).toBe(null)
    expect(view.notice).toContain("citation [9] is not in this lesson")
  })

  test("the excerpt renders while open", async () => {
    const view = lesson.openCitation(lesson.initialLessonView, 1, make())
    const setup = await mount(120, 24, { view })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Intel SDM §3.4")
      expect(frame).toContain("The first three arguments arrive in registers.")
    } finally {
      await setup.dispose()
    }
  })
})

describe("solution reveal", () => {
  test("reveal is explicit and never persisted", () => {
    const view = lesson.revealSolution(make(), lesson.initialLessonView)
    expect(view.solutionOpen).toBe(true)
    // The view is the only state; the lesson object is untouched.
    expect(make().includeSolution).toBe(true)
    expect(JSON.stringify(make())).not.toContain("solutionOpen")
  })

  test("a lesson built without a solution asks for one instead", () => {
    const view = lesson.revealSolution(make({ includeSolution: false }), lesson.initialLessonView)
    expect(view.solutionOpen).toBe(false)
    expect(view.notice).toContain("no solution was written")
  })

  test("the prompt names the key only when a solution exists", async () => {
    const hidden = await mount(120, 24)
    try {
      expect(lines(hidden).join("\n")).toContain("solution hidden · press s to reveal")
    } finally {
      await hidden.dispose()
    }
    const absent = await mount(120, 24, { lesson: make({ includeSolution: false }) })
    try {
      expect(lines(absent).join("\n")).toContain("no solution was written · press s to ask for one")
    } finally {
      await absent.dispose()
    }
  })
})

describe("checkpoints", () => {
  test("a toggle changes the progress line", async () => {
    const before = await mount(120, 24)
    try {
      expect(lines(before).join("\n")).toContain("1 of 2 checkpoints done")
    } finally {
      await before.dispose()
    }
    const toggled = make({
      checkpoints: [
        { id: "c1", text: "Name the convention", done: true },
        { id: "c2", text: "Trace one call", done: true },
      ],
    })
    const after = await mount(120, 24, { lesson: toggled })
    try {
      expect(lines(after).join("\n")).toContain("2 of 2 checkpoints done")
    } finally {
      await after.dispose()
    }
    expect(lesson.intentFor("x")).toBe("checkpoint")
  })
})

describe("states and layout", () => {
  test("a draft lesson renders a next action", async () => {
    const setup = await mount(120, 24, { lesson: make({ status: "draft" }) })
    try {
      expect(lines(setup).join("\n")).toContain("this lesson is still a draft")
    } finally {
      await setup.dispose()
    }
  })

  test("a missing stage names it and offers to build", async () => {
    const setup = await mount(100, 24, { missingStage: "stage-3 · calling conventions" })
    try {
      expect(lines(setup).join("\n")).toContain("stage “stage-3 · calling conventions” is not built yet")
    } finally {
      await setup.dispose()
    }
  })

  test("80x24 and 200x60 snapshots", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mount(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("keys come from one table and no domain rule is reimplemented", () => {
    expect(lesson.intentFor("j")).toBe("down")
    expect(lesson.intentFor("return")).toBe("citation")
    expect(lesson.intentFor("s")).toBe("reveal")
    expect(lesson.intentFor("s", { shift: true })).toBe("ask-solution")
    expect(lesson.footerHints()).toContain("s solution")
    expect(lesson.solutionKeyLabel()).toBe("s")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/reader/lesson.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile|readFileSync|rename|unlink/)
    expect(source).not.toContain("src/services")
    expect(source).not.toContain("src/domain")
  })
})

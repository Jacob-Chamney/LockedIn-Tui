/** `:flashcards` opens an existing deck in the reader. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createCourse } = await import("../../src/services/skills/course")
const { renderDeck, parseDeck } = await import("../../src/services/skills/outputs")

test("a built deck opens in the reader", async () => {
  const base = await mkdtemp(join(tmpdir(), "outputs-ui-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const course = await createCourse({
    workspace: made.value,
    goal: "learn cpp",
    created: "2026-11-01T09:00:00Z",
  })
  if (!course.ok) throw new Error(course.error.message)
  const folder = join(made.value.paths.goals, course.value.id, "outputs")
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, "flashcards.md"),
    renderDeck("learn cpp", [
      { question: "Where is working state held?", answer: "Registers", known: false, missed: false },
    ]),
  )

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} initial={{ pane: "skills" } as never} />,
  })
  try {
    const settled = { timeoutMs: 5_000 }
    await ui.waitUntil(() => ui.frame().includes("learn cpp"), settled)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Chapters"), settled)
    await ui.press(":")
    for (const char of "flashcards") await ui.press(char)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("DECK · learn cpp"), settled)
    expect(ui.frame()).toContain("DECK · learn cpp")
    expect(ui.frame()).toContain("Where is working state held?")

    // Tab flips the card; m marks it missed and rewrites the file.
    await ui.press("tab")
    await ui.waitUntil(() => ui.frame().includes("Registers"), settled)
    expect(ui.frame()).toContain("Registers")
    await ui.press("m")
    await ui.waitUntil(async () => (await readFile(join(folder, "flashcards.md"), "utf8")).includes("M: yes"), settled)
    expect(await readFile(join(folder, "flashcards.md"), "utf8")).toContain("M: yes")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("choosing in missed-only marks the visible missed card", async () => {
  const base = await mkdtemp(join(tmpdir(), "outputs-missed-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const course = await createCourse({
    workspace: made.value,
    goal: "learn cpp",
    created: "2026-11-01T09:00:00Z",
  })
  if (!course.ok) throw new Error(course.error.message)
  const folder = join(made.value.paths.goals, course.value.id, "outputs")
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, "flashcards.md"),
    renderDeck("learn cpp", [
      {
        question: "First question",
        answer: "First answer",
        known: false,
        missed: false,
        choices: [
          { text: "right", correct: true },
          { text: "wrong", correct: false },
        ],
      },
      {
        question: "Missed question",
        answer: "Missed answer",
        known: false,
        missed: true,
        choices: [
          { text: "right", correct: true },
          { text: "wrong", correct: false },
        ],
      },
    ]),
  )

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} initial={{ pane: "skills" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("learn cpp"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Chapters"))
    await ui.press(":")
    for (const char of "flashcards") await ui.press(char)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("DECK · learn cpp"))
    await ui.press("m", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("Missed question"))
    await ui.press("1")
    await ui.waitUntil(async () => {
      const cards = parseDeck(await readFile(join(folder, "flashcards.md"), "utf8"))
      return cards[1]?.known === true
    })
    const cards = parseDeck(await readFile(join(folder, "flashcards.md"), "utf8"))
    expect(cards[1]?.known).toBe(true)
    expect(cards[1]?.missed).toBe(false)
    expect(cards[0]?.known).toBe(false)
  } finally {
    await ui.dispose()
  }
}, 30_000)

/**
 * WP-146 — the review queue built from a real workspace.
 *
 * Sessions, steps, progress telemetry, memory, a deck and a goal are all seeded
 * through the real services, so the queue is exercised against the bytes the app
 * actually writes. The tree is hashed before and after to prove the call is
 * read-only.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { SESSION_FILES } from "../../src/domain/session";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { loadConfig } from "../../src/storage/config";
import { createLockInSession } from "../../src/services/lockin/create";
import { applyTransition } from "../../src/services/skills/progress";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { recordTurn } from "../../src/services/lockin/memory";
import { generateSteps } from "../../src/services/lockin/steps";
import { configuredIntensity, reviewQueue } from "../../src/services/review/queue";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00.000Z"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

let base: string
let workspace: Workspace
let sessionId: string
let sessionFolder: string

/** Every file under the workspace, path → contents: the read-only proof. */
async function treeHash(root: string): Promise<string> {
  const parts: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      parts.push(`${relative(root, path)}:${await readFile(path, "utf8")}`)
    }
  }
  if (existsSync(root)) await walk(root)
  return parts.sort().join("\n")
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "review-queue-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  await mkdir(join(base, "input"), { recursive: true })
  const input = join(base, "input", "lecture-4.md")
  await writeFile(input, "# Unit 4\n\nBoundary conditions.\n")

  const created = unwrap(
    await createLockInSession({
      workspace,
      created: CREATED,
      name: "Physics — Unit 4",
      files: [input],
    }),
  )
  sessionId = created.session.id
  sessionFolder = created.folder

  unwrap(
    await generateSteps({
      folder: sessionFolder,
      plan: {
        phases: [
          { phase: "Understand", items: ["Read section 4.2", "Summarise the boundary conditions"] },
          { phase: "Solve", items: ["Derive the energy balance", "Set up the equations"] },
        ],
      },
      existing: null,
    }),
  )

  // A review telemetry file: three recorded misses on step 3.
  await writeFile(
    join(sessionFolder, SESSION_FILES.progress),
    [
      JSON.stringify({ event: "review", index: 2, result: "missed" }),
      JSON.stringify({ event: "review", index: 2, result: "missed" }),
      JSON.stringify({ event: "review", index: 2, result: "missed" }),
      JSON.stringify({ event: "toggle", index: 0, checked: true }),
      JSON.stringify({ event: "review", index: 1, result: "known" }),
    ].join("\n") + "\n",
  )

  unwrap(
    await recordTurn({
      folder: sessionFolder,
      sessionId,
      outcome: "done",
      points: ["Boundary conditions decide the integral limits."],
      now: CREATED,
    }),
  )

  // A deck with one missed card, one known and one untouched.
  const outputs = join(workspace.paths.root, "school", "outputs", sessionId)
  await mkdir(outputs, { recursive: true })
  await writeFile(
    join(outputs, "flashcards.md"),
    [
      "# Flashcards — Physics",
      "",
      "## Card 1",
      "",
      "Q: What does the learning rate control?",
      "A: The step size.",
      "M: yes",
      "K: no",
      "",
      "## Card 2",
      "",
      "Q: What is a batch?",
      "A: A group of examples.",
      "M: yes",
      "K: yes",
      "",
      "## Card 3",
      "",
      "Q: Never reviewed?",
      "A: Nothing.",
      "M: no",
      "K: no",
      "",
    ].join("\n"),
  )

  // A goal with one done stage and two unfinished.
  const stages: StageDraft[] = [
    { title: "Registers", milestone: "explain a stack frame" },
    { title: "Control flow", milestone: "trace a loop" },
    { title: "Conventions", milestone: "read a prologue" },
  ]
  const goal = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" })),
      stages,
      created: CREATED,
    }),
  )
  unwrap(await applyTransition({ workspace, goalId: goal.goal.id, stageId: "stage-1", action: "done" }))
})

afterEach(async () => {
  await removeTemp(base)
})

describe("items from real state", () => {
  test("unchecked steps, a missed card, unfinished stages and memory", async () => {
    const queue = await reviewQueue(workspace)

    expect(queue.items.map((item) => item.kind)).toEqual([
      "card",
      "step",
      "step",
      "step",
      "step",
      "stage",
      "stage",
      "memory",
    ])
    expect(queue.counts).toEqual({
      total: 8,
      byKind: { card: 1, step: 4, stage: 2, memory: 1 },
    })

    const card = queue.items[0]!
    expect(card.label).toContain("learning rate")
    expect(card.context).toBe("Physics — Unit 4")
    expect(card.reason).toBe("missed")

    const steps = queue.items.filter((item) => item.kind === "step")
    expect(steps.map((item) => item.label)).toContain("Read section 4.2")
    // Recorded misses are read from progress.jsonl, not invented.
    expect(steps.find((item) => item.label === "Derive the energy balance")?.count).toBe(3)

    const stages = queue.items.filter((item) => item.kind === "stage")
    expect(stages.map((item) => item.label)).toEqual(["Control flow", "Conventions"])

    expect(queue.diagnostics).toEqual([])
  })

  test("nothing is read from a note body, a chat turn or plugin output", async () => {
    const notes = join(workspace.paths.schoolVault, "concepts")
    await mkdir(notes, { recursive: true })
    await writeFile(join(notes, "energy.md"), "# Energy\n\nA note that must never become an item.\n")
    await writeFile(
      join(sessionFolder, SESSION_FILES.chat),
      '{"role":"assistant","content":"A chat turn that must never become an item."}\n',
    )

    const queue = await reviewQueue(workspace)
    const labels = queue.items.map((item) => item.label).join(" ")
    expect(labels).not.toContain("must never become an item")
    expect(queue.items.every((item) => ["step", "card", "stage", "memory"].includes(item.kind))).toBe(
      true,
    )
  })

  test("memory is labelled and is not a source", async () => {
    const queue = await reviewQueue(workspace)
    const memory = queue.items.filter((item) => item.kind === "memory")
    expect(memory).toHaveLength(1)
    expect(memory[0]?.origin).toBe("session-memory")
    expect(memory[0]?.reason).toBe("memory")

    // Coverage entries are sources; nothing labelled memory appears among them.
    for (const entry of queue.coverage) {
      expect(entry).not.toHaveProperty("origin")
      expect(entry.name).not.toContain("Boundary conditions decide")
    }
  })
})

describe("robustness", () => {
  test("a broken session is a diagnostic and the rest still appear", async () => {
    const broken = join(workspace.paths.schoolSessions, "2026-01-01-0000-broken")
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, SESSION_FILES.meta), "{ not json")

    const queue = await reviewQueue(workspace)
    expect(queue.diagnostics.length).toBeGreaterThan(0)
    expect(queue.diagnostics[0]?.path).toContain("2026-01-01-0000-broken")
    expect(queue.diagnostics[0]?.next.length).toBeGreaterThan(0)
    // The healthy session and goal still contribute.
    expect(queue.items.filter((item) => item.kind === "step")).toHaveLength(4)
    expect(queue.items.filter((item) => item.kind === "stage")).toHaveLength(2)
  })

  test("an unparseable steps file is a diagnostic, not a crash", async () => {
    await writeFile(join(sessionFolder, SESSION_FILES.steps), "> broken steps done\n- [ ] x\n")
    const queue = await reviewQueue(workspace)
    expect(queue.diagnostics.some((entry) => entry.message.includes("steps"))).toBe(true)
    expect(queue.items.some((item) => item.kind === "card")).toBe(true)
  })

  test("an empty workspace is an empty queue with no diagnostic", async () => {
    const empty = unwrap(await createWorkspace(join(base, "empty")))
    const queue = await reviewQueue(empty)
    expect(queue.items).toEqual([])
    expect(queue.diagnostics).toEqual([])
    expect(queue.counts.total).toBe(0)
  })
})

describe("the call is read-only", () => {
  test("the workspace tree is byte-identical afterwards", async () => {
    const before = await treeHash(workspace.root)
    await reviewQueue(workspace)
    const after = await treeHash(workspace.root)
    expect(after).toBe(before)
  })

  test("two calls return the same order", async () => {
    const first = await reviewQueue(workspace)
    const second = await reviewQueue(workspace)
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))
  })
})

describe("nudge intensity", () => {
  test("intensive shows at least as much as gentle for the same state", async () => {
    const gentle = await reviewQueue(workspace, { intensity: "gentle" })
    const balanced = await reviewQueue(workspace, { intensity: "balanced" })
    const intensive = await reviewQueue(workspace, { intensity: "intensive" })

    expect(gentle.nudge.threshold).toBe(5)
    expect(balanced.nudge.threshold).toBe(3)
    expect(intensive.nudge.threshold).toBe(2)

    // The three recorded misses on one step cross balanced and intensive, not gentle.
    expect(gentle.nudge.due).toHaveLength(0)
    expect(balanced.nudge.due.length).toBe(1)
    expect(intensive.nudge.due.length).toBeGreaterThanOrEqual(balanced.nudge.due.length)
    expect(intensive.nudge.suggestions.length).toBeGreaterThanOrEqual(
      balanced.nudge.suggestions.length,
    )
  })

  test("intensity comes from config when no override is given", async () => {
    // `loadConfig` writes the documented defaults on first run, so the file the
    // service reads is the one the app creates.
    unwrap(await loadConfig(workspace.paths))
    expect(await configuredIntensity(workspace)).toBe("balanced")
    await writeFile(
      join(workspace.paths.config),
      (await readFile(workspace.paths.config, "utf8")).replace(
        'nudge_intensity = "balanced"',
        'nudge_intensity = "intensive"',
      ),
    )
    expect(await configuredIntensity(workspace)).toBe("intensive")
    expect((await reviewQueue(workspace)).nudge.threshold).toBe(2)
  })
})

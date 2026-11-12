/** Guide/deck generation shapes one JSON ask into the service's files. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTemp } from "../helpers/cleanup";
import { createWorkspace } from "../../src/storage/workspace";
import { saveGoal, validateInput } from "../../src/services/skills/create";
import { gatherSources } from "../../src/services/skills/gather";
import { buildOutput } from "../../src/app/actions/outputs";
const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function goal() {
  const base = await mkdtemp(join(tmpdir(), "outputs-gen-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const validated = validateInput({ statement: "learn cpp", level: "beginner", timeBudget: "4 weeks" })
  if (!validated.ok) throw new Error(validated.error.message)
  const saved = await saveGoal({
    workspace: made.value,
    input: validated.value,
    stages: [
      { title: "Registers", milestone: "explain a frame" },
      { title: "Control flow", milestone: "trace a loop" },
      { title: "Conventions", milestone: "read a prologue" },
    ],
    created: "2026-11-01T09:00:00Z",
  })
  if (!saved.ok) throw new Error(saved.error.message)
  const input = join(base, "notes.md")
  await writeFile(input, "# Registers\n\nRegisters hold working state.\n")
  const gathered = await gatherSources({ workspace: made.value, goalId: saved.value.goal.id, retrievedAt: "2026-11-01T10:00:00Z" }, [
    { kind: "file", path: input },
  ])
  if (!gathered.ok) throw new Error("gather")
  return { workspace: made.value, goalId: saved.value.goal.id, folder: saved.value.folder }
}

test("a guide is generated, validated and returned as reader lines", async () => {
  const { workspace, goalId } = await goal()
  const result = await buildOutput({
    workspace,
    goalId,
    kind: "guide",
    generate: async () =>
      JSON.stringify({
        sections: [
          { heading: "Registers", body: ["[src: notes.md] Registers hold working state."], answer: "working state" },
        ],
      }),
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(result.value.lines.join("\n")).toContain("## Registers")
  expect(result.value.lines.join("\n")).toContain("0 of 1 sections reviewed")
})

test("a deck is generated with one correct choice per card", async () => {
  const { workspace, goalId } = await goal()
  const result = await buildOutput({
    workspace,
    goalId,
    kind: "deck",
    generate: async () =>
      JSON.stringify({
        cards: [
          {
            question: "Where is working state held?",
            answer: "Registers",
            choices: [
              { text: "Registers", correct: true },
              { text: "Disk", correct: false },
            ],
          },
        ],
      }),
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(result.value.lines.join("\n")).toContain("Q: Where is working state held?")
})

test("a bad citation is refused and writes nothing", async () => {
  const { workspace, goalId, folder } = await goal()
  const before = await readFile(join(folder, "meta.json"), "utf8")
  const result = await buildOutput({
    workspace,
    goalId,
    kind: "guide",
    generate: async () =>
      JSON.stringify({
        sections: [{ heading: "Claim", body: ["[src: missing.md] invented"], answer: "x" }],
      }),
  })
  expect(result.ok).toBe(false)
  expect(await readFile(join(folder, "meta.json"), "utf8")).toBe(before)
})

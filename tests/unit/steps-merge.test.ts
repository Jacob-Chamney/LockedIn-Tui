/**
 * WP-303 — generation, merge and toggle for `assignment-steps.md`.
 *
 * The checkbox rules belong to `src/domain/progress.ts`; these tests assert the
 * service contract around them: nothing is written when generation is invalid
 * or unconfirmed, and a toggle rewrites one character plus the progress line.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Result } from "../../src/domain/markdown"
import { parseProgress } from "../../src/domain/progress"
import {
  MIN_ITEMS,
  broadSteps,
  generateSteps,
  previewMerge,
  readSteps,
  renderSteps,
  stepsPath,
  toggleStep,
  validatePlan,
  writeSteps,
  type StepPlan,
  type StepsError,
} from "../../src/services/lockin/steps"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, StepsError>): StepsError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const PLAN: StepPlan = {
  phases: [
    { phase: "Understand", items: ["Read section 4.2", "Summarise the boundary conditions"] },
    { phase: "Solve", items: ["Derive the energy balance", "Set up the equations"] },
  ],
}

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(TEMP_BASE, "steps-"))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
})

describe("validatePlan", () => {
  test("accepts a flat plan with at least four steps", () => {
    expect(unwrap(validatePlan(PLAN))).toEqual(PLAN)
  })

  test("rejects fewer than four steps", () => {
    const error = errorOf(validatePlan({ phases: [{ phase: "Only", items: ["a", "b", "c"] }] }))
    expect(error.kind).toBe("provider")
    if (error.kind !== "provider") return
    expect(error.message).toContain(String(MIN_ITEMS))
    expect(error.next).toContain("Regenerate")
  })

  test("accepts a language name with a hash", () => {
    const plan: StepPlan = {
      phases: [
        { phase: "C# basics", items: ["Read a type", "Compile a file"] },
        { phase: "F# basics", items: ["Write a function", "Pattern match"] },
      ],
    }
    expect(unwrap(validatePlan(plan))).toEqual(plan)
  })

  test("rejects a nested list item", () => {
    const error = errorOf(
      validatePlan({ phases: [{ phase: "P", items: ["a", "b", "c", "- [ ] nested"] }] }),
    )
    expect(error.kind).toBe("provider")
    if (error.kind !== "provider") return
    expect(error.message).toContain("nested")
  })

  test("rejects a code fence", () => {
    const error = errorOf(validatePlan({ phases: [{ phase: "P", items: ["a", "b", "c", "```ts"] }] }))
    expect(error.kind).toBe("provider")
  })

  test("rejects an over-long step", () => {
    const error = errorOf(validatePlan({ phases: [{ phase: "P", items: ["a", "b", "c", "x".repeat(301)] }] }))
    expect(error.kind).toBe("provider")
    if (error.kind !== "provider") return
    expect(error.message).toContain("300")
  })

  test("rejects an empty phase, an empty step and a multi-line step", () => {
    expect(errorOf(validatePlan({ phases: [{ phase: " ", items: ["a", "b", "c", "d"] }] })).kind).toBe("provider")
    expect(errorOf(validatePlan({ phases: [{ phase: "P", items: ["a", "b", "c", "  "] }] })).kind).toBe("provider")
    expect(errorOf(validatePlan({ phases: [{ phase: "P", items: ["a", "b", "c", "x\ny"] }] })).kind).toBe("provider")
  })

  test("flags generic study verbs but accepts concrete file and symbol steps", () => {
    const broad = broadSteps({
      phases: [
        {
          phase: "Work",
          items: [
            "Review the assignment",
            "Understand the concept",
            "Implement operator-= in ComplexNumbers.cpp",
            "Open notes.md and list the registers",
          ],
        },
      ],
    })
    expect(broad.map((step) => step.text)).toEqual([
      "Review the assignment",
      "Understand the concept",
    ])
  })
})

describe("renderSteps", () => {
  test("emits the documented shape: one title, one progress line, h2 phases, flat items", () => {
    const markdown = renderSteps(PLAN)
    const lines = markdown.split("\n")
    expect(lines[0]).toBe("# Assignment steps")
    expect(lines.filter((line) => line.startsWith("# ")).length).toBe(1)
    expect(lines.filter((line) => line.startsWith("> ")).length).toBe(1)
    expect(lines).toContain("> 0 of 4 steps done")
    expect(lines.filter((line) => line.startsWith("## "))).toHaveLength(2)
    expect(lines.filter((line) => line.startsWith("- [ ] "))).toHaveLength(4)
    expect(markdown).not.toContain("- [x]")
  })

  test("the progress line matches the parsed item count", () => {
    const parsed = unwrap(parseProgress(renderSteps(PLAN)))
    expect(parsed.total).toBe(4)
    expect(parsed.checked).toBe(0)
    expect(parsed.progressLine).not.toBeNull()
  })
})

describe("generateSteps", () => {
  test("a valid plan writes the file with a correct progress line", async () => {
    const outcome = unwrap(await generateSteps({ folder, plan: PLAN }))
    expect(outcome.written).toBe(true)

    const onDisk = await readFile(stepsPath(folder), "utf8")
    expect(onDisk).toBe(outcome.markdown)
    expect(onDisk).toContain("> 0 of 4 steps done")
    expect(existsSync(stepsPath(folder))).toBe(true)
  })

  test("an invalid plan writes nothing", async () => {
    const error = errorOf(
      await generateSteps({ folder, plan: { phases: [{ phase: "P", items: ["a", "b", "c"] }] } }),
    )
    expect(error.kind).toBe("provider")
    expect(existsSync(stepsPath(folder))).toBe(false)
  })

  test("regenerating with checked steps asks first and writes nothing", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    unwrap(await toggleStep({ folder, index: 0 }))
    unwrap(await toggleStep({ folder, index: 1 }))
    const before = await readFile(stepsPath(folder), "utf8")

    const error = errorOf(await generateSteps({ folder, plan: PLAN }))
    expect(error.kind).toBe("confirm")
    if (error.kind !== "confirm") return
    expect(error.kept).toBe(2)
    expect(error.lost).toBe(0)
    expect(error.message).toContain("keeps 2")
    expect(await readFile(stepsPath(folder), "utf8")).toBe(before)
  })

  test("confirmed regeneration keeps every tick whose text survives", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    unwrap(await toggleStep({ folder, index: 0 }))

    const outcome = unwrap(await generateSteps({ folder, plan: PLAN, confirmed: true }))
    expect(outcome.kept).toBe(1)
    expect(outcome.lost).toBe(0)

    const parsed = unwrap(parseProgress(await readFile(stepsPath(folder), "utf8")))
    expect(parsed.checked).toBe(1)
    expect(parsed.total).toBe(4)
  })

  test("an edited step text drops its tick and the confirmation says so", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    unwrap(await toggleStep({ folder, index: 0 }))

    const edited: StepPlan = {
      phases: [
        { phase: "Understand", items: ["Read section 4.3", "Summarise the boundary conditions"] },
        { phase: "Solve", items: ["Derive the energy balance", "Set up the equations"] },
      ],
    }

    const preview = previewMerge(await readSteps(folder), renderSteps(edited))
    expect(preview.kept).toBe(0)
    expect(preview.lost).toBe(1)
    expect(preview.lostTexts).toEqual(["Read section 4.2"])

    const outcome = unwrap(await generateSteps({ folder, plan: edited, confirmed: true }))
    expect(outcome.kept).toBe(0)
    expect(outcome.lost).toBe(1)

    const parsed = unwrap(parseProgress(await readFile(stepsPath(folder), "utf8")))
    expect(parsed.checked).toBe(0)
  })

  test("a cancelled regeneration leaves the previous bytes identical", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    unwrap(await toggleStep({ folder, index: 2 }))
    const before = await readFile(stepsPath(folder), "utf8")

    // No `confirmed` flag: the service must refuse and stop.
    errorOf(await generateSteps({ folder, plan: PLAN }))
    expect(await readFile(stepsPath(folder), "utf8")).toBe(before)
  })
})

describe("toggleStep", () => {
  test("row 3 changes exactly one bracket character and the progress line", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    const before = await readFile(stepsPath(folder), "utf8")

    const snapshot = unwrap(await toggleStep({ folder, index: 2 }))
    const after = await readFile(stepsPath(folder), "utf8")

    expect(snapshot.checked).toBe(true)
    expect(snapshot.checkedCount).toBe(1)
    expect(snapshot.total).toBe(4)

    // Compare with the progress line masked: only the bracket may differ.
    const mask = (text: string) =>
      text.split("\n").map((line) => (line.startsWith("> ") ? "> <progress>" : line)).join("\n")
    const changed = [...mask(before)]
      .map((char, at) => (mask(after)[at] === char ? null : at))
      .filter((at) => at !== null)
    expect(changed.length).toBe(1)
    const at = changed[0]!
    expect([mask(before)[at], mask(after)[at]]).toEqual([" ", "x"])

    expect(after).toContain("> 1 of 4 steps done")
  })

  test("toggling twice restores the original bytes", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    const before = await readFile(stepsPath(folder), "utf8")
    unwrap(await toggleStep({ folder, index: 1 }))
    unwrap(await toggleStep({ folder, index: 1 }))
    expect(await readFile(stepsPath(folder), "utf8")).toBe(before)
  })

  test("a missing file is a blocked action with the next step", async () => {
    const error = errorOf(await toggleStep({ folder, index: 0 }))
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toContain("build them first")
  })

  test("an out-of-range index is refused and the file is untouched", async () => {
    unwrap(await generateSteps({ folder, plan: PLAN }))
    const before = await readFile(stepsPath(folder), "utf8")
    expect(errorOf(await toggleStep({ folder, index: 9 })).kind).toBe("blocked")
    expect(await readFile(stepsPath(folder), "utf8")).toBe(before)
  })
})

describe("writeSteps", () => {
  test("replaces atomically and leaves no temporary file", async () => {
    unwrap(await writeSteps(folder, "# Assignment steps\n\n> 0 of 0 steps done\n"))
    expect(await readFile(stepsPath(folder), "utf8")).toContain("0 of 0")
    const leftovers = (await import("node:fs/promises")).readdir(folder)
    expect((await leftovers).filter((name) => name.includes(".tmp-"))).toEqual([])
  })

  test("an unwritable folder is a typed storage error", async () => {
    // A file where a directory is needed: the write cannot succeed.
    const blocker = join(folder, "blocker")
    await writeFile(blocker, "not a folder")
    const error = errorOf(await writeSteps(join(blocker, "session"), "# x\n"))
    expect(error.kind).toBe("storage")
  })
})

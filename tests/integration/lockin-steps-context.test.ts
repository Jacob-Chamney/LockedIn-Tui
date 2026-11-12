/** Step generation sees the assignment PDF, not the old generic steps. */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace } from "../../src/storage/workspace"
import { createLockInSession } from "../../src/services/lockin/create"
import { regenerateSessionSteps } from "../../src/app/actions/lockin"
import { writeSteps } from "../../src/services/lockin/steps"
import { buildPdf } from "../unit/helpers/ooxml"

const cleanup: string[] = []
const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

const OLD_STEPS = [
  "# Assignment steps",
  "",
  "> 1 of 2 steps done",
  "",
  "## Understand",
  "",
  "- [x] OLD-GENERIC-STEP",
  "- [ ] Another old step",
  "",
].join("\n")

test("the assignment pdf reaches the generation prompt and old steps do not", async () => {
  if (!pdftotext) return
  const base = await mkdtemp(join(tmpdir(), "lockin-steps-pdf-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const pdf = join(base, "ComplexNumbers.pdf")
  await writeFile(
    pdf,
    buildPdf({
      text: [
        "COMPLEX NUMBERS HOMEWORK",
        "SUBTRACTION: Add operator- and operator-=.",
        "MULTIPLICATION: Overload operator* and operator*=.",
        "MAGNITUDE and the conjugate.",
      ],
    }),
  )
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Complex numbers",
    prompt: "ComplexNumbers.pdf contains the assignment instructions.",
    files: [pdf],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  await writeSteps(created.value.folder, OLD_STEPS)

  const prompts: string[] = []
  const result = await regenerateSessionSteps({
    workspace: made.value,
    id: created.value.session.id,
    generate: async (prompt) => {
      prompts.push(prompt)
      return JSON.stringify({
        phases: [
          { phase: "Arithmetic", items: ["Implement operator-", "Implement operator*", "Implement magnitude", "Implement conjugate"] },
          { phase: "Verify", items: ["Run the demo", "Capture the screenshot"] },
        ],
      })
    },
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain("SUBTRACTION")
  expect(prompts[0]).toContain("MULTIPLICATION")
  expect(prompts[0]).toContain("MAGNITUDE")
  expect(prompts[0]).not.toContain("OLD-GENERIC-STEP")
  expect(prompts[0]).not.toContain("Assignment steps (assignment-steps.md)")
  expect(result.value.kept).toBe(0)
  expect(result.value.lost).toBe(1)

  const onDisk = await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")
  expect(onDisk).toContain("Implement operator-")
  expect(onDisk).not.toContain("OLD-GENERIC-STEP")
})

test("an unreadable assignment pdf stops generation and names the file", async () => {
  if (!pdftotext) return
  const base = await mkdtemp(join(tmpdir(), "lockin-steps-scanned-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const pdf = join(base, "scanned-homework.pdf")
  await writeFile(pdf, buildPdf({ text: [] }))
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Scanned",
    prompt: "Do the homework.",
    files: [pdf],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  let called = false
  const result = await regenerateSessionSteps({
    workspace: made.value,
    id: created.value.session.id,
    generate: async () => {
      called = true
      return "{}"
    },
  })
  expect(called).toBe(false)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.message).toContain("scanned-homework.pdf")
  expect(result.error.message).toContain("OCR is not supported")
})

test("a broad first plan triggers one concrete refinement pass", async () => {
  const base = await mkdtemp(join(tmpdir(), "lockin-steps-refine-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nImplement operator-= in ComplexNumbers.h.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Refinement",
    prompt: "Follow the notes.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const prompts: string[] = []
  const result = await regenerateSessionSteps({
    workspace: made.value,
    id: created.value.session.id,
    generate: async (prompt) => {
      prompts.push(prompt)
      if (prompts.length === 1) {
        return JSON.stringify({
          phases: [
            {
              phase: "Understanding",
              items: ["Review the assignment", "Understand the concept", "Study the material", "Familiarize yourself with the topic"],
            },
          ],
        })
      }
      return JSON.stringify({
        phases: [
          {
            phase: "Implement subtraction",
            items: [
              "Declare operator-= in ComplexNumbers.h",
              "Implement operator-= in ComplexNumbers.cpp",
              "Compile ComplexNumbersDemo.cpp and verify subtraction output",
              "Run the demo and compare the expected subtraction result",
            ],
          },
        ],
      })
    },
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain("too broad")
  expect(result.value.markdown).toContain("Declare operator-= in ComplexNumbers.h")
  expect(result.value.markdown).not.toContain("Review the assignment")
})

test("fenced JSON and trailing commas are accepted", async () => {
  const base = await mkdtemp(join(tmpdir(), "lockin-steps-json-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nImplement operator-= in ComplexNumbers.h.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "JSON",
    prompt: "Follow the notes.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const result = await regenerateSessionSteps({
    workspace: made.value,
    id: created.value.session.id,
    generate: async () =>
      [
        "```json",
        "{",
        '  "phases": [',
        "    {",
        '      "phase": "Implement",',
        '      "items": [',
        '        "Declare operator-= in ComplexNumbers.h",',
        '        "Implement operator-= in ComplexNumbers.cpp",',
        '        "Compile ComplexNumbersDemo.cpp and verify output",',
        '        "Run the demo and compare the subtraction result",',
        "      ],",
        "    },",
        "  ],",
        "}",
        "```",
      ].join("\n"),
  })
  if (!result.ok) throw new Error(result.error.message)
  expect(result.value.markdown).toContain("Declare operator-= in ComplexNumbers.h")
})

test("incomplete JSON is reported as incomplete, not a crash", async () => {
  const base = await mkdtemp(join(tmpdir(), "lockin-steps-incomplete-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nImplement operator-= in ComplexNumbers.h.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Incomplete",
    prompt: "Follow the notes.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const result = await regenerateSessionSteps({
    workspace: made.value,
    id: created.value.session.id,
    generate: async () => '{"phases":[{"phase":"Work","items":["Declare operator-= in ComplexNumbers.h"',
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.message).toContain("incomplete JSON")
})

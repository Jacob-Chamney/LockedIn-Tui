/** Instruction files: copy the original, extract to prompt.md, keep provenance. */
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace } from "../../src/storage/workspace"
import { createLockInSession } from "../../src/services/lockin/create"
import {
  importSessionInstructions,
  loadSessionSettings,
  reExtractInstructions,
  saveSessionPrompt,
} from "../../src/services/lockin/instructions"
import { sessionContextReport } from "../../src/services/lockin/context"
import { buildPdf } from "../unit/helpers/ooxml"

const cleanup: string[] = []
const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
const NOW = () => new Date("2026-11-07T18:00:00Z")

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function setup(prompt = "Initial instructions.") {
  const base = await mkdtemp(join(tmpdir(), "lockin-instructions-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-07T16:56:00Z",
    name: "Complex numbers",
    prompt,
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  return { base, workspace: made.value, folder: created.value.folder, id: created.value.session.id }
}

test("importing a pdf copies the original, extracts prompt.md and records provenance", async () => {
  if (!pdftotext) return
  const { base, workspace, folder, id } = await setup()
  const pdf = join(base, "ComplexNumbers.pdf")
  await writeFile(
    pdf,
    buildPdf({ text: ["COMPLEX NUMBERS HOMEWORK", "SUBTRACTION", "MULTIPLICATION", "MAGNITUDE"] }),
  )

  const imported = await importSessionInstructions({ workspace, id, file: pdf, now: NOW })
  if (!imported.ok) throw new Error(imported.error.message)
  expect(imported.value.prompt).toContain("SUBTRACTION")
  expect(imported.value.instructions.name).toBe("ComplexNumbers.pdf")
  expect(imported.value.instructions.kind).toBe("pdf")
  expect(imported.value.instructions.extractedAt).toBe(NOW().toISOString())
  expect(imported.value.instructions.storedPath.startsWith("sources/")).toBe(true)
  expect(existsSync(join(folder, imported.value.instructions.storedPath))).toBe(true)
  expect(await readFile(join(folder, "prompt.md"), "utf8")).toContain("MULTIPLICATION")

  const meta = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as {
    prompt: string
    instructions_source: { name: string; extracted_at: string; stored_path: string }
  }
  expect(meta.prompt).toContain("SUBTRACTION")
  expect(meta.instructions_source.name).toBe("ComplexNumbers.pdf")
  expect(meta.instructions_source.extracted_at).toBe(NOW().toISOString())
  expect(meta.instructions_source.stored_path).toBe(imported.value.instructions.storedPath)

  const loaded = await loadSessionSettings({ workspace, id })
  if (!loaded.ok) throw new Error(loaded.error.message)
  expect(loaded.value.originalPresent).toBe(true)
  expect(loaded.value.instructions?.hash).toBe(imported.value.instructions.hash)

  // The instruction file is also a source; context must not include it twice.
  const report = await sessionContextReport(workspace, id, { includeSteps: false, includeOutputs: false })
  expect(report.text.match(/SUBTRACTION/g)?.length ?? 0).toBe(1)
})

test("editing the prompt updates prompt.md and meta.prompt but keeps the original", async () => {
  if (!pdftotext) return
  const { base, workspace, folder, id } = await setup()
  const pdf = join(base, "ComplexNumbers.pdf")
  await writeFile(pdf, buildPdf({ text: ["Original assignment text"] }))
  const imported = await importSessionInstructions({ workspace, id, file: pdf, now: NOW })
  if (!imported.ok) throw new Error(imported.error.message)
  const stored = join(folder, imported.value.instructions.storedPath)

  const saved = await saveSessionPrompt({ workspace, id, text: "Edited by hand." })
  if (!saved.ok) throw new Error(saved.error.message)
  expect(await readFile(join(folder, "prompt.md"), "utf8")).toBe("Edited by hand.")
  const meta = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as {
    prompt: string
    instructions_source: { stored_path: string }
  }
  expect(meta.prompt).toBe("Edited by hand.")
  expect(meta.instructions_source.stored_path).toBe(imported.value.instructions.storedPath)
  expect(existsSync(stored)).toBe(true)

  const reExtracted = await reExtractInstructions({ workspace, id, now: NOW })
  if (!reExtracted.ok) throw new Error(reExtracted.error.message)
  expect(reExtracted.value.prompt).toContain("Original assignment text")
  expect(reExtracted.value.instructions.name).toBe("ComplexNumbers.pdf")
})

test("a scanned pdf fails without changing prompt.md or meta.json", async () => {
  if (!pdftotext) return
  const { base, workspace, folder, id } = await setup()
  const pdf = join(base, "scanned.pdf")
  await writeFile(pdf, buildPdf({ text: [] }))
  const beforePrompt = await readFile(join(folder, "prompt.md"), "utf8")
  const beforeMeta = await readFile(join(folder, "meta.json"), "utf8")

  const imported = await importSessionInstructions({ workspace, id, file: pdf, now: NOW })
  expect(imported.ok).toBe(false)
  if (imported.ok) return
  expect(imported.error.kind).toBe("extraction")
  expect(imported.error.message).toContain("OCR is not supported")
  expect(await readFile(join(folder, "prompt.md"), "utf8")).toBe(beforePrompt)
  expect(await readFile(join(folder, "meta.json"), "utf8")).toBe(beforeMeta)
})

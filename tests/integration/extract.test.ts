/**
 * WP-307 — extraction against real files.
 *
 * The unit suite proves the rules; this one proves the pipeline: bytes on disk
 * in, text and hash out, with nothing else read or written.
 *
 * Fixtures are generated into a temp directory by the same deterministic
 * helpers the unit suite uses, instead of being committed under
 * `tests/fixtures/extract/**`. Reason: the ZIP and PNG payloads need
 * compression at build time, and the generators are the reviewable artifact.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extract, type ExtractError, type Extraction } from "../../src/services/extract"
import { buildDocumentXml, buildPdf, buildPng, buildZip } from "../unit/helpers/ooxml"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
/**
 * PDF extraction needs `pdftotext` (poppler). Without it the PDF assertions
 * would fail with a product-looking error, so they skip with a reason instead
 * of passing silently. Declared in `docs/testing.md` §1.
 */
const PDF_TOOL = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
const PDF_SKIP_REASON =
  "pdftotext not found — install poppler (apt install poppler-utils / brew install poppler)"
if (!PDF_TOOL) console.warn(`SKIP (pdf): ${PDF_SKIP_REASON}`)
const pdfTest = PDF_TOOL ? test : test.skip

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(TEMP_BASE, "extract-integration-"))
  await writeFile(join(root, "notes.md"), "# Unit 4\n\nBoundary conditions.\n")
  await writeFile(join(root, "notes.txt"), "Energy balance\r\n\r\nThe rate of change.\r\n")
  await writeFile(join(root, "snippet.ts"), "export function f() {\n  return 1\n}\n")
  await writeFile(join(root, "sample.pdf"), buildPdf())
  await writeFile(join(root, "scanned.pdf"), buildPdf({ text: [] }))
  await writeFile(join(root, "broken.pdf"), "definitely not a pdf\n")
  await writeFile(join(root, "sample.docx"), await buildZip(buildDocumentXml()))
  await writeFile(join(root, "broken.docx"), "not a zip at all\n")
  await writeFile(join(root, "invalid.txt"), new Uint8Array([0x41, 0xc3, 0x28, 0x42]))
  await writeFile(join(root, "image.png"), await buildPng())
  await writeFile(join(root, "stray.bin"), new Uint8Array([0, 1, 2, 3]))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
})

function ok(result: Awaited<ReturnType<typeof extract>>): Extraction {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result
}

function errorOf(result: Awaited<ReturnType<typeof extract>>): ExtractError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

/** Every accepted kind, end to end. */
describe("the S7 fixture matrix, as files", () => {
  test("markdown, text and code extract as text", async () => {
    const md = ok(await extract(join(root, "notes.md")))
    expect(md.kind).toBe("markdown")
    expect(md.text).toBe("# Unit 4\n\nBoundary conditions.")

    const txt = ok(await extract(join(root, "notes.txt")))
    expect(txt.kind).toBe("text")
    expect(txt.text).toBe("Energy balance\n\nThe rate of change.")

    const code = ok(await extract(join(root, "snippet.ts")))
    expect(code.kind).toBe("code")
    expect(code.text).toBe("export function f() {\n  return 1\n}")
  })

  pdfTest("a text PDF extracts with a page count", async () => {
    const pdf = ok(await extract(join(root, "sample.pdf")))
    expect(pdf.kind).toBe("pdf")
    expect(pdf.pages).toBe(2)
    expect(pdf.text).toStartWith("LockedIn source pipeline")
    expect(pdf.text).toContain("Page two: energy balance.")
  })

  pdfTest("a PDF without a text layer is refused, never returned empty", async () => {
    expect(errorOf(await extract(join(root, "scanned.pdf"))).kind).toBe("no-text")
  })

  pdfTest("garbage with a .pdf extension is malformed", async () => {
    const error = errorOf(await extract(join(root, "broken.pdf")))
    expect(error.kind).toBe("malformed")
    if (error.kind !== "malformed") return
    expect(error.message).toStartWith("not a readable PDF:")
  })

  test("DOCX text matches the spike exactly", async () => {
    const docx = ok(await extract(join(root, "sample.docx")))
    expect(docx.kind).toBe("docx")
    expect(docx.text).toBe("LockedIn source pipeline\nEnergy balance & limits\nStep one\tdetail")
  })

  test("a non-zip .docx is malformed", async () => {
    expect(errorOf(await extract(join(root, "broken.docx"))).kind).toBe("malformed")
  })

  test("invalid UTF-8 is refused", async () => {
    const error = errorOf(await extract(join(root, "invalid.txt")))
    expect(error.kind).toBe("malformed")
  })

  test("images have no text path, but an unknown extension is read as text", async () => {
    expect(errorOf(await extract(join(root, "image.png"))).kind).toBe("unsupported")
    const stray = ok(await extract(join(root, "stray.bin")))
    expect(stray.kind).toBe("other")
    expect(stray.text.length).toBeGreaterThan(0)
  })
})

describe("the hash is the dedupe key", () => {
  test("it equals the SHA-256 of the bytes on disk", async () => {
    for (const name of ["notes.md", "sample.docx"]) {
      const bytes = new Uint8Array(await Bun.file(join(root, name)).arrayBuffer())
      const expected = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
      expect(ok(await extract(join(root, name))).hash).toBe(expected)
    }
  })

  test("identical content in two files shares a hash", async () => {
    await writeFile(join(root, "notes-copy.md"), "# Unit 4\n\nBoundary conditions.\n")
    expect(ok(await extract(join(root, "notes-copy.md"))).hash).toBe(
      ok(await extract(join(root, "notes.md"))).hash,
    )
  })

  test("different content gives a different hash", async () => {
    expect(ok(await extract(join(root, "notes.md"))).hash).not.toBe(
      ok(await extract(join(root, "notes.txt"))).hash,
    )
  })
})

describe("determinism and isolation", () => {
  test("two runs over the same file are identical, counts included", async () => {
    const first = ok(await extract(join(root, "sample.docx")))
    const second = ok(await extract(join(root, "sample.docx")))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(second.characters).toBe(first.text.length)
    expect(second.lines).toBe(first.text.split("\n").length)
  })

  test("extraction reads only the file it was given and writes nothing", async () => {
    const before = (await readdir(root)).sort()
    const mtimes = new Map<string, number>()
    for (const name of before) {
      mtimes.set(name, (await stat(join(root, name))).mtimeMs)
    }

    await extract(join(root, "notes.md"))
    await extract(join(root, "sample.docx"))

    expect((await readdir(root)).sort()).toEqual(before)
    for (const name of before) {
      expect((await stat(join(root, name))).mtimeMs).toBe(mtimes.get(name)!)
    }
  })

  test("a source copied by the session pipeline extracts identically", async () => {
    const original = join(root, "notes.md")
    const copy = join(root, "copied-notes.md")
    await writeFile(copy, await Bun.file(original).text())

    const fromOriginal = ok(await extract(original))
    const fromCopy = ok(await extract(copy))
    expect(fromCopy.text).toBe(fromOriginal.text)
    expect(fromCopy.hash).toBe(fromOriginal.hash)
  })
})

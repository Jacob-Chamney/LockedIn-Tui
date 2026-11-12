/**
 * WP-307 — extraction unit rules.
 *
 * Fixture bytes for the container formats are built here, in a temp directory,
 * by the same deterministic generators the integration test uses. Regenerating
 * them produces identical bytes, so the expected text can be asserted exactly.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySource } from "../../src/domain/source";
import { docxToText, extensionOf, extract, hashOf, normaliseText, readZipText, MAX_ENTRY_BYTES, readZipEntry, type ZipEntry, type ExtractError } from "../../src/services/extract";
import { ZipError, readZipDirectory } from "../../src/services/extract/zip";
import { buildDocumentXml, buildPdf, buildPng, buildZip } from "./helpers/ooxml";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(TEMP_BASE, "extract-unit-"))
  await writeFile(join(dir, "notes.md"), "# Unit 4\n\nBoundary conditions.\n\n```ts\nconst x = 1\n```\n")
  await writeFile(join(dir, "notes.txt"), "Energy balance\r\n\r\nThe rate of change.\r\n")
  await writeFile(join(dir, "snippet.ts"), "export const x = 1\n")
  await writeFile(join(dir, "bom.txt"), "\uFEFFhello\n")
  await writeFile(join(dir, "invalid.txt"), new Uint8Array([0x41, 0xff, 0xfe, 0x42]))
  await writeFile(join(dir, "empty.txt"), "")
  await writeFile(join(dir, "sample.pdf"), buildPdf())
  await writeFile(join(dir, "scanned.pdf"), buildPdf({ text: [] }))
  await writeFile(join(dir, "broken.pdf"), "not a pdf\n")
  await writeFile(join(dir, "sample.docx"), await buildZip(buildDocumentXml()))
  await writeFile(join(dir, "broken.docx"), "not a zip\n")
  await writeFile(join(dir, "image.png"), await buildPng())
  await writeFile(join(dir, "stray.bin"), new Uint8Array([1, 2, 3]))
})

afterAll(async () => {
  await removeTemp(dir)
})

function errorOf(result: Awaited<ReturnType<typeof extract>>): ExtractError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

describe("classify", () => {
  test("maps every documented extension", () => {
    expect(classifySource("notes.md")).toBe("markdown")
    expect(classifySource("notes.markdown")).toBe("markdown")
    expect(classifySource("notes.txt")).toBe("text")
    expect(classifySource("snippet.ts")).toBe("code")
    expect(classifySource("paper.pdf")).toBe("pdf")
    expect(classifySource("essay.docx")).toBe("docx")
    expect(classifySource("diagram.png")).toBe("image")
    expect(classifySource("archive.zip")).toBe("other")
  })

  test("is case-insensitive and survives no extension", () => {
    expect(classifySource("LECTURE.MD")).toBe("markdown")
    expect(classifySource("Makefile")).toBe("other")
    expect(classifySource(".env")).toBe("other")
    expect(extensionOf("a.b.TS")).toBe("ts")
    expect(extensionOf("noext")).toBe("")
  })

  test("the extractor's result kind is the domain's classification", async () => {
    // WP-142: there is no second classifier, so the extractor's answer is checked
    // against the domain rule through real extraction.
    for (const [name, expected] of [
      ["a.md", "markdown"],
      ["a.txt", "text"],
      ["a.ts", "code"],
    ] as const) {
      await writeFile(join(dir, name), "content that is long enough to cite\n")
      const result = await extract(join(dir, name))
      if (!result.ok) throw new Error(`expected ok for ${name}`)
      expect(result.kind).toBe(expected)
    }
  })
})

describe("normaliseText and hashOf", () => {
  test("drops a BOM, converts CRLF and trims trailing newlines", () => {
    expect(normaliseText("\uFEFFa\r\nb\rc")).toBe("a\nb\nc")
    expect(normaliseText("a\n\n\n")).toBe("a")
    expect(normaliseText("")).toBe("")
  })

  test("nothing else is touched", () => {
    expect(normaliseText("  indented\n\ttab\n")).toBe("  indented\n\ttab")
  })

  test("the hash is sha256 of the raw bytes", () => {
    const bytes = new TextEncoder().encode("hello")
    expect(hashOf(bytes)).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
    expect(hashOf(new TextEncoder().encode("hello"))).toBe(hashOf(bytes))
  })
})

describe("text, markdown and code", () => {
  test("markdown keeps structure verbatim", async () => {
    const result = await extract(join(dir, "notes.md"))
    if (!result.ok) throw new Error("expected ok")
    expect(result.kind).toBe("markdown")
    expect(result.text).toStartWith("# Unit 4\n\nBoundary conditions.")
    expect(result.text).toContain("```ts\nconst x = 1\n```")
    expect(result.characters).toBe(result.text.length)
    expect(result.lines).toBe(result.text.split("\n").length)
  })

  test("plain text is normalised once", async () => {
    const result = await extract(join(dir, "notes.txt"))
    if (!result.ok) throw new Error("expected ok")
    expect(result.text).toBe("Energy balance\n\nThe rate of change.")
    expect(result.text).not.toContain("\r")
  })

  test("a BOM is dropped, not kept as a character", async () => {
    const result = await extract(join(dir, "bom.txt"))
    if (!result.ok) throw new Error("expected ok")
    expect(result.text).toBe("hello")
    expect(result.text.charCodeAt(0)).toBe(104)
  })

  test("code is verbatim", async () => {
    const result = await extract(join(dir, "snippet.ts"))
    if (!result.ok) throw new Error("expected ok")
    expect(result.kind).toBe("code")
    expect(result.text).toBe("export const x = 1")
  })

  test("an empty file extracts as empty text, not an error", async () => {
    const result = await extract(join(dir, "empty.txt"))
    if (!result.ok) throw new Error("expected ok")
    expect(result.text).toBe("")
    expect(result.lines).toBe(0)
  })

  test("invalid UTF-8 is refused rather than mangled", async () => {
    const error = errorOf(await extract(join(dir, "invalid.txt")))
    expect(error.kind).toBe("malformed")
    if (error.kind !== "malformed") return
    expect(error.format).toBe("text")
    expect(error.message).toContain("UTF-8")
  })

  test("two extractions of one file are identical", async () => {
    const first = await extract(join(dir, "notes.md"))
    const second = await extract(join(dir, "notes.md"))
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe("PDF", () => {
  const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })

  test("missing pdftotext is typed and actionable", async () => {
    const error = errorOf(await extract(join(dir, "sample.pdf"), { pdftotext: null }))
    expect(error.kind).toBe("tool-missing")
    if (error.kind !== "tool-missing") return
    expect(error.tool).toBe("pdftotext")
    expect(error.message).toContain("poppler")
    expect(error.message).toContain("remove the pdf from the sources")
  })

  test("a real pdf yields text and a page count when the tool exists", async () => {
    if (!pdftotext) return
    const result = await extract(join(dir, "sample.pdf"))
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
    expect(result.kind).toBe("pdf")
    expect(result.pages).toBe(2)
    expect(result.text).toContain("LockedIn source pipeline")
    expect(result.text).toContain("Page two: energy balance.")
    expect(result.text).not.toContain("\f")
  })

  test("garbage with a .pdf extension is malformed, never a crash", async () => {
    if (!pdftotext) return
    const error = errorOf(await extract(join(dir, "broken.pdf")))
    expect(error.kind).toBe("malformed")
    if (error.kind !== "malformed") return
    expect(error.format).toBe("pdf")
    expect(error.message).toStartWith("not a readable PDF:")
  })

  test("a pdf with no text layer is no-text, not empty text", async () => {
    if (!pdftotext) return
    const error = errorOf(await extract(join(dir, "scanned.pdf")))
    expect(error.kind).toBe("no-text")
    if (error.kind !== "no-text") return
    expect(error.message).toContain("OCR is not supported")
  })
})

describe("DOCX", () => {
  test("text, entity and tab from the body XML", async () => {
    const result = await extract(join(dir, "sample.docx"))
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
    expect(result.kind).toBe("docx")
    expect(result.text).toBe("LockedIn source pipeline\nEnergy balance & limits\nStep one\tdetail")
  })

  test("docxToText decodes named, decimal and hex entities", () => {
    expect(docxToText("<w:p><w:t>&amp;&#65;&#x42;</w:t></w:p>")).toBe("&AB")
  })

  test("docxToText keeps tabs, breaks and paragraph boundaries", () => {
    expect(docxToText("<w:p><w:r><w:t>a</w:t></w:r><w:br/><w:r><w:t>b</w:t></w:r></w:p>")).toBe("a\nb")
  })

  test("a non-zip .docx is malformed", async () => {
    const error = errorOf(await extract(join(dir, "broken.docx")))
    expect(error.kind).toBe("malformed")
    if (error.kind !== "malformed") return
    expect(error.format).toBe("docx")
    // A 10-byte file is shorter than an empty archive, so the reader says so.
    expect(error.message).toContain("not a zip archive")
  })

  test("a zip without word/document.xml is malformed", async () => {
    await writeFile(join(dir, "hollow.docx"), await buildZip(null))
    const error = errorOf(await extract(join(dir, "hollow.docx")))
    expect(error.kind).toBe("malformed")
    if (error.kind !== "malformed") return
    expect(error.message).toContain("word/document.xml")
  })

  test("the zip reader lists parts and refuses an unsupported method", async () => {
    const bytes = new Uint8Array(await Bun.file(join(dir, "sample.docx")).arrayBuffer())
    const entries = readZipDirectory(bytes)
    expect(entries.map((entry) => entry.name)).toContain("word/document.xml")
    expect(await readZipText(bytes, "word/document.xml")).toContain("LockedIn source pipeline")

    const broken = new Uint8Array(8)
    expect(() => readZipDirectory(broken)).toThrow(ZipError)
  })
})

describe("rejections", () => {
  test("an image has no text extraction path", async () => {
    const error = errorOf(await extract(join(dir, "image.png")))
    expect(error.kind).toBe("unsupported")
    if (error.kind !== "unsupported") return
    expect(error.detected).toBe("image")
    expect(error.message).toContain("image")
  })

  test("an unknown extension is attempted as UTF-8 text", async () => {
    const stray = await extract(join(dir, "stray.bin"))
    expect(stray.ok).toBe(true)
    if (!stray.ok) return
    expect(stray.kind).toBe("other")
  })

  test("a missing file is a read error", async () => {
    const error = errorOf(await extract(join(dir, "absent.md")))
    expect(error.kind).toBe("read")
    if (error.kind !== "read") return
    expect(error.message.length).toBeGreaterThan(0)
  })
})

describe("zip limits", () => {
  test("an entry that declares a zip-bomb size is refused before inflating", async () => {
    const entry: ZipEntry = {
      name: "word/document.xml",
      method: 0,
      compressedSize: 0,
      uncompressedSize: MAX_ENTRY_BYTES + 1,
      crc32: 0,
      dataOffset: 0,
    }
    await expect(readZipEntry(new Uint8Array(8), entry)).rejects.toThrow(/cap/)
  })

  test("an entry that lies about its size is stopped while inflating", async () => {
    const body = new TextEncoder().encode("x".repeat(4_096))
    const stream = new CompressionStream("deflate-raw")
    const writer = stream.writable.getWriter()
    await writer.write(body)
    await writer.close()
    const packed = new Uint8Array(await new Response(stream.readable).arrayBuffer())
    const entry: ZipEntry = {
      name: "word/document.xml",
      method: 8,
      compressedSize: packed.length,
      uncompressedSize: 1, // a lie: the payload inflates to 4 KiB
      crc32: 0,
      dataOffset: 0,
    }
    await expect(readZipEntry(packed, entry, 64)).rejects.toThrow(/cap/)
  })
})

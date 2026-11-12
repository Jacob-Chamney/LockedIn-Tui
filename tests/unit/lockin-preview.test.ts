/** The finder's capped, read-only preview. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { previewFile } from "../../src/services/lockin/preview"
import type { Result } from "../../src/domain/markdown"
import { buildPdf } from "./helpers/ooxml"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "preview-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
})

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

describe("preview", () => {
  test("shows the first lines of a text file", async () => {
    const path = join(root, "notes.md")
    await writeFile(path, "# Notes\n\nStack frames.\n")
    const preview = unwrap(await previewFile(path))
    expect(preview.kind).toBe("markdown")
    expect(preview.lines.slice(0, 2)).toEqual(["# Notes", ""])
    expect(preview.lines.join("\n")).toContain("Stack frames.")
    expect(preview.truncated).toBe(false)
  })

  test("caps the line count and says it is truncated", async () => {
    const path = join(root, "long.txt")
    await writeFile(path, Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"))
    const preview = unwrap(await previewFile(path, { maxLines: 5 }))
    expect(preview.lines).toHaveLength(5)
    expect(preview.lines[4]).toBe("line 4")
    expect(preview.truncated).toBe(true)
  })

  test("a binary file reports metadata instead of mojibake", async () => {
    const path = join(root, "blob.bin")
    await writeFile(path, new Uint8Array([0x00, 0x01, 0x02, 0xff]))
    const preview = unwrap(await previewFile(path))
    expect(preview.kind).toBe("binary")
    expect(preview.lines).toEqual([])
    expect(preview.note).toContain("binary")
  })

  test("an image reports its kind and never reads the bytes", async () => {
    const path = join(root, "diagram.png")
    await writeFile(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const preview = unwrap(await previewFile(path))
    expect(preview.kind).toBe("image")
    expect(preview.note).toContain("image")
  })

  test("a directory is not a preview", async () => {
    const path = join(root, "folder")
    await mkdir(path)
    const result = await previewFile(path)
    expect(result.ok).toBe(false)
  })

  test("a PDF previews extracted text, or names the missing tool", async () => {
    const path = join(root, "assignment.pdf")
    await writeFile(path, buildPdf({ text: ["COMPLEX NUMBERS HOMEWORK"] }))
    const preview = unwrap(await previewFile(path))
    if (preview.error) {
      expect(preview.error).toContain("pdftotext")
    } else {
      expect(preview.lines.join("\n")).toContain("COMPLEX NUMBERS HOMEWORK")
      expect(preview.note).toContain("pdf")
    }
  })
})

test("a byte cap inside a multi-byte character still previews text", async () => {
  const path = join(root, "unicode.txt")
  await writeFile(path, "aé")
  const preview = unwrap(await previewFile(path, { maxBytes: 2 }))
  expect(preview.kind).not.toBe("binary")
  expect(preview.lines.join("")).toContain("a")
})

test("an empty text file is a text preview, not binary", async () => {
  const path = join(root, "empty.txt")
  await writeFile(path, "")
  const preview = unwrap(await previewFile(path))
  expect(preview.kind).not.toBe("binary")
  expect(preview.lines).toEqual([""])
})

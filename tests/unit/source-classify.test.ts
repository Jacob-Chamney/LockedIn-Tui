/**
 * WP-142 — one classifier.
 *
 * Two tables had drifted: the domain said `other` for an unknown extension while
 * the extractor's private copy said `code`. One table now lives in
 * `src/domain/source.ts`; this suite proves there is no second one and pins the
 * table the product documents.
 */

import { describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_EXTENSIONS, SOURCE_KIND_BY_EXTENSION, classifySource, extensionOf, type SourceKind } from "../../src/domain/source";
import { extract } from "../../src/services/extract";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const SRC = join(import.meta.dir, "..", "..", "src")

async function sourceFiles(directory: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await sourceFiles(path)))
      continue
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path)
  }
  return out
}

describe("exactly one classifier", () => {
  test("no file under src/ declares a second classifier", async () => {
    const offenders: string[] = []
    for (const path of await sourceFiles(SRC)) {
      const text = await readFile(path, "utf8")
      // A declaration of anything called `classify` (but not `classifySource`).
      if (/\b(function|const|let)\s+classify\b(?!Source)/.test(text)) offenders.push(`${path}: declares classify`)
      if (/\bclassify\s*\(/.test(text)) offenders.push(`${path}: calls classify(`)
    }
    expect(offenders).toEqual([])
  })

  test("the extractor no longer ships its own extension list", async () => {
    const extractDir = join(SRC, "services", "extract")
    for (const path of await sourceFiles(extractDir)) {
      const text = await readFile(path, "utf8")
      expect(text).not.toContain("CODE_EXTENSIONS")
      expect(text).not.toContain("IMAGE_EXTENSIONS")
      expect(/SOURCE_KIND_BY_EXTENSION\s*[:=]/.test(text)).toBe(false)
    }
  })

  test("there is exactly one exported classifier to import", async () => {
    const hits: string[] = []
    for (const path of await sourceFiles(SRC)) {
      const text = await readFile(path, "utf8")
      if (/export\s+function\s+classifySource\b/.test(text)) hits.push(path)
    }
    expect(hits).toHaveLength(1)
    expect(hits[0]?.endsWith(join("domain", "source.ts"))).toBe(true)
  })
})

describe("the documented table", () => {
  test("has one entry per documented extension and no duplicates", () => {
    expect(SOURCE_EXTENSIONS.length).toBe(Object.keys(SOURCE_KIND_BY_EXTENSION).length)
    expect(new Set(SOURCE_EXTENSIONS).size).toBe(SOURCE_EXTENSIONS.length)
    // Every key is a lowercase bare extension: no dot, no separator.
    for (const extension of SOURCE_EXTENSIONS) {
      expect(extension).toBe(extension.toLowerCase())
      expect(extension).not.toContain(".")
      expect(extension).not.toContain("/")
    }
  })

  test("maps the product's list to the documented kinds", () => {
    const expected: Record<string, SourceKind> = {
      md: "markdown",
      markdown: "markdown",
      mdx: "markdown",
      txt: "text",
      text: "text",
      rst: "text",
      pdf: "pdf",
      docx: "docx",
      png: "image",
      jpg: "image",
      jpeg: "image",
      gif: "image",
      webp: "image",
      bmp: "image",
      tiff: "image",
      tif: "image",
      avif: "image",
      heic: "image",
      ts: "code",
      tsx: "code",
      js: "code",
      jsx: "code",
      mjs: "code",
      cjs: "code",
      py: "code",
      rs: "code",
      go: "code",
      c: "code",
      h: "code",
      cc: "code",
      cpp: "code",
      hpp: "code",
      java: "code",
      kt: "code",
      rb: "code",
      php: "code",
      swift: "code",
      sh: "code",
      bash: "code",
      zsh: "code",
      sql: "code",
      json: "code",
      jsonl: "code",
      toml: "code",
      yaml: "code",
      yml: "code",
      ini: "code",
      css: "code",
      html: "code",
      xml: "code",
    }
    expect(Object.keys(SOURCE_KIND_BY_EXTENSION).sort()).toEqual(Object.keys(expected).sort())
    for (const [extension, kind] of Object.entries(expected)) {
      expect(classifySource(`file.${extension}`)).toBe(kind)
    }
  })

  test("extension matching is case-insensitive and needs a real extension", () => {
    expect(classifySource("LECTURE.MD")).toBe("markdown")
    expect(classifySource("Main.TS")).toBe("code")
    expect(classifySource("Makefile")).toBe("other")
    expect(classifySource(".env")).toBe("other")
    expect(classifySource("archive.tar.gz")).toBe("other")
    expect(extensionOf("archive.tar.gz")).toBe("gz")
    expect(extensionOf("noext")).toBe("")
  })
})

describe("the previously-differing extensions take the domain answer", () => {
  // The extractor's old private table defaulted anything unrecognised to "code",
  // so these were "code" to the extractor and "other" to the domain.
  const differed = ["zip", "bin", "tar", "gz", "exe", "dll", "iso", "dat"]

  test("each is 'other' now, matching the domain", () => {
    for (const extension of differed) {
      expect(SOURCE_KIND_BY_EXTENSION[extension]).toBeUndefined()
      expect(classifySource(`file.${extension}`)).toBe("other")
    }
  })

  test("the extractor keeps them as other, not code, and reads their text", async () => {
    const dir = await mkdtemp(join(TEMP_BASE, "classify-"))
    try {
      for (const extension of differed.slice(0, 3)) {
        const path = join(dir, `file.${extension}`)
        await writeFile(path, "plain text wearing a binary extension\n")
        const result = await extract(path)
        expect(result.ok).toBe(true)
        if (!result.ok) continue
        expect(result.kind).toBe("other")
        expect(result.text).toContain("plain text")
      }
    } finally {
      await removeTemp(dir)
    }
  })
})

describe("no content-sniff fallback", () => {
  test("markdown bytes in a .bin file stay kind other", async () => {
    const dir = await mkdtemp(join(TEMP_BASE, "classify-"))
    try {
      const path = join(dir, "notes.bin")
      await writeFile(path, "# a perfectly good markdown document\n")
      const result = await extract(path)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.kind).toBe("other")
      expect(result.text).toContain("perfectly good markdown")
    } finally {
      await removeTemp(dir)
    }
  })

  test("a right extension with undecodable bytes is a typed error, not text", async () => {
    const dir = await mkdtemp(join(TEMP_BASE, "classify-"))
    try {
      const path = join(dir, "notes.txt")
      await writeFile(path, new Uint8Array([0x41, 0xff, 0xfe, 0x42]))
      const result = await extract(path)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("malformed")
        expect(JSON.stringify(result.error)).not.toContain("\uFFFD")
      }
    } finally {
      await removeTemp(dir)
    }
  })
})

describe("the wall is untouched", () => {
  test("classification reads no file and takes only a name", () => {
    // A pure function of the name: two calls agree, and nothing about the path
    // influences the answer.
    expect(classifySource("a.md")).toBe(classifySource("a.md"))
    expect(classifySource("/etc/passwd")).toBe("other")
    expect(classifySource("../../../school/vault/energy.md")).toBe("markdown")
  })
})

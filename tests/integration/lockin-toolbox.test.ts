/**
 * WP-302 — the escape matrix and the read/search behaviour, on real folders.
 *
 * Every case builds a workspace with two sessions, so "a sibling session's file
 * is refused even though it is inside school/" is tested against a file that
 * really exists next door.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createLockInSession } from "../../src/services/lockin/create";
import { READ_CAP_BYTES, SEARCH_HIT_CAP, TRUNCATION_MARKER, createToolbox, type ToolError } from "../../src/services/lockin/toolbox";
import { buildDocumentXml, buildPdf, buildZip } from "../unit/helpers/ooxml";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, ToolError>): ToolError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let inputs: string
let sessionId: string
let siblingId: string
let sourcesDir: string
/** Stored names are hash-prefixed (`<hash8>-<name>`); tools see stored names. */
let lecture: string
let notes: string
let paper: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "toolbox-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })
  await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions decide the limits.\n")
  await writeFile(join(inputs, "notes.txt"), "Energy balance\n\nThe rate of change.\n")
  await writeFile(
    join(inputs, "paper.pdf"),
    buildPdf({ text: ["Complex assignment", "SUBTRACTION", "MULTIPLICATION", "MAGNITUDE"] }),
  )

  const mine = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-01T09:00:00Z",
      name: "Physics — Unit 4",
      files: [
        join(inputs, "lecture-4.md"),
        join(inputs, "notes.txt"),
        join(inputs, "paper.pdf"),
      ],
    }),
  )
  const sibling = unwrap(
    await createLockInSession({
      workspace,
      created: "2026-11-02T09:00:00Z",
      name: "Chemistry",
      files: [join(inputs, "notes.txt")],
    }),
  )
  sessionId = mine.session.id
  siblingId = sibling.session.id
  const stored = new Map(
    mine.session.sources.map((source) => [source.name, source.storedPath.split("/").pop()!]),
  )
  lecture = stored.get("lecture-4.md")!
  notes = stored.get("notes.txt")!
  paper = stored.get("paper.pdf")!
  sourcesDir = join(workspace.paths.schoolSessions, sessionId, "sources")

  // A file inside the skills wall, for the cross-wall case.
  await mkdir(workspace.paths.goals, { recursive: true })
  await writeFile(join(workspace.paths.goals, "secret.md"), "skills side\n")
})

afterEach(async () => {
  await removeTemp(base)
})

function toolbox(id = sessionId) {
  return createToolbox({ workspace, sessionId: id })
}

test("copied names carry a content-hash prefix, and tools take stored names", () => {
  for (const name of [lecture, notes, paper]) {
    expect(name).toMatch(/^[0-9a-f]{8}-/)
  }
})

describe("the escape matrix", () => {
  test("every attempt is refused with the right reason and returns no text", async () => {
    const tools = toolbox().tools

    const cases: Array<[string, "escape" | "missing" | "symlink"]> = [
      ["../chat.jsonl", "escape"],
      ["../../sessions", "escape"],
      ["/etc/passwd", "escape"],
      [`${workspace.paths.goals}/secret.md`, "escape"],
      [`../${siblingId}/sources/notes.txt`, "escape"],
      ["absent.md", "missing"],
    ]

    for (const [name, reason] of cases) {
      const error = errorOf(await tools.readSource(name))
      expect(error.kind).toBe("path")
      if (error.kind !== "path") continue
      expect(error.reason).toBe(reason)
      expect(error).not.toHaveProperty("text")
    }
  })

  test.skipIf(isWindows)("a symlink that leaves sources/ is refused as a symlink", async () => {
    await symlink(workspace.paths.goals, join(sourcesDir, "link-to-skills"))
    await symlink(join(workspace.paths.goals, "secret.md"), join(sourcesDir, "leak.md"))

    const error = errorOf(await toolbox().tools.readSource("leak.md"))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("symlink")
  })

  test("a sibling session's file is refused even though it is inside school/", async () => {
    const siblingFile = join(workspace.paths.schoolSessions, siblingId, "sources")
    expect(existsSync(siblingFile)).toBe(true)
    const error = errorOf(await toolbox().tools.readSource(`../${siblingId}/sources/${notes}`))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
  })

  test("an empty name is refused", async () => {
    expect(errorOf(await toolbox().tools.readSource("")).kind).toBe("path")
  })
})

describe("read_source", () => {
  test("returns the text of a copied markdown file", async () => {
    const read = unwrap(await toolbox().tools.readSource(lecture))
    expect(read.kind).toBe("markdown")
    expect(read.text).toContain("Boundary conditions decide the limits.")
    expect(read.truncated).toBe(false)
  })

  test("a pdf is extracted through the text service", async () => {
    if (!pdftotext) return
    const read = unwrap(await toolbox().tools.readSource(paper))
    expect(read.kind).toBe("pdf")
    expect(read.text).toContain("SUBTRACTION")
    expect(read.text).toContain("MULTIPLICATION")
    expect(read.truncated).toBe(false)
  })

  test("a scanned pdf reports no text instead of silently returning nothing", async () => {
    if (!pdftotext) return
    await writeFile(join(sourcesDir, "scanned.pdf"), buildPdf({ text: [] }))
    const error = errorOf(await toolbox().tools.readSource("scanned.pdf"))
    expect(error.kind).toBe("extraction")
    if (error.kind !== "extraction") return
    expect(error.reason).toBe("no-text")
    expect(error.detected).toBe("pdf")
    expect(error.message).toContain("OCR is not supported")
  })

  test("a docx is extracted through the text service", async () => {
    await writeFile(
      join(sourcesDir, "essay.docx"),
      await buildZip(buildDocumentXml()),
    )
    const read = unwrap(await toolbox().tools.readSource("essay.docx"))
    expect(read.kind).toBe("docx")
    expect(read.text).toContain("Energy balance")
  })

  test("a UTF-8 character cut by the cap does not make the source unreadable", async () => {
    const prefix = "x".repeat(READ_CAP_BYTES - 1)
    await writeFile(join(sourcesDir, "boundary.txt"), `${prefix}€rest`)
    const read = unwrap(await toolbox().tools.readSource("boundary.txt"))
    expect(read.truncated).toBe(true)
    expect(read.text).toContain(TRUNCATION_MARKER)
    expect(read.bytes).toBeGreaterThan(READ_CAP_BYTES)
  })

  test("a 200 KiB file truncates at the cap and says so", async () => {
    const big = "x".repeat(200 * 1024)
    await writeFile(join(sourcesDir, "big.txt"), big)
    const read = unwrap(await toolbox().tools.readSource("big.txt"))
    expect(read.truncated).toBe(true)
    expect(read.bytes).toBe(200 * 1024)
    expect(read.text.endsWith(TRUNCATION_MARKER)).toBe(true)
    expect(read.text.length).toBeLessThanOrEqual(READ_CAP_BYTES + TRUNCATION_MARKER.length)
  })
})

describe("list_sources", () => {
  test("lists the copies with kind and size, never a path", async () => {
    const listed = unwrap(await toolbox().tools.listSources())
    expect(listed.map((entry) => entry.name).sort()).toEqual([paper, lecture, notes].sort())
    for (const entry of listed) {
      expect(entry.kind).toBe(entry.name.endsWith(".pdf") ? "pdf" : entry.name.endsWith(".md") ? "markdown" : "text")
      expect(entry.bytes).toBeGreaterThan(0)
      expect(entry).not.toHaveProperty("path")
    }
  })
})

describe("search_sources", () => {
  test("finds a term in two sources and reports both with line numbers", async () => {
    const result = unwrap(await toolbox().tools.searchSources("rate"))
    expect(result.hits.map((hit) => hit.name)).toEqual([notes])
    expect(result.hits[0]?.line).toBe(3)
    expect(result.truncated).toBe(false)

    const both = unwrap(await toolbox().tools.searchSources("e"))
    expect(new Set(both.hits.map((hit) => hit.name)).size).toBeGreaterThan(1)
  })

  test("is case-insensitive", async () => {
    const lower = unwrap(await toolbox().tools.searchSources("boundary"))
    const upper = unwrap(await toolbox().tools.searchSources("BOUNDARY"))
    expect(upper.hits).toEqual(lower.hits)
    expect(lower.hits.length).toBeGreaterThan(0)
  })

  test("200 hits are capped at 50 with a total count", async () => {
    await writeFile(join(sourcesDir, "many.txt"), `${"needle\n".repeat(200)}`)
    const result = unwrap(await toolbox().tools.searchSources("needle"))
    expect(result.hits).toHaveLength(SEARCH_HIT_CAP)
    expect(result.total).toBe(200)
    expect(result.truncated).toBe(true)
  })

  test("an empty term returns nothing rather than everything", async () => {
    expect(unwrap(await toolbox().tools.searchSources(""))).toEqual({
      hits: [],
      total: 0,
      truncated: false,
    })
  })

  test("pdf text is searchable, but raw binary bytes are not", async () => {
    if (!pdftotext) return
    const text = unwrap(await toolbox().tools.searchSources("SUBTRACTION"))
    expect(text.hits.map((hit) => hit.name)).toContain(paper)
    const raw = unwrap(await toolbox().tools.searchSources("%PDF"))
    expect(raw.hits).toEqual([])
  })
})

describe("scope and inventory", () => {
  test("the toolbox can only see its own sources directory", async () => {
    const box = toolbox()
    expect(box.sourcesDir).toBe(sourcesDir)
    const listed = unwrap(await box.tools.listSources())
    expect(listed.map((entry) => entry.name)).toHaveLength(3)
    for (const spec of box.specs) expect(spec.side).toBe("school")
  })

  test("a second session gets its own resolver", async () => {
    const other = toolbox(siblingId)
    expect(other.sourcesDir).not.toBe(sourcesDir)
    const read = unwrap(await other.tools.readSource(notes))
    expect(read.text).toContain("Energy balance")
  })
})

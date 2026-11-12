/**
 * WP-301 — session creation transaction.
 *
 * Every case builds a real workspace in a temp directory and inspects the tree
 * afterwards, because the acceptance criteria are about bytes on disk: what was
 * written, what was not, and what survives a failure.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { sessionFromMeta } from "../../src/domain/session";
import { isInsideSources } from "../../src/domain/source";
import { createWorkspace, openWorkspace, type Workspace } from "../../src/storage/workspace";
import { BLOCKED_COPY } from "../../src/services/lockin/picker";
import { createLockInSession, type CreateError, type SessionEvent } from "../../src/services/lockin/create";
import { buildPdf } from "../unit/helpers/ooxml";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00Z"
const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, CreateError>): CreateError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let inputs: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "lockin-create-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })
  await writeFile(join(inputs, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n")
  await writeFile(join(inputs, "notes.txt"), "energy balance\n")
  await writeFile(join(inputs, "snippet.ts"), "export const x = 1\n")
})

afterEach(async () => {
  await removeTemp(base)
})

/** Every path below `root`, relative and sorted: the tree as a value. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      out.push(relative(root, path).split(sep).join("/"))
      if (entry.isDirectory()) await walk(path)
    }
  }
  if (existsSync(root)) await walk(root)
  return out.sort()
}

describe("create — the happy paths", () => {
  test("one file and no prompt writes meta.json, prompt.md and one source", async () => {
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Physics — Unit 4",
        files: [join(inputs, "lecture-4.md")],
      }),
    )

    expect(outcome.session.id).toBe("2026-11-01-1430-physics-unit-4")
    expect(outcome.copiedFiles).toBe(1)
    expect(await tree(outcome.folder)).toEqual([
      "meta.json",
      "prompt.md",
      "sources",
      `sources/${outcome.session.sources[0]!.hash.slice(7, 15)}-lecture-4.md`,
    ])
  })

  test("the copied bytes are identical to the original", async () => {
    const original = join(inputs, "lecture-4.md")
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Physics",
        files: [original],
      }),
    )
    const copiedPath = join(outcome.folder, outcome.session.sources[0]!.storedPath)
    expect(await readFile(copiedPath, "utf8")).toBe(await readFile(original, "utf8"))
  })

  test("editing the original after create does not change the session", async () => {
    const original = join(inputs, "lecture-4.md")
    const outcome = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Physics", files: [original] }),
    )
    await writeFile(original, "rewritten\n")
    const copiedPath = join(outcome.folder, outcome.session.sources[0]!.storedPath)
    expect(await readFile(copiedPath, "utf8")).toContain("Boundary conditions.")
  })

  test("a prompt with no file is allowed and writes an empty sources/", async () => {
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Prompt only",
        prompt: "Explain the problem set.",
      }),
    )
    expect(await tree(outcome.folder)).toEqual(["meta.json", "prompt.md", "sources"])
    expect(await readFile(join(outcome.folder, "prompt.md"), "utf8")).toBe(
      "Explain the problem set.",
    )
    expect(outcome.session.sources).toEqual([])
  })

  test("no file and no prompt is refused before anything is written", async () => {
    const before = await tree(workspace.root)
    const error = errorOf(
      await createLockInSession({ workspace, created: CREATED, name: "Empty" }),
    )
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toBe(BLOCKED_COPY)
    expect(await tree(workspace.root)).toEqual(before)
  })

  test("two sessions in the same minute get different ids and folders", async () => {
    const first = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Physics", prompt: "one" }),
    )
    const second = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Physics", prompt: "two" }),
    )
    expect(second.session.id).not.toBe(first.session.id)
    expect(second.session.id).toBe("2026-11-01-1430-physics-2")
    expect(second.folder).not.toBe(first.folder)
    expect(existsSync(first.folder)).toBe(true)
    expect(await readFile(join(first.folder, "prompt.md"), "utf8")).toBe("one")
  })

  test("an instructions file is copied, extracted to prompt.md and recorded in meta.json", async () => {
    if (!pdftotext) return
    const pdf = join(inputs, "ComplexNumbers.pdf")
    await writeFile(
      pdf,
      buildPdf({ text: ["COMPLEX NUMBERS HOMEWORK", "SUBTRACTION", "MULTIPLICATION", "MAGNITUDE"] }),
    )
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Complex numbers",
        files: [join(inputs, "lecture-4.md")],
        instructionsFile: pdf,
      }),
    )
    expect(outcome.session.prompt).toContain("SUBTRACTION")
    expect(outcome.session.instructions?.name).toBe("ComplexNumbers.pdf")
    expect(outcome.session.instructions?.kind).toBe("pdf")
    expect(outcome.session.instructions?.extractedAt).toBe(new Date(CREATED).toISOString())
    expect(existsSync(join(outcome.folder, outcome.session.instructions!.storedPath))).toBe(true)
    expect(await readFile(join(outcome.folder, "prompt.md"), "utf8")).toContain("MULTIPLICATION")

    const meta = JSON.parse(await readFile(join(outcome.folder, "meta.json"), "utf8")) as {
      prompt: string
      instructions_source: { name: string; stored_path: string; extracted_at: string }
    }
    expect(meta.prompt).toContain("SUBTRACTION")
    expect(meta.instructions_source.name).toBe("ComplexNumbers.pdf")
    expect(meta.instructions_source.stored_path).toBe(outcome.session.instructions!.storedPath)
    expect(meta.instructions_source.extracted_at).toBe(new Date(CREATED).toISOString())
    expect(outcome.copiedFiles).toBe(2)
  })

  test("an instructions file can be the only input", async () => {
    if (!pdftotext) return
    const pdf = join(inputs, "only-instructions.pdf")
    await writeFile(pdf, buildPdf({ text: ["The whole assignment is in this file."] }))
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Instructions only",
        instructionsFile: pdf,
      }),
    )
    expect(outcome.session.prompt).toContain("whole assignment")
    expect(outcome.session.sources).toHaveLength(1)
    expect(outcome.copiedFiles).toBe(1)
  })

  test("prompt text and an instructions file cannot both be supplied", async () => {
    const pdf = join(inputs, "assignment.pdf")
    await writeFile(pdf, buildPdf({ text: ["Instructions"] }))
    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Ambiguous",
        prompt: "Write these instead",
        instructionsFile: pdf,
      }),
    )
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toContain("not both")
  })

  test("an unreadable instructions file leaves no session behind", async () => {
    if (!pdftotext) return
    const pdf = join(inputs, "scanned.pdf")
    await writeFile(pdf, buildPdf({ text: [] }))
    const before = await tree(workspace.root)
    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Scanned",
        files: [join(inputs, "lecture-4.md")],
        instructionsFile: pdf,
      }),
    )
    expect(error.kind).toBe("extraction")
    if (error.kind !== "extraction") return
    expect(error.name).toBe("scanned.pdf")
    expect(error.message).toContain("OCR is not supported")
    expect(await tree(workspace.root)).toEqual(before)
  })

  test("an instruction file already selected as a source is stored once", async () => {
    if (!pdftotext) return
    const pdf = join(inputs, "assignment.pdf")
    await writeFile(pdf, buildPdf({ text: ["Assignment"] }))
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Same file",
        files: [pdf],
        instructionsFile: pdf,
      }),
    )
    expect(outcome.copiedFiles).toBe(1)
    expect(outcome.session.sources).toHaveLength(1)
    expect(outcome.session.instructions?.hash).toBe(outcome.session.sources[0]?.hash)
  })

  test("a duplicate source is stored once and listed once", async () => {
    const copy = join(inputs, "lecture-4-copy.md")
    await writeFile(copy, "# Unit 4\n\nBoundary conditions.\n")

    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Duplicate",
        files: [join(inputs, "lecture-4.md"), copy],
      }),
    )
    expect(outcome.copiedFiles).toBe(1)
    expect(outcome.session.sources).toHaveLength(1)
    expect((await tree(outcome.folder)).filter((path) => path.startsWith("sources/"))).toHaveLength(1)
  })
})

describe("create — meta.json", () => {
  test("round-trips through the domain shape with relative stored paths", async () => {
    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Physics — Unit 4",
        prompt: "Explain the problem set.",
        files: [join(inputs, "lecture-4.md"), join(inputs, "snippet.ts")],
      }),
    )

    const raw = JSON.parse(await readFile(join(outcome.folder, "meta.json"), "utf8")) as unknown
    const meta = raw as Record<string, unknown>
    expect(meta.schema).toBe(1)
    expect(meta.id).toBe(outcome.session.id)
    expect(meta.prompt).toBe("Explain the problem set.")
    expect(meta.archived).toBe(false)

    const parsed = unwrap(sessionFromMeta(raw))
    expect(parsed.id).toBe(outcome.session.id)
    expect(parsed.name).toBe("Physics — Unit 4")
    expect(parsed.sources).toHaveLength(2)

    for (const source of parsed.sources) {
      expect(isInsideSources(source.storedPath)).toBe(true)
      expect(source.storedPath.startsWith("sources/")).toBe(true)
      expect(source.storedPath).not.toContain(outcome.folder)
      expect(existsSync(join(outcome.folder, source.storedPath))).toBe(true)
    }
    // original_path is informational only, and may be absolute.
    expect(isAbsolute(parsed.sources[0]?.originalPath ?? "")).toBe(true)
  })

  test("the session does not write chat, progress, steps or memory", async () => {
    const outcome = unwrap(
      await createLockInSession({ workspace, created: CREATED, name: "Bare", prompt: "hello" }),
    )
    const files = await tree(outcome.folder)
    for (const forbidden of ["chat.jsonl", "progress.jsonl", "assignment-steps.md", "memory.md"]) {
      expect(files).not.toContain(forbidden)
    }
  })
})

describe("create — the wall and the workspace", () => {
  test("a file under the skills side is refused before any copy", async () => {
    const goalFile = join(workspace.paths.goals, "assembly-basics", "sources", "intel.md")
    await mkdir(join(workspace.paths.goals, "assembly-basics", "sources"), { recursive: true })
    await writeFile(goalFile, "skills-side material\n")

    const before = await tree(workspace.paths.schoolSessions)
    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Crossed",
        files: [goalFile],
      }),
    )
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
    expect(error.message).toContain("skills")
    expect(await tree(workspace.paths.schoolSessions)).toEqual(before)
  })

  test("a legacy v0.7 workspace is refused by the workspace layer and nothing is created", async () => {
    const legacy = join(base, "old-workspace")
    await mkdir(join(legacy, "school", "sessions"), { recursive: true })
    await writeFile(join(legacy, "config.toml"), "[ui]\ntheme = 'lockedin'\n")
    const before = await tree(legacy)

    const opened = await openWorkspace(legacy)
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.kind).toBe("legacy")
    expect(await tree(legacy)).toEqual(before)
  })
})

describe("create — failure leaves nothing behind", () => {
  test("a failure mid-copy removes the session and the temporary directory", async () => {
    const before = await tree(workspace.paths.schoolSessions)

    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Doomed",
        files: [join(inputs, "lecture-4.md")],
        onChunk: (index) => {
          if (index === 0) throw new Error("injected copy failure")
        },
      }),
    )

    expect(error.kind).toBe("storage")
    if (error.kind !== "storage") return
    expect(error.message).toContain("injected copy failure")
    expect(await tree(workspace.paths.schoolSessions)).toEqual(before)

    const leftovers = (await readdir(workspace.paths.schoolSessions)).filter((name) =>
      name.startsWith(".tmp-"),
    )
    expect(leftovers).toEqual([])
  })

  test("the failing attempt does not consume an id", async () => {
    await createLockInSession({
      workspace,
      created: CREATED,
      name: "Retry",
      files: [join(inputs, "lecture-4.md")],
      onChunk: (index) => {
        if (index === 0) throw new Error("boom")
      },
    })

    const retried = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Retry",
        files: [join(inputs, "lecture-4.md")],
      }),
    )
    expect(retried.session.id).toBe("2026-11-01-1430-retry")
  })

  test("a missing source file fails the create and cleans up", async () => {
    const before = await tree(workspace.paths.schoolSessions)
    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Missing",
        files: [join(inputs, "absent.md")],
      }),
    )
    expect(error.kind).toBe("storage")
    expect(await tree(workspace.paths.schoolSessions)).toEqual(before)
  })

  test("a directory is refused as a source and the create cleans up", async () => {
    const before = await tree(workspace.paths.schoolSessions)
    const error = errorOf(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Directory",
        files: [inputs],
      }),
    )
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("missing")
    expect(error.message).toContain("not a regular file")
    expect(await tree(workspace.paths.schoolSessions)).toEqual(before)
  })
})

describe("create — session.updated", () => {
  test("fires exactly once, after the folder exists", async () => {
    const events: Array<{ event: SessionEvent; folderExists: boolean }> = []
    let folder = ""

    const outcome = unwrap(
      await createLockInSession({
        workspace,
        created: CREATED,
        name: "Observed",
        prompt: "hi",
        emit: (event) => {
          events.push({ event, folderExists: folder !== "" && existsSync(folder) })
        },
      }),
    )
    folder = outcome.folder

    expect(events).toHaveLength(1)
    expect(events[0]?.event.type).toBe("session.updated")
    expect(events[0]?.event.sessionId).toBe(outcome.session.id)
    expect(existsSync(outcome.folder)).toBe(true)
    expect((await stat(outcome.folder)).isDirectory()).toBe(true)
  })

  test("does not fire when the create fails", async () => {
    const events: SessionEvent[] = []
    await createLockInSession({
      workspace,
      created: CREATED,
      name: "Doomed",
      files: [join(inputs, "lecture-4.md")],
      emit: (event) => events.push(event),
      onChunk: () => {
        throw new Error("boom")
      },
    })
    expect(events).toEqual([])
  })
})

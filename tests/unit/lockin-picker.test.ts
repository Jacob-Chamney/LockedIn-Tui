/**
 * WP-301 — headless picker model.
 *
 * Directories are real temp directories: the picker reads the filesystem, so a
 * mock would not test the containment rule. Nothing under `tests/fixtures` is
 * touched; each test builds and removes its own tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { type Result } from "../../src/domain/markdown"
import {
  BLOCKED_COPY,
  MAX_SOURCES,
  canContinue,
  cancel,
  createPicker,
  mark,
  markFolder,
  navigate,
  entryAt,
  previewSources,
  rankEntries,
  resolvePickerPath,
  searchFiles,
  setPrompt,
  unmarkAll,
  type PickerError,
  type PickerState,
} from "../../src/services/lockin/picker"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, PickerError>): PickerError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let root: string
let outside: string

beforeEach(async () => {
  const base = await mkdtemp(join(TEMP_BASE, "picker-"))
  const rootPath = join(base, "root")
  const outsidePath = join(base, "outside")
  await mkdir(join(rootPath, "unit-4"), { recursive: true })
  await mkdir(outsidePath, { recursive: true })
  await writeFile(join(rootPath, "lecture-4.md"), "# Unit 4\n\nBoundary conditions.\n")
  await writeFile(join(outsidePath, "secret.md"), "not yours\n")
  await writeFile(join(rootPath, "unit-4", "notes.txt"), "energy balance\n")
  await writeFile(join(rootPath, "unit-4", "snippet.ts"), "export const x = 1\n")
  await writeFile(join(rootPath, "diagram.png"), "not really a png\n")
  await writeFile(join(rootPath, "archive.zip"), "PK\n")
  // `createPicker` stores the resolved root; resolve the fixture paths too so
  // Windows short names do not make the same folder look like an escape.
  root = await realpath(rootPath)
  outside = await realpath(outsidePath)
})

afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
})

async function picker(limit?: number): Promise<PickerState> {
  return unwrap(await createPicker({ root, limit }))
}

describe("picker — typed paths", () => {
  test("resolves relative files and directories", async () => {
    const state = await picker()
    const file = unwrap(await resolvePickerPath(state, "lecture-4.md"))
    expect(file).toEqual({ path: join(root, "lecture-4.md"), kind: "file" })
    const directory = unwrap(await resolvePickerPath(state, "unit-4"))
    expect(directory).toEqual({ path: join(root, "unit-4"), kind: "directory" })
  })

  test("a missing path is a typed error, not a filter crash", async () => {
    const state = await picker()
    const error = errorOf(await resolvePickerPath(state, "unit-4/missing.md"))
    expect(error.kind).toBe("path")
  })
})

describe("picker — fuzzy search", () => {
  test("finds files across nested directories with relative names", async () => {
    const state = await picker()
    const found = unwrap(await searchFiles(state, "notes")).entries
    expect(found.map((entry) => entry.name)).toEqual([join("unit-4", "notes.txt")])
    expect(found[0]?.path).toBe(join(root, "unit-4", "notes.txt"))
    expect(found[0]?.selectable).toBe(true)
  })

  test("respects token order and marks current selections", async () => {
    const state = unwrap(mark(await picker(), join(root, "unit-4", "notes.txt")))
    const found = unwrap(await searchFiles(state, "unit note")).entries
    expect(found.map((entry) => entry.name)).toEqual([join("unit-4", "notes.txt")])
    expect(found[0]?.marked).toBe(true)
  })

  test("an empty query is an empty result, not a full walk", async () => {
    const state = await picker()
    expect(unwrap(await searchFiles(state, "   ")).entries).toEqual([])
  })
})

describe("picker — listing", () => {
  test("lists files and directories, sorted, inside the root", async () => {
    const state = await picker()
    expect(state.entries.map((entry) => entry.name)).toEqual([
      "archive.zip",
      "diagram.png",
      "lecture-4.md",
      "unit-4",
    ])
    expect(state.cwd).toBe(state.root)
    expect(state.marks).toEqual([])
  })

  test("every regular file is selectable, whatever its extension", async () => {
    const state = await picker()
    const byName = (name: string) => state.entries.find((entry) => entry.name === name)!
    expect(byName("lecture-4.md").selectable).toBe(true)
    expect(byName("diagram.png").selectable).toBe(true)
    expect(byName("diagram.png").reason).toBe(null)
    expect(byName("archive.zip").selectable).toBe(true)
    expect(byName("archive.zip").reason).toBe(null)
    expect(byName("unit-4").selectable).toBe(false)
    expect(byName("unit-4").reason).toBe("directory")
  })

  test("a missing root is a storage error, not a throw", async () => {
    const result = await createPicker({ root: join(root, "nope") })
    expect(result.ok).toBe(false)
  })

  test("a non-positive limit is refused", async () => {
    const result = await createPicker({ root, limit: 0 })
    expect(errorOf(result).kind).toBe("limit")
  })
})

describe("picker — marking", () => {
  test("mark toggles on and off", async () => {
    let state = await picker()
    const file = join(state.root, "lecture-4.md")

    state = unwrap(mark(state, file))
    expect(state.marks).toEqual([file])
    expect(state.entries.find((entry) => entry.name === "lecture-4.md")?.marked).toBe(true)

    state = unwrap(mark(state, file))
    expect(state.marks).toEqual([])
    expect(state.entries.find((entry) => entry.name === "lecture-4.md")?.marked).toBe(false)
  })

  test("mark accepts an image and an unknown extension", async () => {
    const state = await picker()
    const withImage = unwrap(mark(state, join(state.root, "diagram.png")))
    expect(withImage.marks).toEqual([join(state.root, "diagram.png")])
    const withArchive = unwrap(mark(withImage, join(state.root, "archive.zip")))
    expect(withArchive.marks).toHaveLength(2)
  })

  test("mark refuses a directory: use markFolder", async () => {
    const state = await picker()
    const error = errorOf(mark(state, join(state.root, "unit-4")))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.message).toContain("markFolder")
  })

  test("mark refuses a path outside the root", async () => {
    const state = await picker()
    const error = errorOf(mark(state, join(outside, "secret.md")))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
  })

  test("markFolder marks only accepted files inside the root, recursively", async () => {
    const state = await picker()
    const marked = unwrap(await markFolder(state, join(state.root, "unit-4")))
    expect(marked.marks.map((path) => relative(state.root, path))).toEqual([
      join("unit-4", "notes.txt"),
      join("unit-4", "snippet.ts"),
    ])
  })

  test("markFolder at the root marks every regular file", async () => {
    const state = await picker()
    const marked = unwrap(await markFolder(state, state.root))
    expect(marked.marks.map((path) => relative(state.root, path))).toEqual([
      "archive.zip",
      "diagram.png",
      "lecture-4.md",
      join("unit-4", "notes.txt"),
      join("unit-4", "snippet.ts"),
    ])
  })

  test("unmarkAll clears every mark", async () => {
    let state = await picker()
    state = unwrap(await markFolder(state, state.root))
    expect(state.marks.length).toBe(5)
    state = unmarkAll(state)
    expect(state.marks).toEqual([])
    expect(state.entries.every((entry) => !entry.marked)).toBe(true)
  })

  test("crossing the cap is a typed limit error naming the setting", async () => {
    const state = await picker(2)
    const error = errorOf(await markFolder(state, state.root))
    expect(error.kind).toBe("limit")
    if (error.kind !== "limit") return
    expect(error.limit).toBe(2)
    expect(error.message).toContain("storage.max_items_per_side")
  })
})



describe("picker — ranked search", () => {
  function entry(name: string, kind: "file" | "directory" = "file") {
    return {
      path: join(root, name),
      name,
      kind,
      bytes: 10,
      selectable: kind === "file",
      reason: kind === "directory" ? ("directory" as const) : null,
      marked: false,
    }
  }

  test("a basename match outranks a deeper path match", () => {
    const ranked = rankEntries(
      [
        entry("notes/other.md"),
        entry("unit-4/notes.txt"),
        entry("notes.txt"),
      ],
      "notes",
    )
    expect(ranked.map((row) => row.name)).toEqual(["notes.txt", "unit-4/notes.txt", "notes/other.md"])
  })

  test("search returns directories as well as files", async () => {
    const state = await picker()
    const found = unwrap(await searchFiles(state, "unit"))
    const directory = found.entries.find((row) => row.name === "unit-4")
    expect(directory?.kind).toBe("directory")
    expect(directory?.selectable).toBe(false)
  })

  test("a scope root narrows both the walk and the relative names", async () => {
    const state = await picker()
    const found = unwrap(
      await searchFiles(state, "notes", { scopeRoot: join(root, "unit-4") }),
    )
    expect(found.entries.map((row) => row.name)).toEqual(["notes.txt"])
    expect(found.entries[0]?.path).toBe(join(root, "unit-4", "notes.txt"))
  })

  test("an aborted search stops before reading anything", async () => {
    const state = await picker()
    const controller = new AbortController()
    controller.abort()
    const found = unwrap(await searchFiles(state, "notes", { signal: controller.signal }))
    expect(found.entries).toEqual([])
    expect(found.visited).toBe(0)
  })

  test("hidden folders stay out unless the query asks for them", async () => {
    await mkdir(join(root, ".config"), { recursive: true })
    await writeFile(join(root, ".config", "secret.toml"), "x = 1\n")
    const state = await picker()
    const hidden = unwrap(await searchFiles(state, "secret"))
    expect(hidden.entries).toEqual([])
    const asked = unwrap(await searchFiles(state, ".config"))
    expect(asked.entries.some((row) => row.name.endsWith("secret.toml"))).toBe(true)
  })

  test("entryAt describes a file for the pinned path row", async () => {
    const state = await picker()
    const pinned = unwrap(await entryAt(state, join(root, "lecture-4.md"), root))
    expect(pinned.kind).toBe("file")
    expect(pinned.name).toBe("lecture-4.md")
    expect(pinned.bytes).toBeGreaterThan(0)
  })
})

describe.skipIf(isWindows)("picker — symlinks", () => {
  test("an escaping symlink is refused and never enters the preview", async () => {
    const link = join(root, "escape.md")
    await symlink(join(outside, "secret.md"), link)

    const state = await picker()
    const entry = state.entries.find((item) => item.name === "escape.md")!
    expect(entry.selectable).toBe(false)
    expect(entry.reason).toBe("symlink-escape")

    const error = errorOf(mark(state, link))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("symlink")

    const preview = unwrap(await previewSources(state))
    expect(preview.map((source) => source.name)).not.toContain("escape.md")
  })

  test("a contained symlink resolves to its target", async () => {
    await symlink(join(root, "lecture-4.md"), join(root, "alias.md"))
    const state = await picker()
    const entry = state.entries.find((item) => item.name === "alias.md")!
    expect(entry.kind).toBe("file")
    expect(entry.selectable).toBe(true)
    expect(unwrap(mark(state, join(root, "alias.md"))).marks).toHaveLength(1)
  })

  test("a dangling symlink does not abort a directory listing", async () => {
    await symlink(join(root, "gone.md"), join(root, "dangling.md"))
    const state = await picker()
    expect(state.entries.map((entry) => entry.name)).not.toContain("dangling.md")
    expect(state.entries.map((entry) => entry.name)).toContain("lecture-4.md")
  })

  test("navigating through an escaping symlink is refused", async () => {
    await symlink(outside, join(root, "elsewhere"))
    const state = await picker()
    const error = errorOf(await navigate(state, join(root, "elsewhere")))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("symlink")
  })
})

describe("picker — navigation and continuation", () => {
  test("navigating into a subdirectory lists it", async () => {
    const state = await picker()
    const inside = unwrap(await navigate(state, join(state.root, "unit-4")))
    expect(inside.cwd).toBe(join(state.root, "unit-4"))
    expect(inside.entries.map((entry) => entry.name)).toEqual(["notes.txt", "snippet.ts"])
  })

  test("navigating out of the root is a typed escape error", async () => {
    const state = await picker()
    const error = errorOf(await navigate(state, ".."))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
  })

  test("navigating into a missing directory is a typed missing error", async () => {
    const state = await picker()
    const error = errorOf(await navigate(state, join(state.root, "absent")))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("missing")
  })

  test("the flow is blocked with the documented copy until a mark or a prompt exists", async () => {
    const state = await picker()
    expect(canContinue(state)).toBe(false)
    expect(BLOCKED_COPY).toBe("choose at least one file, or write a prompt to continue")

    expect(canContinue(setPrompt(state, "Explain the problem set."))).toBe(true)
    expect(canContinue(setPrompt(state, "   "))).toBe(false)
    expect(canContinue(unwrap(mark(state, join(state.root, "lecture-4.md"))))).toBe(true)
  })

  test("cancel discards marks and the prompt and returns to the root", async () => {
    let state = await picker()
    state = unwrap(await navigate(state, join(state.root, "unit-4")))
    state = unwrap(await markFolder(state, state.cwd))
    state = setPrompt(state, "half-written prompt")

    const cancelled = cancel(state)
    expect(cancelled.marks).toEqual([])
    expect(cancelled.prompt).toBe("")
    expect(cancelled.cwd).toBe(state.root)
    expect(canContinue(cancelled)).toBe(false)
    // Cancelling touches nothing on disk.
    expect(existsSync(join(root, "unit-4", "notes.txt"))).toBe(true)
  })
})

describe("picker — preview", () => {
  test("a preview describes every mark with a shareable stored path", async () => {
    let state = await picker()
    state = unwrap(await markFolder(state, state.root))
    const preview = unwrap(await previewSources(state))

    expect(preview.map((source) => source.name)).toEqual([
      "archive.zip",
      "diagram.png",
      "lecture-4.md",
      "notes.txt",
      "snippet.ts",
    ])
    expect(preview.map((source) => source.kind)).toEqual(["other", "image", "markdown", "text", "code"])
    for (const source of preview) {
      expect(source.storedPath).toMatch(/^sources\//)
      expect(source.storedPath).not.toContain(state.root)
      expect(source.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  test("a preview hash is provisional: the same file keeps it between calls", async () => {
    const state = unwrap(mark(await picker(), join(root, "lecture-4.md")))
    const first = unwrap(await previewSources(state))
    const second = unwrap(await previewSources(state))
    expect(second[0]?.hash).toBe(first[0]?.hash)
  })

  test("the default cap is the documented 25", () => {
    expect(MAX_SOURCES).toBe(25)
  })

  test("an empty selection previews nothing", async () => {
    expect(unwrap(await previewSources(await picker()))).toEqual([])
  })
})

test("a credential variable is not expanded into a visible path", async () => {
  const state = await picker()
  const result = await resolvePickerPath(state, "$OPENAI_API_KEY")
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.kind).toBe("path")
  if (result.error.kind !== "path") return
  expect(result.error.message).toContain("credential")
})

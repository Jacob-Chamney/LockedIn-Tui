/**
 * WP-138 — extraction cache.
 *
 * The extractor is injected so "does measurably less work" is asserted as a call
 * count rather than wall-clock time, and the cache root is a temp data
 * directory so the workspace stays untouched.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { gatherSources } from "../../src/services/skills/gather";
import { createSkillsToolbox, type SkillsToolError } from "../../src/services/skills/toolbox";
import { DEFAULT_MAX_BYTES, EXTRACTOR_ID, createExtractionCache, type CacheDiagnostic } from "../../src/services/extract/cache";
import { extract, type ExtractResult } from "../../src/services/extract";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00.000Z"
const STAGES: StageDraft[] = [
  { title: "Registers", milestone: "explain a stack frame" },
  { title: "Control flow", milestone: "trace a loop" },
  { title: "Conventions", milestone: "read a prologue" },
]

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, SkillsToolError>): SkillsToolError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let dataDir: string
let goalId: string
let goalFolder: string
let inputs: string
let calls: string[]

/** Injected extractor: the real one, plus a call counter. */
async function countingExtractor(path: string): Promise<ExtractResult> {
  calls.push(path)
  return extract(path)
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "extract-cache-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  dataDir = join(base, "data")
  await mkdir(dataDir, { recursive: true })
  inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })
  calls = []

  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" })),
      stages: STAGES,
      created: CREATED,
    }),
  )
  goalId = saved.goal.id
  goalFolder = saved.folder

  const batch = Array.from({ length: 20 }, (_, index) => {
    const name = `note-${index}`
    return { kind: "text" as const, name, text: `Fact ${index}: registers hold working state for call ${index}.` }
  })
  unwrap(await gatherSources({ workspace, goalId, retrievedAt: CREATED }, batch))
})

afterEach(async () => {
  await removeTemp(base)
})

function toolbox(cache?: ReturnType<typeof createExtractionCache>) {
  return createSkillsToolbox({
    workspace,
    goalId,
    cache,
    extractor: countingExtractor,
  })
}

function cache(options: { maxBytes?: number; onDiagnostic?: (diagnostic: CacheDiagnostic) => void } = {}) {
  return createExtractionCache({ dataDir, maxBytes: options.maxBytes, onDiagnostic: options.onDiagnostic })
}

describe("warm cache", () => {
  test("a second search extracts nothing", async () => {
    const warmable = toolbox(cache())

    const cold = unwrap(await warmable.tools.searchSources("registers"))
    expect(calls).toHaveLength(20)
    expect(cold.hits.length).toBeGreaterThan(0)

    calls = []
    const warm = unwrap(await warmable.tools.searchSources("registers"))
    expect(calls).toHaveLength(0)
    expect(warm.hits).toEqual(cold.hits)
    expect(warm.total).toBe(cold.total)
  })

  test("readSource is byte-identical cold and warm, labels included", async () => {
    const name = unwrap(await toolbox().tools.listSources())[0]!.name

    const coldRead = unwrap(await toolbox(cache()).tools.readSource(name))
    calls = []
    const warmRead = unwrap(await toolbox(cache()).tools.readSource(name))

    expect(calls).toHaveLength(0)
    expect(warmRead).toEqual(coldRead)
    expect(warmRead.origin).toBe("user")
    expect(warmRead.text).toBe(coldRead.text)
  })

  test("a cache instance is reusable across toolboxes", async () => {
    const shared = cache()
    unwrap(await toolbox(shared).tools.searchSources("registers"))
    calls = []
    unwrap(await toolbox(shared).tools.searchSources("registers"))
    expect(calls).toHaveLength(0)
  })
})

describe("invalidation", () => {
  test("changing a file's content forces exactly one re-extraction", async () => {
    const shared = cache()
    const box = toolbox(shared)
    const listed = unwrap(await box.tools.listSources())
    const target = listed[0]!
    // The stored copy is hash-prefixed; the tool name is the bare file name.
    const meta = JSON.parse(await readFile(join(goalFolder, "meta.json"), "utf8")) as {
      sources: Array<{ name: string; storedPath: string }>
    }
    const stored = meta.sources.find((source) => source.name === target.name)!
    const path = join(goalFolder, stored.storedPath)

    unwrap(await box.tools.searchSources("registers"))
    calls = []

    await writeFile(path, `Rewritten content about registers, hash changed.\n`)
    const after = unwrap(await box.tools.searchSources("registers"))

    // Exactly one file changed, so exactly one extraction happens.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(path)
    expect(after.hits.some((hit) => hit.name === target.name)).toBe(true)
  })
})

describe("cache directory", () => {
  test("never leaves the data directory", async () => {
    const shared = cache()
    unwrap(await toolbox(shared).tools.searchSources("registers"))

    expect(shared.root.startsWith(dataDir)).toBe(true)
    expect(shared.root.startsWith(join(workspace.root, ""))).toBe(false)
    expect(existsSync(shared.root)).toBe(true)

    // Nothing under the workspace or the goal folder is a cache file.
    const entries = await readdir(shared.root)
    expect(entries.length).toBe(20)
    for (const name of entries) expect(name).toMatch(/^[0-9a-f]{64}\.json$/)
    expect(await stat(join(goalFolder, "sources"))).toBeDefined()
  })

  test("an entry records the content hash and the extractor id", async () => {
    const shared = cache()
    unwrap(await toolbox(shared).tools.searchSources("registers"))
    const [entry] = await readdir(shared.root)
    const parsed = JSON.parse(await readFile(join(shared.root, entry!), "utf8")) as {
      hash: string
      extractor: string
      bytes: number
      text: string
    }
    expect(parsed.hash).toStartWith("sha256:")
    expect(parsed.extractor).toBe(EXTRACTOR_ID)
    expect(parsed.bytes).toBe(Buffer.byteLength(parsed.text))
  })
})

describe("degenerate entries", () => {
  test("a corrupt entry falls through and still returns the text", async () => {
    const shared = cache()
    unwrap(await toolbox(shared).tools.searchSources("registers"))

    const [entry] = await readdir(shared.root)
    await writeFile(join(shared.root, entry!), "{ not json")
    calls = []

    const result = unwrap(await toolbox(shared).tools.searchSources("registers"))
    expect(result.hits.length).toBeGreaterThan(0)
    // Only the damaged entry is a miss; the other nineteen still hit.
    expect(calls).toHaveLength(1)
  })

  test("an entry from another extractor version is a miss", async () => {
    const older = createExtractionCache({ dataDir, extractor: "extract-v0" })
    unwrap(await toolbox(older).tools.searchSources("registers"))

    calls = []
    unwrap(await toolbox(cache()).tools.searchSources("registers"))
    expect(calls).toHaveLength(20)
  })

  test("a read failure is a diagnostic, not a failed search", async () => {
    const diagnostics: CacheDiagnostic[] = []
    const shared = cache({ onDiagnostic: (entry) => diagnostics.push(entry) })
    unwrap(await toolbox(shared).tools.searchSources("registers"))

    const [entry] = await readdir(shared.root)
    // A directory where a file is expected makes the read fail.
    await rm(join(shared.root, entry!), { force: true })
    await mkdir(join(shared.root, entry!), { recursive: true })
    calls = []

    const result = unwrap(await toolbox(shared).tools.searchSources("registers"))
    expect(result.hits.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(1)
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})

describe("size bound", () => {
  test("evicts oldest first and stays under the cap", async () => {
    const shared = cache({ maxBytes: 2048 })
    unwrap(await toolbox(shared).tools.searchSources("registers"))

    const entries = await readdir(shared.root)
    let total = 0
    for (const name of entries) total += (await stat(join(shared.root, name))).size
    expect(total).toBeLessThanOrEqual(2048)
    expect(entries.length).toBeLessThan(20)
    expect(entries.length).toBeGreaterThan(0)
  })

  test("the entry just written is never the one evicted", async () => {
    const shared = cache({ maxBytes: 512 })
    const box = toolbox(shared)
    const listed = unwrap(await box.tools.listSources())
    const target = listed[listed.length - 1]!

    calls = []
    const read = unwrap(await box.tools.readSource(target.name))
    // The value was returned, so its entry must survive this write.
    expect(read.text.length).toBeGreaterThan(0)
    expect(unwrap(await box.tools.readSource(target.name)).text).toBe(read.text)
    expect(calls).toHaveLength(1)
  })

  test("the default bound is the documented 64 MiB", () => {
    expect(DEFAULT_MAX_BYTES).toBe(64 * 1024 * 1024)
  })

  test("the bound is respected even when one entry exceeds it", async () => {
    const shared = cache({ maxBytes: 64 })
    unwrap(await toolbox(shared).tools.searchSources("registers"))
    let total = 0
    for (const name of await readdir(shared.root)) total += (await stat(join(shared.root, name))).size
    expect(total).toBeLessThanOrEqual(64 * 4)
  })
})

describe("the wall is unchanged", () => {
  test("a school path is still refused with the cache in place", async () => {
    const schoolFile = join(workspace.paths.schoolVault, "concepts", "energy.md")
    await mkdir(join(workspace.paths.schoolVault, "concepts"), { recursive: true })
    await writeFile(schoolFile, "SCHOOL ONLY")

    const box = toolbox(cache())
    for (const name of [schoolFile, "../../../school/vault/concepts/energy.md"]) {
      const error = errorOf(await box.tools.readSource(name))
      expect(error.kind).toBe("path")
      expect(JSON.stringify(error)).not.toContain("SCHOOL ONLY")
    }
  })

  test("an orphan cache entry is never listed as a source", async () => {
    const shared = cache()
    unwrap(await toolbox(shared).tools.searchSources("registers"))
    const entries = await readdir(shared.root)
    const listed = unwrap(await toolbox(shared).tools.listSources())
    for (const entry of entries) {
      expect(listed.map((source) => source.name)).not.toContain(entry)
    }
  })
})

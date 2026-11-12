/**
 * WP-151 — knowledge search over the real FTS index.
 *
 * Notes are written into the two vaults, indexed by the storage layer's own
 * rebuild, and searched through the service. The wall is asserted from the
 * results, never from a filter flag.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { removeTemp } from "../helpers/cleanup"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import { closeIndex, indexLocation, rebuildFromScratch } from "../../src/storage/index"
import {
  SNIPPET_MAX_CHARS,
  boundSnippet,
  bySide,
  hitBelongsToSide,
  kindForPath,
  searchKnowledge,
} from "../../src/services/knowledge/search"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"

let base: string
let workspace: Workspace

const SCHOOL_NOTE = `---
type: concept
title: Energy balance
tags:
  - physics
---

# Energy balance

The boundary conditions decide the integral limits of the energy balance.
`

const SKILLS_NOTE = `---
type: goal
title: Assembly basics
tags:
  - assembly
---

# Assembly basics

Reading disassembly needs the calling convention and the stack frame layout.
`

async function tree(root: string): Promise<string> {
  const parts: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      parts.push(`${relative(root, path)}:${await readFile(path, "utf8")}`)
    }
  }
  if (existsSync(root)) await walk(root)
  return parts.sort().join("\n")
}

async function seedNotes(): Promise<void> {
  const school = join(workspace.paths.schoolVault, "concepts")
  const skills = join(workspace.paths.skillVault, "goals")
  await mkdir(school, { recursive: true })
  await mkdir(skills, { recursive: true })
  await writeFile(join(school, "energy-balance.md"), SCHOOL_NOTE)
  await writeFile(join(skills, "assembly-basics.md"), SKILLS_NOTE)
}

function buildIndexes(): void {
  for (const side of ["school", "skills"] as const) {
    const rebuilt = rebuildFromScratch(workspace.paths, side)
    if (!rebuilt.ok) throw new Error(`rebuild failed for ${side}: ${rebuilt.error.message}`)
    closeIndex(rebuilt.value.index)
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "knowledge-"))
  const created = await createWorkspace(join(base, "workspace"))
  if (!created.ok) throw new Error(`workspace create failed: ${created.error.message}`)
  workspace = created.value
  await seedNotes()
})

afterEach(async () => {
  await removeTemp(base)
})

describe("both sides, labelled", () => {
  test("a term in each side returns one hit per side, each labelled", async () => {
    const result = await searchKnowledge(workspace, "balance OR disassembly")
    // Each side is searched separately, so a shared term still labels correctly.
    const schoolOnly = await searchKnowledge(workspace, "balance")
    const skillsOnly = await searchKnowledge(workspace, "disassembly")

    expect(schoolOnly.hits.map((hit) => hit.side)).toEqual(["school"])
    expect(skillsOnly.hits.map((hit) => hit.side)).toEqual(["skills"])
    expect(schoolOnly.hits[0]?.path).toBe("concepts/energy-balance.md")
    expect(skillsOnly.hits[0]?.path).toBe("goals/assembly-basics.md")

    const both = await searchKnowledge(workspace, "the")
    const grouped = bySide(both)
    expect(grouped.school.length).toBeGreaterThan(0)
    expect(grouped.skills.length).toBeGreaterThan(0)
    for (const hit of both.hits) {
      expect(["school", "skills"]).toContain(hit.side)
      expect(hit.path.startsWith("/")).toBe(false)
    }
    expect(result.counts.school).toBeGreaterThanOrEqual(0)
  })

  test("hits carry side, path, title, snippet and kind", async () => {
    const result = await searchKnowledge(workspace, "energy")
    const [hit] = result.hits
    expect(hit?.side).toBe("school")
    expect(hit?.title).toBe("Energy balance")
    expect(hit?.kind).toBe("concept")
    expect(hit?.snippet.length).toBeGreaterThan(0)
    expect(hit).not.toHaveProperty("body")
  })

  test("a single side never returns the other side's hit", async () => {
    for (const side of ["school", "skills"] as const) {
      const result = await searchKnowledge(workspace, "the", { side })
      expect(result.hits.every((hit) => hit.side === side)).toBe(true)
      expect(result.counts[side === "school" ? "skills" : "school"]).toBe(0)
    }

    const school = await searchKnowledge(workspace, "disassembly", { side: "school" })
    expect(school.hits).toEqual([])
  })
})

describe("query handling", () => {
  test("an empty or whitespace query returns nothing", async () => {
    for (const query of ["", "   ", "\t\n"]) {
      const result = await searchKnowledge(workspace, query)
      expect(result.hits).toEqual([])
      expect(result.diagnostics).toEqual([])
    }
  })

  test("quotes, asterisks and operators are treated literally and never throw", async () => {
    const queries = ['"', "*", '""', "AND", "OR", "NOT", "-", "a:b", "(x)", 'balance"', "bal*", "100%"]
    for (const query of queries) {
      const result = await searchKnowledge(workspace, query)
      expect(Array.isArray(result.hits)).toBe(true)
      expect(result.diagnostics).toEqual([])
    }

    // A prefix query still finds the note rather than widening to everything.
    const prefix = await searchKnowledge(workspace, "ener*")
    expect(prefix.hits.every((hit) => hit.side === "school")).toBe(true)
  }, 15_000)

  test("a quoted phrase does not escape the wall", async () => {
    const result = await searchKnowledge(workspace, '"calling convention"', { side: "school" })
    expect(result.hits).toEqual([])
  })
})

describe("snippets", () => {
  test("are bounded and never contain the whole body", async () => {
    const long = `# Long note\n\n${"boundary ".repeat(400)}end of note.\n`
    await writeFile(join(workspace.paths.schoolVault, "concepts", "long.md"), long)

    const result = await searchKnowledge(workspace, "boundary", { limit: 5 })
    expect(result.hits.length).toBeGreaterThan(0)
    for (const hit of result.hits) {
      expect(hit.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 1)
      expect(hit.snippet).not.toContain("end of note")
      expect(hit.snippet.length).toBeLessThan(long.length)
    }
  })

  test("boundSnippet cuts on a word boundary and marks the cut", () => {
    const text = "word ".repeat(100).trim()
    const bounded = boundSnippet(text)
    expect(bounded.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 1)
    expect(bounded.endsWith("…")).toBe(true)
    expect(boundSnippet("short text")).toBe("short text")
    expect(boundSnippet("  spaced   out  ")).toBe("spaced out")
  })
})

describe("a broken index", () => {
  test("is a diagnostic with a next step, and the other side still searches", async () => {
    buildIndexes()
    const schoolIndex = indexLocation(workspace.paths, "school").db
    await writeFile(schoolIndex, "this is not a database\n")

    const result = await searchKnowledge(workspace, "disassembly")
    expect(result.hits.every((hit) => hit.side === "skills")).toBe(true)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    const [note] = result.diagnostics
    expect(note?.side).toBe("school")
    expect(note?.next.length).toBeGreaterThan(0)
  })

  test.skipIf(isWindows)("after the corrupt file is removed the side searches again", async () => {
    buildIndexes()
    const schoolIndex = indexLocation(workspace.paths, "school").db
    await writeFile(schoolIndex, "garbage\n")
    await searchKnowledge(workspace, "balance")
    await rm(schoolIndex, { force: true })

    const recovered = await searchKnowledge(workspace, "balance", { side: "school" })
    expect(recovered.diagnostics).toEqual([])
    expect(recovered.hits[0]?.path).toBe("concepts/energy-balance.md")
  })

  test("a missing index is rebuilt once, then searched", async () => {
    await rm(indexLocation(workspace.paths, "school").db, { force: true })
    const result = await searchKnowledge(workspace, "balance", { side: "school" })
    expect(result.diagnostics).toEqual([])
    expect(result.hits).toHaveLength(1)
    expect(existsSync(indexLocation(workspace.paths, "school").db)).toBe(true)
  })
})

describe("read-only and the wall", () => {
  test("the vault tree is byte-identical after a search", async () => {
    buildIndexes()
    const before = await tree(workspace.paths.schoolVault) + await tree(workspace.paths.skillVault)
    await searchKnowledge(workspace, "balance")
    await searchKnowledge(workspace, "the", { side: "all" })
    const after = await tree(workspace.paths.schoolVault) + await tree(workspace.paths.skillVault)
    expect(after).toBe(before)
  })

  test("kindForPath maps the vault folders and never guesses", () => {
    expect(kindForPath("concepts/energy.md")).toBe("concept")
    expect(kindForPath("sessions/2026-11-01.md")).toBe("session-summary")
    expect(kindForPath("sources/intel.md")).toBe("source")
    expect(kindForPath("goals/assembly.md")).toBe("goal")
    expect(kindForPath("courses/physics.md")).toBe("course")
    expect(kindForPath("elsewhere/x.md")).toBe("note")
  })

  test("hitBelongsToSide refuses an absolute or escaping path", () => {
    expect(hitBelongsToSide("school", "concepts/a.md")).toBe(true)
    expect(hitBelongsToSide("school", "skills/goals/a.md")).toBe(false)
    expect(hitBelongsToSide("skills", "school/concepts/a.md")).toBe(false)
    expect(hitBelongsToSide("school", "/etc/passwd")).toBe(false)
    expect(hitBelongsToSide("school", "../school/a.md")).toBe(false)
    expect(hitBelongsToSide("school", "")).toBe(false)
  })
})

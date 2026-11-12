/**
 * The knowledge loader reads both vaults, builds the topic forest and keeps the
 * wall: no edge crosses school and skills, and no note is written.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { loadKnowledgeGraph } from "../../src/services/knowledge/graph"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function workspace(): Promise<Workspace> {
  const parent = await mkdtemp(join(TEMP_BASE, "lockedin-knowledge-"))
  cleanup.push(parent)
  const created = await createWorkspace(join(parent, "workspace"), { dataDir: join(parent, "data") })
  if (!created.ok) throw new Error(JSON.stringify(created.error))
  return created.value
}

function write(root: string, path: string, text: string): void {
  const abs = join(root, path)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, text)
}

describe("loadKnowledgeGraph", () => {
  test("reads topics, builds the forest and resolves links inside a side", async () => {
    const ws = await workspace()
    write(
      ws.paths.skillVault,
      "knowledge/coding/cpp/vector.md",
      "---\ntitle: Smart vector growth\ntopics: [Coding/C++, Algorithms]\n---\n\nSee [[tables]].\n",
    )
    write(
      ws.paths.skillVault,
      "knowledge/coding/lua/tables.md",
      "---\ntitle: Lua tables\ntopics: [Coding/Lua]\n---\n\nTables are the one data structure.\n",
    )

    const graph = await loadKnowledgeGraph(ws)
    expect(graph.diagnostics).toEqual([])
    expect(graph.notes).toHaveLength(2)

    const coding = graph.topics.find((topic) => topic.label === "Coding")!
    expect(coding.children.map((child) => child.label)).toEqual(["C++", "Lua"])
    expect(coding.count).toBe(2)

    const cpp = graph.notes.find((note) => note.title === "Smart vector growth")!
    expect(cpp.topics).toEqual(["Coding/C++", "Algorithms"])
    expect(graph.edges).toContainEqual({
      from: cpp.id,
      to: graph.notes.find((note) => note.title === "Lua tables")!.id,
    })
  })

  test("the wall holds: a cross-side link becomes no edge", async () => {
    const ws = await workspace()
    write(ws.paths.skillVault, "knowledge/vector.md", "---\ntitle: Vector\ntopics: [Coding]\n---\n")
    write(ws.paths.schoolVault, "concepts/energy.md", "---\ntitle: Energy\n---\n\nSee [[vector]].\n")

    const graph = await loadKnowledgeGraph(ws)
    expect(graph.notes).toHaveLength(2)
    expect(graph.edges).toEqual([])
  })

  test("a note added after the first load appears on the next load", async () => {
    const ws = await workspace()
    write(ws.paths.skillVault, "knowledge/a.md", "---\ntitle: A\ntopics: [T]\n---\n")
    const first = await loadKnowledgeGraph(ws)
    expect(first.notes).toHaveLength(1)
    write(ws.paths.skillVault, "knowledge/b.md", "---\ntitle: B\ntopics: [T]\n---\n")
    const second = await loadKnowledgeGraph(ws)
    expect(second.notes.map((note) => note.title).sort()).toEqual(["A", "B"])
  })

  test("reading the graph never changes a note", async () => {
    const ws = await workspace()
    const path = join(ws.paths.skillVault, "knowledge/vector.md")
    write(ws.paths.skillVault, "knowledge/vector.md", "---\ntitle: Vector\ntopics: [Coding]\n---\n\nBody.\n")
    const before = readFileSync(path, "utf8")
    await loadKnowledgeGraph(ws)
    expect(readFileSync(path, "utf8")).toBe(before)
    expect(ws.paths.skillVault).toContain(join("skills", "vault"))
  })

  test("a corrupt index is a diagnostic, and the other vault still loads", async () => {
    const ws = await workspace()
    write(ws.paths.schoolVault, "concepts/energy.md", "---\ntitle: Energy\ntopics: [Physics]\n---\n")
    write(ws.paths.root, "skills/index.db", "this is not a sqlite database")
    const graph = await loadKnowledgeGraph(ws)
    expect(graph.diagnostics.length).toBeGreaterThan(0)
    expect(graph.notes.some((note) => note.title === "Energy")).toBe(true)
  })

  test("goals, sources and session summaries are not knowledge", async () => {
    const ws = await workspace()
    write(ws.paths.skillVault, "goals/g.md", "---\ntitle: Learn C++\ntype: goal\n---\n")
    write(ws.paths.skillVault, "sources/s.md", "---\ntitle: Source excerpt\ntype: source\n---\n")
    write(ws.paths.schoolVault, "sessions/s.md", "---\ntitle: Session summary\ntype: session-summary\n---\n")
    write(ws.paths.schoolVault, "concepts/c.md", "---\ntitle: A concept\ntype: concept\ntopics: [Math]\n---\n")
    write(ws.paths.skillVault, "knowledge/k.md", "---\ntitle: Smart vector\ntype: knowledge\ntopics: [Coding/C++]\n---\n")
    const graph = await loadKnowledgeGraph(ws)
    expect(graph.notes.map((note) => note.title).sort()).toEqual(["A concept", "Smart vector"])
  })

  test("a note without topics still appears under General", async () => {
    const ws = await workspace()
    write(ws.paths.skillVault, "knowledge/loose.md", "---\ntitle: Loose note\n---\n\nBody.\n")
    const graph = await loadKnowledgeGraph(ws)
    expect(graph.topics.map((topic) => topic.label)).toEqual(["General"])
    expect(graph.topics[0]!.notes[0]!.title).toBe("Loose note")
  })
})

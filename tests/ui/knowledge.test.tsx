/** The Knowledge window: themed tree, breadcrumb and in-window reader. */
import { describe, expect, test } from "bun:test"

import type { KnowledgeGraph, KnowledgeNote } from "../../src/services/knowledge/graph"
import type { KnowledgeState } from "../../src/ui/knowledge/model"

const { testRender } = await import("@opentui/solid")
const knowledge = await import("../../src/ui/knowledge/model")
const { KnowledgeWindow } = await import("../../src/ui/knowledge/window")
const graph = await import("../../src/services/knowledge/graph")
const { crimson } = await import("../../src/ui/theme")

const notes: KnowledgeNote[] = [
  {
    id: graph.noteId("skills", "knowledge/coding/cpp/vector.md"),
    section: "skills",
    path: "knowledge/coding/cpp/vector.md",
    title: "Smart vector growth",
    kind: "concept",
    topics: ["Coding/C++"],
    tags: ["cpp"],
    updated: Date.UTC(2026, 10, 1),
    body: "# Smart vector growth\n\nGrow by 1.5x and never copy twice.\n\n```cpp\nv.reserve(n);\n```\n",
  },
  {
    id: graph.noteId("skills", "knowledge/coding/lua/tables.md"),
    section: "skills",
    path: "knowledge/coding/lua/tables.md",
    title: "Lua tables",
    kind: "concept",
    topics: ["Coding/Lua"],
    tags: [],
    updated: 0,
    body: "# Lua tables\n\nTables are the one data structure.\n",
  },
]

const GRAPH: KnowledgeGraph = {
  topics: graph.buildTopics(notes),
  notes,
  edges: [{ from: notes[0]!.id, to: notes[1]!.id }],
  diagnostics: [],
}

async function mount(
  state: KnowledgeState,
  graph: KnowledgeGraph = GRAPH,
  graphics?: boolean,
) {
  const setup = await testRender(
    () => (
      <KnowledgeWindow
        theme={crimson}
        width={100}
        height={30}
        focused
        graph={graph}
        state={state}
        reducedMotion
        graphics={graphics}
      />
    ),
    { width: 100, height: 30 },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function frame(setup: Awaited<ReturnType<typeof mount>>): string {
  return setup.captureCharFrame()
}

describe("the knowledge window", () => {
  test("shows the section, topic and note tree with a breadcrumb", async () => {
    const focus = graph.noteId("skills", "knowledge/coding/cpp/vector.md")
    const setup = await mount({ ...knowledge.initialKnowledge, focus })
    try {
      const text = frame(setup)
      expect(text).toContain("KNOWLEDGE")
      expect(text).toContain("reference")
      expect(text).toContain("Coding")
      expect(text).toContain("Smart vector growth")
      expect(text).toContain("Lua tables")
      expect(text).toContain("Coding › C++ › Smart vector growth")
    } finally {
      await setup.dispose()
    }
  })

  test("the pixel renderer paints labels and node pixels", async () => {
    const setup = await mount(
      { ...knowledge.initialKnowledge, focus: graph.topicId("Coding") },
      GRAPH,
      true,
    )
    try {
      const text = frame(setup)
      expect(text).toContain("KNOWLEDGE")
      expect(text).toContain("Coding")
      expect(text).toContain("C++")
      expect(text).not.toContain("◆ Coding")
    } finally {
      await setup.dispose()
    }
  })

  test("the list fallback keeps the same contract", async () => {
    const focus = graph.topicId("Coding")
    const setup = await mount({ ...knowledge.initialKnowledge, focus, list: true })
    try {
      const text = frame(setup)
      expect(text).toContain("◆ Coding")
      expect(text).toContain("▸ C++")
      expect(text).toContain("● Smart vector growth")
      expect(text).toContain("v list")
    } finally {
      await setup.dispose()
    }
  })

  test("Enter's reader renders Markdown and code, read-only", async () => {
    const reading = graph.noteId("skills", "knowledge/coding/cpp/vector.md")
    const setup = await mount({ ...knowledge.initialKnowledge, focus: reading, reading })
    try {
      const text = frame(setup)
      expect(text).toContain("Smart vector growth")
      expect(text).toContain("Grow by 1.5x")
      expect(text).toContain("reserve(n)")
      expect(text).toContain("Esc back")
    } finally {
      await setup.dispose()
    }
  })

  test("a corrupt index is shown as a diagnostic, not an empty page", async () => {
    const setup = await mount(
      { ...knowledge.initialKnowledge, focus: graph.topicId("Coding") },
      { ...GRAPH, diagnostics: ["School knowledge could not be read: index is corrupt"] },
    )
    try {
      const text = frame(setup)
      expect(text).toContain("! School knowledge could not be read: index is corrupt")
    } finally {
      await setup.dispose()
    }
  })

  test("a search notice is visible, not silent", async () => {
    const setup = await mount({
      ...knowledge.initialKnowledge,
      focus: graph.topicId("Coding"),
      notice: "no match in knowledge",
      query: "zzz",
    })
    try {
      const text = frame(setup)
      expect(text).toContain("! no match in knowledge")
      expect(text).toContain("/zzz")
    } finally {
      await setup.dispose()
    }
  })
})

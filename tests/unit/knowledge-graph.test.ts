/**
 * Knowledge graph: the index cache, the topic tree and the keyboard model.
 *
 * The fixtures are in memory. Nothing here opens a vault except the parity
 * check for `parseNoteFile`, which reads one string.
 */
import { describe, expect, test } from "bun:test"

import { parseNoteFile } from "../../src/storage/index"
import {
  buildTopics,
  flattenTopics,
  GENERAL_TOPIC,
  noteId,
  topicId,
  topicsFor,
  type KnowledgeGraph,
  type KnowledgeNote,
} from "../../src/services/knowledge/graph"
import {
  breadcrumb,
  firstChildOf,
  linkedNotes,
  moveFocus,
  navigationOrder,
  parentOf,
  primaryTopic,
  rootOf,
  searchGraph,
  searchJump,
  initialKnowledge,
} from "../../src/ui/knowledge/model"
import { buildScene, directionTarget, MAX_SCENE_NOTES, project } from "../../src/ui/knowledge/scene"

function note(
  section: "school" | "skills",
  path: string,
  title: string,
  topics: string[],
  body = "",
): KnowledgeNote {
  return {
    id: noteId(section, path),
    section,
    path,
    title,
    kind: "concept",
    topics,
    tags: [],
    updated: 0,
    body,
  }
}

function graphOf(notes: KnowledgeNote[], edges: Array<{ from: string; to: string }> = []): KnowledgeGraph {
  return { topics: buildTopics(notes), notes, edges, diagnostics: [] }
}

function sample(): KnowledgeGraph {
  const cpp = note("skills", "knowledge/coding/cpp/vector.md", "Smart vector growth", ["Coding/C++"])
  const lua = note("skills", "knowledge/coding/lua/tables.md", "Lua tables", ["Coding/Lua"])
  const unfiled = note("skills", "knowledge/misc/reading.md", "Reading code", [])
  const rome = note("school", "knowledge/history/rome.md", "Fall of Rome", ["History/Rome"])
  return graphOf([cpp, lua, unfiled, rome], [{ from: cpp.id, to: lua.id }])
}

describe("topics in frontmatter", () => {
  test("a note declares an ordered topic path", () => {
    const parsed = parseNoteFile(
      "knowledge/coding/cpp/vector.md",
      "---\ntitle: Smart vector\ntopics:\n  - Coding/C++\n  - Algorithms\n---\n\nBody.\n",
    )
    expect(parsed.topics).toEqual(["Coding/C++", "Algorithms"])
    expect(parsed.title).toBe("Smart vector")
  })

  test("a bare string is one path, and empty segments collapse", () => {
    const parsed = parseNoteFile("a.md", "---\ntopics: Coding / C++ /\n---\n")
    expect(parsed.topics).toEqual(["Coding/C++"])
  })

  test("inline tag and topic lists parse as lists, not one bracketed string", () => {
    const parsed = parseNoteFile(
      "a.md",
      "---\ntags: [cpp, perf]\ntopics: [\"Coding/C++\", Algorithms]\n---\n",
    )
    expect(parsed.tags).toEqual(["cpp", "perf"])
    expect(parsed.topics).toEqual(["Coding/C++", "Algorithms"])
    const quoted = parseNoteFile(
      "b.md",
      "---\ntopics: [Coding, \"Research, Methods\"]\n---\n",
    )
    expect(quoted.topics).toEqual(["Coding", "Research, Methods"])
  })

  test("missing topics is an empty list, not a fabricated branch", () => {
    expect(parseNoteFile("a.md", "# A\n").topics).toEqual([])
    expect(parseNoteFile("a.md", "---\ntopics: []\n---\n").topics).toEqual([])
  })

  test("topicsFor keeps declaration order and de-duplicates", () => {
    expect(topicsFor(["Coding/C++", "Coding/C++/", "Algorithms"])).toEqual(["Coding/C++", "Algorithms"])
    expect(topicsFor([])).toEqual([GENERAL_TOPIC])
  })
})

describe("the topic tree", () => {
  test("school and skills share one forest; General is never dropped", () => {
    const graph = sample()
    expect(graph.topics.map((topic) => topic.label)).toEqual(["Coding", "General", "History"])
    expect(flattenTopics(graph.topics).some((topic) => topic.label === GENERAL_TOPIC)).toBe(true)
  })

  test("big nodes contain small nodes and counts are unique notes", () => {
    const graph = sample()
    const coding = graph.topics.find((topic) => topic.label === "Coding")!
    expect(coding.children.map((child) => child.label)).toEqual(["C++", "Lua"])
    expect(coding.count).toBe(2)
    expect(coding.children.find((child) => child.label === "C++")!.notes[0]!.title).toBe(
      "Smart vector growth",
    )
  })

  test("the same topic from school and skills is one node", () => {
    const school = note("school", "concepts/cpp.md", "C++ from school", ["Coding/C++"])
    const skills = note("skills", "knowledge/cpp.md", "C++ from skills", ["Coding/C++"])
    const graph = graphOf([school, skills])
    const coding = graph.topics.find((topic) => topic.label === "Coding")!
    const cpp = coding.children.find((topic) => topic.label === "C++")!
    expect(cpp.notes.map((entry) => entry.title).sort()).toEqual(["C++ from school", "C++ from skills"])
    expect(cpp.count).toBe(2)
  })

  test("a note in two topics is one node in two places", () => {
    const shared = note("skills", "knowledge/shared.md", "Shared", ["Coding", "Coding/C++"])
    const graph = graphOf([shared])
    const coding = graph.topics.find((topic) => topic.label === "Coding")!
    expect(coding.notes.map((entry) => entry.id)).toEqual([shared.id])
    expect(coding.children[0]!.notes.map((entry) => entry.id)).toEqual([shared.id])
    expect(coding.count).toBe(1)
    expect(graph.notes).toHaveLength(1)
    const scene = buildScene(graph, shared.id, 800, 480)
    expect(scene.nodes.filter((node) => node.id === shared.id)).toHaveLength(1)
  })

  test("every node uses the celestial star glyph", () => {
    const scene = buildScene(sample(), null, 800, 480)
    expect(scene.nodes.length).toBeGreaterThan(0)
    expect(scene.nodes.every((node) => node.shape === "star")).toBe(true)
  })
})

describe("keyboard navigation", () => {
  test("the order is topics, their notes, then their children", () => {
    const order = navigationOrder(sample())
    expect(order[0]).toEqual({ id: topicId("Coding"), kind: "topic", label: "Coding" })
    expect(order.slice(0, 3).map((item) => item.label)).toEqual(["Coding", "C++", "Smart vector growth"])
    expect(order.some((item) => item.id === noteId("school", "knowledge/history/rome.md"))).toBe(true)
  })

  test("j/k wraps and keeps one focus", () => {
    const graph = sample()
    const first = { ...initialKnowledge, focus: topicId("Coding") }
    const next = moveFocus(graph, first, 1)
    expect(next.focus).not.toBe(first.focus)
    const wrapped = moveFocus(graph, { ...first, focus: navigationOrder(graph).at(-1)!.id }, 1)
    expect(wrapped.focus).toBe(navigationOrder(graph)[0]!.id)
  })

  test("Backspace climbs from a note to its primary topic", () => {
    const graph = sample()
    const cpp = noteId("skills", "knowledge/coding/cpp/vector.md")
    expect(parentOf(graph, cpp)).toBe(topicId("Coding/C++"))
    expect(parentOf(graph, topicId("Coding/C++"))).toBe(topicId("Coding"))
    expect(parentOf(graph, topicId("Coding"))).toBeNull()
    expect(primaryTopic(graph.notes.find((entry) => entry.id === cpp)!)).toBe(
      topicId("Coding/C++"),
    )
  })

  test("breadcrumbs normalize spacing in a topic path", () => {
    const raw = note("skills", "knowledge/raw.md", "Raw", ["Coding / C++"])
    const graph = graphOf([raw])
    expect(breadcrumb(graph, raw.id)).toEqual(["Coding", "C++", "Raw"])
  })

  test("breadcrumbs read like a path, not an id", () => {
    const graph = sample()
    expect(breadcrumb(graph, noteId("skills", "knowledge/coding/cpp/vector.md"))).toEqual([
      "Coding",
      "C++",
      "Smart vector growth",
    ])
    expect(breadcrumb(graph, topicId("History"))).toEqual(["History"])
  })

  test("g climbs to the root topic and l descends into the first child", () => {
    const graph = sample()
    const cpp = noteId("skills", "knowledge/coding/cpp/vector.md")
    expect(rootOf(graph, cpp)).toBe(topicId("Coding"))
    expect(rootOf(graph, topicId("Coding/C++"))).toBe(topicId("Coding"))
    expect(firstChildOf(graph, topicId("Coding"))).toBe(topicId("Coding/C++"))
    expect(firstChildOf(graph, cpp)).toBe(noteId("skills", "knowledge/coding/lua/tables.md"))
  })

  test("h/l follow resolved links, never the wall", () => {
    const graph = sample()
    const cpp = noteId("skills", "knowledge/coding/cpp/vector.md")
    expect(linkedNotes(graph, cpp).map((entry) => entry.title)).toEqual(["Lua tables"])
    expect(linkedNotes(graph, noteId("school", "knowledge/history/rome.md"))).toEqual([])
  })

  test("search finds a topic or a note and jumps to the next match", () => {
    const graph = sample()
    expect(searchGraph(graph, "lua").map((item) => item.label)).toContain("Lua tables")
    const jumped = searchJump(graph, { ...initialKnowledge, query: "vector" })
    expect(jumped.focus).toBe(noteId("skills", "knowledge/coding/cpp/vector.md"))
    const empty = searchJump(graph, { ...initialKnowledge, query: "zzz" })
    expect(empty.notice).toContain("no match")
  })
})

describe("3D layout", () => {
  test("the same graph lays out identically twice", () => {
    const graph = sample()
    const first = buildScene(graph, noteId("skills", "knowledge/coding/cpp/vector.md"), 800, 480)
    const second = buildScene(graph, noteId("skills", "knowledge/coding/cpp/vector.md"), 800, 480)
    expect(first.nodes.map((node) => [node.id, node.x, node.y, node.z])).toEqual(
      second.nodes.map((node) => [node.id, node.x, node.y, node.z]),
    )
  })

  test("a large vault draws a bounded map and keeps the focused note", () => {
    const many = Array.from({ length: MAX_SCENE_NOTES + 30 }, (_, index) =>
      note("skills", `knowledge/n${index}.md`, `Note ${index}`, ["Coding"]),
    )
    const focused = many.at(-1)!
    const scene = buildScene(graphOf(many), focused.id, 800, 480)
    const drawn = scene.nodes.filter((node) => node.kind === "note")
    expect(drawn.length).toBe(MAX_SCENE_NOTES + 1)
    expect(drawn.some((node) => node.id === focused.id)).toBe(true)
    expect(scene.truncated).toBe(29)
  })

  test("a single root topic is centred, not pushed to one side", () => {
    const only = note("skills", "knowledge/one.md", "Only", ["Coding"])
    const scene = buildScene(graphOf([only]), topicId("Coding"), 800, 480)
    const root = scene.nodes.find((node) => node.id === topicId("Coding"))!
    expect(root.x).toBe(0)
  })

  test("the camera looks at the focused node and depth changes scale", () => {
    const graph = sample()
    const focus = noteId("skills", "knowledge/coding/cpp/vector.md")
    const scene = buildScene(graph, focus, 800, 480)
    const node = scene.nodes.find((entry) => entry.id === focus)!
    expect(scene.camera.x).toBeCloseTo(node.x)
    expect(scene.camera.y).toBeCloseTo(node.y)
    expect(scene.camera.z).toBeCloseTo(node.z)

    const centre = project({ x: 0, y: 0, z: 0 }, scene.camera, 800, 480)
    const far = project({ x: 0, y: 0, z: 300 }, scene.camera, 800, 480)
    expect(centre.visible).toBe(true)
    expect(far.visible).toBe(true)
    expect(far.scale).toBeLessThan(centre.scale)
  })

  test("arrow movement stays inside the graph and never returns the focus", () => {
    const graph = sample()
    const focus = noteId("skills", "knowledge/coding/cpp/vector.md")
    const ids = new Set(graph.notes.map((entry) => entry.id))
    for (const direction of ["up", "down", "left", "right"] as const) {
      const target = directionTarget(graph, focus, direction, 100, 30)
      if (target !== null) {
        expect(target).not.toBe(focus)
        expect(ids.has(target) || target.startsWith("topic:")).toBe(true)
      }
    }
    expect(directionTarget(graph, null, "up", 100, 30)).toBeNull()
  })

  test("the focus and its neighbours are the only near nodes", () => {
    const graph = sample()
    const focus = noteId("skills", "knowledge/coding/cpp/vector.md")
    const scene = buildScene(graph, focus, 800, 480)
    expect(scene.near.has(focus)).toBe(true)
    expect(scene.near.has(noteId("school", "knowledge/history/rome.md"))).toBe(false)
  })
})

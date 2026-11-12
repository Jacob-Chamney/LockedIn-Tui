/**
 * Knowledge navigation model.
 *
 * School and skills are one library here: the top layer is the topic forest
 * (`Coding`, `Research`, `Math`, `Gaming`, …), not the vault a note came from.
 * There is one focused id, a stable order, and a parent to return to.
 *
 * Nothing here reads or writes a file.
 */
import {
  GENERAL_TOPIC,
  noteId,
  topicId,
  topicsFor,
  type KnowledgeGraph,
  type KnowledgeNote,
  type KnowledgeTopic,
} from "../../services/knowledge/graph"

export type KnowledgeState = {
  /** Focused node id, or null before the first graph arrives. */
  focus: string | null
  /** Paths the user drilled through, for `Backspace`. */
  history: string[]
  /** The note rendered in the window's reader, or null for the graph. */
  reading: string | null
  /** First Markdown block visible in the reader. */
  readingOffset: number
  /** `v` flips to the indented list. */
  list: boolean
  /** `/` query; empty when search is closed. */
  query: string
  /** True while `/` is capturing text. */
  searching: boolean
  /** One-line status, e.g. an empty search. */
  notice: string | null
}

export const initialKnowledge: KnowledgeState = {
  focus: null,
  history: [],
  reading: null,
  readingOffset: 0,
  list: false,
  query: "",
  searching: false,
  notice: null,
}

export type NodeKind = "topic" | "note"

export type FocusNode =
  | { id: string; kind: "topic"; topic: KnowledgeTopic }
  | { id: string; kind: "note"; note: KnowledgeNote }

export type NavItem = { id: string; kind: NodeKind; label: string }

/** Primary topic id for a note: the first topic it declared. */
export function primaryTopic(note: KnowledgeNote): string {
  const topic = topicsFor(note.topics)[0] ?? GENERAL_TOPIC
  return topicId(topic)
}

/**
 * One stable order: the topic forest in pre-order, with a topic's own notes
 * listed directly under it, then its children. A note in two topics is listed
 * once, under the first topic that declares it.
 */
export function navigationOrder(graph: KnowledgeGraph): NavItem[] {
  const out: NavItem[] = []
  const seen = new Set<string>()
  const walk = (topic: KnowledgeTopic): void => {
    out.push({ id: topic.id, kind: "topic", label: topic.label })
    for (const note of topic.notes) {
      if (seen.has(note.id)) continue
      seen.add(note.id)
      out.push({ id: note.id, kind: "note", label: note.title })
    }
    for (const child of topic.children) walk(child)
  }
  for (const topic of graph.topics) walk(topic)
  return out
}

function findTopic(topics: readonly KnowledgeTopic[], id: string): KnowledgeTopic | null {
  for (const topic of topics) {
    if (topic.id === id) return topic
    const hit = findTopic(topic.children, id)
    if (hit) return hit
  }
  return null
}

export function focusNode(graph: KnowledgeGraph, id: string | null): FocusNode | null {
  if (id === null) return null
  const topic = findTopic(graph.topics, id)
  if (topic) return { id, kind: "topic", topic }
  const note = graph.notes.find((entry) => entry.id === id)
  return note ? { id, kind: "note", note } : null
}

export function parentOf(graph: KnowledgeGraph, id: string): string | null {
  const walk = (topics: readonly KnowledgeTopic[], parent: string | null): string | null => {
    for (const topic of topics) {
      if (topic.id === id) return parent
      const hit = walk(topic.children, topic.id)
      if (hit !== null) return hit
    }
    return null
  }
  const topicParent = walk(graph.topics, null)
  if (topicParent !== null) return topicParent
  const note = graph.notes.find((entry) => entry.id === id)
  return note ? primaryTopic(note) : null
}

/** The top-level topic a node belongs to, for `g`. */
export function rootOf(graph: KnowledgeGraph, id: string | null): string | null {
  if (id === null) return null
  const walk = (topics: readonly KnowledgeTopic[], root: string | null): string | null => {
    for (const topic of topics) {
      const nextRoot = root ?? topic.id
      if (topic.id === id) return nextRoot
      const hit = walk(topic.children, nextRoot)
      if (hit !== null) return hit
    }
    return null
  }
  const root = walk(graph.topics, null)
  if (root !== null) return root
  const note = graph.notes.find((entry) => entry.id === id)
  return note ? rootOf(graph, primaryTopic(note)) : null
}

/** First node inside a topic, or the first linked note when a note is focused. */
export function firstChildOf(graph: KnowledgeGraph, id: string): string | null {
  const node = focusNode(graph, id)
  if (!node) return null
  if (node.kind === "topic") {
    return node.topic.children[0]?.id ?? node.topic.notes[0]?.id ?? null
  }
  return linkedNotes(graph, id)[0]?.id ?? null
}

/** Breadcrumb from the top topic down to the focused node. */
export function breadcrumb(graph: KnowledgeGraph, id: string | null): string[] {
  const node = focusNode(graph, id)
  if (!node) return []
  if (node.kind === "note") {
    const topic = topicsFor(node.note.topics)[0] ?? GENERAL_TOPIC
    return [...topic.split("/"), node.note.title]
  }
  return node.topic.path.split("/")
}

/** Move `delta` through the stable order, wrapping at the ends. */
export function moveFocus(graph: KnowledgeGraph, state: KnowledgeState, delta: number): KnowledgeState {
  const order = navigationOrder(graph)
  if (order.length === 0) return { ...state, focus: null }
  const index = Math.max(0, order.findIndex((item) => item.id === state.focus))
  const next = (index + delta + order.length) % order.length
  return { ...state, focus: order[next]?.id ?? state.focus, history: [], notice: null }
}

/** Notes reachable from a note: backlinks and outgoing links, in stable order. */
export function linkedNotes(graph: KnowledgeGraph, id: string): KnowledgeNote[] {
  const ids = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from === id) ids.add(edge.to)
    if (edge.to === id) ids.add(edge.from)
  }
  return graph.notes.filter((note) => ids.has(note.id)).sort((a, b) => a.title.localeCompare(b.title))
}

export function searchGraph(graph: KnowledgeGraph, query: string): NavItem[] {
  const text = query.trim().toLowerCase()
  if (text === "") return []
  return navigationOrder(graph)
    .filter((item) => item.label.toLowerCase().includes(text))
    .slice(0, 12)
}

/** Step to the next match of `query`, starting after the current focus. */
export function searchJump(graph: KnowledgeGraph, state: KnowledgeState): KnowledgeState {
  const hits = searchGraph(graph, state.query)
  if (hits.length === 0) return { ...state, searching: false, notice: "no match in knowledge" }
  const at = hits.findIndex((hit) => hit.id === state.focus)
  const hit = hits[(at + 1) % hits.length]!
  return { ...state, searching: false, notice: null, focus: hit.id }
}

/** Every note under a topic, including children, without duplicates. */
export function notesUnder(topic: KnowledgeTopic): KnowledgeNote[] {
  const byId = new Map<string, KnowledgeNote>()
  const walk = (node: KnowledgeTopic): void => {
    for (const note of node.notes) byId.set(note.id, note)
    for (const child of node.children) walk(child)
  }
  walk(topic)
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title))
}

export { noteId, topicId }

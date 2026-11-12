/**
 * Read-only knowledge graph over the two note vaults.
 *
 * The page this feeds is a reference library, not an audit log: it reads the
 * vaults, never writes a note, never follows a link across the school/skills
 * wall, and never treats the activity log as knowledge.
 *
 * Hierarchy comes from each note's `topics` frontmatter. The first topic is the
 * primary parent; extra topics are additional places the note appears. A note
 * without topics lands in `General`, so nothing silently disappears.
 *
 * The index is a cache: a missing index is rebuilt once, exactly as knowledge
 * search does. A corrupt index becomes a diagnostic, not a crash.
 */

import {
  closeIndex,
  indexFileExists,
  openIndex,
  rebuildFromScratch,
  refreshAsync,
  type IndexError,
} from "../../storage/index"
import type { Side } from "../../storage/index"
import type { Workspace } from "../../storage/workspace"

export type KnowledgeSide = Side

/** The topic a note lands in when it declares none. */
export const GENERAL_TOPIC = "General"

export type KnowledgeNote = {
  id: string
  /** Where the note was written. This is metadata, not a top-level node. */
  section: KnowledgeSide
  /** Vault-relative path, e.g. `knowledge/coding/cpp/vector.md`. */
  path: string
  title: string
  kind: string
  topics: string[]
  tags: string[]
  /** Epoch milliseconds, for "updated" copy. */
  updated: number
  /** Markdown body, without frontmatter. Read-only. */
  body: string
}

export type KnowledgeTopic = {
  id: string
  /** Full topic path, e.g. `Coding/C++`. */
  path: string
  label: string
  /** Unique notes under this topic and its children. */
  count: number
  notes: KnowledgeNote[]
  children: KnowledgeTopic[]
}

export type KnowledgeEdge = {
  from: string
  to: string
}

export type KnowledgeGraph = {
  /** Combined topic forest: `Coding` contains `C++`, `Lua`, … */
  topics: KnowledgeTopic[]
  /** Every note once, in title order. School and skills share one graph. */
  notes: KnowledgeNote[]
  /** Resolved wikilinks, never crossing a side. */
  edges: KnowledgeEdge[]
  diagnostics: string[]
}

export type LoadOptions = {
  /** Rebuild a missing index once. On by default, matching knowledge search. */
  rebuildMissing?: boolean
}

/** A graph with no notes, for a pane that mounts before its data arrives. */
export const EMPTY_KNOWLEDGE_GRAPH: KnowledgeGraph = {
  topics: [],
  notes: [],
  edges: [],
  diagnostics: [],
}

export function noteId(section: KnowledgeSide, path: string): string {
  return `note:${section}:${path}`
}

/** Topic ids are shared across sides: one `Coding/C++` node, not two. */
export function topicId(path: string): string {
  return `topic:${path}`
}

export const SECTION_LABELS: Record<KnowledgeSide, string> = {
  school: "School",
  skills: "Skills",
}

const SIDES: readonly KnowledgeSide[] = ["school", "skills"]

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function messageOf(error: IndexError): string {
  return "message" in error && typeof error.message === "string" ? error.message : "The index could not be read."
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value !== "string") return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

type Row = {
  path: string
  title: string
  tags: string
  topics: string
  type: string
  body: string
  mtime: number
}

/** Split `Coding/C++` into cleaned segments; an empty path is `General`. */
export function topicSegments(path: string): string[] {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.length > 0 ? segments : [GENERAL_TOPIC]
}

/** A note's topic list, with the primary topic first and no duplicates. */
export function topicsFor(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const path = topicSegments(item).join("/")
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out.length > 0 ? out : [GENERAL_TOPIC]
}

function addNote(root: KnowledgeTopic, topic: string, note: KnowledgeNote): void {
  const segments = topicSegments(topic)
  let node = root
  let path = ""
  for (const segment of segments) {
    path = path === "" ? segment : `${path}/${segment}`
    let child = node.children.find((entry) => entry.label === segment)
    if (!child) {
      child = {
        id: topicId(path),
        path,
        label: segment,
        count: 0,
        notes: [],
        children: [],
      }
      node.children.push(child)
    }
    node = child
  }
  if (!node.notes.some((entry) => entry.id === note.id)) node.notes.push(note)
}

function finalise(node: KnowledgeTopic): Set<string> {
  const unique = new Set(node.notes.map((note) => note.id))
  for (const child of node.children) {
    for (const id of finalise(child)) unique.add(id)
  }
  node.count = unique.size
  node.children.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  node.notes.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
  return unique
}

/** Build one combined topic forest from notes of both sides. */
export function buildTopics(notes: readonly KnowledgeNote[]): KnowledgeTopic[] {
  const root: KnowledgeTopic = {
    id: "root",
    path: "",
    label: "",
    count: 0,
    notes: [],
    children: [],
  }
  for (const note of notes) {
    for (const topic of topicsFor(note.topics)) addNote(root, topic, note)
  }
  root.children.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  finalise(root)
  return root.children
}

function diagnosticFor(side: KnowledgeSide, error: IndexError): string {
  return `${SECTION_LABELS[side]} knowledge could not be read: ${messageOf(error)}`
}

async function readSide(
  workspace: Workspace,
  side: KnowledgeSide,
  rebuildMissing: boolean,
): Promise<{
  notes: KnowledgeNote[]
  edges: KnowledgeEdge[]
  diagnostics: string[]
}> {
  const diagnostics: string[] = []

  if (!indexFileExists(workspace.paths, side)) {
    if (!rebuildMissing) {
      return { notes: [], edges: [], diagnostics: [`${SECTION_LABELS[side]} knowledge has not been indexed yet.`] }
    }
    const rebuilt = rebuildFromScratch(workspace.paths, side)
    if (!rebuilt.ok) {
      return { notes: [], edges: [], diagnostics: [diagnosticFor(side, rebuilt.error)] }
    }
    closeIndex(rebuilt.value.index)
  }

  const opened = openIndex(workspace.paths, side)
  if (!opened.ok) {
    return { notes: [], edges: [], diagnostics: [diagnosticFor(side, opened.error)] }
  }

  const index = opened.value
  try {
    // Markdown is the source of truth; the index is a cache. Refresh before
    // reading so a note added or edited outside the app shows up here.
    const refreshed = await refreshAsync(index)
    if (!refreshed.ok) {
      diagnostics.push(
        `${SECTION_LABELS[side]} knowledge could not be refreshed: ${messageOf(refreshed.error)}`,
      )
    } else {
      for (const problem of refreshed.value.problems) {
        diagnostics.push(
          `${SECTION_LABELS[side]} note ${problem.path} could not be read: ${problem.message}`,
        )
      }
    }

    // Knowledge is reference material, not process history. Goals, sessions
    // and source excerpts live in the same vault but are not knowledge notes.
    const rows = index.db
      .query(
        "SELECT path, title, tags, topics, type, body, mtime FROM notes WHERE type IN ('concept', 'knowledge') ORDER BY path",
      )
      .all() as Row[]

    const notes: KnowledgeNote[] = rows.map((row) => ({
      id: noteId(side, row.path),
      section: side,
      path: row.path,
      title: row.title,
      kind: row.type,
      topics: parseList(row.topics),
      tags: parseList(row.tags),
      updated: row.mtime,
      body: row.body,
    }))

    const paths = new Set(notes.map((note) => note.path))
    const links = index.db
      .query("SELECT from_path AS fromPath, to_path AS toPath FROM links WHERE broken = 0")
      .all() as Array<{ fromPath: string; toPath: string }>

    const edges: KnowledgeEdge[] = []
    const seen = new Set<string>()
    for (const link of links) {
      if (!paths.has(link.fromPath) || !paths.has(link.toPath)) continue
      const from = noteId(side, link.fromPath)
      const to = noteId(side, link.toPath)
      const key = `${from}\u0000${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to })
    }

    return { notes, edges, diagnostics }
  } catch (error) {
    diagnostics.push(`${SECTION_LABELS[side]} knowledge could not be read: ${describe(error)}`)
    return { notes: [], edges: [], diagnostics }
  } finally {
    closeIndex(index)
  }
}

/** Read both vaults and build the graph the Knowledge window renders. */
export async function loadKnowledgeGraph(
  workspace: Workspace,
  options: LoadOptions = {},
): Promise<KnowledgeGraph> {
  const rebuildMissing = options.rebuildMissing ?? true
  const notes: KnowledgeNote[] = []
  const edges: KnowledgeEdge[] = []
  const diagnostics: string[] = []

  for (const side of SIDES) {
    const read = await readSide(workspace, side, rebuildMissing)
    diagnostics.push(...read.diagnostics)
    notes.push(...read.notes)
    edges.push(...read.edges)
  }

  notes.sort((a, b) =>
    a.title < b.title ? -1 : a.title > b.title ? 1 : a.path.localeCompare(b.path),
  )

  return { topics: buildTopics(notes), notes, edges, diagnostics }
}

/** Every topic node in pre-order, for navigation and tests. */
export function flattenTopics(topics: readonly KnowledgeTopic[]): KnowledgeTopic[] {
  const out: KnowledgeTopic[] = []
  const walk = (topic: KnowledgeTopic): void => {
    out.push(topic)
    for (const child of topic.children) walk(child)
  }
  for (const topic of topics) walk(topic)
  return out
}

/**
 * Finder view model. Pure: it takes the service's `PickerState` and renders
 * decisions from it. It never reads the filesystem and never copies a file.
 *
 * The same surface is used for lock-in sources, a skill's gathered sources and
 * a single assignment-instructions file. The model therefore knows nothing
 * about "sources": it only knows entries, marks and a scope.
 */
import { basename, isAbsolute, relative } from "node:path"

import type { FilePreview } from "../../../services/lockin/preview"
import type { PickerEntry, PickerError, PickerState } from "../../../services/lockin/picker"

export type Step = "browse" | "review"
export type FinderFocus = "list" | "sources"
export type SearchScope = "home" | "folder"

export type PickerView = {
  step: Step
  /** Index into the active list; clamped so an empty directory cannot crash. */
  cursor: number
  /** One actionable line for the last failure, if any. */
  error: string | null
  /** Why the flow cannot continue yet; null when it can. */
  blocked: string | null
  /** True while the path/filter input owns the keyboard. */
  editing: boolean
  query: string
  results: PickerEntry[]
  /** A real path the query resolves to, pinned above the ranked matches. */
  pathResult: PickerEntry | null
  searching: boolean
  /** Entries inspected by the last search, for the "searched N" line. */
  visited: number
  /** The visited or match cap stopped the last search. */
  capped: boolean
  /** Which half of the window owns the keyboard. */
  focus: FinderFocus
  /** Selected row in the right-hand source manifest. */
  sourcesCursor: number
  scope: SearchScope
  preview: FilePreview | null
  previewing: boolean
  previewError: string | null
}

export const initialView: PickerView = {
  step: "browse",
  cursor: 0,
  error: null,
  blocked: null,
  editing: false,
  query: "",
  results: [],
  pathResult: null,
  searching: false,
  visited: 0,
  capped: false,
  focus: "list",
  sourcesCursor: 0,
  scope: "home",
  preview: null,
  previewing: false,
  previewError: null,
}

function clamp(cursor: number, entries: readonly PickerEntry[]): number {
  if (entries.length === 0) return 0
  return Math.max(0, Math.min(entries.length - 1, cursor))
}

/** A typed value that looks like a path is resolved as well as searched. */
export function isPathQuery(query: string): boolean {
  const text = query.trim()
  return text.startsWith("/") || text.startsWith("~") || text.startsWith(".") || text.includes("/")
}

/** A path the user is likely to mean even when it is not absolute. */
export function displayPath(state: PickerState, path: string): string {
  const home = state.home
  if (home) {
    const rel = relative(home, path)
    if (rel === "") return "~"
    if (!rel.startsWith("..") && !isAbsolute(rel)) return `~/${rel}`
  }
  return path
}

/** Keep the filename readable when a path does not fit. */
export function shortPath(path: string, width: number): string {
  if (width <= 0) return ""
  if (path.length <= width) return path
  if (width <= 2) return "…"
  return `…${path.slice(-(width - 1))}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function scopeLabel(state: PickerState, view: PickerView): string {
  return view.scope === "home" && state.home ? "~" : "folder"
}

function reviewEntry(state: PickerState, path: string): PickerEntry {
  const found = state.entries.find((entry) => entry.path === path)
  if (found) return { ...found, name: displayPath(state, path), marked: true }
  return {
    path,
    name: displayPath(state, path),
    kind: "file",
    bytes: 0,
    selectable: true,
    reason: null,
    marked: true,
  }
}

/** The marked files, in selection order, for the review list. */
export function reviewEntries(state: PickerState): PickerEntry[] {
  return state.marks.map((path) => reviewEntry(state, path))
}

/** The list the cursor currently moves through. */
export function activeEntries(state: PickerState, view: PickerView): PickerEntry[] {
  if (view.step === "review") return reviewEntries(state)
  if (view.query.trim() === "") return state.entries
  const rows = view.pathResult ? [view.pathResult, ...view.results] : [...view.results]
  const seen = new Set<string>()
  return rows.filter((entry) => {
    if (seen.has(entry.path)) return false
    seen.add(entry.path)
    return true
  })
}

export function currentEntry(state: PickerState, view: PickerView): PickerEntry | undefined {
  const entries = activeEntries(state, view)
  return entries[clamp(view.cursor, entries)]
}

export function move(state: PickerState, view: PickerView, delta: number): PickerView {
  const entries = activeEntries(state, view)
  return { ...view, cursor: clamp(view.cursor + delta, entries) }
}

export function inputLine(view: PickerView): string {
  if (!view.editing && view.query.trim() === "") return "Path or filter — press / to type"
  if (view.searching) return `> ${view.query}  searching…`
  return view.editing ? `> ${view.query}▏` : `> ${view.query}`
}

/** Marks live in the service state, so navigation cannot drop them. */
export function markedNames(state: PickerState): string[] {
  return state.marks.map((path) => basename(path))
}

export function countLine(state: PickerState): string {
  const count = state.marks.length
  if (state.limit === 1) return count === 1 ? "1 file selected" : "no file selected"
  return `${count} of ${state.limit} sources selected`
}

export function blockedReason(
  state: PickerState,
  view: PickerView,
  options: { allowInstructions?: boolean } = {},
): string | null {
  if (view.step === "review" && state.marks.length === 0 && state.prompt.trim() === "") {
    if (options.allowInstructions) {
      return "choose a source, write instructions, or choose an instructions file"
    }
    if (state.limit === 1) return "choose one file to continue"
    return "mark at least one file to continue"
  }
  if (state.marks.length >= state.limit) return `source limit reached (${state.limit}); unmark one to add another`
  return null
}

/** One actionable sentence per typed service error; never a raw stack. */
export function errorLine(error: PickerError): string {
  switch (error.kind) {
    case "path":
      return error.reason === "symlink"
        ? `${error.path} leaves the folder through a link. Choose a file inside the folder.`
        : error.reason === "escape"
          ? `${error.path} is outside the folder. Navigate back with h.`
          : `${error.path} is not a file you can add.`
    case "limit":
      return `Source limit is ${error.limit}. Unmark one before adding another.`
    case "storage":
      return `${error.path} could not be read (${error.message}). Check permissions, then retry.`
  }
}

/** Row text: mark glyph, name and a short detail. */
export function rowFor(
  entry: PickerEntry,
  cursor: boolean,
): { glyph: string; text: string; label: string; detail: string; dim: boolean } {
  const glyph =
    entry.kind === "directory" ? (cursor ? "▾" : "▸") : entry.marked ? "◉" : entry.selectable ? "○" : "·"
  const detail =
    entry.kind === "directory"
      ? "directory"
      : entry.reason === "symlink-escape"
        ? "link leaves the folder"
        : formatBytes(entry.bytes)
  const label = `${glyph} ${entry.name}`
  return {
    glyph,
    text: `${cursor ? "▌" : " "} ${label}  ${detail}`,
    label,
    detail,
    dim: !entry.selectable && entry.kind !== "directory",
  }
}

/** The review header keeps the count and drops the dead prompt line. */
export function reviewLines(state: PickerState): string[] {
  const count = state.marks.length
  const lines = [`${count} source${count === 1 ? "" : "s"}`]
  for (const entry of reviewEntries(state)) lines.push(`  ${entry.name}`)
  return lines
}

/** Empty states teach the next action. */
export function emptyState(state: PickerState, parent: string | undefined): string {
  return parent
    ? `No files here. Press h to go back to ${parent}.`
    : `No files in ${shortPath(state.cwd, 60)}. Add files there, then reopen the picker.`
}

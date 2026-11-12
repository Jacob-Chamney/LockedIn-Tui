/**
 * Headless source picker for the lock-in wizard.
 *
 * The wizard's browser is a `tui-shell` packet; this module is the model behind
 * it: a directory tree rooted at one directory, a set of marks and a preview of
 * the `Source` values that would be copied.
 *
 * Rules enforced here:
 * - a path outside the root is refused, including a symlink whose target
 *   escapes it, and it never reaches the preview;
 * - every regular file is selectable; the kind only decides how it is read,
 *   not whether the user may add it;
 * - the mark count is capped, and the cap is the caller's value from
 *   `[storage] max_items_per_side` (`docs/data-model.md` §2), defaulting to the
 *   documented 25.
 *
 * The only IO is a directory read plus a `stat` per entry. Hashing happens in
 * the copy transaction, so a preview carries a provisional hash derived from
 * stat data and is never mistaken for the content hash.
 */

import { homedir } from "node:os"
import { lstat, readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { makeSource, type Source } from "../../domain/source"

export const MAX_SOURCES = 25

/** A variable that must never be expanded into a visible path. */
const SECRET_NAME =
  /(API_?KEY|ACCESS_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY)/i

/** Copy the UI must show when the flow cannot continue. */
export const BLOCKED_COPY = "choose at least one file, or write a prompt to continue"

export type PickerError =
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "limit"; limit: number; message: string }

export type PickerEntryKind = "file" | "directory" | "symlink"

export type PickerEntry = {
  /** Absolute path, always inside the root. */
  path: string
  name: string
  kind: PickerEntryKind
  bytes: number
  /** False for directories and escaping symlinks; true for every regular file. */
  selectable: boolean
  /** Why it cannot be selected, for the row's dimmed hint. */
  reason: "directory" | "symlink-escape" | null
  marked: boolean
}

export type PickerState = {
  root: string
  /** The user's home directory; the default search scope. */
  home: string
  /** Directory currently listed; always inside `root`. */
  cwd: string
  entries: PickerEntry[]
  /** Marked files, absolute, in the order they were marked. */
  marks: string[]
  /** Prompt text for the wizard's prompt step; empty means "none". */
  prompt: string
  limit: number
}

/** True when `path` is `root` or below it, without resolving symlinks. */
function isInside(root: string, path: string): boolean {
  if (path === root) return true
  const rel = relative(root, path)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

function storageError(path: string, error: unknown): PickerError {
  return {
    kind: "storage",
    path,
    message: error instanceof Error ? error.message : String(error),
  }
}

function pathError(path: string, reason: "escape" | "missing" | "symlink", message: string): PickerError {
  return { kind: "path", path, reason, message }
}

/** Previews carry a provisional hash; the copy step replaces it. */
async function provisionalHash(path: string, bytes: number): Promise<string> {
  const info = await stat(path)
  const digest = new Bun.CryptoHasher("sha256")
    .update(`${path}\u0000${bytes}\u0000${info.mtimeMs}`)
    .digest("hex")
  return `sha256:${digest}`
}

async function readEntries(
  root: string,
  cwd: string,
  marks: readonly string[],
): Promise<Result<PickerEntry[], PickerError>> {
  const rootReal = await realpath(root)
  let names: string[]
  try {
    names = await readdir(cwd)
  } catch (error) {
    return err(storageError(cwd, error))
  }

  const entries: PickerEntry[] = []
  for (const name of names.sort()) {
    const path = join(cwd, name)
    let info
    try {
      info = await lstat(path)
    } catch {
      // A directory can contain entries we cannot inspect (permissions, races,
      // special files). Browsing the whole filesystem must not fail because one
      // row is unreadable: skip it and keep listing.
      continue
    }

    if (info.isSymbolicLink()) {
      let target: string
      try {
        target = await realpath(path)
      } catch {
        // A dangling link has no target to enter or mark; skip it.
        continue
      }
      if (!isInside(rootReal, target)) {
        entries.push({
          path,
          name,
          kind: "symlink",
          bytes: 0,
          selectable: false,
          reason: "symlink-escape",
          marked: false,
        })
        continue
      }
      // A contained link is treated as what it points at.
      let targetInfo
      try {
        targetInfo = await stat(target)
      } catch {
        continue
      }
      if (targetInfo.isDirectory()) {
        entries.push({
          path,
          name,
          kind: "directory",
          bytes: 0,
          selectable: false,
          reason: "directory",
          marked: false,
        })
        continue
      }
      if (!targetInfo.isFile()) continue
      entries.push({
        path,
        name,
        kind: "file",
        bytes: targetInfo.size,
        selectable: true,
        reason: null,
        marked: marks.includes(path),
      })
      continue
    }

    if (info.isDirectory()) {
      entries.push({
        path,
        name,
        kind: "directory",
        bytes: 0,
        selectable: false,
        reason: "directory",
        marked: false,
      })
      continue
    }
    // Sockets, pipes and devices are not sources; skip them instead of showing
    // an unselectable row for every one under `/dev`.
    if (!info.isFile()) continue

    entries.push({
      path,
      name,
      kind: "file",
      bytes: info.size,
      selectable: true,
      reason: null,
      marked: marks.includes(path),
    })
  }

  return ok(entries)
}

/**
 * Open a picker at `root`.
 *
 * `root` is resolved through `realpath` once, so a symlinked workspace folder
 * still has a stable containment check.
 */
export async function createPicker(input: {
  root: string
  home?: string
  limit?: number
}): Promise<Result<PickerState, PickerError>> {
  const limit = input.limit ?? MAX_SOURCES
  if (!Number.isInteger(limit) || limit < 1) {
    return err({ kind: "limit", limit, message: `the source cap must be a positive integer, got ${limit}` })
  }
  let root: string
  try {
    root = await realpath(input.root)
    const info = await stat(root)
    if (!info.isDirectory()) {
      return err(pathError(root, "missing", `${root} is not a directory`))
    }
  } catch (error) {
    return err(storageError(input.root, error))
  }

  const entries = await readEntries(root, root, [])
  if (!entries.ok) return entries
  return ok({
    root,
    home: input.home ?? homedir(),
    cwd: root,
    entries: entries.value,
    marks: [],
    prompt: "",
    limit,
  })
}

/** List a directory inside the tree. Escaping or missing paths are typed errors. */
export async function navigate(
  state: PickerState,
  path: string,
): Promise<Result<PickerState, PickerError>> {
  const target = isAbsolute(path) ? path : join(state.cwd, path)
  if (!isInside(state.root, target)) {
    return err(pathError(target, "escape", `${target} is outside the picker root`))
  }
  try {
    const real = await realpath(target)
    const rootReal = await realpath(state.root)
    if (!isInside(rootReal, real)) {
      return err(
        pathError(target, "symlink", `${target} is a symlink that escapes the picker root`),
      )
    }
    const info = await stat(real)
    if (!info.isDirectory()) return err(pathError(target, "missing", `${target} is not a directory`))
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return err(pathError(target, "missing", `${target} does not exist`))
    }
    return err(storageError(target, error))
  }

  const entries = await readEntries(state.root, target, state.marks)
  if (!entries.ok) return entries
  return ok({ ...state, cwd: target, entries: entries.value })
}

/** Mark or unmark one file. A directory is not a file: use `markFolder`. */
export function mark(state: PickerState, path: string): Result<PickerState, PickerError> {
  const target = isAbsolute(path) ? path : join(state.cwd, path)
  if (!isInside(state.root, target)) {
    return err(pathError(target, "escape", `${target} is outside the picker root`))
  }

  if (state.marks.includes(target)) {
    const remaining = state.marks.filter((item) => item !== target)
    return ok({ ...state, marks: remaining, entries: withMarks(state, remaining) })
  }

  const entry = state.entries.find((item) => item.path === target)
  if (entry?.reason === "symlink-escape") {
    return err(pathError(target, "symlink", `${target} is a symlink that escapes the picker root`))
  }
  if (entry?.reason === "directory") {
    return err(pathError(target, "missing", `${target} is a directory; use markFolder`))
  }
  const nextMarks = [...state.marks, target]
  const limited = enforceLimit(state, nextMarks)
  if (!limited.ok) return limited
  return ok({ ...state, marks: nextMarks, entries: withMarks(state, nextMarks) })
}

/** Mark every accepted file at or below `path`, stopping at the root and the cap. */
export async function markFolder(
  state: PickerState,
  path: string,
): Promise<Result<PickerState, PickerError>> {
  const target = isAbsolute(path) ? path : join(state.cwd, path)
  if (!isInside(state.root, target)) {
    return err(pathError(target, "escape", `${target} is outside the picker root`))
  }

  const collected: string[] = []
  const seenDirectories = new Set<string>()
  const walk = async (directory: string): Promise<Result<void, PickerError>> => {
    let real: string
    try {
      real = await realpath(directory)
    } catch (error) {
      return err(storageError(directory, error))
    }
    // A contained symlink can point back up the tree; a real-path set stops
    // the recursion instead of trusting the link.
    if (seenDirectories.has(real)) return ok(undefined)
    seenDirectories.add(real)

    const listed = await readEntries(state.root, directory, [])
    if (!listed.ok) return listed
    for (const entry of listed.value) {
      if (entry.kind === "directory") {
        if (SKIP_DIRS.has(entry.name)) continue
        const deeper = await walk(entry.path)
        if (!deeper.ok) return deeper
        continue
      }
      if (!entry.selectable) continue
      if (state.marks.length + collected.length >= state.limit) {
        return err({
          kind: "limit",
          limit: state.limit,
          message:
            `that would be more than ${state.limit} sources; the limit is ${state.limit} ` +
            "(storage.max_items_per_side). Remove some, or raise the setting.",
        })
      }
      collected.push(entry.path)
    }
    return ok(undefined)
  }

  const walked = await walk(target)
  if (!walked.ok) return walked

  const merged = [...state.marks]
  for (const item of collected) if (!merged.includes(item)) merged.push(item)

  const limited = enforceLimit(state, merged)
  if (!limited.ok) return limited
  return ok({ ...state, marks: merged, entries: withMarks(state, merged) })
}

function enforceLimit(state: PickerState, marks: readonly string[]): Result<void, PickerError> {
  if (marks.length <= state.limit) return ok(undefined)
  return err({
    kind: "limit",
    limit: state.limit,
    message:
      `that would be ${marks.length} sources; the limit is ${state.limit} ` +
      "(storage.max_items_per_side). Remove some, or raise the setting.",
  })
}

function withMarks(state: PickerState, marks: readonly string[]): PickerEntry[] {
  return state.entries.map((entry) => ({ ...entry, marked: marks.includes(entry.path) }))
}

export function unmarkAll(state: PickerState): PickerState {
  return { ...state, marks: [], entries: withMarks(state, []) }
}

export function setPrompt(state: PickerState, prompt: string): PickerState {
  return { ...state, prompt }
}

/** Discard the selection and return to the root view. Nothing is written. */
export function cancel(state: PickerState): PickerState {
  return { ...state, cwd: state.root, marks: [], prompt: "", entries: withMarks(state, []) }
}

/** The flow may continue with at least one file *or* a prompt. */
export function canContinue(state: PickerState): boolean {
  return state.marks.length > 0 || state.prompt.trim() !== ""
}

/**
 * Preview the sources the marks would produce.
 *
 * The hash is provisional (stat data), so a preview can never be used as the
 * content hash: `copy.ts` recomputes it while copying.
 */
export async function previewSources(
  state: PickerState,
): Promise<Result<Source[], PickerError>> {
  const sources: Source[] = []
  const seen = new Set<string>()

  for (const path of state.marks) {
    if (!isInside(state.root, path)) {
      return err(pathError(path, "escape", `${path} is outside the picker root`))
    }
    const name = path.split(sep).pop() ?? path
    let bytes: number
    try {
      bytes = (await stat(path)).size
    } catch (error) {
      return err(storageError(path, error))
    }

    const built = makeSource({
      originalPath: path,
      name,
      hash: await provisionalHash(path, bytes),
      storedPath: `sources/${name}`,
    })
    if (!built.ok) {
      return err({
        kind: "path",
        path,
        reason: "missing",
        message: built.error.message,
      })
    }
    if (seen.has(built.value.hash)) continue
    seen.add(built.value.hash)
    sources.push(built.value)
  }

  return ok(sources)
}

/** Directories that are never worth walking during a home-wide search. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  ".local",
  ".cargo",
  ".rustup",
  ".npm",
  ".bun",
  "target",
  "Library",
  "AppData",
  ".Trash",
  ".venv",
  "venv",
  "__pycache__",
])

export type SearchOutcome = {
  entries: PickerEntry[]
  /** How many directory entries were inspected before the walk stopped. */
  visited: number
  /** True when the visited or match cap stopped the walk early. */
  capped: boolean
}

/** One token's score against a relative path; higher is better, null is no match. */
function tokenScore(name: string, token: string): number | null {
  const lower = name.toLowerCase()
  const segments = lower.split(/[\\/]/)
  const base = segments[segments.length - 1] ?? lower
  if (base === token) return 1200
  if (base.startsWith(token)) return 1050 - Math.min(100, base.length - token.length)
  const baseAt = base.indexOf(token)
  if (baseAt >= 0) return 850 - Math.min(100, baseAt * 4)
  const segmentAt = segments.findIndex((segment) => segment.startsWith(token))
  if (segmentAt >= 0) return 760 - Math.min(100, segmentAt * 6)
  const pathAt = lower.indexOf(token)
  if (pathAt >= 0) return 620 - Math.min(100, pathAt * 2)
  return subsequenceScore(base, token) ?? subsequenceScore(lower, token)
}

/** A loose ordered match, penalised by the gaps between its characters. */
function subsequenceScore(text: string, token: string): number | null {
  let at = 0
  let last = -1
  let gaps = 0
  for (const char of token) {
    const found = text.indexOf(char, at)
    if (found < 0) return null
    if (last >= 0) gaps += Math.max(0, found - last - 1)
    last = found
    at = found + 1
  }
  return 500 - Math.min(250, gaps * 5)
}

/**
 * Rank search hits: basename beats path, a prefix beats a substring, and a
 * shallower, shorter path breaks the remaining ties. Pure, so the ordering is
 * unit-tested without touching the filesystem.
 */
export function rankEntries(entries: readonly PickerEntry[], query: string, limit = 60): PickerEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const scored: Array<{ entry: PickerEntry; score: number }> = []
  for (const entry of entries) {
    let score = 0
    let matched = true
    for (const token of tokens) {
      const next = tokenScore(entry.name, token)
      if (next === null) {
        matched = false
        break
      }
      score += next
    }
    if (!matched) continue
    const depth = entry.name.split(/[\\/]/).length - 1
    score -= Math.min(80, depth * 6)
    score -= Math.min(40, Math.floor(entry.name.length / 8))
    // A directory with the same score is usually the more useful hit.
    if (entry.kind === "directory") score += 15
    scored.push({ entry, score })
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.entry.kind !== b.entry.kind) return a.entry.kind < b.entry.kind ? -1 : 1
    if (a.entry.name !== b.entry.name) return a.entry.name < b.entry.name ? -1 : 1
    return 0
  })
  return scored.slice(0, limit).map((row) => row.entry)
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Ranked search beneath a scope root (the home directory by default).
 *
 * Home-wide searching is intentional, so the walk is bounded: a visited cap,
 * a depth cap and a match cap keep a huge tree from stalling the renderer. It
 * yields every 256 entries and stops promptly when the caller aborts, because
 * every keystroke replaces the previous query.
 */
export async function searchFiles(
  state: PickerState,
  query: string,
  options: {
    limit?: number
    maxDepth?: number
    maxVisited?: number
    maxMatches?: number
    scopeRoot?: string
    signal?: AbortSignal
  } = {},
): Promise<Result<SearchOutcome, PickerError>> {
  const text = query.trim()
  if (text === "") return ok({ entries: [], visited: 0, capped: false })
  if (options.signal?.aborted) return ok({ entries: [], visited: 0, capped: false })

  const limit = options.limit ?? 60
  const maxDepth = options.maxDepth ?? 8
  const maxVisited = options.maxVisited ?? 8_000
  const maxMatches = options.maxMatches ?? 400
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  const wantsHidden = text.startsWith(".") || text.includes("/.")

  const requested = options.scopeRoot ?? state.cwd
  let scope: string
  try {
    scope = await realpath(requested)
  } catch (error) {
    return err(storageError(requested, error))
  }
  let rootReal: string
  try {
    rootReal = await realpath(state.root)
  } catch (error) {
    return err(storageError(state.root, error))
  }
  if (!isInside(rootReal, scope)) {
    return err(pathError(scope, "escape", `${scope} is outside the picker root`))
  }

  const matches: PickerEntry[] = []
  let visited = 0
  let capped = false
  const queue: Array<{ path: string; depth: number }> = [{ path: scope, depth: 0 }]
  const matchesQuery = (path: string): boolean => {
    const lower = path.toLowerCase()
    return tokens.every((token) => lower.includes(token))
  }

  while (queue.length > 0) {
    if (options.signal?.aborted) return ok({ entries: [], visited, capped: false })
    const current = queue.shift()!
    let entries
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (options.signal?.aborted) return ok({ entries: [], visited, capped: false })
      if (visited >= maxVisited) {
        capped = true
        break
      }
      visited += 1
      if (visited % 256 === 0) await yieldToEventLoop()

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (!wantsHidden && entry.name.startsWith(".")) continue
        const path = join(current.path, entry.name)
        const relativePath = relative(scope, path)
        if (matchesQuery(relativePath)) {
          matches.push({
            path,
            name: relativePath,
            kind: "directory",
            bytes: 0,
            selectable: false,
            reason: "directory",
            marked: false,
          })
          if (matches.length >= maxMatches) {
            capped = true
            break
          }
        }
        if (current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 })
        continue
      }

      if (!entry.isFile()) continue
      const path = join(current.path, entry.name)
      const relativePath = relative(scope, path)
      if (!matchesQuery(relativePath)) continue
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      matches.push({
        path,
        name: relativePath,
        kind: "file",
        bytes: info.size,
        selectable: true,
        reason: null,
        marked: state.marks.includes(path),
      })
      if (matches.length >= maxMatches) {
        capped = true
        break
      }
    }
    if (capped) break
    await yieldToEventLoop()
  }

  return ok({ entries: rankEntries(matches, text, limit), visited, capped })
}

/** Stat one path and describe it the way the picker lists it. */
export async function entryAt(
  state: PickerState,
  path: string,
  base: string = state.cwd,
): Promise<Result<PickerEntry, PickerError>> {
  const target = isAbsolute(path) ? path : join(state.cwd, path)
  if (!isInside(state.root, target)) {
    return err(pathError(target, "escape", `${target} is outside the picker root`))
  }
  try {
    const real = await realpath(target)
    const rootReal = await realpath(state.root)
    if (!isInside(rootReal, real)) {
      return err(pathError(target, "symlink", `${target} is a symlink that escapes the picker root`))
    }
    const info = await stat(real)
    const rel = relative(base, real)
    const name = rel === "" || rel.startsWith("..") ? real : rel
    if (info.isDirectory()) {
      return ok({
        path: real,
        name,
        kind: "directory",
        bytes: 0,
        selectable: false,
        reason: "directory",
        marked: false,
      })
    }
    if (!info.isFile()) {
      return err(pathError(target, "missing", `${target} is not a regular file`))
    }
    return ok({
      path: real,
      name,
      kind: "file",
      bytes: info.size,
      selectable: true,
      reason: null,
      marked: state.marks.includes(real),
    })
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return err(pathError(target, "missing", `${target} does not exist`))
    }
    return err(storageError(target, error))
  }
}

/** Resolve a typed path or `~`/environment reference for the source input. */
export async function resolvePickerPath(
  state: PickerState,
  value: string,
): Promise<Result<{ path: string; kind: "directory" | "file" }, PickerError>> {
  let text = value.trim()
  if (text === "") return err(pathError("", "missing", "a path is required"))
  if (text === "~") text = homedir()
  else if (text.startsWith("~/") || text.startsWith("~\\")) text = join(homedir(), text.slice(2))
  let blocked: string | null = null
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => {
    const name = braced ?? bare
    if (SECRET_NAME.test(name)) {
      blocked = name
      return ""
    }
    return process.env[name] ?? ""
  })
  if (blocked !== null) {
    return err(
      pathError(value, "missing", `$${blocked} is a credential and is never expanded into a visible path`),
    )
  }
  const target = isAbsolute(text) ? text : join(state.cwd, text)
  if (!isInside(state.root, target)) return err(pathError(target, "escape", `${target} is outside the picker root`))
  try {
    const real = await realpath(target)
    const rootReal = await realpath(state.root)
    if (!isInside(rootReal, real)) {
      return err(pathError(target, "symlink", `${target} is a symlink that escapes the picker root`))
    }
    const info = await stat(real)
    if (info.isDirectory()) return ok({ path: real, kind: "directory" })
    if (info.isFile()) return ok({ path: real, kind: "file" })
    return err(pathError(target, "missing", `${target} is not a file or directory`))
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return err(pathError(target, "missing", `${target} does not exist`))
    }
    return err(storageError(target, error))
  }
}

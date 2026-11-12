/**
 * Session manager service: find, reopen and extend lock-in sessions.
 *
 * The list is built from one pass over each folder, so counts always describe
 * the same bytes the row was derived from (no second query, `AGENTS.md` §2.15).
 * A broken folder becomes a `broken` row rather than an exception: one bad
 * session must never hide the others.
 *
 * Storage owns bytes; this module owns the manager semantics. It never rewrites
 * `chat.jsonl`, `progress.jsonl` or `assignment-steps.md`.
 */

import { open, readdir, readFile, realpath, rename, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { parseProgress } from "../../domain/progress"
import {
  SESSION_FILES,
  sessionFromMeta,
  sessionToMeta,
  type LockInSession,
} from "../../domain/session"
import { makeSource } from "../../domain/source"
import { confinedJoin, isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { copySource } from "./copy"

export type ManagerError =
  | { kind: "storage"; path: string; message: string }
  | { kind: "blocked"; path: string; message: string }
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "invalid-session"; field: string; message: string }

export type ManagerEvent = {
  type: "session.updated"
  id: string
  action: "archive" | "restore" | "delete" | "export" | "add-sources"
}

export type Emit = (event: ManagerEvent) => void

export type SortKey = "date" | "name" | "size"

export type SessionRow = {
  id: string
  name: string
  created: string
  archived: boolean
  sourceCount: number
  stepCounts: { checked: number; total: number }
  hasSteps: boolean
  hasOutputs: boolean
  /** Bytes of every file in the folder. */
  sizeBytes: number
  broken: boolean
  /** Why the row is broken, for the dimmed second line. */
  reason?: string
}

export type ListOptions = {
  workspace: Workspace
  /** Where archived sessions live; omit to list only open sessions. */
  archiveRoot?: string
  sort?: SortKey
  query?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "ENOENT" || (error as { code?: string }).code === "ENOTDIR")
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      try {
        total += (await stat(path)).size
      } catch {
        // A file that vanished mid-walk contributes nothing.
      }
    }
  }
  await walk(root)
  return total
}

/** Read one folder into a row without throwing. */
async function readRow(
  folder: string,
  archived: boolean,
  options: { outputsRoot: string },
): Promise<SessionRow> {
  const fallback: SessionRow = {
    id: basename(folder),
    name: "",
    created: "",
    archived,
    sourceCount: 0,
    stepCounts: { checked: 0, total: 0 },
    hasSteps: false,
    hasOutputs: false,
    sizeBytes: 0,
    broken: true,
  }

  let meta: unknown
  try {
    meta = JSON.parse(await readFile(join(folder, SESSION_FILES.meta), "utf8"))
  } catch (error) {
    return {
      ...fallback,
      reason: isMissing(error)
        ? "meta.json is missing"
        : `meta.json is not readable JSON: ${messageOf(error)}`,
    }
  }

  const parsed = sessionFromMeta(meta)
  if (!parsed.ok) {
    return { ...fallback, reason: `meta.json is invalid: ${parsed.error.message}` }
  }

  const session = parsed.value
  const stepsPath = join(folder, SESSION_FILES.steps)
  let stepCounts = { checked: 0, total: 0 }
  const hasSteps = await exists(stepsPath)
  if (hasSteps) {
    try {
      const counted = parseProgress(await readFile(stepsPath, "utf8"))
      if (counted.ok) stepCounts = { checked: counted.value.checked, total: counted.value.total }
    } catch {
      // Steps are optional; an unreadable file leaves the counts at zero.
    }
  }

  const hasOutputs = await exists(join(options.outputsRoot, session.id))

  return {
    id: session.id,
    name: session.name,
    created: session.created,
    archived,
    sourceCount: session.sources.length,
    stepCounts,
    hasSteps,
    hasOutputs,
    sizeBytes: await directoryBytes(folder),
    broken: false,
  }
}

/** One archived session in either layout; the canonical path when absent. */
async function archivedFolder(archiveRoot: string, id: string): Promise<string> {
  const canonical = join(archiveRoot, "school", "session", id)
  if (await exists(canonical)) return canonical
  const legacy = join(archiveRoot, "school", id)
  if (await exists(legacy)) return legacy
  return canonical
}

/** Folders inside `root` that are not temporary or hidden. */
async function folders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(root, entry.name))
      .sort()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/**
 * Every session, open and optionally archived.
 *
 * Sort is stable and total: date (newest first), name (case-insensitive) or
 * size (largest first); ties fall back to id so two runs agree.
 * Search is a case-insensitive substring over name and prompt.
 */
export async function listSessions(options: ListOptions): Promise<SessionRow[]> {
  const openFolders = await folders(options.workspace.paths.schoolSessions)
  const archivedFolders: string[] = []
  if (options.archiveRoot) {
    const school = join(options.archiveRoot, "school")
    // Canonical layout first, then pre-port `<school>/<id>` archives. The kind
    // folders themselves are containers, never sessions. One id is one row even
    // if both layouts happen to exist.
    const seen = new Set<string>()
    for (const folder of await folders(join(school, "session"))) {
      seen.add(basename(folder))
      archivedFolders.push(folder)
    }
    for (const folder of await folders(school)) {
      const name = basename(folder)
      if (name === "session" || name === "goal" || name === "project") continue
      if (seen.has(name)) continue
      if (await exists(join(folder, SESSION_FILES.meta))) archivedFolders.push(folder)
    }
  }

  const rows: SessionRow[] = []
  for (const folder of openFolders) {
    rows.push(await readRow(folder, false, { outputsRoot: join(options.workspace.paths.root, "school", "outputs") }))
  }
  for (const folder of archivedFolders) {
    rows.push(await readRow(folder, true, { outputsRoot: join(options.workspace.paths.root, "school", "outputs") }))
  }

  // The prompt is part of the search surface, and it is not on the row: read it
  // once here rather than widening the row shape.
  const prompts = new Map<string, string>()
  const query = (options.query ?? "").trim().toLowerCase()
  if (query !== "") {
    for (const row of rows) {
      if (row.broken) continue
      const folder = row.archived
        ? await archivedFolder(options.archiveRoot!, row.id)
        : join(options.workspace.paths.schoolSessions, row.id)
      try {
        prompts.set(row.id, (await readFile(join(folder, SESSION_FILES.prompt), "utf8")).toLowerCase())
      } catch {
        prompts.set(row.id, "")
      }
    }
  }

  const filtered =
    query === ""
      ? rows
      : rows.filter(
          (row) =>
            row.name.toLowerCase().includes(query) || (prompts.get(row.id) ?? "").includes(query),
        )

  const sort = options.sort ?? "date"
  filtered.sort((a, b) => {
    if (sort === "name") {
      const left = a.name.toLowerCase()
      const right = b.name.toLowerCase()
      if (left !== right) return left < right ? -1 : 1
    } else if (sort === "size") {
      if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes
    } else {
      if (a.created !== b.created) return a.created < b.created ? 1 : -1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return filtered
}

export type OpenResult = {
  session: LockInSession
  folder: string
  chatPath: string
  progressPath: string
}

/** Reopen a session from its folder. A missing or broken meta is typed. */
export async function openSession(input: {
  workspace: Workspace
  id: string
}): Promise<Result<OpenResult, ManagerError>> {
  const checked = assertSessionId(input.id)
  if (!checked.ok) return checked
  const folder = sessionFolderFor(input.workspace, input.id)
  if (!(await exists(folder))) {
    return err({
      kind: "storage",
      path: folder,
      message: `there is no session "${input.id}" in this workspace`,
    })
  }

  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(folder, SESSION_FILES.meta), "utf8"))
  } catch (error) {
    return err({ kind: "storage", path: join(folder, SESSION_FILES.meta), message: messageOf(error) })
  }

  const parsed = sessionFromMeta(raw, { memory: await exists(join(folder, SESSION_FILES.memory)) })
  if (!parsed.ok) {
    return err({
      kind: "invalid-session",
      field: "meta",
      message: parsed.error.message,
    })
  }

  return ok({
    session: parsed.value,
    folder,
    chatPath: join(folder, parsed.value.chatPath),
    progressPath: join(folder, parsed.value.progressPath),
  })
}

/** Absolute folder for an open session; the id is the folder name. */
export function sessionFolderFor(workspace: Workspace, id: string): string {
  return (
    confinedJoin(workspace.paths.schoolSessions, id) ??
    join(workspace.paths.schoolSessions, ".invalid-session")
  )
}

/**
 * Write `meta.json` atomically: temp file in the same directory, then rename.
 *
 * `extra` records facts the domain entity does not carry — today that is
 * `chat_archived`, which an archive must state because the chat file is gone.
 * `sessionFromMeta` ignores unknown keys, so these survive a round trip without
 * widening the entity.
 */
export async function writeMeta(
  folder: string,
  session: LockInSession,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const target = join(folder, SESSION_FILES.meta)
  const temporary = join(folder, `.${SESSION_FILES.meta}.tmp-${crypto.randomUUID()}`)
  const payload = { ...sessionToMeta(session), ...extra }
  await Bun.write(temporary, `${JSON.stringify(payload, null, 2)}\n`)
  const handle = await open(temporary, "r+")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, target)
}

export type AddSourcesResult = { session: LockInSession; added: number; skipped: number }

/**
 * Add files to an existing session.
 *
 * Duplicates are skipped by hash, `meta.json` is replaced atomically, and the
 * chat, progress and steps files are never opened for writing.
 */
export async function addSources(input: {
  workspace: Workspace
  id: string
  files: readonly string[]
  /** Where archived sessions live, so an archived id can be refused properly. */
  archiveRoot?: string
  emit?: Emit
}): Promise<Result<AddSourcesResult, ManagerError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.id })
  if (!opened.ok) {
    if (input.archiveRoot && opened.error.kind === "storage") {
      const archived = await archivedFolder(input.archiveRoot, input.id)
      if (await exists(archived)) {
        return err({
          kind: "blocked",
          path: archived,
          message: "this session is archived; restore it first, then add sources",
        })
      }
    }
    return opened
  }

  const { folder, session } = opened.value
  if (session.archived) {
    return err({
      kind: "blocked",
      path: folder,
      message: "this session is archived; restore it first, then add sources",
    })
  }

  const forbidden: string[] = []
  for (const root of [input.workspace.paths.goals, input.workspace.paths.skillVault]) {
    try {
      forbidden.push(await realpath(root))
    } catch {
      forbidden.push(resolve(root))
    }
  }
  for (const file of input.files) {
    let actual = resolve(file)
    try {
      actual = await realpath(actual)
    } catch {
      // The copy reports a missing file; the lexical path is still checked.
    }
    if (forbidden.some((root) => isPathInside(root, actual))) {
      return err({
        kind: "path",
        path: actual,
        reason: "escape",
        message: `${actual} belongs to the skills side; a lock-in session never reads it`,
      })
    }
  }

  const copied = new Map(session.sources.map((source) => [source.hash, source]))
  let added = 0
  let skipped = 0

  for (const file of input.files) {
    const result = await copySource({
      original: file,
      sourcesDir: join(folder, "sources"),
      copied,
    })
    if (!result.ok) return err(result.error)
    if (result.value.duplicate) {
      skipped++
      continue
    }
    copied.set(result.value.source.hash, result.value.source)
    added++
  }

  const next: LockInSession = { ...session, sources: [...copied.values()] }
  try {
    await writeMeta(folder, next)
  } catch (error) {
    return err({ kind: "storage", path: join(folder, SESSION_FILES.meta), message: messageOf(error) })
  }

  if (added > 0) input.emit?.({ type: "session.updated", id: session.id, action: "add-sources" })
  return ok({ session: next, added, skipped })
}

/**
 * Notes that link to this session.
 *
 * A session summary note is a vault note whose body contains `[[<id>]]` or
 * `[[<name>]]`. The count is what a delete confirmation must name.
 */
export async function inboundLinks(input: {
  workspace: Workspace
  id: string
  name?: string
}): Promise<{ count: number; notes: string[] }> {
  const notesDir = join(input.workspace.paths.schoolVault, "sessions")
  const needles = [input.id, input.name ?? ""].filter((value) => value !== "")
  const notes: string[] = []

  let entries
  try {
    entries = await readdir(notesDir, { withFileTypes: true })
  } catch {
    return { count: 0, notes }
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const path = join(notesDir, entry.name)
    let body: string
    try {
      body = await readFile(path, "utf8")
    } catch {
      continue
    }
    if (needles.some((needle) => body.includes(`[[${needle}]]`))) notes.push(path)
  }

  return { count: notes.length, notes: notes.sort() }
}

/** Resolve a user-supplied id, refusing one that climbs out of the folder. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function assertSessionId(id: string): Result<string, ManagerError> {
  if (
    id === "" ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\u0000") ||
    /[<>:"|?*\u0000-\u001f]/.test(id) ||
    id.endsWith(".") ||
    id.endsWith(" ") ||
    WINDOWS_RESERVED.test(id)
  ) {
    return err({
      kind: "path",
      path: id,
      reason: "escape",
      message: `"${id}" is not a session id; ids are a single folder name`,
    })
  }
  return ok(id)
}

export { makeSource }

/**
 * Rebuildable note index, one SQLite database per side (WP-105).
 *
 * Markdown is the source of truth. This module only ever *reads* the vault and
 * writes `index.db`, so a corrupt, missing or half-written index can never
 * damage a note (`docs/data-model.md` §8, `AGENTS.md` §2.8). Deleting the
 * database is always safe: `rebuildFromScratch()` recreates it.
 *
 * Shape of a write:
 *
 * - `rebuild()` — clear the index, then insert every note in sorted-path order,
 *   so rowids and results are identical on every rebuild.
 * - `refresh()` — diff by `(path, mtime, size)` and rewrite only the notes that
 *   changed, plus their links and headings. Untouched rows keep their rowid and
 *   bytes.
 *
 * The store is synchronous (`bun:sqlite` is synchronous), so there is no
 * in-process race to lock against.
 */

import { Database } from "bun:sqlite"
import { existsSync, readdirSync, readFileSync, rmSync, statSync, type Dirent } from "node:fs"
import { join } from "node:path"

import { err, ok, type Result } from "../domain/markdown"
import { extractWikilinks, parseDocument } from "../domain/markdown"
import { slugify } from "../domain/note"
import type { WorkspacePaths } from "./paths"
import { INDEX_MIGRATIONS, hasFts5, sqliteVersion } from "./migrations/index-schema"
import { currentVersion, migrate } from "./migrations/runner"

export type Side = "school" | "skills"

export const INDEX_PAGE_PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA cache_size = -8192",
] as const

export type IndexError =
  | {
      kind: "unsupported"
      message: string
      next: string
    }
  | {
      /** The user's search text could not be parsed by FTS, not a bad file. */
      kind: "query"
      message: string
      next: string
    }
  | {
      /** The file is not a usable database. The fix is always "rebuild". */
      kind: "corrupt"
      path: string
      message: string
      next: string
    }
  | {
      kind: "storage"
      path: string
      message: string
      next: string
    }
  | {
      kind: "migration"
      path: string
      message: string
      next: string
    }

export type NoteIndex = {
  db: Database
  side: Side
  dbFile: string
  vault: string
}

export type IndexLocation = { db: string; vault: string; side: Side }

export type SyncProblem = { path: string; message: string }

export type SyncResult = {
  scanned: number
  added: number
  updated: number
  deleted: number
  unchanged: number
  /** Files actually re-parsed (changed + added). */
  parsed: number
  ftsDeletes: number
  ftsInserts: number
  problems: SyncProblem[]
  ms: number
}

export type Hit = {
  path: string
  title: string
  snippet: string
  score: number
}

export type IndexStatus = {
  notes: number
  links: number
  brokenLinks: number
  headings: number
  ftsRows: number
  schemaVersion: number
}

export type RowInfo = { rowid: number; mtime: number; size: number; digest: string }

/* -------------------------------------------------------------------------- */
/* paths                                                                       */
/* -------------------------------------------------------------------------- */

export function indexLocation(paths: WorkspacePaths, side: Side): IndexLocation {
  return {
    side,
    db: join(paths.root, side, "index.db"),
    vault: side === "school" ? paths.schoolVault : paths.skillVault,
  }
}

/** Remove `index.db` and any journal files. Safe at any time. */
export function deleteIndexFiles(paths: WorkspacePaths, side: Side): void {
  const { db } = indexLocation(paths, side)
  // Windows releases a closed SQLite handle a moment after `close()`; retrying
  // avoids a spurious EBUSY while the kernel finishes the cleanup.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(db + suffix, { force: true, maxRetries: 20, retryDelay: 25 })
    } catch (error) {
      // Windows can keep a recently closed SQLite handle alive. The caller can
      // still rebuild through the existing file; only the delete is skipped.
      const code = (error as { code?: string }).code
      if (process.platform !== "win32" || (code !== "EBUSY" && code !== "EPERM")) throw error
    }
  }
}

/* -------------------------------------------------------------------------- */
/* open / close                                                                */
/* -------------------------------------------------------------------------- */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function corruptError(path: string, error: unknown): IndexError {
  return {
    kind: "corrupt",
    path,
    message: `The note index is not readable: ${describe(error)}`,
    next: "Rebuild the index — it is a cache, and no note was touched.",
  }
}

export function openIndex(paths: WorkspacePaths, side: Side): Result<NoteIndex, IndexError> {
  const { db: dbFile, vault } = indexLocation(paths, side)

  let db: Database
  try {
    db = new Database(dbFile, { create: true })
  } catch (error) {
    return err(corruptError(dbFile, error))
  }

  try {
    for (const pragma of INDEX_PAGE_PRAGMAS) db.exec(pragma)
  } catch (error) {
    try {
      db.close()
    } catch {
      // ignore a failing close on a broken handle
    }
    return err(corruptError(dbFile, error))
  }

  if (!hasFts5(db)) {
    try {
      db.close()
    } catch {
      // ignore
    }
    return err({
      kind: "unsupported",
      message: "This SQLite build has no FTS5, so the note index cannot be created.",
      next: "Use the bundled build (see docs/stack.md §4.3); do not switch to a different index silently.",
    })
  }

  const migrated = migrate(db, INDEX_MIGRATIONS)
  if (!migrated.ok) {
    try {
      db.close()
    } catch {
      // ignore
    }
    if (migrated.error.kind === "newer-schema") {
      return err({
        kind: "migration",
        path: dbFile,
        message: migrated.error.message,
        next: migrated.error.next,
      })
    }
    return err({
      kind: migrated.error.kind === "migration" ? "corrupt" : "migration",
      path: dbFile,
      message: migrated.error.message,
      next: migrated.error.next,
    })
  }

  return ok({ db, side, dbFile, vault })
}

/**
 * Close cleanly: checkpoint, leave WAL mode, close.
 *
 * Bun 1.4.4 keeps `-wal`/`-shm` on disk when a prepared statement is still
 * alive, so a plain `close()` does not give "the index is one file". Verified in
 * the S3 spike (`spikes/s3-sqlite/README.md`, L2).
 */
export function closeIndex(index: NoteIndex): void {
  try {
    index.db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    index.db.exec("PRAGMA journal_mode = DELETE")
  } catch {
    // a read-only or already-broken handle still has to close
  } finally {
    index.db.close()
  }
}

/* -------------------------------------------------------------------------- */
/* parsing                                                                     */
/* -------------------------------------------------------------------------- */

export type ScannedNote = { path: string; abs: string; mtime: number; size: number }

/** Every `.md` file under the vault, sorted by path (byte order, locale-free). */
export function scanVault(vault: string): ScannedNote[] {
  const out: ScannedNote[] = []
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      // A symlinked note would index bytes outside the vault; the note store
      // refuses such writes, and the cache must not read them either.
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(abs, rel)
      } else if (entry.name.endsWith(".md")) {
        const stats = statSync(abs)
        out.push({ path: rel, abs, mtime: Math.round(stats.mtimeMs), size: stats.size })
      }
    }
  }
  walk(vault, "")
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

export type ParsedNote = {
  title: string
  tags: string[]
  /**
   * Topic paths from `topics` frontmatter, in declaration order. The first
   * entry is the note's primary parent; later entries are extra places the
   * note appears. Order is meaningful, so this list is never sorted.
   */
  topics: string[]
  type: string
  body: string
  headings: Array<{ level: number; text: string; line: number }>
  links: string[]
}

function firstHeading(body: string): string {
  for (const line of body.split("\n")) {
    const match = /^#\s+(.+?)\s*$/.exec(line)
    if (match) return match[1] as string
  }
  return ""
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * YAML's common inline list arrives from the frontmatter parser as one string:
 * `[cpp, perf]`. Parse it, including the unquoted form; `null` means "not an
 * inline list", so callers keep their own scalar rules.
 */
function parseInlineList(value: string): string[] | null {
  const text = value.trim()
  if (!text.startsWith("[") || !text.endsWith("]")) return null
  const inner = text.slice(1, -1).trim()
  if (inner === "") return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string")
    }
  } catch {
    // Unquoted YAML: `[Coding/C++, Algorithms]`.
  }
  // Unquoted YAML: split on commas outside quotes, so `"Research, Methods"`
  // stays one topic.
  const out: string[] = []
  let current = ""
  let quote: string | null = null
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index]!
    if (quote !== null) {
      if (character === "\\") {
        index += 1
        if (index < inner.length) current += inner[index]
        continue
      }
      if (character === quote) {
        quote = null
        continue
      }
      current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ",") {
      out.push(current)
      current = ""
      continue
    }
    current += character
  }
  out.push(current)
  return out.map((item) => item.trim()).filter(Boolean)
}

function readTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").sort()
  }
  if (typeof value !== "string") return []
  const list = parseInlineList(value)
  if (list !== null) return list.sort()
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .sort()
}

/**
 * Topic paths keep their order: `topics[0]` is the primary parent. A bare
 * string is one path, not a comma list, so a topic may contain a comma.
 */
function readTopics(value: unknown): string[] {
  let raw: unknown[] = []
  if (Array.isArray(value)) {
    raw = value
  } else if (typeof value === "string") {
    const text = value.trim()
    if (text !== "" && text !== "[]") {
      const list = parseInlineList(text)
      raw = list ?? [text]
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    const path = item
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join("/")
    if (path === "" || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

export function parseNoteFile(path: string, text: string): ParsedNote {
  const parsed = parseDocument(text)
  const data = parsed.ok ? parsed.value.data : {}
  const body = parsed.ok ? parsed.value.body : text

  const base = (path.split("/").pop() ?? path).replace(/\.md$/, "")
  const title = readText(data.title) || firstHeading(body) || base

  const headings: Array<{ level: number; text: string; line: number }> = []
  const lines = body.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i] as string)
    if (match) headings.push({ level: (match[1] as string).length, text: match[2] as string, line: i + 1 })
  }

  const links: string[] = []
  const seen = new Set<string>()
  for (const link of extractWikilinks(body)) {
    if (seen.has(link.target)) continue
    seen.add(link.target)
    links.push(link.target)
  }

  return {
    title,
    tags: readTags(data.tags),
    topics: readTopics(data.topics),
    type: readText(data.type) || "concept",
    body,
    headings,
    links,
  }
}

/* -------------------------------------------------------------------------- */
/* link resolution                                                             */
/* -------------------------------------------------------------------------- */

function linkKeys(path: string, title: string): string[] {
  const withoutExtension = path.replace(/\.md$/, "")
  const base = withoutExtension.split("/").pop() ?? withoutExtension
  return [withoutExtension, base, slugify(base), slugify(title)]
}

type LinkIndex = Map<string, string>

function buildLinkIndex(notes: Array<{ path: string; title: string }>): LinkIndex {
  const index: LinkIndex = new Map()
  for (const note of notes) {
    for (const key of linkKeys(note.path, note.title)) {
      if (key && !index.has(key)) index.set(key, note.path)
    }
  }
  return index
}

/**
 * Resolve a wikilink against this side only. Anything that does not resolve —
 * including a link to the other side — is recorded broken and never followed.
 */
function resolveLink(target: string, links: LinkIndex): { path: string; broken: boolean } {
  const clean = target.split("#")[0]!.trim()
  const hit = links.get(clean) ?? links.get(slugify(clean))
  return hit ? { path: hit, broken: false } : { path: clean, broken: true }
}

/* -------------------------------------------------------------------------- */
/* writes                                                                      */
/* -------------------------------------------------------------------------- */

type Statements = {
  selectOld: ReturnType<Database["prepare"]>
  deleteNote: ReturnType<Database["prepare"]>
  deleteLinks: ReturnType<Database["prepare"]>
  deleteHeadings: ReturnType<Database["prepare"]>
  updateNote: ReturnType<Database["prepare"]>
  insertNote: ReturnType<Database["prepare"]>
  ftsDelete: ReturnType<Database["prepare"]>
  ftsInsert: ReturnType<Database["prepare"]>
  insertLink: ReturnType<Database["prepare"]>
  insertHeading: ReturnType<Database["prepare"]>
}

function prepare(db: Database): Statements {
  return {
    selectOld: db.prepare("SELECT rowid, title, body FROM notes WHERE path = ?"),
    deleteNote: db.prepare("DELETE FROM notes WHERE path = ?"),
    deleteLinks: db.prepare("DELETE FROM links WHERE from_path = ?"),
    deleteHeadings: db.prepare("DELETE FROM headings WHERE path = ?"),
    updateNote: db.prepare(
      "UPDATE notes SET mtime = ?, size = ?, title = ?, tags = ?, topics = ?, type = ?, body = ? WHERE rowid = ?",
    ),
    insertNote: db.prepare(
      "INSERT INTO notes (path, mtime, size, title, tags, topics, type, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    ftsDelete: db.prepare(
      "INSERT INTO notes_fts (notes_fts, rowid, title, body) VALUES ('delete', ?, ?, ?)",
    ),
    ftsInsert: db.prepare("INSERT INTO notes_fts (rowid, title, body) VALUES (?, ?, ?)"),
    insertLink: db.prepare(
      "INSERT OR IGNORE INTO links (from_path, to_path, broken) VALUES (?, ?, ?)",
    ),
    insertHeading: db.prepare("INSERT INTO headings (path, level, text, line) VALUES (?, ?, ?, ?)"),
  }
}

function clear(db: Database): void {
  db.exec("INSERT INTO notes_fts (notes_fts) VALUES ('delete-all')")
  db.exec("DELETE FROM notes")
  db.exec("DELETE FROM links")
  db.exec("DELETE FROM headings")
}

type ExistingRow = { rowid: number; mtime: number; size: number }

function existingRows(db: Database): Map<string, ExistingRow> {
  const rows = db
    .query("SELECT rowid, path, mtime, size FROM notes")
    .all() as Array<{ rowid: number; path: string; mtime: number; size: number }>
  const map = new Map<string, ExistingRow>()
  for (const row of rows) map.set(row.path, { rowid: row.rowid, mtime: row.mtime, size: row.size })
  return map
}

type WritePlan = {
  changed: ScannedNote[]
  removed: string[]
}

function plan(
  files: ScannedNote[],
  existing: Map<string, ExistingRow>,
): WritePlan {
  const present = new Set(files.map((file) => file.path))
  const removed: string[] = []
  for (const path of existing.keys()) if (!present.has(path)) removed.push(path)
  removed.sort()

  const changed = files.filter((file) => {
    const row = existing.get(file.path)
    return !row || row.mtime !== file.mtime || row.size !== file.size
  })

  return { changed, removed }
}

type Prepared = { file: ScannedNote; note: ParsedNote | null; problem?: SyncProblem }

/** Parse the files that changed exactly once; a bad file is a problem, not a crash. */
function prepareNotes(files: ScannedNote[]): Prepared[] {
  return files.map((file) => {
    try {
      return { file, note: parseNoteFile(file.path, readFileSync(file.abs, "utf8")) }
    } catch (error) {
      return { file, note: null, problem: { path: file.path, message: describe(error) } }
    }
  })
}

function writeNotes(
  index: NoteIndex,
  statements: Statements,
  prepared: Prepared[],
  removed: string[],
  titles: Array<{ path: string; title: string }>,
  existing: Map<string, ExistingRow>,
): {
  added: number
  updated: number
  parsed: number
  ftsDeletes: number
  ftsInserts: number
  problems: SyncProblem[]
} {
  const { db } = index
  const links = buildLinkIndex(titles)

  let added = 0
  let updated = 0
  let parsed = 0
  let ftsDeletes = 0
  let ftsInserts = 0
  const problems: SyncProblem[] = []

  const drop = (path: string): void => {
    const old = statements.selectOld.get(path) as
      | { rowid: number; title: string; body: string }
      | null
    if (old) {
      statements.ftsDelete.run(old.rowid, old.title, old.body)
      ftsDeletes += 1
    }
    statements.deleteNote.run(path)
    statements.deleteLinks.run(path)
    statements.deleteHeadings.run(path)
  }

  const transaction = db.transaction(() => {
    for (const path of removed) drop(path)

    for (const item of prepared) {
      const file = item.file
      if (!item.note) {
        if (item.problem) problems.push(item.problem)
        continue
      }
      const note = item.note
      parsed += 1
      const row = existing.get(file.path)
      const tags = JSON.stringify(note.tags)
      const topics = JSON.stringify(note.topics)

      let rowid: number
      if (row) {
        const old = statements.selectOld.get(file.path) as {
          rowid: number
          title: string
          body: string
        }
        statements.ftsDelete.run(old.rowid, old.title, old.body)
        ftsDeletes += 1
        statements.updateNote.run(
          file.mtime,
          file.size,
          note.title,
          tags,
          topics,
          note.type,
          note.body,
          old.rowid,
        )
        rowid = old.rowid
        statements.deleteLinks.run(file.path)
        statements.deleteHeadings.run(file.path)
        updated += 1
      } else {
        const info = statements.insertNote.run(
          file.path,
          file.mtime,
          file.size,
          note.title,
          tags,
          topics,
          note.type,
          note.body,
        )
        rowid = Number(info.lastInsertRowid)
        added += 1
      }

      statements.ftsInsert.run(rowid, note.title, note.body)
      ftsInserts += 1

      for (const target of note.links) {
        const resolved = resolveLink(target, links)
        statements.insertLink.run(file.path, resolved.path, resolved.broken ? 1 : 0)
      }
      for (const heading of note.headings) {
        statements.insertHeading.run(file.path, heading.level, heading.text, heading.line)
      }
    }
  })

  transaction()

  return { added, updated, parsed, ftsDeletes, ftsInserts, problems }
}

/** Clear the index and re-read the whole vault in sorted order. */
export function rebuild(index: NoteIndex): Result<SyncResult, IndexError> {
  const started = performance.now()
  const files = scanVault(index.vault)
  const statements = prepare(index.db)

  try {
    index.db.transaction(() => clear(index.db))()
  } catch (error) {
    return err(corruptError(index.dbFile, error))
  }

  // Titles are needed for link resolution before any row is inserted, so parse
  // once and reuse the result for the insert pass.
  const prepared = prepareNotes(files)
  const titles = prepared
    .filter((item) => item.note !== null)
    .map((item) => ({ path: item.file.path, title: (item.note as ParsedNote).title }))

  const written = writeNotes(index, statements, prepared, [], titles, new Map())

  return ok({
    scanned: files.length,
    added: written.added,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    parsed: written.parsed,
    ftsDeletes: written.ftsDeletes,
    ftsInserts: written.ftsInserts,
    problems: written.problems,
    ms: performance.now() - started,
  })
}

/**
 * Async refresh for the UI loader.
 *
 * Parsing changed notes is the expensive part; it is split into batches with
 * a macrotask between them, so a large vault does not hold the render thread
 * for the whole scan. The database write is still one transaction.
 */
export async function refreshAsync(
  index: NoteIndex,
  batchSize = 25,
): Promise<Result<SyncResult, IndexError>> {
  const started = performance.now()
  const files = scanVault(index.vault)

  let existing: Map<string, ExistingRow>
  try {
    existing = existingRows(index.db)
  } catch (error) {
    return err(corruptError(index.dbFile, error))
  }

  const { changed, removed } = plan(files, existing)
  let toParse = changed
  if (changed.length > 0 || removed.length > 0) {
    const removedSet = new Set(removed)
    const changedSet = new Set(changed.map((file) => file.path))
    const linking = new Set(
      (index.db.query("SELECT DISTINCT from_path FROM links").all() as Array<{ from_path: string }>).map(
        (row) => row.from_path,
      ),
    )
    const extra = files.filter(
      (file) => linking.has(file.path) && !changedSet.has(file.path) && !removedSet.has(file.path),
    )
    if (extra.length > 0) toParse = [...changed, ...extra]
  }

  const prepared: Prepared[] = []
  const size = Math.max(1, Math.floor(batchSize))
  for (let at = 0; at < toParse.length; at += size) {
    prepared.push(...prepareNotes(toParse.slice(at, at + size)))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  const changedPaths = new Set(toParse.map((file) => file.path))
  const titles: Array<{ path: string; title: string }> = []
  for (const row of index.db
    .query("SELECT path, title FROM notes ORDER BY path")
    .all() as Array<{ path: string; title: string }>) {
    if (!changedPaths.has(row.path)) titles.push({ path: row.path, title: row.title })
  }
  for (const item of prepared) {
    if (item.note) titles.push({ path: item.file.path, title: item.note.title })
  }
  titles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  await new Promise<void>((resolve) => setImmediate(resolve))
  const statements = prepare(index.db)
  const written = writeNotes(index, statements, prepared, removed, titles, existing)

  return ok({
    scanned: files.length,
    added: written.added,
    updated: written.updated,
    deleted: removed.length,
    unchanged: existing.size - written.updated - removed.length,
    parsed: written.parsed,
    ftsDeletes: written.ftsDeletes,
    ftsInserts: written.ftsInserts,
    problems: written.problems,
    ms: performance.now() - started,
  })
}

/**
 * Refresh by `(path, mtime, size)`. Only changed and added notes are re-parsed
 * and rewritten; untouched rows keep their rowid, bytes and FTS entry.
 */
export function refresh(index: NoteIndex): Result<SyncResult, IndexError> {
  const started = performance.now()
  const files = scanVault(index.vault)

  let existing: Map<string, ExistingRow>
  try {
    existing = existingRows(index.db)
  } catch (error) {
    return err(corruptError(index.dbFile, error))
  }

  const { changed, removed } = plan(files, existing)

  // A link row is rewritten only when its source note is re-parsed. When a
  // target appears or disappears, re-parse every note that links somewhere so
  // its `broken` flag follows the new title set instead of going stale.
  let toParse = changed
  if (changed.length > 0 || removed.length > 0) {
    const removedSet = new Set(removed)
    const changedSet = new Set(changed.map((file) => file.path))
    const linking = new Set(
      (index.db.query("SELECT DISTINCT from_path FROM links").all() as Array<{ from_path: string }>).map(
        (row) => row.from_path,
      ),
    )
    const extra = files.filter(
      (file) => linking.has(file.path) && !changedSet.has(file.path) && !removedSet.has(file.path),
    )
    if (extra.length > 0) toParse = [...changed, ...extra]
  }

  const prepared = prepareNotes(toParse)

  // Link resolution needs the current title set: the index for untouched notes,
  // the parsed result for the ones being rewritten. Sorted by path so a name
  // collision resolves the same way on every run.
  const changedPaths = new Set(toParse.map((file) => file.path))
  const titles: Array<{ path: string; title: string }> = []
  for (const row of index.db
    .query("SELECT path, title FROM notes ORDER BY path")
    .all() as Array<{ path: string; title: string }>) {
    if (!changedPaths.has(row.path)) titles.push({ path: row.path, title: row.title })
  }
  for (const item of prepared) {
    if (item.note) titles.push({ path: item.file.path, title: item.note.title })
  }
  titles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const statements = prepare(index.db)
  const written = writeNotes(index, statements, prepared, removed, titles, existing)

  return ok({
    scanned: files.length,
    added: written.added,
    updated: written.updated,
    deleted: removed.length,
    unchanged: existing.size - written.updated - removed.length,
    parsed: written.parsed,
    ftsDeletes: written.ftsDeletes,
    ftsInserts: written.ftsInserts,
    problems: written.problems,
    ms: performance.now() - started,
  })
}

/** Delete the database (all journal files) and rebuild it from Markdown. */
export function rebuildFromScratch(
  paths: WorkspacePaths,
  side: Side,
): Result<{ index: NoteIndex; result: SyncResult }, IndexError> {
  deleteIndexFiles(paths, side)
  const opened = openIndex(paths, side)
  if (!opened.ok) return opened
  const rebuilt = rebuild(opened.value)
  if (!rebuilt.ok) {
    closeIndex(opened.value)
    return rebuilt
  }
  return ok({ index: opened.value, result: rebuilt.value })
}

/* -------------------------------------------------------------------------- */
/* search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Free text → FTS5 expression.
 *
 * Raw user text must never reach `MATCH`: `-`, `:`, `(`, `)`, `*`, `^`, `NOT`,
 * `OR`, `AND` are operators, and `zzz-no-such-term` throws `no such column: no`
 * (S3 finding L1). Every token is quoted, which also neutralises a user typing
 * `AND`; a trailing `*` stays a prefix query, and an explicitly quoted phrase is
 * passed through.
 */
export function toFtsQuery(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ""
  // A single, well-formed quoted phrase is passed through. Anything else that
  // merely starts and ends with a quote (`"a" xyz"`) is tokenised, because raw
  // text must never reach MATCH as malformed syntax.
  if (/^"[^"]*"$/.test(trimmed)) return trimmed

  const parts: string[] = []
  for (const chunk of trimmed.split(/\s+/)) {
    const prefix = chunk.endsWith("*")
    const words = chunk
      .replace(/[^\p{L}\p{N}_]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    words.forEach((word, position) => {
      const quoted = `"${word}"`
      parts.push(prefix && position === words.length - 1 ? `${quoted}*` : quoted)
    })
  }
  return parts.join(" ")
}

/**
 * bm25 with the title weighted 3×. `bm25` returns negative numbers where more
 * negative is better, so ordering is `score ASC, path ASC` — totals are stable
 * for equal scores.
 */
export function search(
  index: NoteIndex,
  query: string,
  limit = 10,
): Result<Hit[], IndexError> {
  const expression = toFtsQuery(query)
  if (!expression || limit <= 0) return ok([])

  try {
    const hits = index.db
      .query(
        `SELECT n.path AS path,
                n.title AS title,
                snippet(notes_fts, -1, '[', ']', '…', 12) AS snippet,
                bm25(notes_fts, 3.0, 1.0) AS score
           FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ?
          ORDER BY score ASC, n.path ASC
          LIMIT ?`,
      )
      .all(expression, limit) as Hit[]
    return ok(hits)
  } catch (error) {
    const message = describe(error)
    if (/fts5|syntax error|unterminated string|no such column/i.test(message)) {
      return err({
        kind: "query",
        message: `The search text could not be matched: ${message}`,
        next: "Remove stray quotes or operators from the search, then try again.",
      })
    }
    return err(corruptError(index.dbFile, error))
  }
}

/* -------------------------------------------------------------------------- */
/* introspection (tests, doctor)                                               */
/* -------------------------------------------------------------------------- */

export function status(index: NoteIndex): IndexStatus {
  const one = (sql: string): number => (index.db.query(sql).get() as { c: number }).c
  const schemaRow = index.db
    .query("SELECT value FROM index_meta WHERE key = 'schema_version'")
    .get() as { value: string } | null
  return {
    notes: one("SELECT count(*) AS c FROM notes"),
    links: one("SELECT count(*) AS c FROM links"),
    brokenLinks: one("SELECT count(*) AS c FROM links WHERE broken = 1"),
    headings: one("SELECT count(*) AS c FROM headings"),
    ftsRows: one("SELECT count(*) AS c FROM notes_fts"),
    schemaVersion: schemaRow ? Number(schemaRow.value) : 0,
  }
}

export function migrationVersion(index: NoteIndex): number {
  return currentVersion(index.db)
}

function digest(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)
}

/** Per-path row identity + content digest, for scope assertions. */
export function snapshot(index: NoteIndex): Map<string, RowInfo> {
  const out = new Map<string, RowInfo>()
  const rows = index.db
    .query("SELECT rowid, path, mtime, size, title, body FROM notes")
    .all() as Array<{
    rowid: number
    path: string
    mtime: number
    size: number
    title: string
    body: string
  }>
  for (const row of rows) {
    out.set(row.path, {
      rowid: row.rowid,
      mtime: row.mtime,
      size: row.size,
      digest: digest(`${row.title}\u0000${row.body}`),
    })
  }
  return out
}

/**
 * Canonical logical dump. Rowids are included when `includeRowid` is true; a
 * rebuild renumbers them in sorted-path order, so comparisons across write
 * paths use `false` (S3 finding L3).
 */
export function dump(index: NoteIndex, includeRowid = true): string {
  const out: string[] = []
  out.push(`schema=${status(index).schemaVersion}`)
  out.push(`migrations=${migrationVersion(index)}`)
  out.push(`fts_rows=${status(index).ftsRows}`)

  const notes = index.db
    .query("SELECT rowid, path, mtime, size, title, tags, type, body FROM notes ORDER BY rowid")
    .all() as Array<{
    rowid: number
    path: string
    mtime: number
    size: number
    title: string
    tags: string
    type: string
    body: string
  }>
  for (const note of notes) {
    const prefix = includeRowid ? `N ${note.rowid} ` : "N "
    out.push(
      `${prefix}${note.path} ${note.mtime} ${note.size} ${note.title} ${note.tags} ${note.type} ${digest(note.body)}`,
    )
  }

  for (const link of index.db
    .query("SELECT from_path, to_path, broken FROM links ORDER BY from_path, to_path, broken")
    .all() as Array<{ from_path: string; to_path: string; broken: number }>) {
    out.push(`L ${link.from_path} -> ${link.to_path} broken=${link.broken}`)
  }

  for (const heading of index.db
    .query("SELECT path, level, text, line FROM headings ORDER BY path, line, level")
    .all() as Array<{ path: string; level: number; text: string; line: number }>) {
    out.push(`H ${heading.path} ${heading.level} ${heading.text} ${heading.line}`)
  }

  return out.join("\n")
}

/**
 * True when the vault holds notes the index has never seen — the state a user
 * sees as "search is empty, offer to build it" (`docs/design.md` §8, state
 * `blocked`). Never an error.
 */
export function needsRebuild(index: NoteIndex): boolean {
  const onDisk = scanVault(index.vault).length
  const indexed = (index.db.query("SELECT count(*) AS c FROM notes").get() as { c: number }).c
  return indexed < onDisk
}

/** True when `index.db` is present on disk (it is optional at all times). */
export function indexFileExists(paths: WorkspacePaths, side: Side): boolean {
  return existsSync(indexLocation(paths, side).db)
}

export { sqliteVersion }

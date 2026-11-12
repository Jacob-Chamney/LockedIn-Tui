/**
 * Archive, restore, delete and export for lock-in sessions.
 *
 * The archive keeps everything except chat history: `docs/product.md` §4.4 says
 * the archived copy keeps meta, sources, steps, progress and outputs but not the
 * conversation. That exclusion is recorded in `meta.json` as
 * `chat_archived: false`, so a restore can never imply a chat that is gone.
 *
 * Every destructive action is a transaction: build the destination in a
 * temporary folder beside it, then rename. A cancel changes no bytes and emits
 * nothing.
 */

import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../domain/markdown";
import { SESSION_FILES, sessionFromMeta, sessionToMeta } from "../../domain/session";
import type { Workspace } from "../../storage/workspace";
import { confinedJoin } from "../../storage/paths";
import { assertSessionId, inboundLinks, openSession, sessionFolderFor, writeMeta, type Emit, type ManagerError } from "./manager";
import { writeZip, type ZipInput } from "./zip";
/** Chat history is the one artefact an archive never carries. */
export const ARCHIVE_EXCLUDES: readonly string[] = [SESSION_FILES.chat]

export type ActionOptions = {
  workspace: Workspace
  id: string
  /** False means the confirmation was cancelled: nothing is written or emitted. */
  confirmed?: boolean
  emit?: Emit
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}


/** Canonical folder an archived session lives in, matching the archive port. */
export function archivedFolderFor(archiveRoot: string, id: string): string {
  const root = join(archiveRoot, "school", "session")
  return confinedJoin(root, id) ?? join(root, ".invalid-session")
}

/** Pre-backend layout (`<root>/school/<id>`); kept readable for old archives. */
export function legacyArchivedFolderFor(archiveRoot: string, id: string): string {
  const root = join(archiveRoot, "school")
  return confinedJoin(root, id) ?? join(root, ".invalid-session")
}

/** Find an archived session in either layout; null when neither exists. */
async function findArchived(archiveRoot: string, id: string): Promise<string | null> {
  for (const candidate of [archivedFolderFor(archiveRoot, id), legacyArchivedFolderFor(archiveRoot, id)]) {
    if (await exists(candidate)) return candidate
  }
  return null
}

/**
 * Copy a session folder, skipping the excluded names, and return the entries it
 * wrote so the export path can reuse the same file set.
 */
async function copySession(
  source: string,
  destination: string,
  excludes: readonly string[],
): Promise<ZipInput[]> {
  await mkdir(destination, { recursive: true })
  const written: ZipInput[] = []

  const walk = async (from: string, to: string, relative: string): Promise<void> => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const name = relative === "" ? entry.name : `${relative}/${entry.name}`
      if (relative === "" && excludes.includes(entry.name)) continue
      if (entry.name.startsWith(".")) continue
      const fromPath = join(from, entry.name)
      const toPath = join(to, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(fromPath, toPath, name)
        continue
      }
      // Pipes and devices would block the read; a copy is only regular files.
      if (!entry.isFile()) continue
      await cp(fromPath, toPath)
      written.push({ name, data: new Uint8Array(await readFile(toPath)) })
    }
  }

  await walk(source, destination, "")
  return written
}

export type ArchiveOutcome = { archived: boolean; folder: string; files: string[] }

/**
 * Move a session into the archive for its side, dropping chat history.
 * `confirmed: false` is a cancel: no bytes change, no event fires.
 */
export async function archiveSession(
  options: ActionOptions & { archiveRoot: string },
): Promise<Result<ArchiveOutcome, ManagerError>> {
  const checked = assertSessionId(options.id)
  if (!checked.ok) return checked
  const source = sessionFolderFor(options.workspace, options.id)
  if (!(await exists(source))) {
    return err({ kind: "storage", path: source, message: `there is no session "${options.id}"` })
  }
  if (options.confirmed === false) return ok({ archived: false, folder: source, files: [] })

  const opened = await openSession({ workspace: options.workspace, id: options.id })
  if (!opened.ok) return opened
  const { session } = opened.value

  const destination = archivedFolderFor(options.archiveRoot, options.id)
  if (await findArchived(options.archiveRoot, options.id)) {
    return err({
      kind: "blocked",
      path: destination,
      message: `an archived copy of "${options.id}" already exists; restore or remove it first`,
    })
  }

  const temporary = join(options.archiveRoot, "school", "session", `.tmp-${options.id}-${crypto.randomUUID()}`)
  try {
    const written = await copySession(source, temporary, ARCHIVE_EXCLUDES)
    await writeMeta(temporary, { ...session, archived: true }, { chat_archived: false })
    await rename(temporary, destination)
    await rm(source, { recursive: true, force: true })
    options.emit?.({ type: "session.updated", id: options.id, action: "archive" })
    return ok({ archived: true, folder: destination, files: written.map((entry) => entry.name) })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    return err({ kind: "storage", path: destination, message: messageOf(error) })
  }
}

export type RestoreOutcome = { restored: boolean; folder: string }

/** Move an archived session back, keeping the same file set. */
export async function restoreSession(
  options: ActionOptions & { archiveRoot: string },
): Promise<Result<RestoreOutcome, ManagerError>> {
  const checked = assertSessionId(options.id)
  if (!checked.ok) return checked
  const found = await findArchived(options.archiveRoot, options.id)
  if (found === null) {
    return err({
      kind: "storage",
      path: archivedFolderFor(options.archiveRoot, options.id),
      message: `there is no archived session "${options.id}"`,
    })
  }
  const source = found
  if (options.confirmed === false) return ok({ restored: false, folder: source })

  let archivedSession
  try {
    archivedSession = sessionFromMeta(
      JSON.parse(await readFile(join(source, SESSION_FILES.meta), "utf8")),
    )
  } catch (error) {
    return err({ kind: "storage", path: source, message: messageOf(error) })
  }
  if (!archivedSession.ok) {
    return err({ kind: "invalid-session", field: "meta", message: archivedSession.error.message })
  }
  const session = archivedSession.value

  const destination = sessionFolderFor(options.workspace, options.id)
  if (await exists(destination)) {
    return err({
      kind: "blocked",
      path: destination,
      message: `"${options.id}" is already open; delete or archive it first`,
    })
  }

  const temporary = join(options.workspace.paths.schoolSessions, `.tmp-${options.id}-${crypto.randomUUID()}`)
  try {
    await copySession(source, temporary, [])
    await writeMeta(temporary, { ...session, archived: false })
    await rename(temporary, destination)
    // The archived chat was dropped on archive; say so rather than implying it.
    await rm(join(destination, SESSION_FILES.chat), { force: true })
    await rm(source, { recursive: true, force: true })
    options.emit?.({ type: "session.updated", id: options.id, action: "restore" })
    return ok({ restored: true, folder: destination })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    return err({ kind: "storage", path: destination, message: messageOf(error) })
  }
}

export type DeleteOutcome = {
  deleted: boolean
  /** Notes that link to this session; the confirmation must name this number. */
  inboundLinks: number
}

/**
 * Delete a session folder. Nothing else is touched: no note, no work project,
 * no archive entry.
 */
export async function deleteSession(
  options: ActionOptions & { archiveRoot?: string },
): Promise<Result<DeleteOutcome, ManagerError>> {
  const checked = assertSessionId(options.id)
  if (!checked.ok) return checked
  const open = sessionFolderFor(options.workspace, options.id)
  const archived = options.archiveRoot ? await findArchived(options.archiveRoot, options.id) : null

  const folder = (await exists(open)) ? open : archived
  if (folder === null) {
    return err({ kind: "storage", path: open, message: `there is no session "${options.id}"` })
  }

  const links = await inboundLinks({ workspace: options.workspace, id: options.id })
  if (options.confirmed === false) return ok({ deleted: false, inboundLinks: links.count })

  try {
    await rm(folder, { recursive: true, force: true })
  } catch (error) {
    return err({ kind: "storage", path: folder, message: messageOf(error) })
  }

  options.emit?.({ type: "session.updated", id: options.id, action: "delete" })
  return ok({ deleted: true, inboundLinks: links.count })
}

export type ExportOutcome = { path: string; bytes: number; entries: string[] }

/**
 * Archive a session through any backend and remove the live copy only after the
 * upload and index write succeeded. This is the GitHub path; the folder path
 * keeps its atomic rename.
 */
export async function archiveSessionToBackend(options: {
  workspace: Workspace
  id: string
  backend: import("../../archive/types").ArchiveBackend
}): Promise<Result<import("../../archive/types").PutResult, import("../../archive/types").ArchiveError>> {
  const checked = assertSessionId(options.id)
  if (!checked.ok) {
    return err({
      kind: "path",
      path: options.id,
      reason: "escape",
      message: checked.error.kind === "path" ? checked.error.message : `"${options.id}" is not a session id`,
      next: "Refresh the session list and try again.",
    })
  }
  const folder = sessionFolderFor(options.workspace, options.id)
  if (!(await exists(folder))) {
    return err({
      kind: "path",
      path: folder,
      reason: "missing",
      message: `there is no session "${options.id}"`,
      next: "Refresh the session list and try again.",
    })
  }
  const put = await options.backend.put(
    { side: "school", id: options.id, backend: options.backend.id, kind: "session" },
    folder,
  )
  if (!put.ok) return put
  // `put` reports success for a partial upload: oversized files and symlinks are
  // skipped with warnings. Removing the live copy then would destroy the only
  // full copy, so keep it and surface the skip instead.
  if (put.value.warnings.length > 0) {
    return err({
      kind: "storage",
      path: folder,
      message:
        `the archive is incomplete (${put.value.warnings.length} file` +
        `${put.value.warnings.length === 1 ? "" : "s"} skipped); the live copy was kept`,
      next: "Remove the skipped files or reference them by path, then archive again.",
    })
  }
  try {
    await rm(folder, { recursive: true, force: true })
  } catch (error) {
    return err({
      kind: "storage",
      path: folder,
      message: `the archive succeeded but the local copy could not be removed: ${messageOf(error)}`,
      next: "The archive copy is safe; remove the local folder manually.",
    })
  }
  return ok(put.value)
}

/**
 * Export a session as a deterministic zip in `exports/`.
 *
 * Same file set as an archive (chat excluded), entries sorted, timestamps
 * pinned, written to a temp file and renamed into place.
 */
export async function exportSession(options: ActionOptions): Promise<Result<ExportOutcome, ManagerError>> {
  const opened = await openSession({ workspace: options.workspace, id: options.id })
  if (!opened.ok) return opened

  const { folder, session } = opened.value
  const staging = join(
    options.workspace.paths.exports,
    `.session-${options.id}-${crypto.randomUUID()}`,
  )
  const target = join(options.workspace.paths.exports, `session-${options.id}.zip`)
  const temporary = `${target}.tmp-${crypto.randomUUID()}`

  try {
    await mkdir(staging, { recursive: true })
    // `meta.json` is rewritten first so the archive carries a fresh copy and the
    // copy pass does not add a second one.
    await writeMeta(staging, { ...session, archived: session.archived }, { chat_archived: false })
    const written = await copySession(folder, staging, [...ARCHIVE_EXCLUDES, SESSION_FILES.meta])

    const entries: ZipInput[] = [
      { name: SESSION_FILES.meta, data: new Uint8Array(await readFile(join(staging, SESSION_FILES.meta))) },
      ...written,
    ]

    const bytes = writeZip(entries)
    await Bun.write(temporary, bytes)
    await rename(temporary, target)
    options.emit?.({ type: "session.updated", id: options.id, action: "export" })
    return ok({ path: target, bytes: bytes.length, entries: entries.map((entry) => entry.name).sort() })
  } catch (error) {
    await rm(temporary, { force: true })
    return err({ kind: "storage", path: target, message: messageOf(error) })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export { sessionFromMeta, sessionToMeta }

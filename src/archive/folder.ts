/**
 * Folder archive backend (WP-128).
 *
 * Layout: `<archiveRoot>/<side>/<kind>/<id>/`, so the wall holds in the archive
 * exactly as it does in the workspace (`docs/product.md` §9).
 *
 * Guarantees:
 *
 * - `put()` copies into a temporary folder beside the destination and renames
 *   it into place: the archived copy either fully exists or does not exist. The
 *   source folder is only ever read.
 * - chat history, config and data-dir counters are never copied; `meta.json`
 *   loses `original_path` so no absolute machine path reaches the archive.
 * - files above the size cap are skipped with a warning in the result.
 * - `remove()` only ever deletes inside `<archiveRoot>`; a live item is never
 *   touched. `restore()` refuses a non-empty destination unless asked.
 * - the local index (`<workspace>/archive-index/<side>.json`) is a cache: a
 *   corrupt or missing index is reported and the folders still list.
 */

import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, type Dirent } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { err, ok, type Result } from "../domain/markdown";
import { isPathInside } from "../storage/paths";
import { ARCHIVE_EXCLUDED_NAMES, ARCHIVE_KINDS, ARCHIVE_SIDES, DEFAULT_MAX_FILE_BYTES, type ArchiveBackend, type ArchiveDiagnostic, type ArchiveEntry, type ArchiveError, type ArchiveBackendId, type ArchiveKind, type ArchiveRef, type ArchiveLocation, type ArchiveSide, type ArchiveWarning, type EnsureResult, type ListResult, type PutOptions, type PutResult, type RemoveOptions, type RestoreOptions, type RestoreResult } from "./types";
/** Manifest written inside every archived folder (never absolute paths). */
export const ARCHIVE_MANIFEST = "archive.json"
export const ARCHIVE_SCHEMA = 1

export type FolderArchiveOptions = {
  /** Absolute path where archives are stored (config `archive.folder`). */
  archiveRoot: string
  /** Live workspace root, used to confine `put()`'s source folder. */
  workspaceRoot?: string
  /** Defaults to `<workspaceRoot>/archive-index`. */
  indexDir?: string
  /** Overridable for tests; production uses 50 MB. */
  maxFileBytes?: number
  now?: () => Date
}

export type FolderArchive = ArchiveBackend & {
  readonly id: "folder"
  /** Index file for one side. */
  indexFile(side: ArchiveSide): string
  /** Folder an archived item lives in. */
  folderFor(ref: Pick<ArchiveRef, "side" | "kind" | "id">): string
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Windows can briefly refuse a directory rename while a scanner holds it. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as { code?: string }).code
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error
      await Bun.sleep(25)
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function pathError(
  path: string,
  reason: Extract<ArchiveError, { kind: "path" }>["reason"],
  message: string,
  next: string,
): ArchiveError {
  return { kind: "path", path, reason, message, next }
}


async function isEmptyDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch {
    // "Cannot read" is not "empty": overwriting an unreadable folder without
    // the overwrite flag would destroy data the user never approved.
    return false
  }
}

async function writeFileAtomic(file: string, text: string): Promise<void> {
  const dir = dirname(file)
  const temp = join(dir, `.${basename(file)}.tmp-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await mkdir(dir, { recursive: true })
    handle = await open(temp, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameWithRetry(temp, file)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // nothing useful to do with a failing close
    }
    rmSync(temp, { force: true })
    throw error
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function validateRef(ref: ArchiveRef): ArchiveError | null {
  if (!(ARCHIVE_SIDES as readonly string[]).includes(ref.side)) {
    return {
      kind: "path",
      path: String(ref.side),
      reason: "escape",
      message: `“${ref.side}” is not an archive side; school and skills never share a folder.`,
      next: "Archive a school item under school and a skill item under skills.",
    }
  }
  if (ref.kind !== undefined && !(ARCHIVE_KINDS as readonly string[]).includes(ref.kind)) {
    return {
      kind: "path",
      path: String(ref.kind),
      reason: "invalid-id",
      message: `“${ref.kind}” is not an archive kind.`,
      next: "Use session, goal or project.",
    }
  }
  if (
    typeof ref.id !== "string" ||
    ref.id.length === 0 ||
    ref.id.length > 128 ||
    !ID_PATTERN.test(ref.id) ||
    ref.id === "." ||
    ref.id === ".."
  ) {
    return {
      kind: "path",
      path: String(ref.id ?? ""),
      reason: "invalid-id",
      message: `“${ref.id}” is not a safe archive id.`,
      next: "Archive ids are the item id: letters, digits, dot, dash and underscore only.",
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* copy                                                                        */
/* -------------------------------------------------------------------------- */

type CopyTally = { files: number; bytes: number; warnings: ArchiveWarning[] }

/**
 * Copy `from` into `to`, skipping excluded names, symlinks and oversized files.
 * Symlinks are never followed: an archive may not reach outside its source.
 */
async function copyTree(
  from: string,
  to: string,
  options: { excludes: readonly string[]; maxFileBytes: number; warnings: ArchiveWarning[] },
): Promise<CopyTally> {
  await mkdir(to, { recursive: true })
  let files = 0
  let bytes = 0

  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (options.excludes.includes(entry.name)) continue
    if (entry.name.startsWith(".")) continue

    const source = join(from, entry.name)
    const target = join(to, entry.name)

    if (entry.isSymbolicLink()) {
      options.warnings.push({
        code: "symlink",
        path: entry.name,
        message: `${entry.name} is a symlink and was not archived.`,
      })
      continue
    }
    if (entry.isDirectory()) {
      const nested = await copyTree(source, target, options)
      files += nested.files
      bytes += nested.bytes
      continue
    }
    // Pipes, sockets and devices can block a read forever; only regular files
    // are copied. A symlink was already refused above.
    if (!entry.isFile()) {
      options.warnings.push({
        code: "special-file",
        path: entry.name,
        message: `${entry.name} is not a regular file and was not archived.`,
      })
      continue
    }

    const info = lstatSync(source)
    if (info.size > options.maxFileBytes) {
      options.warnings.push({
        code: "large-file",
        path: entry.name,
        bytes: info.size,
        message: `${entry.name} is ${(info.size / 1024 / 1024).toFixed(1)} MB and was skipped; reference it instead of archiving it.`,
      })
      continue
    }

    await copyFile(source, target)
    files += 1
    bytes += info.size
  }

  return { files, bytes, warnings: options.warnings }
}

/**
 * Replace absolute source paths in the archived `meta.json`.
 * The live file is never touched: `docs/product.md` §9 forbids machine paths in
 * anything that leaves the machine.
 */
async function scrubAbsolutePaths(dir: string): Promise<boolean> {
  const file = join(dir, "meta.json")
  if (!existsSync(file)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return false // a broken meta.json is left alone: the archive is a copy
  }
  if (typeof parsed !== "object" || parsed === null) return false

  const record = parsed as Record<string, unknown>
  let changed = false
  if (Array.isArray(record.sources)) {
    for (const source of record.sources) {
      if (typeof source === "object" && source !== null && "original_path" in source) {
        delete (source as Record<string, unknown>).original_path
        changed = true
      }
    }
  }
  if (changed) await writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`)
  return changed
}

function metaTitleAndTags(dir: string): { title: string | null; tags: string[] } {
  for (const name of [ARCHIVE_MANIFEST, "meta.json"]) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
      const title =
        typeof parsed.title === "string" && parsed.title.trim() !== ""
          ? parsed.title
          : typeof parsed.name === "string" && parsed.name.trim() !== ""
            ? parsed.name
            : null
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : []
      if (title) return { title, tags }
      if (tags.length > 0) return { title: null, tags }
    } catch {
      continue
    }
  }
  return { title: null, tags: [] }
}

/* -------------------------------------------------------------------------- */
/* backend                                                                     */
/* -------------------------------------------------------------------------- */

export function openFolderArchive(
  options: FolderArchiveOptions,
): Result<FolderArchive, ArchiveError> {
  if (!options.archiveRoot || !isAbsolute(options.archiveRoot)) {
    return err(
      pathError(
        options.archiveRoot ?? "",
        "absolute",
        "The archive folder must be an absolute path.",
        "Choose a folder for the archive (Settings → Storage and archive).",
      ),
    )
  }

  const archiveRoot = resolvePath(options.archiveRoot)
  const indexDir = resolvePath(
    options.indexDir ?? (options.workspaceRoot ? join(options.workspaceRoot, "archive-index") : join(archiveRoot, "..", "archive-index")),
  )
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const now = options.now ?? (() => new Date())

  const locate = (ref: ArchiveRef): ArchiveLocation => ({
    side: ref.side,
    kind: ref.kind ?? "session",
    id: ref.id,
  })

  const folderFor = (ref: ArchiveRef | ArchiveLocation): string => {
    const location = "backend" in ref ? locate(ref) : ref
    const canonical = join(archiveRoot, location.side, location.kind, location.id)
    if (existsSync(canonical)) return canonical
    // Archives written before the port landed as `<side>/<id>`; keep them
    // restorable and removable instead of silently reporting "missing".
    const legacy = join(archiveRoot, location.side, location.id)
    return existsSync(legacy) ? legacy : canonical
  }

  const indexFile = (side: ArchiveSide): string => join(indexDir, `${side}.json`)

  function realPathFor(path: string): string {
    try {
      return realpathSync(path)
    } catch {
      try {
        return join(realpathSync(dirname(path)), basename(path))
      } catch {
        return path
      }
    }
  }

  function confined(folder: string, what: string): ArchiveError | null {
    // Textual containment is not enough: a symlinked side folder would pass.
    if (!isPathInside(realPathFor(archiveRoot), realPathFor(folder))) {
      return pathError(
        folder,
        "escape",
        `${what} resolves outside the archive folder.`,
        "Keep archives under the configured archive root.",
      )
    }
    return null
  }

  type IndexFile = { backends: ArchiveBackendId[]; entries: ArchiveEntry[] }

  function readIndex(side: ArchiveSide): {
    entries: ArchiveEntry[]
    diagnostics: ArchiveDiagnostic[]
  } {
    const file = indexFile(side)
    if (!existsSync(file)) return { entries: [], diagnostics: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      return {
        entries: [],
        diagnostics: [
          {
            code: "index-corrupt",
            path: file,
            message: `The ${side} archive index is unreadable: ${describe(error)}`,
            next: "The folders are still listed; rebuild the index by opening the archive again.",
          },
        ],
      }
    }
    const entries: ArchiveEntry[] = []
    const diagnostics: ArchiveDiagnostic[] = []
    const record = parsed as { entries?: unknown; backend?: unknown }
    const fileBackend =
      record.backend === "github" ? "github" : record.backend === "folder" ? "folder" : "folder"
    if (!Array.isArray(record.entries)) {
      return {
        entries,
        diagnostics: [
          {
            code: "index-corrupt",
            path: file,
            message: `The ${side} archive index has no entries list.`,
            next: "The folders are still listed; the index is rebuilt on the next archive.",
          },
        ],
      }
    }
    for (const raw of record.entries) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        typeof (raw as ArchiveEntry).id !== "string" ||
        !(ARCHIVE_KINDS as readonly string[]).includes((raw as ArchiveEntry).kind)
      ) {
        continue
      }
      const entry = raw as ArchiveEntry & { backend?: unknown }
      const backend =
        entry.backend === "folder" || entry.backend === "github" ? entry.backend : fileBackend
      if (entry.backend !== undefined && backend !== entry.backend) {
        diagnostics.push({
          code: "index-entry-invalid",
          path: file,
          message: `The index entry “${entry.id}” names an unknown backend ${JSON.stringify(entry.backend)}.`,
          next: "It was ignored for archiving; the index is rewritten on the next successful write.",
        })
        continue
      }
      entries.push({
        id: entry.id,
        kind: entry.kind,
        title: typeof entry.title === "string" ? entry.title : entry.id,
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
        archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : "",
        sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
        backend,
      })
    }
    return { entries, diagnostics }
  }

  async function writeIndex(side: ArchiveSide, entries: ArchiveEntry[]): Promise<void> {
    const backends = [...new Set(entries.map((entry) => entry.backend))].sort() as ArchiveBackendId[]
    const payload: IndexFile = {
      backends,
      entries: [...entries].sort((a, b) =>
        a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : a.id < b.id ? -1 : 1,
      ),
    }
    await writeFileAtomic(indexFile(side), `${JSON.stringify(payload, null, 2)}\n`)
  }

  async function upsertIndex(side: ArchiveSide, entry: ArchiveEntry): Promise<void> {
    const { entries } = readIndex(side)
    const next = entries.filter((existing) => existing.id !== entry.id)
    next.push(entry)
    await writeIndex(side, next)
  }

  async function dropFromIndex(side: ArchiveSide, id: string): Promise<void> {
    const { entries } = readIndex(side)
    const next = entries.filter((existing) => existing.id !== id)
    if (next.length !== entries.length) await writeIndex(side, next)
  }

  function entryFor(_side: ArchiveSide, kind: ArchiveKind, id: string, folder: string): ArchiveEntry {
    const info = metaTitleAndTags(folder)
    let archivedAt = ""
    let sizeBytes = 0
    try {
      const manifest = JSON.parse(readFileSync(join(folder, ARCHIVE_MANIFEST), "utf8")) as Record<string, unknown>
      if (typeof manifest.archived_at === "string") archivedAt = manifest.archived_at
      if (typeof manifest.bytes === "number") sizeBytes = manifest.bytes
    } catch {
      // no manifest: fall back to folder metadata below
    }
    if (!archivedAt) {
      try {
        archivedAt = new Date(lstatSync(folder).mtimeMs).toISOString()
      } catch {
        archivedAt = ""
      }
    }
    return {
      id,
      kind,
      title: info.title ?? id,
      tags: info.tags,
      archivedAt,
      sizeBytes,
      backend: "folder" as const,
    }
  }

  async function ensureReady(): Promise<Result<EnsureResult, ArchiveError>> {
    const created: string[] = []
    try {
      for (const dir of [archiveRoot, indexDir, ...ARCHIVE_SIDES.map((side) => join(archiveRoot, side))]) {
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true })
          created.push(dir)
        }
      }
      return ok({ root: archiveRoot, created })
    } catch (error) {
      return err({
        kind: "storage",
        path: archiveRoot,
        message: `The archive folder could not be created: ${describe(error)}`,
        next: "Choose a writable folder for the archive (Settings → Storage and archive).",
      })
    }
  }

  async function put(
    ref: ArchiveRef,
    sourceDir: string,
    putOptions: PutOptions = {},
  ): Promise<Result<PutResult, ArchiveError>> {
    const invalid = validateRef(ref)
    if (invalid) return err(invalid)
    const kind: ArchiveKind = ref.kind ?? "session"
    if (!isAbsolute(sourceDir)) {
      return err(
        pathError(sourceDir, "absolute", "The source folder must be an absolute path.", "Pass the live session or goal folder."),
      )
    }

    const source = resolvePath(sourceDir)
    let sourceStat
    try {
      sourceStat = lstatSync(source)
    } catch {
      return err(
        pathError(source, "missing", `The source folder “${source}” does not exist.`, "Open the item before archiving it."),
      )
    }
    if (!sourceStat.isDirectory()) {
      return err(
        pathError(source, "not-a-folder", "Only a folder can be archived.", "Archive the session or goal folder, not a single file."),
      )
    }
    if (options.workspaceRoot) {
      const workspace = resolvePath(options.workspaceRoot)
      const realSource = realpathSync(source)
      if (!isPathInside(workspace, realSource)) {
        return err(
          pathError(
            source,
            "escape",
            "The source folder is outside the workspace, so it cannot be archived.",
            "Archive from the workspace that owns the item.",
          ),
        )
      }
    }

    const target = folderFor({ side: ref.side, kind, id: ref.id })
    const escaped = confined(target, "The archive destination")
    if (escaped) return err(escaped)

    const parent = dirname(target)
    const temp = join(parent, `.${ref.id}.tmp-${randomUUID()}`)
    const previous = join(parent, `.${ref.id}.old-${randomUUID()}`)
    const warnings: ArchiveWarning[] = []
    const archivedAt = now().toISOString()

    try {
      await mkdir(parent, { recursive: true })
      await rm(temp, { recursive: true, force: true })
      const copied = await copyTree(source, temp, {
        excludes: ARCHIVE_EXCLUDED_NAMES,
        maxFileBytes,
        warnings,
      })

      await scrubAbsolutePaths(temp)

      const info = metaTitleAndTags(temp)
      const manifest = {
        schema: ARCHIVE_SCHEMA,
        side: ref.side,
        kind,
        id: ref.id,
        title: putOptions.title ?? info.title ?? ref.id,
        tags: putOptions.tags ?? info.tags,
        archived_at: archivedAt,
        files: copied.files,
        bytes: copied.bytes,
      }
      await writeFileAtomic(join(temp, ARCHIVE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)

      // Swap: the archived copy is only visible once it is complete.
      const replacing = existsSync(target)
      if (replacing) await renameWithRetry(target, previous)
      try {
        await renameWithRetry(temp, target)
      } catch (error) {
        if (replacing) await renameWithRetry(previous, target).catch(() => {})
        throw error
      }
      if (replacing) await rm(previous, { recursive: true, force: true })

      const entry: ArchiveEntry = {
        id: ref.id,
        kind,
        title: manifest.title,
        tags: manifest.tags,
        archivedAt,
        sizeBytes: copied.bytes,
        backend: "folder",
      }
      await upsertIndex(ref.side, entry)

      return ok({ ref, path: target, files: copied.files, bytes: copied.bytes, warnings })
    } catch (error) {
      await rm(temp, { recursive: true, force: true })
      return err({
        kind: "storage",
        path: target,
        message: `The item could not be archived: ${describe(error)}`,
        next: "Check that the archive folder is writable; the live item was not touched.",
      })
    }
  }

  async function list(side: ArchiveSide): Promise<Result<ListResult, ArchiveError>> {
    if (!(ARCHIVE_SIDES as readonly string[]).includes(side)) {
      return err(pathError(String(side), "escape", "Unknown archive side.", "Use school or skills."))
    }

    const diagnostics: ArchiveDiagnostic[] = []
    const index = readIndex(side)
    diagnostics.push(...index.diagnostics)

    const entries: ArchiveEntry[] = []
    const seen = new Set<string>()

    const scan = async (kind: ArchiveKind, parent: string): Promise<void> => {
      let dirents
      try {
        dirents = await readdir(parent, { withFileTypes: true })
      } catch {
        return
      }
      for (const dirent of dirents) {
        if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue
        if (seen.has(dirent.name)) continue
        const folder = join(parent, dirent.name)
        seen.add(dirent.name)
        entries.push(entryFor(side, kind, dirent.name, folder))
      }
    }

    for (const kind of ARCHIVE_KINDS) {
      await scan(kind, join(archiveRoot, side, kind))
    }

    // Tolerate the session-manager layout (`<side>/<id>/`) written by WP-305 so
    // the picker lists archives made before this backend existed.
    let sideDirents: Dirent[]
    try {
      sideDirents = await readdir(join(archiveRoot, side), { withFileTypes: true })
    } catch {
      sideDirents = []
    }
    for (const dirent of sideDirents) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue
      if ((ARCHIVE_KINDS as readonly string[]).includes(dirent.name)) continue
      if (seen.has(dirent.name)) continue
      const folder = join(archiveRoot, side, dirent.name)
      if (!existsSync(join(folder, "meta.json")) && !existsSync(join(folder, ARCHIVE_MANIFEST))) {
        diagnostics.push({
          code: "unreadable-folder",
          path: folder,
          message: `${dirent.name} has no archive metadata and was skipped.`,
          next: "Restore or remove it by hand; the picker only lists items it can identify.",
        })
        continue
      }
      seen.add(dirent.name)
      entries.push(entryFor(side, "session", dirent.name, folder))
    }

    // Entries the folders did not produce. A remote entry is listed (it is not a
    // file here); a folder entry whose directory vanished is a diagnostic.
    for (const entry of index.entries) {
      if (seen.has(entry.id)) continue
      if (entry.backend === "github") {
        seen.add(entry.id)
        entries.push(entry)
        continue
      }
      diagnostics.push({
        code: "index-entry-invalid",
        path: join(archiveRoot, side, entry.kind, entry.id),
        message: `The index lists “${entry.id}”, but its folder is gone.`,
        next: "The index is a cache; archiving again rebuilds it.",
      })
    }

    entries.sort((a, b) =>
      a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : a.id < b.id ? -1 : 1,
    )

    return ok({ entries, diagnostics })
  }

  async function restore(
    ref: ArchiveRef,
    destination: string,
    restoreOptions: RestoreOptions = {},
  ): Promise<Result<RestoreResult, ArchiveError>> {
    const invalid = validateRef(ref)
    if (invalid) return err(invalid)
    if (!isAbsolute(destination)) {
      return err(
        pathError(destination, "absolute", "The restore destination must be an absolute path.", "Choose where the item should be restored."),
      )
    }

    const source = folderFor(ref)
    if (!existsSync(source)) {
      return err(
        pathError(source, "missing", `There is no archived “${ref.id}” on the ${ref.side} side.`, "Archive the item first, or pick another entry."),
      )
    }

    const target = resolvePath(destination)
    if (isPathInside(archiveRoot, target)) {
      return err(
        pathError(target, "inside-archive", "The restore destination is inside the archive folder.", "Restore into the workspace, not into the archive."),
      )
    }

    const targetExists = existsSync(target)
    if (targetExists && !(await isEmptyDir(target)) && !restoreOptions.overwrite) {
      return err(
        pathError(
          target,
          "not-empty",
          `“${basename(target)}” already exists and is not empty.`,
          "Restore into a new folder, or confirm the overwrite to replace it.",
        ),
      )
    }

    const parent = dirname(target)
    const temp = join(parent, `.${basename(target)}.restore-${randomUUID()}`)
    const previous = join(parent, `.${basename(target)}.old-${randomUUID()}`)
    const warnings: ArchiveWarning[] = []

    try {
      await mkdir(parent, { recursive: true })
      await rm(temp, { recursive: true, force: true })
      const copied = await copyTree(source, temp, {
        // `archive.json` describes the archived copy; a restored item is a live
        // item and must not gain archive metadata.
        excludes: [ARCHIVE_MANIFEST],
        maxFileBytes,
        warnings,
      })

      const replacing = targetExists
      if (replacing) await renameWithRetry(target, previous)
      try {
        await renameWithRetry(temp, target)
      } catch (error) {
        if (replacing) await renameWithRetry(previous, target).catch(() => {})
        throw error
      }
      if (replacing) await rm(previous, { recursive: true, force: true })

      return ok({ ref, path: target, files: copied.files })
    } catch (error) {
      await rm(temp, { recursive: true, force: true })
      return err({
        kind: "storage",
        path: target,
        message: `The item could not be restored: ${describe(error)}`,
        next: "Check that the destination is writable; nothing was replaced.",
      })
    }
  }

  async function remove(
    ref: ArchiveRef,
    _options: RemoveOptions = {},
  ): Promise<Result<{ removed: boolean; path: string }, ArchiveError>> {
    const invalid = validateRef(ref)
    if (invalid) return err(invalid)

    const target = folderFor(ref)
    const escaped = confined(target, "The archive folder")
    if (escaped) return err(escaped)

    // Never delete through a symlink: the archive root is the only place this
    // backend may write or remove.
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
      return err(
        pathError(target, "symlink", "The archived folder is a symlink; refusing to delete through it.", "Remove the link yourself, then archive again."),
      )
    }

    if (!existsSync(target)) {
      await dropFromIndex(ref.side, ref.id).catch(() => {})
      return ok({ removed: false, path: target })
    }

    try {
      await rm(target, { recursive: true, force: true })
      await dropFromIndex(ref.side, ref.id)
      return ok({ removed: true, path: target })
    } catch (error) {
      return err({
        kind: "storage",
        path: target,
        message: `The archived copy could not be removed: ${describe(error)}`,
        next: "Check the archive folder permissions; the live item was not touched.",
      })
    }
  }

  return ok({
    id: "folder",
    archiveRoot,
    indexFile,
    folderFor,
    ensureReady,
    put,
    list,
    restore,
    remove,
  })
}

/** Archived-folder layout for a ref, without opening a backend (tests, pickers). */
export function archiveFolderPath(
  archiveRoot: string,
  location: ArchiveLocation,
): string {
  return join(resolvePath(archiveRoot), location.side, location.kind, location.id)
}

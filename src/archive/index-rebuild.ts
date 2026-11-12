/**
 * Archive index rebuild (WP-152).
 *
 * `archive-index/<side>.json` is a cache, not the truth (`docs/product.md` §9).
 * `list()` promises "the index is rebuilt on the next archive"; this module is
 * the repair path that promise implies.
 *
 * Rules:
 *
 * - the archive folders are the only source; the live workspace is never read;
 * - an item that cannot be identified is reported and left out, and its folder
 *   is not touched;
 * - entries from another backend (WP-144's per-entry `backend`) cannot be
 *   discovered on disk, so they are carried over rather than guessed or dropped;
 * - the write is atomic (temp file → fsync → rename) and confined to the index
 *   directory;
 * - rebuilding twice produces identical bytes.
 */

import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { mkdir, open, readdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { err, ok, type Result } from "../domain/markdown";
import { isPathInside } from "../storage/paths";
import { ARCHIVE_MANIFEST, ARCHIVE_SCHEMA } from "./folder";
import { ARCHIVE_KINDS, type ArchiveBackendId, type ArchiveDiagnostic, type ArchiveEntry, type ArchiveError, type ArchiveSide } from "./types";
export type RebuildOptions = {
  /** Absolute archive folder. */
  archiveRoot: string
  /** Absolute `archive-index` folder inside the workspace. */
  indexDir: string
}

export type RebuildResult = {
  side: ArchiveSide
  path: string
  entries: number
  diagnostics: ArchiveDiagnostic[]
  /** Bytes of the rewritten file. */
  bytes: number
  /** Entries carried over from another backend (not discoverable on disk). */
  preserved: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeFileAtomic(file: string, text: string): Promise<void> {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `.${basename(file)}.tmp-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, file)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // ignore
    }
    rmSync(temp, { force: true })
    throw error
  }
}

type ReadEntry = { entry: ArchiveEntry; skipped?: string[] }

function indexFile(options: RebuildOptions, side: ArchiveSide): string {
  return join(options.indexDir, `${side}.json`)
}

/** Existing entries, tolerating a corrupt or missing file. */
function readExisting(
  options: RebuildOptions,
  side: ArchiveSide,
): { entries: ReadEntry[]; diagnostics: ArchiveDiagnostic[] } {
  const file = indexFile(options, side)
  if (!existsSync(file)) return { entries: [], diagnostics: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      entries?: unknown
      backend?: unknown
    }
    if (!Array.isArray(parsed.entries)) {
      return {
        entries: [],
        diagnostics: [
          {
            code: "index-corrupt",
            path: file,
            message: `The ${side} archive index has no entries list and was rebuilt from the folders.`,
            next: "No action needed; the rebuilt index replaces it.",
          },
        ],
      }
    }
    const fallback: ArchiveBackendId = parsed.backend === "github" ? "github" : "folder"
    const entries: ReadEntry[] = []
    for (const raw of parsed.entries) {
      if (typeof raw !== "object" || raw === null) continue
      const entry = raw as ArchiveEntry & { skipped?: unknown; backend?: unknown }
      if (typeof entry.id !== "string" || !ARCHIVE_KINDS.includes(entry.kind)) continue
      const backend =
        entry.backend === "folder" || entry.backend === "github" ? entry.backend : fallback
      entries.push({
        entry: {
          id: entry.id,
          kind: entry.kind,
          title: typeof entry.title === "string" ? entry.title : entry.id,
          tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string") : [],
          archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : "",
          sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
          backend,
        },
        ...(Array.isArray(entry.skipped)
          ? { skipped: entry.skipped.filter((name): name is string => typeof name === "string") }
          : {}),
      })
    }
    return { entries, diagnostics: [] }
  } catch (error) {
    return {
      entries: [],
      diagnostics: [
        {
          code: "index-corrupt",
          path: file,
          message: `The ${side} archive index was unreadable (${describe(error)}) and was rebuilt from the folders.`,
          next: "No action needed; the rebuilt index replaces it.",
        },
      ],
    }
  }
}

function metadata(folder: string): {
  title: string | null
  tags: string[]
  archivedAt: string
  sizeBytes: number
  backend: ArchiveBackendId
  skipped?: string[]
} | null {
  const manifestFile = join(folder, ARCHIVE_MANIFEST)
  const metaFile = join(folder, "meta.json")

  if (existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>
      if (manifest.schema !== ARCHIVE_SCHEMA) return null
      return {
        title:
          typeof manifest.title === "string" && manifest.title.trim() !== ""
            ? manifest.title
            : null,
        tags: Array.isArray(manifest.tags)
          ? manifest.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        archivedAt: typeof manifest.archived_at === "string" ? manifest.archived_at : "",
        sizeBytes: typeof manifest.bytes === "number" ? manifest.bytes : 0,
        backend: "folder",
        ...(Array.isArray(manifest.skipped)
          ? { skipped: manifest.skipped.filter((name): name is string => typeof name === "string") }
          : {}),
      }
    } catch {
      return null
    }
  }

  if (existsSync(metaFile)) {
    try {
      const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>
      const title =
        typeof meta.title === "string" && meta.title.trim() !== ""
          ? meta.title
          : typeof meta.name === "string" && meta.name.trim() !== ""
            ? meta.name
            : null
      return {
        title,
        tags: Array.isArray(meta.tags)
          ? meta.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        archivedAt: "",
        sizeBytes: 0,
        backend: "folder",
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * Rewrite `<indexDir>/<side>.json` from the archive folders. Idempotent: two
 * runs over the same folders produce identical bytes.
 */
export async function rebuildIndex(
  options: RebuildOptions,
  side: ArchiveSide,
): Promise<Result<RebuildResult, ArchiveError>> {
  if (side !== "school" && side !== "skills") {
    return err({
      kind: "path",
      path: String(side),
      reason: "escape",
      message: "Unknown archive side.",
      next: "Use school or skills.",
    })
  }
  if (!options.archiveRoot || !options.indexDir) {
    return err({
      kind: "config",
      field: "archive.root",
      message: "The archive root and index folder are required to rebuild the index.",
      next: "Set archive.folder in Settings → Storage and archive.",
    })
  }

  const archiveRoot = resolvePath(options.archiveRoot)
  const indexDir = resolvePath(options.indexDir)
  const file = indexFile({ archiveRoot, indexDir }, side)

  if (!isPathInside(indexDir, file)) {
    return err({
      kind: "path",
      path: file,
      reason: "escape",
      message: "The index file resolves outside the index folder.",
      next: "Keep the archive index inside the workspace.",
    })
  }

  const existing = readExisting({ archiveRoot, indexDir }, side)
  const diagnostics: ArchiveDiagnostic[] = [...existing.diagnostics]

  const discovered = new Map<string, ArchiveEntry>()
  const seenFolders = new Set<string>()

  const record = (kind: (typeof ARCHIVE_KINDS)[number], folder: string, name: string): void => {
    seenFolders.add(name)
    const info = metadata(folder)
    if (!info) {
      diagnostics.push({
        code: "unreadable-folder",
        path: folder,
        message: `The archived item “${name}” has no readable archive.json or meta.json, so it was not indexed.`,
        next: "Its folder was left untouched; add the metadata by hand or remove it outside the app.",
      })
      return
    }
    let archivedAt = info.archivedAt
    if (!archivedAt) {
      try {
        archivedAt = new Date(lstatSync(folder).mtimeMs).toISOString()
      } catch {
        archivedAt = ""
      }
    }
    discovered.set(name, {
      id: name,
      kind,
      title: info.title ?? name,
      tags: info.tags,
      archivedAt,
      sizeBytes: info.sizeBytes,
      backend: "folder",
    })
  }

  const scan = async (kind: (typeof ARCHIVE_KINDS)[number], parent: string): Promise<void> => {
    let dirents
    try {
      dirents = await readdir(parent, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue
      record(kind, join(parent, dirent.name), dirent.name)
    }
  }

  for (const kind of ARCHIVE_KINDS) {
    await scan(kind, join(archiveRoot, side, kind))
  }

  // The session-manager layout (`<side>/<id>/`) is still readable.
  let sideDirents: import("node:fs").Dirent[]
  try {
    sideDirents = await readdir(join(archiveRoot, side), { withFileTypes: true })
  } catch {
    sideDirents = []
  }
  for (const dirent of sideDirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue
    if ((ARCHIVE_KINDS as readonly string[]).includes(dirent.name)) continue
    if (seenFolders.has(dirent.name)) continue
    record("session", join(archiveRoot, side, dirent.name), dirent.name)
  }

  // Entries from another backend cannot be discovered on disk: keep them.
  const preserved: ReadEntry[] = []
  for (const entry of existing.entries) {
    if (entry.entry.backend === "folder") continue
    if (discovered.has(entry.entry.id)) continue
    preserved.push(entry)
  }

  const entries = [...discovered.values(), ...preserved.map((entry) => entry.entry)].sort((a, b) =>
    a.archivedAt < b.archivedAt ? 1 : a.archivedAt > b.archivedAt ? -1 : a.id < b.id ? -1 : 1,
  )

  const backends = [...new Set(entries.map((entry) => entry.backend))].sort() as ArchiveBackendId[]
  const payload = { backends, entries: entries.map((entry) => ({ ...entry })) }
  const text = `${JSON.stringify(payload, null, 2)}\n`

  try {
    await writeFileAtomic(file, text)
  } catch (error) {
    return err({
      kind: "index",
      path: file,
      message: `The archive index could not be rebuilt: ${describe(error)}`,
      next: "Check the workspace is writable; the previous index and every archived item were kept.",
    })
  }

  return ok({
    side,
    path: file,
    entries: entries.length,
    diagnostics,
    bytes: Buffer.byteLength(text, "utf8"),
    preserved: preserved.length,
  })
}

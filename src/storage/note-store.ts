/**
 * Note store service (WP-121).
 *
 * Wires the note domain (`src/domain/note.ts`) to atomic file IO and the
 * rebuildable index (`src/storage/index.ts`) behind the `NoteStore` port in
 * `docs/architecture.md` §4.2.
 *
 * Rules this module enforces:
 *
 * - every path is vault-relative and confined: absolute paths, `..`, and
 *   symlink escapes are refused for read, write, delete and backlinks
 *   (`AGENTS.md` §2.12);
 * - a write is temp file → fsync → rename, and only the frontmatter keys that
 *   actually changed are rewritten — unknown keys and untouched bytes survive;
 * - the index is a cache: a write or delete refreshes it incrementally, and a
 *   failed write leaves both the old bytes and the old index row intact;
 * - no UI, no provider code, no network.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  type Dirent,
} from "node:fs"
import { open, readFile, readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path"

import { err, ok, type Result } from "../domain/markdown"
import {
  parseDocument,
  patchFrontmatter,
  serializeDocument,
  splitDocument,
  type Frontmatter,
  type FrontmatterValue,
} from "../domain/markdown"
import {
  noteFromFrontmatter,
  noteToFrontmatterPreserving,
  type LinkRef,
  type Note,
} from "../domain/note"
import {
  closeIndex,
  openIndex,
  refresh as refreshIndex,
  search as searchIndex,
  type NoteIndex,
  type Side,
  type SyncResult,
} from "./index"
import { isPathInside, type WorkspacePaths } from "./paths"

export type NoteStoreError =
  | {
      kind: "path"
      path: string
      reason: "absolute" | "escape" | "symlink" | "missing" | "not-a-note" | "directory"
      message: string
      next: string
    }
  | {
      kind: "note"
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
      kind: "index"
      path: string
      message: string
      next: string
    }

/** What `read` returns: the entity, its raw frontmatter and the body. */
export type StoredNote = {
  path: string
  note: Note
  data: Frontmatter
  body: string
}

/** What `write` accepts. `note.body` is used unless `body` overrides it. */
export type NoteWrite = {
  path: string
  note: Note
  body?: string
}

export type NoteHit = {
  path: string
  title: string
  snippet: string
  score: number
  /** ISO-8601 from the file mtime the index recorded. */
  updated: string
}

export type WriteOutcome = {
  path: string
  bytes: number
  /** False when the file landed but the index refresh failed (rebuild needed). */
  indexUpdated: boolean
  indexError?: string
}

export type NoteStore = {
  readonly side: Side
  readonly vault: string
  resolve(relative: string): Result<string, NoteStoreError>
  read(relative: string): Promise<Result<StoredNote, NoteStoreError>>
  write(input: NoteWrite): Promise<Result<WriteOutcome, NoteStoreError>>
  delete(relative: string): Promise<Result<{ removed: boolean }, NoteStoreError>>
  search(query: string, limit?: number): Promise<Result<NoteHit[], NoteStoreError>>
  backlinks(relative: string): Promise<Result<LinkRef[], NoteStoreError>>
  refresh(): Promise<Result<SyncResult, NoteStoreError>>
  close(): void
}

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function pathError(
  path: string,
  reason: Extract<NoteStoreError, { kind: "path" }>["reason"],
  message: string,
  next: string,
): NoteStoreError {
  return { kind: "path", path, reason, message, next }
}

function storageError(path: string, error: unknown): NoteStoreError {
  return {
    kind: "storage",
    path,
    message: `The note could not be written: ${describe(error)}`,
    next: "Check the vault is writable; the previous file and index entry were kept.",
  }
}

/* -------------------------------------------------------------------------- */
/* path confinement                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a vault-relative path, refusing anything that leaves the vault.
 *
 * Symlinks are checked twice: the deepest existing ancestor must realpath to a
 * location inside the real vault, and an existing target that is itself a
 * symlink is refused rather than followed.
 */
function resolveInVault(vault: string, relative: string): Result<string, NoteStoreError> {
  if (typeof relative !== "string" || relative.trim() === "") {
    return err(pathError(relative ?? "", "missing", "A note path is required.", "Pass a vault-relative path such as concepts/energy.md."))
  }
  if (isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) {
    return err(
      pathError(
        relative,
        "absolute",
        `“${relative}” is an absolute path; notes are addressed relative to the vault.`,
        "Pass a vault-relative path such as concepts/energy.md.",
      ),
    )
  }

  const segments = relative.split("/")
  if (segments.some((segment) => segment === "..")) {
    return err(
      pathError(relative, "escape", `“${relative}” tries to leave the vault with “..”.`, "Use a path inside the vault; the wall is enforced in code."),
    )
  }

  const absolute = resolvePath(vault, relative)
  if (!isPathInside(vault, absolute) || absolute === resolvePath(vault)) {
    return err(
      pathError(relative, "escape", `“${relative}” resolves outside the vault.`, "Use a path inside the vault; the wall is enforced in code."),
    )
  }
  try {
    if (existsSync(absolute) && statSync(absolute).isDirectory()) {
      return err(
        pathError(relative, "directory", `“${relative}” is a folder, not a note.`, "The store only addresses .md files; folders are managed outside it."),
      )
    }
  } catch {
    // fall through: the checks below will report a readable error
  }

  if (!absolute.endsWith(".md")) {
    return err(
      pathError(relative, "not-a-note", `“${relative}” is not a Markdown note.`, "Notes are .md files inside the vault."),
    )
  }

  // Symlink escapes: check the deepest existing ancestor and the target itself.
  try {
    const realVault = realpathSync(vault)
    let probe = absolute
    while (!existsSync(probe) && probe !== dirname(probe)) probe = dirname(probe)
    const realProbe = realpathSync(probe)
    if (!isPathInside(realVault, realProbe)) {
      return err(
        pathError(relative, "symlink", `“${relative}” escapes the vault through a symlink.`, "Remove the symlink or use a real folder inside the vault."),
      )
    }
    if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
      return err(
        pathError(relative, "symlink", `“${relative}” is a symlink; notes are never written through links.`, "Replace the link with a real file inside the vault."),
      )
    }
  } catch (error) {
    return err({
      kind: "storage",
      path: absolute,
      message: `The vault path could not be checked: ${describe(error)}`,
      next: "Check that the workspace folder exists and is readable.",
    })
  }

  return ok(absolute)
}

/* -------------------------------------------------------------------------- */
/* frontmatter diffing                                                         */
/* -------------------------------------------------------------------------- */

function sameValue(a: FrontmatterValue | undefined, b: FrontmatterValue | undefined): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) =>
      sameValue(
        (a as Record<string, FrontmatterValue>)[key],
        (b as Record<string, FrontmatterValue>)[key],
      ),
    )
  }
  return false
}

/** Only the keys whose value actually changed: everything else stays byte-exact. */
function changedKeys(existing: Frontmatter, desired: Frontmatter): Frontmatter {
  const patch: Frontmatter = {}
  for (const [key, value] of Object.entries(desired)) {
    if (!sameValue(existing[key], value)) patch[key] = value
  }
  return patch
}

/* -------------------------------------------------------------------------- */
/* atomic write                                                               */
/* -------------------------------------------------------------------------- */

async function writeFileAtomic(file: string, text: string): Promise<void> {
  const dir = dirname(file)
  const temp = join(dir, `.${basename(file)}.tmp-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameSync(temp, file)
    return
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // nothing useful to do with a failing close
    }
    try {
      rmSync(temp, { force: true })
    } catch {
      // a leftover temp file is never read back
    }
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* one writer per vault                                                        */
/* -------------------------------------------------------------------------- */

const chains = new Map<string, Promise<void>>()

async function withVaultLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  chains.set(key, chained)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (chains.get(key) === chained) chains.delete(key)
  }
}

/* -------------------------------------------------------------------------- */
/* open / close                                                                */
/* -------------------------------------------------------------------------- */

export function openNoteStore(
  paths: WorkspacePaths,
  side: Side,
): Result<NoteStore, NoteStoreError> {
  const vault = side === "school" ? paths.schoolVault : paths.skillVault
  const opened = openIndex(paths, side)
  if (!opened.ok) {
    return err({
      kind: "index",
      path: side,
      message: opened.error.message,
      next: opened.error.next,
    })
  }
  const index = opened.value

  const store: NoteStore = {
    side,
    vault,

    resolve(relative: string) {
      return resolveInVault(vault, relative)
    },

    async read(relative: string) {
      const resolved = resolveInVault(vault, relative)
      if (!resolved.ok) return resolved

      let text: string
      try {
        text = await readFile(resolved.value, "utf8")
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code === "ENOENT") {
          return err(
            pathError(relative, "missing", `“${relative}” does not exist in the ${side} vault.`, "Check the path, or create the note first."),
          )
        }
        return err({
          kind: "storage",
          path: resolved.value,
          message: `The note could not be read: ${describe(error)}`,
          next: "Check the file permissions and that the disk is readable.",
        })
      }

      const document = splitDocument(text)
      if (!document.closed) {
        return err({
          kind: "note",
          path: relative,
          message: `“${relative}” has an unterminated frontmatter block.`,
          next: "Close the block with --- on its own line; nothing was changed.",
        })
      }

      const parsed = parseDocument(text)
      if (!parsed.ok) {
        return err({
          kind: "note",
          path: relative,
          message: `“${relative}” has invalid frontmatter: ${parsed.error.message}`,
          next: "Fix the frontmatter line; nothing was changed.",
        })
      }

      const note = noteFromFrontmatter(parsed.value.data, parsed.value.body, { side })
      if (!note.ok) {
        return err({
          kind: "note",
          path: relative,
          message: `“${relative}” is not a ${side} note: ${note.error.message}`,
          next: `Use a note of a kind ${side} holds, or open the other side.`,
        })
      }

      return ok({ path: relative, note: note.value, data: parsed.value.data, body: parsed.value.body })
    },

    async write(input: NoteWrite) {
      const resolved = resolveInVault(vault, input.path)
      if (!resolved.ok) return resolved
      if (input.note.side !== side) {
        return err({
          kind: "note",
          path: input.path,
          message: `A ${input.note.side} note cannot be written into the ${side} vault.`,
          next: "Write the note through its own side; the two sides never cross.",
        })
      }

      return withVaultLock(vault, async () => {
        const file = resolved.value
        const exists = existsSync(file)
        if (exists && statSync(file).isDirectory()) {
          return err(pathError(input.path, "directory", `“${input.path}” is a folder, not a note.`, "Delete a folder outside the store; the store only writes files."))
        }

        let existingText: string | null = null
        let existingData: Frontmatter = {}
        if (exists) {
          try {
            existingText = readFileSync(file, "utf8")
          } catch (error) {
            return err({
              kind: "storage",
              path: file,
              message: `The existing note could not be read: ${describe(error)}`,
              next: "Check the file permissions; nothing was overwritten.",
            })
          }
          const parsed = parseDocument(existingText)
          if (!parsed.ok) {
            return err({
              kind: "note",
              path: input.path,
              message: `“${input.path}” has invalid frontmatter: ${parsed.error.message}`,
              next: "Fix the frontmatter before saving; nothing was overwritten.",
            })
          }
          existingData = parsed.value.data
        }

        const body = input.body ?? input.note.body
        const merged = noteToFrontmatterPreserving(input.note, existingData)
        const patch = changedKeys(existingData, merged)

        // Refuse a silent shape change (scalar -> list, list -> scalar). This
        // parser reads block lists only, so an inline `[a, b]` arrives as a
        // string; rewriting it from the entity would delete the user's text.
        const shape = (value: FrontmatterValue | undefined): string =>
          value === undefined || value === null
            ? "empty"
            : Array.isArray(value)
              ? "list"
              : typeof value === "object"
                ? "map"
                : "scalar"
        const reshaped = Object.keys(patch).filter(
          (key) => existingData[key] !== undefined && shape(existingData[key]) !== shape(patch[key]),
        )
        if (reshaped.length > 0) {
          return err({
            kind: "note",
            path: input.path,
            message: `“${input.path}” holds ${reshaped.join(", ")} in a different shape than this build writes.`,
            next:
              "Fix the frontmatter by hand (this build reads block lists such as `tags:` with `- item` lines, not inline [a, b]); nothing was written.",
          })
        }

        let text: string
        if (existingText === null) {
          text = serializeDocument(merged, body)
        } else {
          // Patch only the changed keys, then replace the body if it changed.
          let working = existingText
          if (Object.keys(patch).length > 0) {
            const patched = patchFrontmatter(existingText, patch)
            if (!patched.ok) {
              return err({
                kind: "note",
                path: input.path,
                message: `“${input.path}” could not be updated: ${patched.error.message}`,
                next: "Fix the frontmatter line; nothing was overwritten.",
              })
            }
            working = patched.value
          }
          const existingBody = splitDocument(existingText).body
          if (existingBody === body) {
            text = working
          } else {
            const document = splitDocument(working)
            const eol = splitDocument(existingText).eol
            const combined =
              document.frontmatter === null
                ? body
                : `---\n${document.frontmatter}\n---\n${body}`
            text = eol === "\n" ? combined : combined.replace(/\n/g, eol)
          }
        }

        try {
          await writeFileAtomic(file, text)
        } catch (error) {
          return err(storageError(input.path, error))
        }

        const refreshed = refreshIndex(index)
        return ok({
          path: input.path,
          bytes: Buffer.byteLength(text, "utf8"),
          indexUpdated: refreshed.ok,
          indexError: refreshed.ok ? undefined : refreshed.error.message,
        })
      })
    },

    async delete(relative: string) {
      const resolved = resolveInVault(vault, relative)
      if (!resolved.ok) return resolved
      const file = resolved.value

      return withVaultLock(vault, async () => {
        let stats
        try {
          stats = lstatSync(file)
        } catch {
          return err(
            pathError(relative, "missing", `“${relative}” does not exist in the ${side} vault.`, "Nothing to delete; check the path."),
          )
        }
        if (stats.isDirectory()) {
          return err(
            pathError(relative, "directory", `“${relative}” is a folder. The store only deletes notes.`, "Remove folders yourself, outside the app."),
          )
        }

        try {
          unlinkSync(file)
        } catch (error) {
          return err({
            kind: "storage",
            path: file,
            message: `The note could not be deleted: ${describe(error)}`,
            next: "Check the file permissions; the note is still there.",
          })
        }

        // Best effort: the row is dropped on the next refresh even if this fails.
        refreshIndex(index)
        return ok({ removed: true })
      })
    },

    async search(query: string, limit = 10) {
      const hits = searchIndex(index, query, limit)
      if (!hits.ok) {
        return err({
          kind: "index",
          path: side,
          message: hits.error.message,
          next: hits.error.next,
        })
      }

      const updatedAt = index.db.query("SELECT mtime FROM notes WHERE path = ?")
      const withMeta: NoteHit[] = hits.value.map((hit) => {
        const row = updatedAt.get(hit.path) as { mtime: number } | null
        return {
          path: hit.path,
          title: hit.title,
          snippet: hit.snippet,
          score: hit.score,
          updated: new Date(row?.mtime ?? 0).toISOString(),
        }
      })
      return ok(withMeta)
    },

    async backlinks(relative: string) {
      const resolved = resolveInVault(vault, relative)
      if (!resolved.ok) return resolved
      const fromVault = relative.replace(/^\.\//, "")

      try {
        const rows = index.db
          .query(
            "SELECT from_path, to_path FROM links WHERE to_path = ? AND broken = 0 ORDER BY from_path",
          )
          .all(fromVault) as Array<{ from_path: string; to_path: string }>
        return ok(
          rows.map((row) => ({
            from: row.from_path,
            to: row.to_path,
            // The links table stores only from/to/broken; heading and alias are
            // display metadata the reader re-reads from the source note.
            heading: null,
            alias: null,
            broken: false,
          })),
        )
      } catch (error) {
        return err({
          kind: "index",
          path: side,
          message: `Backlinks could not be read: ${describe(error)}`,
          next: "Rebuild the index — it is a cache and no note was touched.",
        })
      }
    },

    async refresh() {
      const refreshed = refreshIndex(index)
      if (!refreshed.ok) {
        return err({
          kind: "index",
          path: side,
          message: refreshed.error.message,
          next: refreshed.error.next,
        })
      }
      return ok(refreshed.value)
    },

    close() {
      closeIndex(index)
    },
  }

  return ok(store)
}

/** List note paths in the vault, sorted. Read-only helper for managers. */
export async function listNotes(vault: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(abs, rel)
      else if (entry.name.endsWith(".md")) out.push(rel)
    }
  }
  await walk(vault, "")
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return out
}

export type { NoteIndex }

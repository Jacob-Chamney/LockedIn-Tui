/**
 * Extraction cache.
 *
 * `searchSources` re-extracts every source on every call (WP-406 handoff, known
 * gap), so the same PDF is spawned through `pdftotext` again and again. This
 * caches extracted text by **content hash plus extractor id**, so a changed file
 * is a miss and a new extractor version is a miss — never a stale hit.
 *
 * The cache lives under the app data directory, never in the workspace: it is
 * derived data, it must never appear in a zip, and deleting it is always safe.
 * Every failure is a diagnostic and a fall-through to extraction — a broken
 * cache must never be visible to the user as a failed search.
 */

import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"

/** Bump when extraction output changes shape; old entries then miss. */
export const EXTRACTOR_ID = "extract-v1"

/** 64 MiB, as the packet specifies. */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

export type CacheDiagnostic = {
  kind: "cache"
  /** `read`, `write`, `corrupt` or `evict`. */
  code: "read" | "write" | "corrupt" | "evict"
  path: string
  message: string
}

export type CacheEntry = {
  /** `sha256:<hex>` of the cached file's bytes. */
  hash: string
  /** Extractor that produced the text; a mismatch is a miss. */
  extractor: string
  text: string
  bytes: number
  /** ISO timestamp of when the entry was written, for eviction order. */
  writtenAt: string
}

export type ExtractionCache = {
  /** Absolute directory holding the entries; asserted to be outside the workspace. */
  readonly root: string
  readonly extractor: string
  readonly maxBytes: number
  /** Cached text, or null on a miss. Never throws. */
  get(hash: string): Promise<string | null>
  /** Store text for a hash. Never throws; failures are diagnostics. */
  set(hash: string, text: string): Promise<void>
  /** Bytes currently stored. */
  size(): Promise<number>
}

export type CacheOptions = {
  /** App data directory (never the workspace). */
  dataDir: string
  maxBytes?: number
  extractor?: string
  /** Where diagnostics go; defaults to dropping them. */
  onDiagnostic?: (diagnostic: CacheDiagnostic) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fileNameFor(hash: string): string {
  // `sha256:abc…` -> `abc….json`: the prefix is constant and the colon is not
  // a safe filename character on every platform.
  return `${hash.replace(/^sha256:/, "").replace(/[^0-9a-f]/gi, "")}.json`
}

/**
 * Build a cache rooted at `<dataDir>/cache/extract`.
 *
 * Nothing here reads the clock for correctness: `writtenAt` is informational and
 * eviction order comes from mtime, so a test can control both by writing files.
 */
export function createExtractionCache(options: CacheOptions): ExtractionCache {
  const extractor = options.extractor ?? EXTRACTOR_ID
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const root = join(options.dataDir, "cache", "extract")
  const report = options.onDiagnostic ?? (() => {})

  const pathFor = (hash: string) => join(root, fileNameFor(hash))

  const size = async (): Promise<number> => {
    let total = 0
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return 0
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      try {
        total += (await stat(join(root, name))).size
      } catch {
        // A file that vanished mid-walk contributes nothing.
      }
    }
    return total
  }

  const evict = async (keepName: string | null): Promise<void> => {
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return
    }

    const entries: Array<{ name: string; path: string; size: number; mtimeMs: number }> = []
    for (const name of names) {
      if (!name.endsWith(".json")) continue
      const path = join(root, name)
      try {
        const info = await stat(path)
        entries.push({ name, path, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        continue
      }
    }

    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    if (total <= maxBytes) return

    // Oldest first, and never the entry just written: it is about to be read.
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.name < b.name ? -1 : 1))
    for (const entry of entries) {
      if (total <= maxBytes) break
      if (entry.name === keepName) continue
      try {
        await rm(entry.path, { force: true })
        total -= entry.size
        report({ kind: "cache", code: "evict", path: entry.path, message: "evicted to stay under the bound" })
      } catch (error) {
        report({ kind: "cache", code: "evict", path: entry.path, message: messageOf(error) })
      }
    }
  }

  return {
    root,
    extractor,
    maxBytes,

    async get(hash: string) {
      const path = pathFor(hash)
      let raw: string
      try {
        raw = await readFile(path, "utf8")
      } catch (error) {
        // A miss is not a diagnostic: the file simply is not cached yet.
        const code = (error as { code?: string }).code
        if (code !== "ENOENT") {
          report({ kind: "cache", code: "read", path, message: messageOf(error) })
        }
        return null
      }

      try {
        const entry = JSON.parse(raw) as Partial<CacheEntry>
        if (
          entry.hash !== hash ||
          entry.extractor !== extractor ||
          typeof entry.text !== "string" ||
          typeof entry.bytes !== "number" ||
          entry.bytes !== Buffer.byteLength(entry.text)
        ) {
          report({
            kind: "cache",
            code: "corrupt",
            path,
            message: "entry does not match its key, extractor or byte length",
          })
          return null
        }
        return entry.text
      } catch (error) {
        report({ kind: "cache", code: "corrupt", path, message: messageOf(error) })
        return null
      }
    },

    async set(hash: string, text: string) {
      const path = pathFor(hash)
      const entry: CacheEntry = {
        hash,
        extractor,
        text,
        bytes: Buffer.byteLength(text),
        writtenAt: new Date(0).toISOString(),
      }

      try {
        await mkdir(root, { recursive: true })
        const temporary = `${path}.tmp-${crypto.randomUUID()}`
        await Bun.write(temporary, JSON.stringify(entry))
        await rename(temporary, path)
      } catch (error) {
        report({ kind: "cache", code: "write", path, message: messageOf(error) })
        return
      }

      await evict(fileNameFor(hash))
    },

    size,
  }
}

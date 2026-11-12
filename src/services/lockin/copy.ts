/**
 * Streaming source copy for the lock-in creation transaction.
 *
 * The copy is the moment a session stops following the user's files: after it,
 * editing the original changes nothing in the session (`docs/product.md` §4.2).
 *
 * Rules:
 * - streamed, never read whole into memory, and the SHA-256 is computed while
 *   writing rather than in a second pass;
 * - the stored name comes from `storedPathFor()`, so it is inside `sources/`;
 * - identical content is copied once (hash de-duplication) and the duplicate
 *   copy is deleted rather than kept;
 * - a failure unlinks its partial file, so nothing half-written survives.
 */

import { rename, rm, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { SOURCE_DIRECTORY, classifySource, storedPathFor, type Source } from "../../domain/source"

export type CopyError =
  | { kind: "storage"; path: string; message: string }
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }

export type CopyOutcome = {
  source: Source
  /** True when identical content was already copied; nothing new was written. */
  duplicate: boolean
}

export type CopyOptions = {
  /** Absolute path of the original file. */
  original: string
  /** Absolute path of the session's `sources/` directory. */
  sourcesDir: string
  /** Hashes already copied, mapped to their sources. */
  copied?: ReadonlyMap<string, Source>
  /**
   * Called once per streamed chunk. Throwing aborts the copy, which is how a
   * test injects a mid-copy failure without patching node internals.
   */
  onChunk?: (index: number) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Stream a file through a hasher and a sink, without buffering it. */
async function streamCopy(
  original: string,
  target: string,
  onChunk?: (index: number) => void,
): Promise<string> {
  const reader = Bun.file(original).stream().getReader()
  const sink = Bun.file(target).writer()
  const hasher = new Bun.CryptoHasher("sha256")
  let index = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk?.(index)
      hasher.update(value)
      sink.write(value)
      index++
    }
    await sink.end()
  } catch (error) {
    try {
      await sink.end()
    } catch {
      // The partial file is removed by the caller; a failed flush is expected.
    }
    throw error
  }

  return `sha256:${hasher.digest("hex")}`
}

/**
 * Copy one file into `sourcesDir` and return the `Source` that describes it.
 * The stored path is relative to the session folder, never absolute.
 */
export async function copySource(
  options: CopyOptions,
): Promise<Result<CopyOutcome, CopyError>> {
  const name = basename(options.original)
  const partial = join(options.sourcesDir, `.partial-${crypto.randomUUID()}`)

  // A pipe or device would make the stream block forever. A symlink to a
  // regular file is still fine: `stat` follows it, and the picker already
  // refused links that leave their root.
  const info = await stat(options.original).catch(() => null)
  if (info !== null && !info.isFile()) {
    return err({
      kind: "path",
      path: options.original,
      reason: "missing",
      message: `${name} is not a regular file, so it cannot become a source`,
    })
  }

  let hash: string
  try {
    hash = await streamCopy(options.original, partial, options.onChunk)
  } catch (error) {
    await rm(partial, { force: true })
    return err({
      kind: "storage",
      path: options.original,
      message: `copying ${name} failed: ${messageOf(error)}`,
    })
  }

  const existing = options.copied?.get(hash)
  if (existing) {
    await rm(partial, { force: true })
    return ok({ source: existing, duplicate: true })
  }

  const storedPath = storedPathFor(name, hash)
  const finalPath = join(options.sourcesDir, basename(storedPath))

  try {
    await rename(partial, finalPath)
  } catch (error) {
    await rm(partial, { force: true })
    return err({
      kind: "storage",
      path: finalPath,
      message: `could not place ${name} in ${SOURCE_DIRECTORY}/: ${messageOf(error)}`,
    })
  }

  return ok({
    source: { originalPath: options.original, storedPath, name, hash, kind: classifySource(name) },
    duplicate: false,
  })
}

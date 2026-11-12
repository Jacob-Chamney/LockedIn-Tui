/**
 * Deterministic zip writing for session export (ADR 0003).
 *
 * `fflate` is the only archive dependency. Two rules make an export verifiable:
 * entries are sorted by path, and every timestamp is pinned to the zip epoch,
 * so the same input directory produces the same bytes every time.
 */

import { unzipSync, zipSync, type Zippable } from "fflate"

/** 1980-01-01T00:00:00Z, the earliest timestamp the zip format can store. */
export const ZIP_EPOCH_MS = Date.UTC(1980, 0, 1)

export type ZipInput = { name: string; data: Uint8Array }

export type ZipError = { kind: "zip"; message: string }

function isZipError(error: unknown): ZipError {
  return { kind: "zip", message: error instanceof Error ? error.message : String(error) }
}

/**
 * Write a zip from explicit entries.
 * Sorted by name, fixed timestamps, deflate level 6: byte-stable for a given
 * input, which is what the acceptance criterion asks for.
 */
export function writeZip(entries: readonly ZipInput[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const bundle: Zippable = {}
  for (const entry of sorted) {
    bundle[entry.name] = [entry.data, { mtime: ZIP_EPOCH_MS, level: 6 }]
  }
  return zipSync(bundle)
}

/** Read a zip back into its entries. Used by tests and by restore checks. */
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

/** Entry names in stored order. */
export function listZip(bytes: Uint8Array): string[] {
  return Object.keys(readZip(bytes)).sort()
}

export { isZipError }

/**
 * Source value object for a lock-in session.
 *
 * A source is a *copy* that lives under the session's `sources/` folder
 * (`docs/product.md` §4.2). This module defines the value and its rules; it
 * never copies, reads or writes a file — storage owns that.
 *
 * Rules enforced here:
 * - a stored path must stay inside `sources/` (the wall against traversal);
 * - any regular file may be a source; text-bearing kinds are read as text;
 * - two sources with the same content hash are one source;
 * - order is insertion order and never sorted behind the caller's back.
 */

import { err, ok, type Result } from "./markdown"

export type SourceKind = "markdown" | "text" | "code" | "pdf" | "docx" | "image" | "other"

/** Kinds that can be read as text and therefore used as a source. */
export const TEXT_SOURCE_KINDS: readonly SourceKind[] = [
  "markdown",
  "text",
  "code",
  "pdf",
  "docx",
  "other",
]

export const SOURCE_KINDS: readonly SourceKind[] = [...TEXT_SOURCE_KINDS, "image"]

/** Folder inside a session that holds the copies. */
export const SOURCE_DIRECTORY = "sources"

export type Source = {
  /** Where the user picked it. Informational only; never read back. */
  originalPath: string
  /** Relative to the session folder, always under `sources/`. */
  storedPath: string
  name: string
  /** `sha256:<64 hex>` — the de-duplication key. */
  hash: string
  kind: SourceKind
}

export type SourceError =
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "unsupported"; name: string; detected: SourceKind; message: string }
  | { kind: "storage"; path: string; message: string }

/**
 * The one extension table.
 *
 * WP-142: this used to exist twice — here and in `src/services/extract/` — and
 * the copies drifted, so one file could be "markdown" to the domain and "text"
 * to the extractor. Every consumer now reads this table through
 * `classifySource()`; there is no second list anywhere in `src/`.
 *
 * Kinds follow `docs/architecture.md` §3.2. An unknown extension yields
 * `"other"`: it is still a valid source and is read as UTF-8 text when possible.
 * There is no content-sniff fallback, because guessing a kind from bytes makes
 * storage unstable.
 */
export const SOURCE_KIND_BY_EXTENSION: Readonly<Record<string, SourceKind>> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  text: "text",
  rst: "text",
  pdf: "pdf",
  docx: "docx",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  avif: "image",
  heic: "image",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  rs: "code",
  go: "code",
  c: "code",
  h: "code",
  cc: "code",
  cpp: "code",
  hpp: "code",
  java: "code",
  kt: "code",
  rb: "code",
  php: "code",
  swift: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  sql: "code",
  json: "code",
  jsonl: "code",
  toml: "code",
  yaml: "code",
  yml: "code",
  ini: "code",
  css: "code",
  html: "code",
  xml: "code",
}

/** Extensions the product documents, for the table test. */
export const SOURCE_EXTENSIONS: readonly string[] = Object.keys(SOURCE_KIND_BY_EXTENSION)

const HASH = /^sha256:[0-9a-f]{64}$/

export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".")
  return at <= 0 ? "" : name.slice(at + 1).toLowerCase()
}

/**
 * Classify by extension.
 *
 * The single classifier in the codebase (WP-142). Content sniffing is
 * deliberately absent: a kind that depends on bytes would change when a user
 * edits a file, and every index and preview would need rewriting.
 */
export function classifySource(name: string): SourceKind {
  return SOURCE_KIND_BY_EXTENSION[extensionOf(name)] ?? "other"
}

export function isTextSourceKind(kind: SourceKind): boolean {
  return TEXT_SOURCE_KINDS.includes(kind)
}

export function isSourceHash(value: string): boolean {
  return HASH.test(value)
}

/** Last path segment, with any separator style handled. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** Filesystem-safe copy name. Keeps the extension so the kind still reads. */
export function safeSourceName(name: string): string {
  const base = baseName(name)
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  // A dot-only name is either the current directory or a traversal fragment.
  if (cleaned === "" || /^\.+$/.test(cleaned)) return "source"
  return cleaned.slice(0, 120)
}

/**
 * Where a copy lives inside the session.
 *
 * Two files with the same name but different content would overwrite each
 * other, so the name is prefixed with a short content hash when one is given.
 * The result is stable for the same bytes.
 */
export function storedPathFor(name: string, hash?: string): string {
  const safe = safeSourceName(name)
  if (hash === undefined) return `${SOURCE_DIRECTORY}/${safe}`
  if (!isSourceHash(hash)) return `${SOURCE_DIRECTORY}/${safe}`
  const short = hash.slice("sha256:".length, "sha256:".length + 8)
  return `${SOURCE_DIRECTORY}/${short}-${safe}`
}

/**
 * True when a stored path is a relative path strictly inside `sources/`.
 * Absolute paths, `..` segments, `.` segments, backslashes and empty segments
 * are all refused.
 */
export function isInsideSources(storedPath: string): boolean {
  if (storedPath === "" || storedPath.startsWith("/") || storedPath.includes("\\")) return false
  if (/^[A-Za-z]:/.test(storedPath)) return false
  const parts = storedPath.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false
  return parts[0] === SOURCE_DIRECTORY && parts.length > 1
}

export type MakeSourceInput = {
  originalPath: string
  name?: string
  hash: string
  kind?: SourceKind
  storedPath?: string
}

/**
 * Build and validate a source.
 * The kind defaults to the extension of the name; the stored path defaults to
 * `sources/<hash8>-<safe-name>`.
 */
export function makeSource(input: MakeSourceInput): Result<Source, SourceError> {
  const name = input.name ?? baseName(input.originalPath)
  if (name.trim() === "") {
    return err({ kind: "path", path: input.originalPath, reason: "missing", message: "a source needs a file name" })
  }

  const kind = input.kind ?? classifySource(name)

  if (!isSourceHash(input.hash)) {
    return err({
      kind: "storage",
      path: input.originalPath,
      message: `source hash must look like "sha256:<64 hex>", got "${input.hash}"`,
    })
  }

  const storedPath = input.storedPath ?? storedPathFor(name, input.hash)
  if (!isInsideSources(storedPath)) {
    return err({
      kind: "path",
      path: storedPath,
      reason: "escape",
      message:
        `source copies must stay inside "${SOURCE_DIRECTORY}/"; "${storedPath}" ` +
        "is absolute or climbs out of the session folder",
    })
  }

  return ok({ originalPath: input.originalPath, storedPath, name, hash: input.hash, kind })
}

/**
 * Append a source unless a source with the same content hash already exists.
 * A duplicate is a no-op, not an error: adding the same lecture twice is a
 * user action with nothing to report. Order is preserved.
 */
export function addSource(
  sources: readonly Source[],
  incoming: Source,
): Result<{ sources: Source[]; added: boolean }, SourceError> {
  const checked = makeSource({
    originalPath: incoming.originalPath,
    name: incoming.name,
    hash: incoming.hash,
    kind: incoming.kind,
    storedPath: incoming.storedPath,
  })
  if (!checked.ok) return checked

  if (sources.some((source) => source.hash === incoming.hash)) {
    return ok({ sources: [...sources], added: false })
  }
  return ok({ sources: [...sources, incoming], added: true })
}

/** Add several sources in order, applying the same de-duplication. */
export function addSources(
  sources: readonly Source[],
  incoming: readonly Source[],
): { sources: Source[]; added: number } {
  let current = [...sources]
  let added = 0
  for (const source of incoming) {
    const result = addSource(current, source)
    if (!result.ok) continue
    current = result.value.sources
    if (result.value.added) added++
  }
  return { sources: current, added }
}

/** True when two source lists hold the same hashes in the same order. */
export function sameSources(a: readonly Source[], b: readonly Source[]): boolean {
  if (a.length !== b.length) return false
  return a.every((source, index) => source.hash === b[index]?.hash)
}

export type ProgressTarget = {
  /** Source name as shown in the source list. */
  name: string
  /** Stable label used by coverage and review; disambiguated by hash. */
  display: string
  hash: string
}

/**
 * Map source names to stable display names for source coverage.
 *
 * A name is stable for a source: it never changes when other sources are added
 * or removed. Duplicated names are disambiguated with the short content hash,
 * which is content-addressed and therefore stable too.
 */
export function progressTargets(sources: readonly Source[]): ProgressTarget[] {
  const counts = new Map<string, number>()
  for (const source of sources) counts.set(source.name, (counts.get(source.name) ?? 0) + 1)

  return sources.map((source) => {
    const duplicated = (counts.get(source.name) ?? 0) > 1
    return {
      name: source.name,
      display: duplicated ? `${source.name} (${source.hash.slice(7, 15)})` : source.name,
      hash: source.hash,
    }
  })
}

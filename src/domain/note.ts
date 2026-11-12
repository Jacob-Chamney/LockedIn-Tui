/**
 * Note, excerpt and source entities, plus the rules that must not depend on the
 * renderer: note kinds per side, slugs and collisions, excerpt caps, and the
 * wall between `school` and `skills`.
 *
 * No file IO, no UI, no provider code. Every rule that can fail returns a typed
 * error from `MarkdownError` rather than throwing or silently repairing.
 */

import {
  err,
  extractWikilinks,
  ok,
  readString,
  readStringArray,
  serializeFrontmatter,
  type Frontmatter,
  type MarkdownError,
  type Result,
  type Side,
  type Wikilink,
} from "./markdown"

export type { Side } from "./markdown"

export type NoteKind = "concept" | "course" | "goal" | "knowledge" | "session-summary" | "source"

export const NOTE_KINDS: readonly NoteKind[] = [
  "concept",
  "course",
  "goal",
  "knowledge",
  "session-summary",
  "source",
]

/** Kinds each side may hold. `docs/data-model.md` §1 fixes the folders. */
export const KINDS_BY_SIDE: Record<Side, readonly NoteKind[]> = {
  school: ["concept", "course", "knowledge", "session-summary", "source"],
  skills: ["goal", "knowledge", "source"],
}

const KIND_DIRECTORY: Record<NoteKind, string> = {
  concept: "concepts",
  course: "courses",
  goal: "goals",
  knowledge: "knowledge",
  "session-summary": "sessions",
  source: "sources",
}

export type Excerpt = {
  sourceName: string
  location: string
  /** `sha256:…` over the excerpt identity; this is the de-duplication key. */
  hash: string
  text: string
}

export type Source = {
  /** Informational only: reads use `storedPath` inside the session. */
  originalPath: string
  storedPath: string
  name: string
  hash: string
  kind: "markdown" | "text" | "code" | "pdf" | "docx" | "image" | "other"
}

export type Note = {
  id: string
  side: Side
  type: NoteKind
  title: string
  /** Markdown body, verbatim, without frontmatter. */
  body: string
  /** Wikilink targets, same side only. */
  links: string[]
  tags: string[]
  excerpt?: Excerpt
  created: string
  updated: string
}

export type LinkRef = {
  from: string
  to: string
  heading: string | null
  alias: string | null
  /** True when the target does not exist on this side. */
  broken: boolean
}

export const DEFAULT_EXCERPT_CHARS = 400
export const MAX_SLUG_LENGTH = 64

// ------------------------------------------------------------------ slugs

/**
 * Lowercase ASCII slug. Accents are folded, everything else collapses to `-`,
 * so "Physics — Unit 4" becomes "physics-unit-4". Never returns "".
 */
export function slugify(input: string, maxLength = MAX_SLUG_LENGTH): string {
  const folded = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const capped = folded.slice(0, maxLength).replace(/-+$/, "")
  return capped === "" ? "note" : capped
}

/**
 * First free slug in `base`, `base-2`, `base-3`, … order.
 * The result depends only on `base` and the taken set, so two runs over the
 * same state produce the same name.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const root = slugify(base)
  if (!used.has(root)) return root
  for (let suffix = 2; ; suffix++) {
    const candidate = `${root.slice(0, MAX_SLUG_LENGTH - String(suffix).length - 1)}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

/** Relative vault path for a note, e.g. `concepts/energy-balance.md`. */
export function noteRelativePath(
  side: Side,
  kind: NoteKind,
  slug: string,
): Result<string, MarkdownError> {
  if (!KINDS_BY_SIDE[side].includes(kind)) {
    return err({
      kind: "frontmatter-invalid",
      line: 1,
      message: `a ${side} note cannot be of kind "${kind}"; ${side} holds ${KINDS_BY_SIDE[
        side
      ].join(", ")}`,
    })
  }
  return ok(`${KIND_DIRECTORY[kind]}/${slugify(slug)}.md`)
}

// ------------------------------------------------------------------ excerpts

function excerptHash(sourceName: string, location: string, text: string): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(`${sourceName}\u0000${location}\u0000${text}`)
    .digest("hex")
  return `sha256:${digest}`
}

/**
 * Build an excerpt, capped at `chars` characters (default 400).
 * The hash covers the *full* text, so two excerpts of the same passage
 * de-duplicate even when the cap differs between callers.
 */
export function makeExcerpt(input: {
  sourceName: string
  location: string
  text: string
  chars?: number
}): Excerpt {
  const cap = input.chars ?? DEFAULT_EXCERPT_CHARS
  if (!Number.isInteger(cap) || cap <= 0) {
    throw new RangeError(`excerpt cap must be a positive integer, got ${cap}`)
  }
  return {
    sourceName: input.sourceName,
    location: input.location,
    hash: excerptHash(input.sourceName, input.location, input.text),
    text: input.text.slice(0, cap),
  }
}

/** Keep the first excerpt for each hash; order is preserved. */
export function dedupeExcerpts(excerpts: readonly Excerpt[]): Excerpt[] {
  const seen = new Set<string>()
  const out: Excerpt[] = []
  for (const excerpt of excerpts) {
    if (seen.has(excerpt.hash)) continue
    seen.add(excerpt.hash)
    out.push(excerpt)
  }
  return out
}

// ------------------------------------------------------------------ the wall

export function isKindAllowed(side: Side, kind: NoteKind): boolean {
  return KINDS_BY_SIDE[side].includes(kind)
}

/**
 * Build a link reference from one note to another.
 * A link to the other side is rejected: the wall is enforced here, not in the
 * UI and not in a prompt.
 */
export function linkNote(
  from: Pick<Note, "id" | "side">,
  to: Pick<Note, "id" | "side">,
  options: { heading?: string | null; alias?: string | null; broken?: boolean } = {},
): Result<LinkRef, MarkdownError> {
  if (from.side !== to.side) {
    return err({
      kind: "cross-side-link",
      from: from.side,
      to: to.side,
      target: to.id,
      message: `a ${from.side} note cannot link to ${to.side} note "${to.id}": the two sides never cross`,
    })
  }
  return ok({
    from: from.id,
    to: to.id,
    heading: options.heading ?? null,
    alias: options.alias ?? null,
    broken: options.broken ?? false,
  })
}

/** Wikilinks in a note body resolved against the same side only. */
export function resolveNoteLinks(
  note: Pick<Note, "id" | "side" | "body">,
  exists: (target: string) => boolean,
): Result<LinkRef[], MarkdownError> {
  const links = extractWikilinks(note.body)
  const refs: LinkRef[] = []
  for (const link of links) {
    const ref = linkNote(note, { id: link.target, side: note.side }, {
      heading: link.heading,
      alias: link.alias,
      broken: !exists(link.target),
    })
    if (!ref.ok) return ref
    refs.push(ref.value)
  }
  return ok(refs)
}

/** Distinct link targets in a note body, preserving document order. */
export function linkTargets(body: string): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  for (const link of extractWikilinks(body)) {
    if (seen.has(link.target)) continue
    seen.add(link.target)
    targets.push(link.target)
  }
  return targets
}

// ------------------------------------------------------------------ frontmatter

/**
 * Note frontmatter as written to disk. Unknown keys must be preserved, so
 * callers pass the parsed record through `noteFromFrontmatter` and back rather
 * than rebuilding it from the entity.
 */
export type NoteFrontmatter = Frontmatter

export function noteToFrontmatter(note: Note): NoteFrontmatter {
  const data: NoteFrontmatter = {
    id: note.id,
    side: note.side,
    type: note.type,
    title: note.title,
    tags: [...note.tags],
    links: [...note.links],
    created: note.created,
    updated: note.updated,
  }
  if (note.excerpt) {
    data.excerpt = {
      source: note.excerpt.sourceName,
      location: note.excerpt.location,
      hash: note.excerpt.hash,
      text: note.excerpt.text,
    }
  }
  return data
}

/** Merge a note into an existing record so unknown keys survive a save. */
export function noteToFrontmatterPreserving(note: Note, existing: Frontmatter): NoteFrontmatter {
  return { ...existing, ...noteToFrontmatter(note) }
}

export type ParseNoteOptions = {
  /** Required when the frontmatter has no `side`. */
  side?: Side
}

/** Build a `Note` from a parsed frontmatter record. */
export function noteFromFrontmatter(
  data: Frontmatter,
  body: string,
  options: ParseNoteOptions = {},
): Result<Note, MarkdownError> {
  const side = (readString(data, "side") ?? options.side ?? null) as Side | null
  if (side !== "school" && side !== "skills") {
    return err({
      kind: "frontmatter-invalid",
      line: 1,
      message: `note frontmatter needs side = "school" or "skills", got ${JSON.stringify(
        data.side ?? null,
      )}`,
    })
  }

  const rawType = readString(data, "type")
  const type = (rawType ?? "concept") as NoteKind
  if (!NOTE_KINDS.includes(type)) {
    return err({
      kind: "frontmatter-invalid",
      line: 1,
      message: `unknown note type "${rawType}"; expected one of ${NOTE_KINDS.join(", ")}`,
    })
  }
  if (!isKindAllowed(side, type)) {
    return err({
      kind: "frontmatter-invalid",
      line: 1,
      message: `a ${side} note cannot be of kind "${type}"; ${side} holds ${KINDS_BY_SIDE[
        side
      ].join(", ")}`,
    })
  }

  const title = readString(data, "title") ?? ""
  const id = readString(data, "id") ?? slugify(title)
  const excerpt = readExcerpt(data)

  return ok({
    id,
    side,
    type,
    title,
    body,
    links: readStringArray(data, "links"),
    tags: readStringArray(data, "tags"),
    ...(excerpt ? { excerpt } : {}),
    created: readString(data, "created") ?? "",
    updated: readString(data, "updated") ?? "",
  })
}

function readExcerpt(data: Frontmatter): Excerpt | undefined {
  const value = data.excerpt
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const source = typeof value.source === "string" ? value.source : ""
  const location = typeof value.location === "string" ? value.location : ""
  const text = typeof value.text === "string" ? value.text : ""
  const hash = typeof value.hash === "string" ? value.hash : excerptHash(source, location, text)
  if (source === "" && text === "") return undefined
  return { sourceName: source, location, hash, text }
}

/** Serialize a note's frontmatter block; the body is written by the caller. */
export function noteFrontmatterBlock(note: Note, existing: Frontmatter = {}): string {
  return serializeFrontmatter(noteToFrontmatterPreserving(note, existing))
}

/** All wikilinks in a body, for coverage and backlink computation. */
export function noteWikilinks(body: string): Wikilink[] {
  return extractWikilinks(body)
}

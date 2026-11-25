/**
 * Mistakes: record one, list the ledger, and promote an entry into a note.
 *
 * A lock-in session's `misconceptions.md` is the record of what the learner got
 * wrong. It is append-only process history, never a source. This service is the
 * only path that turns one entry into something durable — a **labelled
 * knowledge note** in the school vault, carrying the session, the entry and the
 * step it came from, so the knowledge base can show it with provenance and
 * `knowledge.read` can open it like any other note.
 *
 * Promotion is idempotent: the note records `origin: session-mistake`,
 * `session` and `premise_index`, and a second promotion of the same entry
 * returns that note instead of writing a duplicate.
 *
 * Writes are the note store's atomic replace (temp → fsync → rename). A failure
 * leaves the ledger and the vault exactly as they were. No network, no model.
 */

import { mkdir, readFile } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"

import {
  err,
  ok,
  parseDocument,
  patchFrontmatter,
  readString,
  serializeFrontmatter,
  type Result,
} from "../../domain/markdown"
import {
  MAX_CORRECTION_CHARS,
  MAX_MISTAKE_CHARS,
  MISTAKE_ORIGIN,
  MISTAKE_TAG,
  MISTAKE_TOPIC,
  mistakeBody,
  mistakeTitle,
  normaliseMistake,
  parseMistakes,
  replaceCorrection,
  type MistakeEntry,
} from "../../domain/mistakes"
import { slugify, uniqueSlug, type Note } from "../../domain/note"
import type { Workspace } from "../../storage/workspace"
import { listNotes, openNoteStore } from "../../storage/note-store"
import { appendMisconception, readSessionFile, writeSessionFile } from "./insights"
import { openSession } from "./manager"

export type MistakeError =
  | { kind: "invalid"; message: string }
  | { kind: "storage"; path: string; message: string }

/** A promoted note, addressed the way `knowledge.read` addresses a note. */
export type PromotedMistake = {
  /** Workspace-relative path, e.g. `school/vault/knowledge/….md`. */
  path: string
  title: string
  created: string
  /** `open` until a correction is written; then `corrected` or `reviewed`. */
  status: "open" | "corrected" | "reviewed"
}

/** One ledger entry plus the note it graduated into, when it has one. */
export type MistakeRow = MistakeEntry & {
  note: PromotedMistake | null
}

/** The note's path never leaves `knowledge/` on the school side. */
const KNOWLEDGE_DIR = "knowledge"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function relativeToRoot(root: string, absolute: string): string {
  const rel = relative(root, absolute).split(sep).join("/")
  return rel.startsWith("..") ? "" : rel
}

function integerOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

/** The ledger's entries, with no promoted-note lookup. */
export async function readMistakes(folder: string): Promise<MistakeEntry[]> {
  return parseMistakes(await readSessionFile(folder, "misconceptions.md"))
}

/**
 * Every promoted note for one session, keyed by the ledger entry it came from.
 *
 * Reads Markdown directly instead of the index: the index is a cache, and a
 * promotion must be visible even if the cache is stale. A note that cannot be
 * read is skipped; one unreadable note never hides the rest of the ledger.
 */
async function promotedNotes(
  workspace: Workspace,
  sessionId: string,
): Promise<Map<number, PromotedMistake>> {
  const out = new Map<number, PromotedMistake>()
  const vault = workspace.paths.schoolVault
  for (const rel of await listNotes(vault)) {
    if (!rel.startsWith(`${KNOWLEDGE_DIR}/`)) continue
    const absolute = join(vault, rel)
    let text: string
    try {
      text = await readFile(absolute, "utf8")
    } catch {
      continue
    }
    const parsed = parseDocument(text)
    if (!parsed.ok) continue
    const data = parsed.value.data
    if (readString(data, "origin") !== MISTAKE_ORIGIN) continue
    if (readString(data, "session") !== sessionId) continue
    const index = integerOf(data.premise_index)
    if (index === null) continue
    const path = relativeToRoot(workspace.root, absolute)
    if (path === "") continue
    const rawStatus = readString(data, "status") ?? "open"
    const status =
      rawStatus === "corrected" || rawStatus === "reviewed" ? rawStatus : "open"
    out.set(index, {
      path,
      title: readString(data, "title") ?? "",
      created: readString(data, "created") ?? "",
      status,
    })
  }
  return out
}

/** The session's ledger with promotion state, in file order. */
export async function listMistakes(input: {
  workspace: Workspace
  sessionId: string
}): Promise<Result<{ entries: MistakeRow[] }, MistakeError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.sessionId })
  if (!opened.ok) {
    return err({ kind: "storage", path: "", message: opened.error.message })
  }
  const entries = await readMistakes(opened.value.folder)
  const promoted = await promotedNotes(input.workspace, opened.value.session.id)
  return ok({
    entries: entries.map((entry) => ({ ...entry, note: promoted.get(entry.index) ?? null })),
  })
}

/** Record one misconception. The text is bounded, not silently truncated. */
export async function recordMistake(input: {
  workspace: Workspace
  sessionId: string
  text: string
  step?: string
}): Promise<Result<{ entries: MistakeRow[] }, MistakeError>> {
  const text = normaliseMistake(input.text)
  if (text === "") {
    return err({ kind: "invalid", message: "a mistake needs some text" })
  }
  if (text.length > MAX_MISTAKE_CHARS) {
    return err({
      kind: "invalid",
      message: `a mistake is at most ${MAX_MISTAKE_CHARS} characters; this one is ${text.length}`,
    })
  }
  const step = normaliseMistake(input.step ?? "")

  const opened = await openSession({ workspace: input.workspace, id: input.sessionId })
  if (!opened.ok) {
    return err({ kind: "storage", path: "", message: opened.error.message })
  }
  try {
    await appendMisconception(opened.value.folder, text, step === "" ? undefined : step)
  } catch (error) {
    return err({ kind: "storage", path: opened.value.folder, message: messageOf(error) })
  }
  return listMistakes(input)
}

/**
 * Write (or replace) a promoted mistake's corrected understanding.
 *
 * Promotion is deliberately not one-way: a learner can promote before they know
 * the right answer and fill it in later. This replaces only the
 * `## Corrected understanding` section, keeps the mistake, the label and the
 * provenance, and sets `status: corrected` so the note is settled and leaves the
 * Review queue. A blank correction is refused rather than written as text.
 */
export async function correctMistake(input: {
  workspace: Workspace
  sessionId: string
  index: number
  correction: string
}): Promise<Result<{ note: PromotedMistake }, MistakeError>> {
  const correction = normaliseMistake(input.correction)
  if (correction === "") {
    return err({ kind: "invalid", message: "a correction needs some text" })
  }
  if (correction.length > MAX_CORRECTION_CHARS) {
    return err({
      kind: "invalid",
      message: `a correction is at most ${MAX_CORRECTION_CHARS} characters; this one is ${correction.length}`,
    })
  }
  const promoted = await promotedNotes(input.workspace, input.sessionId)
  const note = promoted.get(input.index)
  if (note === undefined) {
    return err({
      kind: "invalid",
      message: `there is no promoted mistake ${input.index} in this session`,
    })
  }

  const absolute = join(input.workspace.root, note.path)
  let text: string
  try {
    text = await readFile(absolute, "utf8")
  } catch (error) {
    return err({ kind: "storage", path: note.path, message: messageOf(error) })
  }
  const parsed = parseDocument(text)
  if (!parsed.ok) {
    return err({ kind: "storage", path: note.path, message: parsed.error.message })
  }

  const at = new Date().toISOString()
  const body = replaceCorrection(parsed.value.body, correction)
  const frontmatter = serializeFrontmatter({
    ...parsed.value.data,
    status: "corrected",
    corrected_at: at,
  })
  const next = `${frontmatter}${body}`
  try {
    await writeSessionFile(
      input.workspace.paths.schoolVault,
      relative(input.workspace.paths.schoolVault, absolute),
      next,
    )
  } catch (error) {
    return err({ kind: "storage", path: note.path, message: messageOf(error) })
  }

  return ok({ note: { ...note, status: "corrected" } })
}

/**
 * Record a review verdict for one promoted mistake.
 *
 * This is the Review surface's write (`docs/product.md` §6.1). `known` means
 * the learner has understood it: `status` becomes `reviewed` and the note leaves
 * the queue — without pretending a correction was written, because the body
 * still carries its own wording. `missed` keeps the note `open` and increments
 * `misses`, so the nudge signal has something durable to count.
 *
 * Only frontmatter changes; the body is byte-identical. The write is atomic and
 * a failure leaves the note as it was.
 */
export async function markMistake(input: {
  workspace: Workspace
  sessionId: string
  index: number
  result: "known" | "missed"
}): Promise<Result<{ misses: number }, MistakeError>> {
  const promoted = await promotedNotes(input.workspace, input.sessionId)
  const note = promoted.get(input.index)
  if (note === undefined) {
    return err({
      kind: "invalid",
      message: `there is no promoted mistake ${input.index} in this session`,
    })
  }
  const absolute = join(input.workspace.root, note.path)
  let text: string
  try {
    text = await readFile(absolute, "utf8")
  } catch (error) {
    return err({ kind: "storage", path: note.path, message: messageOf(error) })
  }
  const parsed = parseDocument(text)
  if (!parsed.ok) {
    return err({ kind: "storage", path: note.path, message: parsed.error.message })
  }
  const current = typeof parsed.value.data.misses === "number" ? parsed.value.data.misses : 0
  const misses = input.result === "missed" ? Math.max(0, Math.floor(current)) + 1 : Math.max(0, Math.floor(current))
  const at = new Date().toISOString()
  const patch: Record<string, string | number> =
    input.result === "known"
      ? { status: "reviewed", reviewed_at: at }
      : { misses, last_missed: at }
  const patched = patchFrontmatter(text, patch)
  if (!patched.ok) {
    return err({ kind: "storage", path: note.path, message: patched.error.message })
  }
  try {
    await writeSessionFile(input.workspace.paths.schoolVault, relative(input.workspace.paths.schoolVault, absolute), patched.value)
  } catch (error) {
    return err({ kind: "storage", path: note.path, message: messageOf(error) })
  }
  return ok({ misses })
}

export type PromoteOutcome = {
  note: PromotedMistake
  /** True when this entry was already promoted and nothing was written. */
  already: boolean
}

/**
 * Promote one ledger entry into a school knowledge note.
 *
 * `correction` is the learner's own right answer; when it is absent the note
 * says so and stays `status: open`, so an uncorrected mistake is honestly
 * labelled rather than presented as settled.
 */
export async function promoteMistake(input: {
  workspace: Workspace
  sessionId: string
  index: number
  correction?: string
  title?: string
}): Promise<Result<PromoteOutcome, MistakeError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.sessionId })
  if (!opened.ok) {
    return err({ kind: "storage", path: "", message: opened.error.message })
  }
  const folder = opened.value.folder
  const session = opened.value.session
  const entries = await readMistakes(folder)
  const entry = entries[input.index]
  if (entry === undefined) {
    return err({
      kind: "invalid",
      message: `there is no mistake at index ${input.index}; the ledger has ${entries.length}`,
    })
  }

  const promoted = await promotedNotes(input.workspace, session.id)
  const existing = promoted.get(input.index)
  if (existing !== undefined) {
    return ok({ note: existing, already: true })
  }

  const correction = normaliseMistake(input.correction ?? "")
  if (correction.length > MAX_CORRECTION_CHARS) {
    return err({
      kind: "invalid",
      message: `a correction is at most ${MAX_CORRECTION_CHARS} characters; this one is ${correction.length}`,
    })
  }
  const explicitTitle = normaliseMistake(input.title ?? "")
  if (explicitTitle.length > 80) {
    return err({ kind: "invalid", message: "a note title is at most 80 characters" })
  }
  const title = explicitTitle === "" ? mistakeTitle(entry.text) : explicitTitle

  const vault = input.workspace.paths.schoolVault
  const taken = new Set(
    (await listNotes(vault))
      .filter((rel) => rel.startsWith(`${KNOWLEDGE_DIR}/`))
      .map((rel) => basename(rel, ".md")),
  )
  const slug = uniqueSlug(slugify(title), taken)
  const path = `${KNOWLEDGE_DIR}/${slug}.md`
  const created = new Date().toISOString()

  const note: Note = {
    id: slug,
    side: "school",
    type: "knowledge",
    title,
    body: "",
    links: [],
    tags: [MISTAKE_TAG],
    created,
    updated: created,
  }
  const body = mistakeBody({
    sessionName: session.name,
    sessionId: session.id,
    index: input.index,
    text: entry.text,
    correction,
    step: entry.step,
  })

  try {
    await mkdir(join(vault, KNOWLEDGE_DIR), { recursive: true })
  } catch (error) {
    return err({ kind: "storage", path: join(vault, KNOWLEDGE_DIR), message: messageOf(error) })
  }

  const store = openNoteStore(input.workspace.paths, "school")
  if (!store.ok) {
    return err({ kind: "storage", path: store.error.path, message: store.error.message })
  }
  try {
    const written = await store.value.write({
      path,
      note,
      body,
      frontmatter: {
        origin: MISTAKE_ORIGIN,
        session: session.id,
        premise_index: input.index,
        status: correction === "" ? "open" : "corrected",
        topics: [MISTAKE_TOPIC],
        promoted_from: `school/sessions/${session.id}/misconceptions.md`,
        ...(entry.step === null ? {} : { step: entry.step }),
      },
    })
    if (!written.ok) {
      return err({ kind: "storage", path: written.error.path, message: written.error.message })
    }
  } finally {
    store.value.close()
  }

  return ok({
    note: {
      path: `${relativeToRoot(input.workspace.root, vault) || "school/vault"}/${path}`,
      title,
      created,
      status: correction === "" ? "open" : "corrected",
    },
    already: false,
  })
}

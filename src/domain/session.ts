/**
 * Lock-in session entity and its id rules.
 *
 * `docs/data-model.md` §4 fixes the on-disk shape: `meta.json` plus prompt,
 * sources, steps, chat, progress and memory. This module owns the entity, the
 * `YYYY-MM-DD-HHMM-<slug>` id, and the plain-object round-trip. Storage owns
 * every byte that reaches the disk, including the copy of each source.
 *
 * No file IO, no UI, no provider, and no clock: `created` is always supplied by
 * the caller so an id is deterministic for a fixed clock and name.
 */

import { err, ok, type Result } from "./markdown"
import {
  addSource,
  makeSource,
  type Source,
  type SourceError,
  type SourceKind,
} from "./source"
import { slugify } from "./note"

export type SessionError =
  | SourceError
  | { kind: "invalid-session"; field: string; message: string }

/** File names inside a session folder, from `docs/data-model.md` §4. */
export const SESSION_FILES = {
  meta: "meta.json",
  prompt: "prompt.md",
  steps: "assignment-steps.md",
  chat: "chat.jsonl",
  progress: "progress.jsonl",
  memory: "memory.md",
  generation: "generation.json",
  questions: "questions.md",
  contradictions: "contradictions.md",
  contract: "contract.md",
  intake: "intake.md",
  check: "check.md",
  misconceptions: "misconceptions.md",
  confidence: "confidence.jsonl",
} as const

export const SESSION_SCHEMA = 1
export const MAX_SESSION_NAME = 120

/** Matches the documented id form; used to validate a meta file on load. */
export const SESSION_ID = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The original file the assignment instructions came from.
 *
 * `prompt.md` remains the text the model reads; this records where that text
 * came from so the pane can show it and re-extract later. The stored copy is a
 * normal `sources/` file, so it travels with the session.
 */
export type InstructionsSource = Source & {
  /** ISO-8601 UTC instant when `prompt.md` was last extracted. */
  extractedAt: string
  characters?: number
  pages?: number
}

export type LockInSession = {
  /** `YYYY-MM-DD-HHMM-<slug>`; also the folder name. */
  id: string
  name: string
  /** ISO-8601 UTC, as stored. */
  created: string
  prompt: string
  sources: Source[]
  /** Original instruction file, when the prompt was loaded from one. */
  instructions: InstructionsSource | null
  /** `assignment-steps.md` when steps were generated, null when they were not. */
  stepsPath: string | null
  chatPath: string
  progressPath: string
  /** `memory.md` until the first reply has been summarised. */
  memoryPath: string | null
  archived: boolean
}

// ------------------------------------------------------------------ ids

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0")
}

/**
 * `YYYY-MM-DD-HHMM` in UTC.
 * The caller supplies the instant, so this never reads the clock and a replay
 * of the same input produces the same id.
 */
export function formatSessionStamp(created: string | Date): Result<string, SessionError> {
  const date = created instanceof Date ? created : new Date(created)
  if (Number.isNaN(date.getTime())) {
    return err({
      kind: "invalid-session",
      field: "created",
      message: `"created" must be an ISO-8601 instant, got "${String(created)}"`,
    })
  }
  const stamp =
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  return ok(stamp)
}

/**
 * Session id: `YYYY-MM-DD-HHMM-<slug>`, with `-2`, `-3`, … appended when that
 * id is already taken. Two runs with the same clock, name and taken set agree.
 */
export function sessionId(input: {
  created: string | Date
  name: string
  taken?: Iterable<string>
}): Result<string, SessionError> {
  const stamp = formatSessionStamp(input.created)
  if (!stamp.ok) return stamp

  const slug = slugify(input.name)
  const base = `${stamp.value}-${slug}`
  const used = new Set(input.taken ?? [])
  if (!used.has(base)) return ok(base)
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) return ok(candidate)
  }
}

// ------------------------------------------------------------------ creation

export type CreateSessionInput = {
  created: string | Date
  name: string
  prompt?: string
  sources?: readonly Source[]
  /** Original instruction file, when the prompt came from one. */
  instructions?: InstructionsSource | null
  /** Existing ids in the workspace, for collision handling. */
  taken?: Iterable<string>
  /** Set false when the user declined step generation. */
  steps?: boolean
  archived?: boolean
}

/**
 * Build a session value. Sources are validated and de-duplicated by hash; a
 * rejected source fails the whole creation, so a half-built session never
 * reaches storage.
 */
export function createSession(input: CreateSessionInput): Result<LockInSession, SessionError> {
  const name = input.name.trim()
  if (name === "") {
    return err({
      kind: "invalid-session",
      field: "name",
      message: "a session needs a name",
    })
  }
  if (name.length > MAX_SESSION_NAME) {
    return err({
      kind: "invalid-session",
      field: "name",
      message: `session names are capped at ${MAX_SESSION_NAME} characters`,
    })
  }

  const id = sessionId({ created: input.created, name, taken: input.taken })
  if (!id.ok) return id

  const created = input.created instanceof Date ? input.created : new Date(input.created)
  const wantSteps = input.steps !== false

  let sources: Source[] = []
  for (const candidate of input.sources ?? []) {
    const added = addSource(sources, candidate)
    if (!added.ok) return added
    sources = added.value.sources
  }

  return ok({
    id: id.value,
    name,
    created: created.toISOString(),
    prompt: input.prompt ?? "",
    sources,
    instructions: input.instructions ?? null,
    stepsPath: wantSteps ? SESSION_FILES.steps : null,
    chatPath: SESSION_FILES.chat,
    progressPath: SESSION_FILES.progress,
    memoryPath: null,
    archived: input.archived ?? false,
  })
}

/** Folders are named after the id; there is no second naming rule. */
export function sessionFolder(session: Pick<LockInSession, "id">): string {
  return session.id
}

/** Every file a session may own, relative to its folder. */
export function sessionFiles(session: LockInSession): string[] {
  const files = [SESSION_FILES.meta, SESSION_FILES.prompt, session.chatPath, session.progressPath]
  if (session.stepsPath !== null) files.push(session.stepsPath)
  if (session.memoryPath !== null) files.push(session.memoryPath)
  return files
}

// ------------------------------------------------------------------ sources

/** Add sources to an existing session. A duplicate hash is a no-op. */
export function addSessionSources(
  session: LockInSession,
  incoming: readonly Source[],
): Result<{ session: LockInSession; added: number }, SessionError> {
  let sources = session.sources
  let added = 0
  for (const candidate of incoming) {
    const result = addSource(sources, candidate)
    if (!result.ok) return result
    sources = result.value.sources
    if (result.value.added) added++
  }
  return ok({ session: { ...session, sources }, added })
}

/** Pure state change; archiving never deletes anything. */
export function withArchived(session: LockInSession, archived: boolean): LockInSession {
  return { ...session, archived }
}

/**
 * Record that a reply has been summarised. `memory.md` is created by storage;
 * this only records that the file is part of the session.
 */
export function withMemory(session: LockInSession): LockInSession {
  return { ...session, memoryPath: SESSION_FILES.memory }
}

// ------------------------------------------------------------------ wire format

/** Plain object matching `docs/data-model.md` §4.1, with no methods. */
export type SessionMeta = {
  schema: number
  id: string
  name: string
  created: string
  prompt: string
  steps: boolean
  sources: Array<{
    original_path: string
    stored_path: string
    name: string
    hash: string
    kind: SourceKind
  }>
  instructions_source: {
    original_path: string
    stored_path: string
    name: string
    hash: string
    kind: SourceKind
    extracted_at: string
    characters?: number
    pages?: number
  } | null
  archived: boolean
}

export function sessionToMeta(session: LockInSession): SessionMeta {
  return {
    schema: SESSION_SCHEMA,
    id: session.id,
    name: session.name,
    created: session.created,
    prompt: session.prompt,
    steps: session.stepsPath !== null,
    sources: session.sources.map((source) => ({
      original_path: source.originalPath,
      stored_path: source.storedPath,
      name: source.name,
      hash: source.hash,
      kind: source.kind,
    })),
    instructions_source:
      session.instructions === null
        ? null
        : {
            original_path: session.instructions.originalPath,
            stored_path: session.instructions.storedPath,
            name: session.instructions.name,
            hash: session.instructions.hash,
            kind: session.instructions.kind,
            extracted_at: session.instructions.extractedAt,
            ...(session.instructions.characters === undefined
              ? {}
              : { characters: session.instructions.characters }),
            ...(session.instructions.pages === undefined ? {} : { pages: session.instructions.pages }),
          },
    archived: session.archived,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

export type FromMetaOptions = {
  /**
   * Whether `memory.md` exists for this session. Memory presence is a
   * filesystem fact, and this module does no IO, so storage passes it in.
   * Default false: no file, no path.
   */
  memory?: boolean
}

/**
 * Read a `meta.json` back into the entity. Unknown keys are ignored (the file
 * belongs to storage) but every required field is validated, and a bad source
 * fails the load rather than being dropped.
 */
export function sessionFromMeta(
  input: unknown,
  options: FromMetaOptions = {},
): Result<LockInSession, SessionError> {
  if (!isRecord(input)) {
    return err({ kind: "invalid-session", field: "meta", message: "meta.json must be an object" })
  }

  const schema = input.schema
  if (schema !== SESSION_SCHEMA) {
    return err({
      kind: "invalid-session",
      field: "schema",
      message: `unsupported session schema ${JSON.stringify(schema)}; this build reads schema ${SESSION_SCHEMA}`,
    })
  }

  const id = readString(input, "id")
  if (id === null || !SESSION_ID.test(id)) {
    return err({
      kind: "invalid-session",
      field: "id",
      message: `session id must look like "YYYY-MM-DD-HHMM-slug", got ${JSON.stringify(id)}`,
    })
  }

  const name = readString(input, "name")
  if (name === null || name.trim() === "") {
    return err({ kind: "invalid-session", field: "name", message: "meta.json has no session name" })
  }

  const created = readString(input, "created")
  if (created === null || Number.isNaN(new Date(created).getTime())) {
    return err({
      kind: "invalid-session",
      field: "created",
      message: `"created" must be an ISO-8601 instant, got ${JSON.stringify(created)}`,
    })
  }

  const rawSources = input.sources
  if (!Array.isArray(rawSources)) {
    return err({
      kind: "invalid-session",
      field: "sources",
      message: 'meta.json needs a "sources" array (empty is fine)',
    })
  }

  const sources: Source[] = []
  for (const [index, raw] of rawSources.entries()) {
    if (!isRecord(raw)) {
      return err({
        kind: "invalid-session",
        field: `sources[${index}]`,
        message: "each source must be an object",
      })
    }
    const originalPath = readString(raw, "original_path") ?? ""
    const storedPath = readString(raw, "stored_path")
    const sourceName = readString(raw, "name")
    const hash = readString(raw, "hash")
    const kind = readString(raw, "kind") as SourceKind | null

    if (storedPath === null || sourceName === null || hash === null || kind === null) {
      return err({
        kind: "invalid-session",
        field: `sources[${index}]`,
        message: "a source needs stored_path, name, hash and kind",
      })
    }

    const checked = makeSource({ originalPath, name: sourceName, hash, kind, storedPath })
    if (!checked.ok) return checked
    sources.push(checked.value)
  }

  let instructions: InstructionsSource | null = null
  const rawInstructions = input.instructions_source
  if (rawInstructions !== undefined && rawInstructions !== null) {
    if (!isRecord(rawInstructions)) {
      return err({
        kind: "invalid-session",
        field: "instructions_source",
        message: "instructions_source must be an object or null",
      })
    }
    const originalPath = readString(rawInstructions, "original_path") ?? ""
    const storedPath = readString(rawInstructions, "stored_path")
    const sourceName = readString(rawInstructions, "name")
    const hash = readString(rawInstructions, "hash")
    const kind = readString(rawInstructions, "kind") as SourceKind | null
    const extractedAt = readString(rawInstructions, "extracted_at")

    if (storedPath === null || sourceName === null || hash === null || kind === null) {
      return err({
        kind: "invalid-session",
        field: "instructions_source",
        message: "instructions_source needs stored_path, name, hash and kind",
      })
    }
    if (extractedAt === null || Number.isNaN(new Date(extractedAt).getTime())) {
      return err({
        kind: "invalid-session",
        field: "instructions_source.extracted_at",
        message: "instructions_source needs an ISO-8601 extracted_at instant",
      })
    }

    const checked = makeSource({ originalPath, name: sourceName, hash, kind, storedPath })
    if (!checked.ok) return checked
    const characters = rawInstructions.characters
    const pages = rawInstructions.pages
    instructions = {
      ...checked.value,
      extractedAt: new Date(extractedAt).toISOString(),
      ...(typeof characters === "number" && Number.isFinite(characters) ? { characters } : {}),
      ...(typeof pages === "number" && Number.isFinite(pages) ? { pages } : {}),
    }
  }

  const steps = input.steps === true
  const rawArchived = input.archived
  const archived = rawArchived === true

  return ok({
    id,
    name,
    created: new Date(created).toISOString(),
    prompt: readString(input, "prompt") ?? "",
    sources,
    instructions,
    stepsPath: steps ? SESSION_FILES.steps : null,
    chatPath: SESSION_FILES.chat,
    progressPath: SESSION_FILES.progress,
    memoryPath: options.memory === true ? SESSION_FILES.memory : null,
    archived,
  })
}

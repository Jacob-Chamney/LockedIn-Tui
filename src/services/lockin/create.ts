/**
 * Lock-in session creation transaction.
 *
 * This is the write behind the wizard's Review step: build the session in a
 * temporary directory beside its destination, write every file, flush, then
 * rename into place. A failure removes the temporary directory, so a failed
 * create leaves no session and no debris (`AGENTS.md` §2.9).
 *
 * Written on create: `meta.json`, `prompt.md`, `sources/`.
 * Not written: `chat.jsonl`, `progress.jsonl`, `assignment-steps.md`,
 * `memory.md` — those appear on first use (`docs/data-model.md` §4).
 */

import { mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import {
  sessionId,
  sessionToMeta,
  type InstructionsSource,
  type LockInSession,
} from "../../domain/session"
import type { Source } from "../../domain/source"
import { isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { extract, type ExtractError, type ExtractResult } from "../extract"
import { copySource } from "./copy"
import { BLOCKED_COPY } from "./picker"

export type CreateError =
  | { kind: "blocked"; message: string }
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "invalid-session"; field: string; message: string }
  | { kind: "extraction"; name: string; reason: ExtractError["kind"]; message: string }

/** The only event this transaction emits, after the rename. */
export type SessionEvent = { type: "session.updated"; sessionId: string; at: string }

export type CreateRequest = {
  workspace: Workspace
  /** Supplied by the caller: no clock is read here. */
  created: string | Date
  name: string
  prompt?: string
  /** Absolute paths chosen in the picker. */
  files?: readonly string[]
  /**
   * Optional file whose extracted text becomes `prompt.md`. The original is
   * copied into `sources/` and recorded as `instructions_source`.
   */
  instructionsFile?: string
  /** False when the user declined step generation. */
  steps?: boolean
  emit?: (event: SessionEvent) => void
  /** Test hook, forwarded to each copy; throwing aborts the transaction. */
  onChunk?: (index: number) => void
  /** Test hook: force a typed extraction result for the instruction file. */
  extractor?: (path: string) => Promise<ExtractResult>
}

export type CreateOutcome = {
  session: LockInSession
  /** Absolute path of the created session folder. */
  folder: string
  /** Number of distinct files written under `sources/`. */
  copiedFiles: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The other wall, for a school session: skills goals and the skills vault. */
function skillsRoots(workspace: Workspace): string[] {
  return [workspace.paths.goals, workspace.paths.skillVault].map((path) => resolve(path))
}

async function existingIds(directory: string): Promise<string[]> {
  try {
    const names = await readdir(directory, { withFileTypes: true })
    return names.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return []
    }
    throw error
  }
}

async function fsyncFile(path: string): Promise<void> {
  // Flush the bytes already written. Open for update, not read-only:
  // Windows' FlushFileBuffers rejects a handle without write access, while
  // POSIX fsync is happy with either.
  const handle = await open(path, "r+")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Create a session folder from chosen files and an optional prompt.
 *
 * Order matters and is tested: validate, then copy into a temporary directory,
 * then flush `meta.json`, then rename, then emit.
 */
export async function createLockInSession(
  request: CreateRequest,
): Promise<Result<CreateOutcome, CreateError>> {
  const requestedPrompt = request.prompt ?? ""
  const files = [...(request.files ?? [])]
  const instructionFile = request.instructionsFile

  if (instructionFile !== undefined && requestedPrompt.trim() !== "") {
    return err({
      kind: "blocked",
      message: "choose assignment instructions or an instructions file, not both",
    })
  }
  if (files.length === 0 && requestedPrompt.trim() === "" && instructionFile === undefined) {
    return err({ kind: "blocked", message: BLOCKED_COPY })
  }

  // The wall is checked before a single byte is copied. Resolve symlinks so a
  // link under `input/` cannot point into the skills store.
  const otherSide: string[] = []
  for (const root of skillsRoots(request.workspace)) {
    try {
      otherSide.push(await realpath(root))
    } catch {
      otherSide.push(root)
    }
  }
  const chosen = instructionFile === undefined ? files : [...files, instructionFile]
  for (const file of chosen) {
    const lexical = resolve(file)
    let target = lexical
    try {
      target = await realpath(lexical)
    } catch {
      // A missing file is refused later by the copy; the lexical path stands.
    }
    if (otherSide.some((root) => isPathInside(root, target))) {
      return err({
        kind: "path",
        path: target,
        reason: "escape",
        message:
          `${target} belongs to the skills side; a lock-in session can only ` +
          "use files from outside the skills store",
      })
    }
  }

  const sessionsRoot = request.workspace.paths.schoolSessions
  let taken: string[]
  try {
    taken = await existingIds(sessionsRoot)
  } catch (error) {
    return err({ kind: "storage", path: sessionsRoot, message: messageOf(error) })
  }

  const id = sessionId({ created: request.created, name: request.name, taken })
  if (!id.ok) {
    return err({
      kind: "invalid-session",
      field: "id",
      message: id.error.kind === "invalid-session" ? id.error.message : "could not build an id",
    })
  }

  let prompt = requestedPrompt
  let extractedInfo: { characters: number; pages?: number } | null = null
  if (instructionFile !== undefined) {
    const extractor = request.extractor ?? ((path: string) => extract(path))
    const extracted = await extractor(instructionFile)
    if (!extracted.ok) {
      return err({
        kind: "extraction",
        name: basename(instructionFile),
        reason: extracted.error.kind,
        message: extracted.error.message,
      })
    }
    prompt = extracted.text
    extractedInfo = {
      characters: extracted.characters,
      ...(extracted.pages === undefined ? {} : { pages: extracted.pages }),
    }
  }

  const folder = join(sessionsRoot, id.value)
  const temporary = join(sessionsRoot, `.tmp-${id.value}-${crypto.randomUUID()}`)

  try {
    await mkdir(join(temporary, "sources"), { recursive: true })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    return err({ kind: "storage", path: temporary, message: messageOf(error) })
  }

  try {
    await Bun.write(join(temporary, "prompt.md"), prompt)

    const copied = new Map<string, Source>()
    for (const file of files) {
      const result = await copySource({
        original: file,
        sourcesDir: join(temporary, "sources"),
        copied,
        onChunk: request.onChunk,
      })
      if (!result.ok) {
        await rm(temporary, { recursive: true, force: true })
        return err(result.error)
      }
      copied.set(result.value.source.hash, result.value.source)
    }

    let instructions: InstructionsSource | null = null
    if (instructionFile !== undefined && extractedInfo !== null) {
      const result = await copySource({
        original: instructionFile,
        sourcesDir: join(temporary, "sources"),
        copied,
        onChunk: request.onChunk,
      })
      if (!result.ok) {
        await rm(temporary, { recursive: true, force: true })
        return err(result.error)
      }
      copied.set(result.value.source.hash, result.value.source)
      instructions = {
        ...result.value.source,
        extractedAt: new Date(request.created).toISOString(),
        characters: extractedInfo.characters,
        ...(extractedInfo.pages === undefined ? {} : { pages: extractedInfo.pages }),
      }
    }

    const sources = [...copied.values()]
    const built = {
      id: id.value,
      name: request.name.trim(),
      created: new Date(request.created).toISOString(),
      prompt,
      sources,
      instructions,
      stepsPath: request.steps === false ? null : "assignment-steps.md",
      chatPath: "chat.jsonl",
      progressPath: "progress.jsonl",
      memoryPath: null,
      archived: false,
    } satisfies LockInSession

    const metaPath = join(temporary, "meta.json")
    await Bun.write(metaPath, `${JSON.stringify(sessionToMeta(built), null, 2)}\n`)
    await fsyncFile(metaPath)

    await rename(temporary, folder)
    request.emit?.({ type: "session.updated", sessionId: id.value, at: new Date().toISOString() })

    return ok({ session: built, folder, copiedFiles: sources.length })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    return err({ kind: "storage", path: temporary, message: messageOf(error) })
  }
}

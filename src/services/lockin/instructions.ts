/**
 * Assignment instructions: load, edit and re-extract `prompt.md`.
 *
 * `prompt.md` is the text the model reads. When the instructions arrive as a
 * file, the original is copied into the session's `sources/` folder and its
 * provenance is recorded in `meta.json`. The copy is the session's own file, so
 * editing the original later changes nothing.
 *
 * Every write is atomic. A failed extraction or a failed metadata write leaves
 * the previous prompt and metadata exactly as they were.
 */

import { open, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import { ok, type Result } from "../../domain/markdown"
import { SESSION_FILES, type InstructionsSource, type LockInSession } from "../../domain/session"
import type { SourceKind } from "../../domain/source"
import { isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { extract, type ExtractError, type ExtractResult } from "../extract"
import { copySource } from "./copy"
import { openSession, writeMeta } from "./manager"

export type InstructionsError =
  | { kind: "blocked"; message: string }
  | { kind: "extraction"; name: string; reason: ExtractError["kind"]; message: string }
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "storage"; path: string; message: string }

export type SessionSettingsData = {
  prompt: string
  instructions: InstructionsSource | null
  /** Whether the copied original still exists where `meta.json` says it does. */
  originalPresent: boolean
}

export type ImportedInstructions = {
  prompt: string
  instructions: InstructionsSource
  session: LockInSession
  /** False when the original was already a source with the same bytes. */
  added: boolean
}

export type InstructionOptions = {
  workspace: Workspace
  id: string
  /** Test hook: force a typed extraction result. */
  extractor?: (path: string) => Promise<ExtractResult>
  /** Test hook: deterministic extraction time. */
  now?: () => Date
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function extractionMessage(name: string, error: ExtractError): string {
  switch (error.kind) {
    case "tool-missing":
      return (
        `${name} needs pdftotext (poppler) on PATH. Install poppler-utils ` +
        "(Debian/Ubuntu), poppler (Homebrew), then retry."
      )
    case "no-text":
      return (
        `${name} has no text layer (scanned image?). OCR is not supported; ` +
        "use a text or DOCX version as the instructions."
      )
    case "malformed":
      return `${name} could not be read: ${error.message}`
    case "unsupported":
      return error.detected === "image"
        ? `${name} is an image; instructions must be text, PDF or DOCX.`
        : `${name} could not be read: ${error.message}`
    case "read":
      return `${name} could not be read: ${error.message}`
  }
}

function extractionError(name: string, error: ExtractError): InstructionsError {
  return { kind: "extraction", name, reason: error.kind, message: extractionMessage(name, error) }
}

/** The same wall add-sources enforces: a lock-in session never reads the skills side. */
async function assertOutsideSkills(workspace: Workspace, file: string): Promise<Result<string, InstructionsError>> {
  let target: string
  try {
    target = await realpath(file)
  } catch (error) {
    return { ok: false, error: { kind: "path", path: file, reason: "missing", message: messageOf(error) } }
  }

  for (const root of [workspace.paths.goals, workspace.paths.skillVault]) {
    let actual: string
    try {
      actual = await realpath(root)
    } catch {
      actual = resolve(root)
    }
    if (isPathInside(actual, target)) {
      return {
        ok: false,
        error: {
          kind: "path",
          path: target,
          reason: "escape",
          message: `${target} belongs to the skills side; a lock-in session can only use files from outside it`,
        },
      }
    }
  }

  try {
    const info = await stat(target)
    if (!info.isFile()) {
      return {
        ok: false,
        error: { kind: "path", path: target, reason: "missing", message: `${target} is not a regular file` },
      }
    }
  } catch (error) {
    return { ok: false, error: { kind: "path", path: target, reason: "missing", message: messageOf(error) } }
  }
  return ok(target)
}

/** Replace a text file atomically: temp file in the same folder, then rename. */
async function writeTextAtomic(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${crypto.randomUUID()}`)
  try {
    await Bun.write(temporary, text)
    const handle = await open(temporary, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Write `prompt.md`, then `meta.json`; restore the old prompt if metadata fails.
 * The caller owns any source-copy rollback.
 */
async function writePromptAndMeta(
  folder: string,
  previousPrompt: string,
  next: LockInSession,
): Promise<Result<void, InstructionsError>> {
  const promptPath = join(folder, SESSION_FILES.prompt)
  try {
    await writeTextAtomic(promptPath, next.prompt)
  } catch (error) {
    return { ok: false, error: { kind: "storage", path: promptPath, message: messageOf(error) } }
  }

  try {
    await writeMeta(folder, next)
  } catch (error) {
    await writeTextAtomic(promptPath, previousPrompt).catch(() => {})
    return {
      ok: false,
      error: { kind: "storage", path: join(folder, SESSION_FILES.meta), message: messageOf(error) },
    }
  }
  return ok(undefined)
}

async function readPrompt(folder: string): Promise<string> {
  try {
    return await readFile(join(folder, SESSION_FILES.prompt), "utf8")
  } catch {
    return ""
  }
}

function openFailure(error: { kind: string; message: string; path?: string }): InstructionsError {
  if (error.kind === "storage" && typeof error.path === "string") {
    return { kind: "storage", path: error.path, message: error.message }
  }
  if (error.kind === "blocked") return { kind: "blocked", message: error.message }
  if (error.kind === "path" && "reason" in error) {
    const reason = (error as { reason?: "escape" | "missing" | "symlink" }).reason ?? "missing"
    return { kind: "path", path: error.path ?? "", reason, message: error.message }
  }
  return { kind: "blocked", message: error.message }
}

export async function loadSessionSettings(input: {
  workspace: Workspace
  id: string
}): Promise<Result<SessionSettingsData, InstructionsError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.id })
  if (!opened.ok) return { ok: false, error: openFailure(opened.error) }

  const { folder, session } = opened.value
  let originalPresent = false
  if (session.instructions !== null) {
    try {
      originalPresent = (await stat(join(folder, session.instructions.storedPath))).isFile()
    } catch {
      originalPresent = false
    }
  }
  return ok({ prompt: await readPrompt(folder), instructions: session.instructions, originalPresent })
}

/**
 * Load a file as the assignment instructions.
 *
 * Order: validate the wall, extract, copy, then write prompt and metadata. A
 * failure before the copy changes nothing; a failure during the metadata write
 * restores the old prompt.
 */
export async function importSessionInstructions(
  input: InstructionOptions & { file: string },
): Promise<Result<ImportedInstructions, InstructionsError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.id })
  if (!opened.ok) return { ok: false, error: openFailure(opened.error) }
  const { folder, session } = opened.value
  if (session.archived) {
    return {
      ok: false,
      error: { kind: "blocked", message: "this session is archived; restore it first, then change its instructions" },
    }
  }

  const checked = await assertOutsideSkills(input.workspace, input.file)
  if (!checked.ok) return checked

  const extractor = input.extractor ?? ((path: string) => extract(path))
  const extracted = await extractor(checked.value)
  if (!extracted.ok) return { ok: false, error: extractionError(basename(checked.value), extracted.error) }

  const copied = new Map(session.sources.map((source) => [source.hash, source]))
  const copy = await copySource({
    original: checked.value,
    sourcesDir: join(folder, "sources"),
    copied,
  })
  if (!copy.ok) {
    return {
      ok: false,
      error: {
        kind: "storage",
        path: copy.error.path,
        message: copy.error.message,
      },
    }
  }
  copied.set(copy.value.source.hash, copy.value.source)

  const instructions: InstructionsSource = {
    ...copy.value.source,
    extractedAt: (input.now ?? (() => new Date()))().toISOString(),
    characters: extracted.characters,
    ...(extracted.pages === undefined ? {} : { pages: extracted.pages }),
  }
  const next: LockInSession = {
    ...session,
    prompt: extracted.text,
    sources: [...copied.values()],
    instructions,
  }

  const previousPrompt = await readPrompt(folder)
  const written = await writePromptAndMeta(folder, previousPrompt, next)
  if (!written.ok) {
    if (!copy.value.duplicate) {
      await rm(join(folder, copy.value.source.storedPath), { force: true }).catch(() => {})
    }
    return written
  }

  return ok({
    prompt: next.prompt,
    instructions,
    session: next,
    added: !copy.value.duplicate,
  })
}

/** Replace the instruction text. The original file and provenance stay. */
export async function saveSessionPrompt(input: {
  workspace: Workspace
  id: string
  text: string
}): Promise<Result<{ prompt: string; session: LockInSession }, InstructionsError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.id })
  if (!opened.ok) return { ok: false, error: openFailure(opened.error) }
  const { folder, session } = opened.value
  if (session.archived) {
    return {
      ok: false,
      error: { kind: "blocked", message: "this session is archived; restore it first, then edit its instructions" },
    }
  }

  const previousPrompt = await readPrompt(folder)
  const next: LockInSession = { ...session, prompt: input.text }
  const written = await writePromptAndMeta(folder, previousPrompt, next)
  if (!written.ok) return written
  return ok({ prompt: next.prompt, session: next })
}

/** Re-extract the copied original into `prompt.md`, replacing manual edits. */
export async function reExtractInstructions(
  input: InstructionOptions,
): Promise<Result<{ prompt: string; instructions: InstructionsSource; session: LockInSession }, InstructionsError>> {
  const opened = await openSession({ workspace: input.workspace, id: input.id })
  if (!opened.ok) return { ok: false, error: openFailure(opened.error) }
  const { folder, session } = opened.value
  if (session.archived) {
    return {
      ok: false,
      error: { kind: "blocked", message: "this session is archived; restore it first, then change its instructions" },
    }
  }
  if (session.instructions === null) {
    return { ok: false, error: { kind: "blocked", message: "this session has no instruction file to re-extract" } }
  }

  const stored = join(folder, session.instructions.storedPath)
  const extractor = input.extractor ?? ((path: string) => extract(path))
  const extracted = await extractor(stored)
  if (!extracted.ok) return { ok: false, error: extractionError(session.instructions.name, extracted.error) }

  const instructions: InstructionsSource = {
    ...session.instructions,
    extractedAt: (input.now ?? (() => new Date()))().toISOString(),
    characters: extracted.characters,
    ...(extracted.pages === undefined ? {} : { pages: extracted.pages }),
  }
  const next: LockInSession = { ...session, prompt: extracted.text, instructions }
  const previousPrompt = await readPrompt(folder)
  const written = await writePromptAndMeta(folder, previousPrompt, next)
  if (!written.ok) return written
  return ok({ prompt: next.prompt, instructions, session: next })
}

/** Kind remembered for the pane's label even when the file copy is missing. */
export function instructionKind(instructions: InstructionsSource | null): SourceKind | null {
  return instructions?.kind ?? null
}

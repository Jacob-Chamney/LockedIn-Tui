/**
 * A safe, capped preview of the file under the finder cursor.
 *
 * Text is read a slice at a time and decoded strictly; a file that is not
 * UTF-8 is shown as binary rather than as mojibake. PDF and DOCX reuse the
 * source extractor, so an assignment PDF previews the same text the session
 * will read. Images and oversized documents report their metadata only.
 *
 * Nothing here writes, and the preview is never persisted. The cap keeps a
 * multi-gigabyte file from reaching the renderer.
 */

import { stat } from "node:fs/promises"
import { basename } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { classifySource, type SourceKind } from "../../domain/source"
import { extract } from "../extract"
import type { PickerError } from "./picker"

export type PreviewKind = SourceKind | "binary"

export type FilePreview = {
  path: string
  name: string
  kind: PreviewKind
  bytes: number
  /** `stat().mtimeMs`; the UI formats it as a relative time. */
  modifiedMs: number
  lines: string[]
  truncated: boolean
  /** A short label such as `pdf · 2 pages`; null for a plain text file. */
  note: string | null
  /** A soft extraction failure, shown in the preview without blocking selection. */
  error: string | null
}

export type PreviewOptions = {
  maxLines?: number
  maxBytes?: number
  /** Stop the read or the pdftotext process when the cursor moves on. */
  signal?: AbortSignal
}

const TEXT_BYTES = 64 * 1024
const HEAVY_BYTES = 16 * 1024 * 1024

function storageError(path: string, error: unknown): PickerError {
  return { kind: "storage", path, message: error instanceof Error ? error.message : String(error) }
}

/**
 * PDF text for a preview, without `extract`'s synchronous spawn.
 *
 * The production extractor uses `spawnSync` because it runs inside a write
 * transaction. A preview follows the cursor, so a blocking spawn would freeze
 * the renderer (and did on Windows). This path is async, kills the process on
 * abort, and gives up after four seconds.
 */
async function previewPdf(
  path: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; error: null } | { text: ""; error: string }> {
  const tool = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
  if (tool === null) {
    return {
      text: "",
      error: "pdf preview needs pdftotext (poppler) on PATH. Install poppler-utils, or choose a text file.",
    }
  }
  if (signal?.aborted) return { text: "", error: "preview cancelled" }
  const proc = Bun.spawn({
    cmd: [tool, "-layout", "-enc", "UTF-8", path, "-"],
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const stop = () => proc.kill()
  signal?.addEventListener("abort", stop, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, 4_000)
  if (typeof timer.unref === "function") timer.unref()
  try {
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (signal?.aborted) return { text: "", error: "preview cancelled" }
    if (timedOut) return { text: "", error: "pdf preview timed out" }
    if (code !== 0) {
      const detail = (await new Response(proc.stderr).text())
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line !== "") ?? "pdftotext rejected the file"
      return { text: "", error: `pdf preview failed: ${detail}` }
    }
    return { text, error: null }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", stop)
  }
}

export async function previewFile(
  path: string,
  options: PreviewOptions = {},
): Promise<Result<FilePreview, PickerError>> {
  const maxLines = options.maxLines ?? 40
  const maxBytes = options.maxBytes ?? TEXT_BYTES
  let info
  try {
    info = await stat(path)
  } catch (error) {
    return err(storageError(path, error))
  }
  if (!info.isFile()) {
    return err({ kind: "path", path, reason: "missing", message: `${path} is not a regular file` })
  }

  const name = basename(path)
  const base: FilePreview = {
    path,
    name,
    kind: classifySource(name),
    bytes: info.size,
    modifiedMs: info.mtimeMs,
    lines: [],
    truncated: false,
    note: null,
    error: null,
  }

  if (base.kind === "image") {
    return ok({ ...base, note: "image · no text preview" })
  }

  if (base.kind === "pdf") {
    if (info.size > HEAVY_BYTES) {
      return ok({ ...base, note: "pdf · too large to preview" })
    }
    const pdf = await previewPdf(path, options.signal)
    if (pdf.error !== null) return ok({ ...base, error: pdf.error })
    const lines = pdf.text.split("\n")
    return ok({
      ...base,
      lines: lines.slice(0, maxLines),
      truncated: lines.length > maxLines,
      note: "pdf",
    })
  }

  if (base.kind === "docx") {
    if (info.size > HEAVY_BYTES) {
      return ok({ ...base, note: "docx · too large to preview" })
    }
    const extracted = await extract(path)
    if (!extracted.ok) return ok({ ...base, error: extracted.error.message })
    const lines = extracted.text.split("\n")
    return ok({
      ...base,
      lines: lines.slice(0, maxLines),
      truncated: lines.length > maxLines,
      note: "docx",
    })
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await Bun.file(path).slice(0, maxBytes).arrayBuffer())
  } catch (error) {
    return err(storageError(path, error))
  }

  // A byte slice can end inside a multi-byte character. Trim up to three
  // trailing bytes before calling it binary, so a long text file does not turn
  // into a binary preview just because the cap landed mid-character.
  let text: string | null = bytes.length === 0 ? "" : null
  for (let trim = 0; text === null && trim <= 3 && trim < bytes.length; trim++) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytes.length - trim))
    } catch {
      // A short file may be entirely an incomplete sequence; try shorter.
    }
  }
  if (text === null) {
    return ok({ ...base, kind: "binary", note: "binary file · no text preview" })
  }
  if (text.includes("\u0000")) {
    return ok({ ...base, kind: "binary", note: "binary file · no text preview" })
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  return ok({
    ...base,
    lines: lines.slice(0, maxLines),
    truncated: info.size > maxBytes || lines.length > maxLines,
  })
}

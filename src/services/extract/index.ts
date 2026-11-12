/**
 * Production source extraction.
 *
 * Promoted from spike S7 (`spikes/s7-clipboard-pdf`, WP-008) after its matrix
 * passed. The rules are unchanged:
 *
 * - classification is by extension only, so a kind never depends on bytes;
 * - text is decoded as UTF-8 with `fatal: true` and normalised once (BOM
 *   dropped, CRLF → LF, trailing newlines trimmed) — invalid bytes are refused,
 *   never replaced with U+FFFD, because a silently mangled source is worse than
 *   a refused one;
 * - PDF goes through `pdftotext`; a missing tool is a typed error with a next
 *   action, and a PDF with no text layer is `no-text` (no OCR, ever);
 * - DOCX is unzipped in-process, so it adds no dependency;
 * - any file may be copied as a source; images are copied but have no text
 *   extraction path, and unknown kinds are attempted as UTF-8 text;
 * - the SHA-256 of the raw bytes is the de-duplication key.
 *
 * No network, no model, no UI. The only process spawned is `pdftotext`, as
 * argv with no shell.
 */

import { basename, resolve } from "node:path"
import { stat } from "node:fs/promises"

import { classifySource, extensionOf, type SourceKind } from "../../domain/source"

export { extensionOf }
import { docxToText } from "./docx"
import { hashOf, normaliseText } from "./text"
import { MAX_ENTRY_BYTES, readZipEntry, readZipText, type ZipEntry } from "./zip"

export type { SourceKind } from "../../domain/source"
export type ExtractableKind = "markdown" | "text" | "code" | "pdf" | "docx" | "other"

export type ExtractError =
  | { kind: "unsupported"; name: string; detected: SourceKind; message: string }
  | { kind: "tool-missing"; name: string; tool: "pdftotext"; message: string }
  | { kind: "malformed"; name: string; format: ExtractableKind; message: string }
  | { kind: "no-text"; name: string; format: ExtractableKind; message: string }
  | { kind: "read"; name: string; message: string }

export type Extraction = {
  ok: true
  name: string
  kind: ExtractableKind
  text: string
  /** `sha256:…` of the raw bytes. */
  hash: string
  bytes: number
  characters: number
  lines: number
  /** PDF only. */
  pages?: number
}

export type ExtractResult = Extraction | { ok: false; error: ExtractError }

export type ExtractOptions = {
  /** Override `pdftotext` lookup. `null` forces the missing-tool path. */
  pdftotext?: string | null
}

/** A source above this is refused before extraction, not inflated in memory. */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024

export { hashOf, normaliseText, docxToText, readZipText, readZipEntry, MAX_ENTRY_BYTES, type ZipEntry }

/** Prefer an error line: pdftotext opens with a "Syntax Warning" for garbage. */
function errorLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return lines.find((line) => /error/i.test(line)) ?? lines[0] ?? ""
}

function resolvePdftotext(options: ExtractOptions): string | null {
  if (options.pdftotext === null) return null
  if (typeof options.pdftotext === "string") return options.pdftotext
  return Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
}

function extractPdf(
  path: string,
  name: string,
  bytes: Uint8Array,
  options: ExtractOptions,
): ExtractResult {
  const tool = resolvePdftotext(options)
  if (tool === null) {
    return {
      ok: false,
      error: {
        kind: "tool-missing",
        name,
        tool: "pdftotext",
        message:
          "pdf sources need `pdftotext` (poppler) on PATH. Install poppler-utils " +
          "(Debian/Ubuntu), poppler (Homebrew), or remove the pdf from the sources.",
      },
    }
  }

  // argv, no shell: a source name can never become a command. The path is
  // resolved first so a file called "-layout" cannot be read as an option.
  const run = Bun.spawnSync({
    cmd: [tool, "-layout", "-enc", "UTF-8", resolve(path), "-"],
    stdout: "pipe",
    stderr: "pipe",
  })

  if (run.exitCode !== 0) {
    const detail = errorLine(run.stderr.toString()) || "pdftotext rejected the file"
    return {
      ok: false,
      error: { kind: "malformed", name, format: "pdf", message: `not a readable PDF: ${detail}` },
    }
  }

  const raw = run.stdout.toString()
  // pdftotext terminates every page with a form feed, including the last one.
  const segments = raw.split("\f")
  const pages = raw.endsWith("\f") ? segments.length - 1 : segments.length
  const text = normaliseText(
    raw
      .replace(/\f/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, ""),
  )

  if (text.trim() === "") {
    return {
      ok: false,
      error: {
        kind: "no-text",
        name,
        format: "pdf",
        message:
          "this pdf has no text layer (scanned image?). OCR is not supported; " +
          "attach the pages as images in chat, or add a text version as the source.",
      },
    }
  }

  return shape(name, "pdf", text, bytes, pages)
}

/** Decode strictly: invalid bytes are refused, never replaced with U+FFFD. */
function decodeStrict(
  bytes: Uint8Array,
  name: string,
  kind: ExtractableKind,
): ExtractResult {
  try {
    const text = normaliseText(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    return shape(name, kind, text, bytes)
  } catch {
    return {
      ok: false,
      error: {
        kind: "malformed",
        name,
        format: kind,
        message: "file is not valid UTF-8 text; convert it to UTF-8 or remove it from the sources",
      },
    }
  }
}

function shape(
  name: string,
  kind: ExtractableKind,
  text: string,
  bytes: Uint8Array,
  pages?: number,
): Extraction {
  const result: Extraction = {
    ok: true,
    name,
    kind,
    text,
    hash: hashOf(bytes),
    bytes: bytes.length,
    characters: text.length,
    lines: text === "" ? 0 : text.split("\n").length,
  }
  if (pages !== undefined) result.pages = pages
  return result
}

/** Extract text from one source file. Never throws at the caller. */
export async function extract(
  path: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const name = basename(path)
  const kind = classifySource(name)

  if (kind === "image") {
    return {
      ok: false,
      error: {
        kind: "unsupported",
        name,
        detected: kind,
        message:
          "image sources are copied, but this build has no image-to-text path. " +
          "Attach the image in chat, or add a text version as the source.",
      },
    }
  }

  let bytes: Uint8Array
  try {
    // Check the size before allocating: a 10 GB "source" must be refused, not
    // read into memory and then refused.
    const info = await stat(path)
    if (!info.isFile()) {
      return {
        ok: false,
        error: { kind: "read", name, message: `${name} is not a regular file` },
      }
    }
    if (info.size > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        error: {
          kind: "malformed",
          name,
          format: kind as ExtractableKind,
          message: `the source is ${(info.size / 1024 / 1024).toFixed(0)} MB; the cap is ${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
        },
      }
    }
    bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "read",
        name,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }

  if (kind === "pdf") return extractPdf(path, name, bytes, options)

  if (kind === "docx") {
    let body: string | null
    try {
      body = await readZipText(bytes, "word/document.xml")
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "malformed",
          name,
          format: "docx",
          message: `not a readable DOCX: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
    if (body === null) {
      return {
        ok: false,
        error: {
          kind: "malformed",
          name,
          format: "docx",
          message: "not a readable DOCX: the archive has no word/document.xml",
        },
      }
    }
    const text = normaliseText(docxToText(body))
    if (text === "") {
      return {
        ok: false,
        error: {
          kind: "no-text",
          name,
          format: "docx",
          message: "this document has no text; add the content or remove it from the sources",
        },
      }
    }
    return shape(name, "docx", text, bytes)
  }

  return decodeStrict(bytes, name, kind)
}

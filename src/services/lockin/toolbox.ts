/**
 * Source-bound toolbox for a lock-in chat.
 *
 * A session's tools can reach exactly one directory: its own `sources/`. There
 * is no `root` or absolute-path parameter anywhere in a tool schema, so a
 * prompt cannot widen the scope (`AGENTS.md` §2.5). Every tool is read-only:
 * `write: false`, `command: false`, `side: "school"` — there is no flag that
 * turns one into a writer.
 *
 * Every result is `{ ok: true, value } | { ok: false, error }`; nothing throws
 * into the chat loop (`swarm/contracts.md` §4.2).
 */

import { readdir, realpath, stat } from "node:fs/promises"
import { join, relative, isAbsolute } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { SOURCE_DIRECTORY, TEXT_SOURCE_KINDS, classifySource, type SourceKind } from "../../domain/source"
import type { Workspace } from "../../storage/workspace"
import { MAX_SOURCE_BYTES, extract, type ExtractError, type ExtractResult } from "../extract"
import { createExtractionCache, type ExtractionCache } from "../extract/cache"
import { sessionFolderFor } from "./manager"

/** Text cap for a single `read_source` result. */
export const READ_CAP_BYTES = 64 * 1024
export const SEARCH_HIT_CAP = 50
export const TRUNCATION_MARKER = "\n… [truncated at 64 KiB]"

/**
 * Kinds a chat can read as text. PDF and DOCX are read through the extraction
 * service; images stay copied but have no text path.
 */
export const READABLE_KINDS: readonly SourceKind[] = TEXT_SOURCE_KINDS

export type ToolError =
  | { kind: "path"; path: string; reason: "escape" | "missing" | "symlink"; message: string }
  | { kind: "unsupported"; name: string; detected: SourceKind; message: string }
  | {
      kind: "extraction"
      name: string
      detected: SourceKind
      reason: ExtractError["kind"]
      message: string
    }
  | { kind: "storage"; path: string; message: string }

export type ToolSpec = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description: string }>
    required: string[]
    additionalProperties: false
  }
  side: "school"
  write: false
  command: false
}

export type SourceEntry = { name: string; kind: SourceKind; bytes: number }
export type ReadResult = {
  name: string
  kind: SourceKind
  text: string
  truncated: boolean
  bytes: number
}
export type SearchHit = { name: string; line: number; snippet: string }
export type SearchResult = { hits: SearchHit[]; total: number; truncated: boolean }

export type Toolbox = {
  sessionId: string
  sourcesDir: string
  specs: ToolSpec[]
  tools: {
    listSources(): Promise<Result<SourceEntry[], ToolError>>
    readSource(name: string): Promise<Result<ReadResult, ToolError>>
    searchSources(term: string): Promise<Result<SearchResult, ToolError>>
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

const SPECS: ToolSpec[] = [
  {
    name: "list_sources",
    description: "List the files copied into this session, with kind and size.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    side: "school",
    write: false,
    command: false,
  },
  {
    name: "read_source",
    description: "Read one copied source by its name, capped at 64 KiB.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Source file name as listed by list_sources." } },
      required: ["name"],
      additionalProperties: false,
    },
    side: "school",
    write: false,
    command: false,
  },
  {
    name: "search_sources",
    description: "Case-insensitive search across this session's copied text sources.",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string", description: "Text to find." } },
      required: ["term"],
      additionalProperties: false,
    },
    side: "school",
    write: false,
    command: false,
  },
]

/** The three specs a session chat gets. Never empty, never writable. */
export function toolsForSession(): ToolSpec[] {
  return SPECS.map((spec) => ({
    ...spec,
    inputSchema: { ...spec.inputSchema, properties: { ...spec.inputSchema.properties } },
  }))
}

export type ToolboxOptions = {
  workspace: Workspace
  sessionId: string
  /** Extracted-text cache. Defaults to the workspace's app-data cache. */
  cache?: ExtractionCache
  /** Injected extractor, so a test can force a typed failure. */
  extractor?: (path: string) => Promise<ExtractResult>
}

/** Map the extractor's typed failure onto the toolbox's error shape. */
function extractionError(name: string, kind: SourceKind, error: ExtractError): ToolError {
  return {
    kind: "extraction",
    name,
    detected: kind,
    reason: error.kind,
    message: error.message,
  }
}

/**
 * Bind a toolbox to one session folder.
 *
 * The resolver is the only way a tool names a file: callers pass a relative
 * name, and everything else is refused with a typed reason.
 */
export function createToolbox(input: ToolboxOptions): Toolbox {
  const sourcesDir = join(sessionFolderFor(input.workspace, input.sessionId), SOURCE_DIRECTORY)
  const cache = input.cache ?? createExtractionCache({ dataDir: input.workspace.paths.dataDir })
  const extractor = input.extractor ?? ((path: string) => extract(path))

  /**
   * Extract a PDF or DOCX through the content-hash cache.
   *
   * The hash is the de-duplication key, so a changed file is always a miss and
   * identical bytes anywhere share one entry. A cache failure falls through to
   * extraction; it is never a user-visible failure.
   */
  const extractText = async (
    path: string,
    name: string,
    kind: SourceKind,
  ): Promise<Result<ReadResult, ToolError>> => {
    let bytes: Uint8Array
    let total: number
    try {
      const info = await stat(path)
      if (!info.isFile()) {
        return err({
          kind: "unsupported",
          name,
          detected: kind,
          message: `"${name}" is not a regular file, so it cannot be read as text`,
        })
      }
      if (info.size > MAX_SOURCE_BYTES) {
        return err({
          kind: "extraction",
          name,
          detected: kind,
          reason: "malformed",
          message:
            `"${name}" is ${(info.size / 1024 / 1024).toFixed(0)} MB; ` +
            `the cap is ${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
        })
      }
      total = info.size
      bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
    } catch (error) {
      return err({ kind: "storage", path: name, message: messageOf(error) })
    }

    const hash = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
    let text = await cache.get(hash)
    if (text === null) {
      const extracted = await extractor(path)
      if (!extracted.ok) return err(extractionError(name, kind, extracted.error))
      text = extracted.text
      await cache.set(hash, text)
    }

    const truncated = text.length > READ_CAP_BYTES
    return ok({
      name,
      kind,
      text: truncated ? `${text.slice(0, READ_CAP_BYTES)}${TRUNCATION_MARKER}` : text,
      truncated,
      bytes: total,
    })
  }

  const resolve = async (name: string): Promise<Result<string, ToolError>> => {
    if (name.trim() === "") {
      return err({ kind: "path", path: name, reason: "missing", message: "a source name is required" })
    }
    if (isAbsolute(name)) {
      return err({
        kind: "path",
        path: name,
        reason: "escape",
        message: "tools take a source name, not an absolute path",
      })
    }
    const target = join(sourcesDir, name)
    if (!isInside(sourcesDir, target)) {
      return err({
        kind: "path",
        path: name,
        reason: "escape",
        message: `"${name}" climbs out of this session's sources`,
      })
    }

    let real: string
    try {
      real = await realpath(target)
    } catch (error) {
      return err({ kind: "path", path: name, reason: "missing", message: messageOf(error) })
    }

    let rootReal: string
    try {
      rootReal = await realpath(sourcesDir)
    } catch (error) {
      return err({ kind: "storage", path: sourcesDir, message: messageOf(error) })
    }
    if (!isInside(rootReal, real)) {
      return err({
        kind: "path",
        path: name,
        reason: "symlink",
        message: `"${name}" is a symlink leading outside this session's sources`,
      })
    }
    return ok(real)
  }

  return {
    sessionId: input.sessionId,
    sourcesDir,
    specs: toolsForSession(),
    tools: {
      async listSources() {
        try {
          const entries = await readdir(sourcesDir, { withFileTypes: true })
          const out: SourceEntry[] = []
          for (const entry of entries) {
            if (!entry.isFile()) continue
            const info = await stat(join(sourcesDir, entry.name))
            out.push({ name: entry.name, kind: classifySource(entry.name), bytes: info.size })
          }
          out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          return ok(out)
        } catch (error) {
          return err({ kind: "storage", path: sourcesDir, message: messageOf(error) })
        }
      },

      async readSource(name: string) {
        const resolved = await resolve(name)
        if (!resolved.ok) return resolved

        const kind = classifySource(name)
        if (kind === "image") {
          return err({
            kind: "unsupported",
            name,
            detected: kind,
            message:
              `"${name}" is an image source, which this build cannot read as text. ` +
              "Attach the image in chat, or add a text version as the source.",
          })
        }
        if (kind === "pdf" || kind === "docx") {
          return extractText(resolved.value, name, kind)
        }
        if (!READABLE_KINDS.includes(kind)) {
          return err({
            kind: "unsupported",
            name,
            detected: kind,
            message:
              `"${name}" is a ${kind} source, which this tool cannot read as text. ` +
              "Markdown, text, code and other UTF-8 files are read directly.",
          })
        }

        try {
          const info = await stat(resolved.value)
          if (!info.isFile()) {
            return err({
              kind: "unsupported",
              name,
              detected: kind,
              message: `"${name}" is not a regular file, so it cannot be read as text`,
            })
          }
          const total = info.size
          const truncated = total > READ_CAP_BYTES
          const bytes = new Uint8Array(
            await Bun.file(resolved.value)
              .slice(0, Math.min(total, READ_CAP_BYTES))
              .arrayBuffer(),
          )
          // `stream: true` leaves an incomplete trailing UTF-8 sequence in the
          // decoder instead of throwing when the byte cap cuts one in half.
          const decoder = new TextDecoder("utf-8", { fatal: true })
          const text = truncated ? decoder.decode(bytes, { stream: true }) : decoder.decode(bytes)
          return ok({
            name,
            kind,
            text: truncated ? `${text}${TRUNCATION_MARKER}` : text,
            truncated,
            bytes: total,
          })
        } catch (error) {
          return err({ kind: "storage", path: name, message: messageOf(error) })
        }
      },

      async searchSources(term: string) {
        if (term === "") return ok({ hits: [], total: 0, truncated: false })
        const needle = term.toLowerCase()
        const hits: SearchHit[] = []
        let total = 0

        const listed = await this.listSources()
        if (!listed.ok) return listed

        for (const entry of listed.value) {
          if (!READABLE_KINDS.includes(entry.kind)) continue
          const read = await this.readSource(entry.name)
          if (!read.ok) continue
          const text = read.value.text
          for (const [index, line] of text.split("\n").entries()) {
            if (!line.toLowerCase().includes(needle)) continue
            total++
            if (hits.length < SEARCH_HIT_CAP) {
              hits.push({ name: entry.name, line: index + 1, snippet: line.trim().slice(0, 200) })
            }
          }
        }

        return ok({ hits, total, truncated: total > hits.length })
      },
    },
  }
}

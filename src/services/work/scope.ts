/**
 * Path-confined toolbox for a Work project chat (WP-502).
 *
 * A project root is a folder the user already owns. This module is the only
 * thing that turns a tool argument into a filesystem path, and it is bound to
 * one resolved root (`docs/product.md` §8.2, `docs/architecture.md` §5,
 * `AGENTS.md` §2.12).
 *
 * The rules, in order of how much they matter:
 *
 * - A tool takes a **relative name**, never an absolute path. No schema here has
 *   a `root` parameter.
 * - `..` is refused as a shape, not just when it happens to escape, and the
 *   normalised result is checked against the root as a second line of defence.
 * - Resolution uses `realpath`, so a symlink inside the root that points outside
 *   is refused with `reason: "symlink"`. This is the rule that is never relaxed.
 * - Every result is `{ ok: true, value } | { ok: false, error }`; nothing throws
 *   into the chat loop (`swarm/contracts.md` §4.2).
 *
 * The three tools shipped here are all `side: "work"`, `write: false`,
 * `command: false`. There is no write tool to disable: WP-504 adds one, and it
 * will be offered only when the global opt-in is on.
 */

import { open, readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { isPathInside } from "../../storage/paths"
import type { ToolSpec } from "../../llm/tools"

/** Text cap for one `read_file` result. */
export const READ_CAP_BYTES = 64 * 1024
export const TRUNCATION_MARKER = "\n… [truncated at 64 KiB]"

/** Listing limits. A depth of 2 keeps a first turn from drowning in output. */
export const DEFAULT_LIST_DEPTH = 2
export const MAX_LIST_DEPTH = 4
export const LIST_CAP = 200

/** Search limits: hits returned, files inspected, bytes per file. */
export const SEARCH_HIT_CAP = 50
export const SEARCH_FILE_CAP = 2_000
export const SEARCH_FILE_BYTES = 1024 * 1024
export const SNIPPET_CHARS = 200

/** Never walked: the object database and dependency trees are not source. */
export const SKIP_DIRECTORIES: readonly string[] = [".git", "node_modules"]

/** The exact tool names a project chat gets in WP-502. */
export const READ_ONLY_TOOL_NAMES = ["list_files", "read_file", "search_files"] as const

export type ScopeError =
  | {
      kind: "path"
      path: string
      reason: "escape" | "missing" | "symlink"
      message: string
    }
  | { kind: "unsupported"; path: string; message: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "tool"; name: string; message: string }

/** The value half of a tool result (`swarm/contracts.md` §4.2). */
export type ToolOutcome<T> = { ok: true; value: T } | { ok: false; error: ScopeError }

export type FileEntry = {
  /** Relative to the project root, always with `/` separators. */
  path: string
  kind: "file" | "directory"
  bytes?: number
}

export type ListResult = {
  entries: FileEntry[]
  total: number
  truncated: boolean
}

export type ReadResult = {
  path: string
  text: string
  truncated: boolean
  bytes: number
}

export type SearchHit = { path: string; line: number; snippet: string }
export type SearchResult = { hits: SearchHit[]; total: number; truncated: boolean }

export type ProjectScope = {
  /** Absolute, symlink-resolved project root. */
  root: string
  specs: ToolSpec[]
  tools: {
    listFiles(options?: { depth?: number }): Promise<ToolOutcome<ListResult>>
    readFile(path: string): Promise<ToolOutcome<ReadResult>>
    searchFiles(term: string): Promise<ToolOutcome<SearchResult>>
  }
  /** The `ToolResolver` the chat loop calls: JSON of a `ToolOutcome`. */
  resolveTool(name: string, input: Record<string, unknown>): Promise<string>
}

const SPECS: readonly ToolSpec[] = [
  {
    name: "list_files",
    description:
      "List files and folders inside the project, relative to its root. Skips .git and node_modules.",
    inputSchema: {
      type: "object",
      properties: {
        depth: {
          type: "integer",
          description: `How many levels below the root to list (1–${MAX_LIST_DEPTH}, default ${DEFAULT_LIST_DEPTH}).`,
          minimum: 1,
          maximum: MAX_LIST_DEPTH,
        },
      },
      required: [],
      additionalProperties: false,
    },
    side: "work",
    write: false,
    command: false,
  },
  {
    name: "read_file",
    description: "Read one text file by its path relative to the project root, capped at 64 KiB.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root, as listed by list_files.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    side: "work",
    write: false,
    command: false,
  },
  {
    name: "search_files",
    description:
      "Case-insensitive substring search across the project's text files, returning path, line and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Text to find." },
      },
      required: ["term"],
      additionalProperties: false,
    },
    side: "work",
    write: false,
    command: false,
  },
]

/**
 * The read-only tool list a project chat may see.
 *
 * `allowWrite` exists so WP-504 can add its write tool at exactly one seam. In
 * this packet the answer is the same three tools whether the opt-in is on or
 * off — there is no write tool anywhere in the build.
 */
export function projectToolSpecs(options: { allowWrite?: boolean } = {}): ToolSpec[] {
  void options
  return SPECS.map((spec) => ({
    ...spec,
    inputSchema: { ...spec.inputSchema, properties: { ...spec.inputSchema.properties } },
  }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

function escapeError(path: string, message: string): ScopeError {
  return { kind: "path", path, reason: "escape", message }
}

function missingError(path: string, message: string): ScopeError {
  return { kind: "path", path, reason: "missing", message }
}

/**
 * Bind a scope to one root.
 *
 * The root is resolved once with `realpath`, so every later comparison is
 * between two real paths. A root that vanished after registration is a typed
 * `missing` error, which the chat reports as a blocked state rather than a
 * crash.
 */
export async function createProjectScope(input: {
  root: string
}): Promise<Result<ProjectScope, ScopeError>> {
  let root: string
  try {
    root = await realpath(input.root)
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err(
        missingError(
          input.root,
          `“${input.root}” is not on disk any more, so the project cannot be read`,
        ),
      )
    }
    return err({ kind: "storage", path: input.root, message: messageOf(error) })
  }

  const info = await stat(root).catch(() => null)
  if (!info || !info.isDirectory()) {
    return err(missingError(input.root, `“${input.root}” is not a folder`))
  }

  /**
   * The single resolver. Relative name in, absolute real path out.
   */
  const resolveInside = async (name: string): Promise<Result<string, ScopeError>> => {
    const requested = name.trim()
    if (requested === "") {
      return err(missingError(name, "a path relative to the project root is required"))
    }
    if (requested.includes("\u0000")) {
      return err(escapeError(name, "a path cannot contain a null byte"))
    }
    if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) {
      return err(
        escapeError(
          name,
          `"${name}" is absolute; tools take a path relative to the project root`,
        ),
      )
    }

    // Refuse the shape, not just the effect: `a/../b` is not something a tool
    // asked for, even when it happens to land back inside the root.
    for (const segment of requested.split(/[\\/]/)) {
      if (segment === "..") {
        return err(escapeError(name, `"${name}" climbs out of the project root`))
      }
    }

    const target = resolve(root, requested)
    if (!isPathInside(root, target)) {
      return err(escapeError(name, `"${name}" climbs out of the project root`))
    }

    let real: string
    try {
      real = await realpath(target)
    } catch (error) {
      if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
        return err(missingError(name, `"${name}" does not exist in this project`))
      }
      return err({ kind: "storage", path: name, message: messageOf(error) })
    }

    if (!isPathInside(root, real)) {
      return err({
        kind: "path",
        path: name,
        reason: "symlink",
        message: `"${name}" is a symlink leading outside the project root`,
      })
    }
    return ok(real)
  }

  const listFiles = async (
    options: { depth?: number } = {},
  ): Promise<ToolOutcome<ListResult>> => {
    const depth = Math.min(
      MAX_LIST_DEPTH,
      Math.max(1, Math.trunc(options.depth ?? DEFAULT_LIST_DEPTH)),
    )
    const entries: FileEntry[] = []
    let total = 0
    let truncated = false

    const walk = async (directory: string, level: number): Promise<void> => {
      let children
      try {
        children = await readdir(directory, { withFileTypes: true })
      } catch {
        // A subdirectory we cannot read is skipped; the rest still lists.
        return
      }
      children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

      for (const child of children) {
        if (truncated) return
        if (child.isSymbolicLink()) continue
        const absolute = join(directory, child.name)
        const path = relative(root, absolute).split(sep).join("/")

        if (child.isDirectory()) {
          if (SKIP_DIRECTORIES.includes(child.name)) continue
          total++
          if (entries.length >= LIST_CAP) {
            truncated = true
            return
          }
          entries.push({ path, kind: "directory" })
          if (level < depth) await walk(absolute, level + 1)
          continue
        }

        if (!child.isFile()) continue
        total++
        if (entries.length >= LIST_CAP) {
          truncated = true
          return
        }
        const info = await stat(absolute).catch(() => null)
        entries.push({ path, kind: "file", bytes: info?.size ?? 0 })
      }
    }

    try {
      await walk(root, 1)
    } catch (error) {
      return { ok: false, error: { kind: "storage", path: root, message: messageOf(error) } }
    }
    return { ok: true, value: { entries, total, truncated } }
  }

  const readFile = async (name: string): Promise<ToolOutcome<ReadResult>> => {
    const resolved = await resolveInside(name)
    if (!resolved.ok) return { ok: false, error: resolved.error }

    let handle
    try {
      const opening = await stat(resolved.value)
      if (!opening.isFile()) {
        return {
          ok: false,
          error: { kind: "unsupported", path: name, message: `"${name}" is not a regular file` },
        }
      }
      handle = await open(resolved.value, "r")
      const info = await handle.stat()
      if (!info.isFile()) {
        return {
          ok: false,
          error: { kind: "unsupported", path: name, message: `"${name}" is not a file` },
        }
      }

      const size = info.size
      const window = Math.min(size, READ_CAP_BYTES + 4)
      const buffer = Buffer.alloc(window)
      const { bytesRead } = await handle.read(buffer, 0, window, 0)
      const bytes = buffer.subarray(0, bytesRead)

      // A NUL in the head is the cheapest reliable binary signal, and it does
      // not depend on the file being valid UTF-8.
      if (bytes.subarray(0, Math.min(bytes.length, 8_000)).includes(0)) {
        return {
          ok: false,
          error: {
            kind: "unsupported",
            path: name,
            message: `"${name}" is a binary file, so it cannot be read as text`,
          },
        }
      }

      const truncated = size > READ_CAP_BYTES
      const slice = bytes.subarray(0, Math.min(bytes.length, READ_CAP_BYTES))
      let text: string
      try {
        text = new TextDecoder("utf-8", { fatal: !truncated }).decode(slice)
        if (truncated) text = text.replace(/\uFFFD+$/u, "")
      } catch {
        return {
          ok: false,
          error: {
            kind: "unsupported",
            path: name,
            message: `"${name}" is not UTF-8 text, so it cannot be read`,
          },
        }
      }

      return {
        ok: true,
        value: {
          path: name,
          text: truncated ? `${text}${TRUNCATION_MARKER}` : text,
          truncated,
          bytes: size,
        },
      }
    } catch (error) {
      if (codeOf(error) === "ENOENT") {
        return { ok: false, error: missingError(name, `"${name}" does not exist in this project`) }
      }
      return { ok: false, error: { kind: "storage", path: name, message: messageOf(error) } }
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  /** Every text file worth searching, relative and capped. */
  const searchableFiles = async (): Promise<string[]> => {
    const files: string[] = []
    const queue: string[] = [root]

    while (queue.length > 0 && files.length < SEARCH_FILE_CAP) {
      const directory = queue.shift() as string
      let children
      try {
        children = await readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const child of children) {
        if (files.length >= SEARCH_FILE_CAP) break
        if (child.isSymbolicLink()) continue
        const absolute = join(directory, child.name)
        if (child.isDirectory()) {
          if (SKIP_DIRECTORIES.includes(child.name)) continue
          queue.push(absolute)
          continue
        }
        if (!child.isFile()) continue
        const info = await stat(absolute).catch(() => null)
        if (!info || info.size > SEARCH_FILE_BYTES) continue
        files.push(relative(root, absolute).split(sep).join("/"))
      }
    }
    return files
  }

  const searchFiles = async (term: string): Promise<ToolOutcome<SearchResult>> => {
    if (term === "") return { ok: true, value: { hits: [], total: 0, truncated: false } }
    const needle = term.toLowerCase()
    const hits: SearchHit[] = []
    let total = 0

    try {
      for (const path of await searchableFiles()) {
        let text: string
        try {
          const bytes = await Bun.file(join(root, path)).arrayBuffer()
          if (new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8_000)).includes(0)) continue
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        } catch {
          // Binary or unreadable: not a search target, not an error.
          continue
        }
        for (const [index, line] of text.split("\n").entries()) {
          if (!line.toLowerCase().includes(needle)) continue
          total++
          if (hits.length < SEARCH_HIT_CAP) {
            hits.push({
              path,
              line: index + 1,
              snippet: line.trim().slice(0, SNIPPET_CHARS),
            })
          }
        }
      }
    } catch (error) {
      return { ok: false, error: { kind: "storage", path: root, message: messageOf(error) } }
    }

    return { ok: true, value: { hits, total, truncated: total > hits.length } }
  }

  const call = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolOutcome<unknown>> => {
    switch (name) {
      case "list_files":
        return listFiles({
          depth: typeof input.depth === "number" ? input.depth : undefined,
        })
      case "read_file":
        if (typeof input.path !== "string") {
          return {
            ok: false,
            error: missingError("", 'read_file needs a "path" relative to the project root'),
          }
        }
        return readFile(input.path)
      case "search_files":
        if (typeof input.term !== "string") {
          return {
            ok: false,
            error: missingError("", 'search_files needs a "term" to look for'),
          }
        }
        return searchFiles(input.term)
      default:
        return {
          ok: false,
          error: { kind: "tool", name, message: `unknown tool "${name}"` },
        }
    }
  }

  return ok({
    root,
    specs: projectToolSpecs(),
    tools: { listFiles, readFile, searchFiles },
    async resolveTool(name: string, input: Record<string, unknown>): Promise<string> {
      return JSON.stringify(await call(name, input))
    },
  })
}

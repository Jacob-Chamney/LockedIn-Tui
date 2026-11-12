/**
 * Read-only toolbox for a skill chat: its own goal's gathered sources.
 *
 * Mirrors the lock-in toolbox (WP-302) on the other side of the wall: one
 * resolver bound to `<workspace>/skills/goals/<goalId>/sources/`, relative names
 * only, every refusal typed, and no spec that can write or run anything.
 *
 * Extraction is WP-307's job, so a PDF is read as text rather than as bytes.
 */

import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { isInsideSources } from "../../domain/source"
import type { Workspace } from "../../storage/workspace"
import { extract, type ExtractResult } from "../extract"
import type { ExtractionCache } from "../extract/cache"
import { goalFolder, readGoal } from "./create"
import type { SkillSource } from "./gather"

export const READ_CAP_BYTES = 64 * 1024
export const SEARCH_HIT_CAP = 50
export const TRUNCATION_MARKER = "\n… [truncated at 64 KiB]"

export type SkillsToolError =
  | {
      kind: "path"
      path: string
      reason: "escape" | "missing" | "symlink"
      message: string
    }
  | { kind: "blocked"; message: string; next: string }
  | { kind: "storage"; path: string; message: string }
  | { kind: "unsupported"; name: string; detected: string; message: string }

export type SkillsToolSpec = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description: string }>
    required: string[]
    additionalProperties: false
  }
  side: "skills"
  write: false
  command: false
}

const SPECS: readonly SkillsToolSpec[] = [
  {
    name: "list_sources",
    description: "List this goal's gathered sources with kind, size, origin and excerpt.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    side: "skills",
    write: false,
    command: false,
  },
  {
    name: "read_source",
    description: "Read one gathered source by name, with its saved excerpt, capped at 64 KiB.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Source name as listed by list_sources." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    side: "skills",
    write: false,
    command: false,
  },
  {
    name: "search_sources",
    description: "Case-insensitive search across this goal's sources, returning labelled excerpts.",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string", description: "Text to find." } },
      required: ["term"],
      additionalProperties: false,
    },
    side: "skills",
    write: false,
    command: false,
  },
]

/** The three read-only specs a skill chat gets. Never empty, never writable. */
export function skillsToolSpecs(): SkillsToolSpec[] {
  return SPECS.map((spec) => ({
    ...spec,
    inputSchema: { ...spec.inputSchema, properties: { ...spec.inputSchema.properties } },
  }))
}

export type SourceSummary = {
  name: string
  kind: string
  hash: string
  bytes: number
  origin: string
  excerpt: string | null
  unusable: boolean
}

export type ReadOutcome = {
  name: string
  kind: string
  hash: string
  bytes: number
  origin: string
  excerpt: string | null
  text: string
  truncated: boolean
}

export type SearchHit = {
  name: string
  line: number
  snippet: string
  origin: string
  excerpt: string | null
}

export type SearchOutcome = { hits: SearchHit[]; total: number; truncated: boolean }

export type SkillsToolbox = {
  goalId: string
  sourcesDir: string
  specs: SkillsToolSpec[]
  tools: {
    listSources(): Promise<Result<SourceSummary[], SkillsToolError>>
    readSource(name: string): Promise<Result<ReadOutcome, SkillsToolError>>
    searchSources(term: string): Promise<Result<SearchOutcome, SkillsToolError>>
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Validate one `meta.json` source before any tool trusts its stored path. */
function checkSource(value: unknown): Result<SkillSource, SkillsToolError> {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.storedPath !== "string" ||
    typeof value.hash !== "string" ||
    typeof value.kind !== "string"
  ) {
    return err({
      kind: "storage",
      path: "meta.json",
      message: "a source entry is missing its name, stored path, hash or kind",
    })
  }
  if (!isInsideSources(value.storedPath)) {
    return err({
      kind: "path",
      path: value.storedPath,
      reason: "escape",
      message: `"${value.name}" points outside this goal's sources`,
    })
  }
  return ok(value as SkillSource)
}

/** Load the goal and its sources once per call, so a tool never sees a stale list. */
async function loadGoal(input: { workspace: Workspace; goalId: string }): Promise<
  Result<{ sources: SkillSource[]; archived: boolean }, SkillsToolError>
> {
  const folder = goalFolder(input.workspace, input.goalId)
  const goal = await readGoal(folder)
  if (!goal.ok) {
    return err({
      kind: "blocked",
      message: `there is no goal "${input.goalId}" in this workspace`,
      next: "Open a skill session first, or create one from the goal wizard.",
    })
  }

  let meta: { sources?: unknown }
  try {
    meta = JSON.parse(await readFile(join(folder, "meta.json"), "utf8")) as { sources?: unknown }
  } catch (error) {
    return err({ kind: "storage", path: join(folder, "meta.json"), message: messageOf(error) })
  }

  const rawSources = meta.sources ?? []
  if (!Array.isArray(rawSources)) {
    return err({
      kind: "storage",
      path: join(folder, "meta.json"),
      message: "meta.json sources must be a list",
    })
  }
  const sources: SkillSource[] = []
  for (const raw of rawSources) {
    const checked = checkSource(raw)
    if (!checked.ok) return checked
    sources.push(checked.value)
  }

  return ok({ sources, archived: goal.value.goal.archived })
}

/**
 * Bind a toolbox to one goal.
 *
 * An archived goal is refused for every tool: its sources are read-only history,
 * so a chat should be reopened through restore, not quietly cited.
 */
export type SkillsToolboxOptions = {
  workspace: Workspace
  goalId: string
  /**
   * Extracted-text cache. Optional: without it every call extracts, which is
   * the pre-cache behaviour and stays available for tests and debugging.
   */
  cache?: ExtractionCache
  /** Injected extractor, so a test can count calls. Defaults to WP-307. */
  extractor?: (path: string) => Promise<ExtractResult>
}

export function createSkillsToolbox(input: SkillsToolboxOptions): SkillsToolbox {
  const folder = goalFolder(input.workspace, input.goalId)
  const sourcesDir = join(folder, "sources")
  const extractor = input.extractor ?? ((path: string) => extract(path))
  const cache = input.cache

  /**
   * Extract through the cache, keyed by the file's **content hash**, so a
   * changed file is a miss and identical bytes anywhere hit the same entry.
   */
  const textFor = async (
    path: string,
  ): Promise<Result<{ text: string; bytes: number }, SkillsToolError>> => {
    let raw: Uint8Array
    try {
      const real = await realpath(path)
      const rootReal = await realpath(sourcesDir)
      if (!isInside(rootReal, real)) {
        return err({
          kind: "path",
          path,
          reason: "symlink",
          message: "the source resolves outside this goal's sources",
        })
      }
      const info = await stat(real)
      if (!info.isFile()) {
        return err({ kind: "path", path, reason: "missing", message: "the source is not a regular file" })
      }
      raw = new Uint8Array(await readFile(real))
    } catch (error) {
      return err({ kind: "path", path, reason: "missing", message: messageOf(error) })
    }

    const hash = `sha256:${new Bun.CryptoHasher("sha256").update(raw).digest("hex")}`
    if (cache) {
      const cached = await cache.get(hash)
      if (cached !== null) return ok({ text: cached, bytes: raw.length })
    }

    const extracted = await extractor(path)
    if (!extracted.ok) {
      return err({
        kind: "unsupported",
        name: path.split("/").pop() ?? path,
        detected: extracted.error.kind === "unsupported" ? extracted.error.detected : "other",
        message: extracted.error.message,
      })
    }

    if (cache) await cache.set(hash, extracted.text)
    return ok({ text: extracted.text, bytes: extracted.bytes })
  }

  const load = async (): Promise<Result<SkillSource[], SkillsToolError>> => {
    const goal = await loadGoal(input)
    if (!goal.ok) return goal
    if (goal.value.archived) {
      return err({
        kind: "blocked",
        message: `goal "${input.goalId}" is archived`,
        next: "restore the goal first, then ask about its sources",
      })
    }
    return ok(goal.value.sources)
  }

  const resolve = async (name: string): Promise<Result<SkillSource, SkillsToolError>> => {
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

    const sources = await load()
    if (!sources.ok) return sources

    const found = sources.value.find((source) => source.name === name)
    if (!found) {
      return err({
        kind: "path",
        path: name,
        reason: "missing",
        message: `"${name}" is not one of this goal's sources`,
      })
    }

    // The stored path comes from meta.json, so it is re-validated here rather
    // than trusted: a hand-edited meta must not widen the scope.
    if (!isInsideSources(found.storedPath)) {
      return err({
        kind: "path",
        path: found.storedPath,
        reason: "escape",
        message: `"${name}" points outside this goal's sources`,
      })
    }

    const target = join(sourcesDir, found.storedPath.replace(/^sources\//, ""))
    if (!isInside(sourcesDir, target)) {
      return err({
        kind: "path",
        path: found.storedPath,
        reason: "escape",
        message: `"${name}" climbs out of this goal's sources`,
      })
    }

    try {
      const real = await realpath(target)
      const rootReal = await realpath(sourcesDir)
      if (!isInside(rootReal, real)) {
        return err({
          kind: "path",
          path: found.storedPath,
          reason: "symlink",
          message: `"${name}" is a symlink leading outside this goal's sources`,
        })
      }
    } catch (error) {
      return err({ kind: "path", path: found.storedPath, reason: "missing", message: messageOf(error) })
    }

    return ok(found)
  }

  return {
    goalId: input.goalId,
    sourcesDir,
    specs: skillsToolSpecs(),
    tools: {
      async listSources() {
        const sources = await load()
        if (!sources.ok) return sources

        const summaries: SourceSummary[] = []
        for (const source of sources.value) {
          let bytes = 0
          try {
            const info = await lstat(join(sourcesDir, source.storedPath.replace(/^sources\//, "")))
            bytes = info.isFile() ? info.size : 0
          } catch {
            bytes = 0
          }
          summaries.push({
            name: source.name,
            kind: source.kind,
            hash: source.hash,
            bytes,
            origin: source.origin,
            excerpt: source.excerpt?.text ?? null,
            unusable: source.unusable,
          })
        }
        summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        return ok(summaries)
      },

      async readSource(name: string) {
        const resolved = await resolve(name)
        if (!resolved.ok) return resolved

        const source = resolved.value
        const path = join(sourcesDir, source.storedPath.replace(/^sources\//, ""))

        // Extraction, not a binary read: a pdf must arrive as text. The cache
        // is keyed by content hash, so an unchanged file costs one read.
        const extracted = await textFor(path)
        if (!extracted.ok) {
          return err({
            ...extracted.error,
            name: source.name,
            detected: extracted.error.kind === "unsupported" ? extracted.error.detected : source.kind,
          })
        }

        const truncated = extracted.value.text.length > READ_CAP_BYTES
        return ok({
          name: source.name,
          kind: source.kind,
          hash: source.hash,
          bytes: extracted.value.bytes,
          origin: source.origin,
          excerpt: source.excerpt?.text ?? null,
          text: truncated
            ? `${extracted.value.text.slice(0, READ_CAP_BYTES)}${TRUNCATION_MARKER}`
            : extracted.value.text,
          truncated,
        })
      },

      async searchSources(term: string) {
        if (term.trim() === "") return ok({ hits: [], total: 0, truncated: false })
        const needle = term.toLowerCase()

        const sources = await load()
        if (!sources.ok) return sources

        const hits: SearchHit[] = []
        let total = 0

        for (const source of sources.value) {
          const path = join(sourcesDir, source.storedPath.replace(/^sources\//, ""))
          const extracted = await textFor(path)
          if (!extracted.ok) continue

          for (const [index, line] of extracted.value.text.split("\n").entries()) {
            if (!line.toLowerCase().includes(needle)) continue
            total++
            if (hits.length >= SEARCH_HIT_CAP) continue
            hits.push({
              name: source.name,
              line: index + 1,
              snippet: line.trim().slice(0, 200),
              origin: source.origin,
              excerpt: source.excerpt?.text ?? null,
            })
          }
        }

        return ok({ hits, total, truncated: total > hits.length })
      },
    },
  }
}

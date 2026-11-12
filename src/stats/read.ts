/**
 * Tolerant readers for the two counter files.
 *
 * A missing file is an empty history, not an error. A corrupt file returns an
 * empty history **with** a diagnostic: losing counters must never block the
 * Stats page or crash the app (`docs/product.md` §10.3).
 *
 * Both files live in the app data directory. Nothing here reads the workspace.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { LearningEvent, LearningKind, StatsScope, UsageRun } from "./types"
import { LEARNING_KINDS, SCOPES } from "./types"
import { isRunScope } from "../llm/usage"

export const USAGE_FILE = "usage.json"
export const STATS_FILE = "stats.json"
export const STATS_SCHEMA = 1

export type ReadResult<T> = { value: T; diagnostic: string | null }

const EMPTY_USAGE: UsageRun[] = []
const EMPTY_EVENTS: LearningEvent[] = []

function diagnostic(file: string): string {
  return `${file} was unreadable and has been ignored. Counters shown here may be incomplete.`
}

function asScope(value: unknown): StatsScope | undefined {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value)
    ? (value as StatsScope)
    : undefined
}

/** `usage.json`, written by WP-203. Extra fields (e.g. `scope`) are kept. */
export async function readUsage(dir: string): Promise<ReadResult<UsageRun[]>> {
  let raw: string
  try {
    raw = await readFile(join(dir, USAGE_FILE), "utf8")
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return { value: EMPTY_USAGE, diagnostic: null }
    return { value: EMPTY_USAGE, diagnostic: diagnostic(USAGE_FILE) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: EMPTY_USAGE, diagnostic: diagnostic(USAGE_FILE) }
  }
  const runs = (parsed as { runs?: unknown })?.runs
  if (!Array.isArray(runs)) return { value: EMPTY_USAGE, diagnostic: diagnostic(USAGE_FILE) }

  const value: UsageRun[] = []
  for (const run of runs) {
    if (typeof run !== "object" || run === null) continue
    const r = run as Partial<UsageRun>
    if (typeof r.model !== "string" || typeof r.at !== "string") continue
    if (typeof r.input !== "number" || typeof r.output !== "number") continue
    // A run's scope is never "all": only a recorded side counts as one
    // (WP-136). Anything else stays "all only".
    const scope = isRunScope(r.scope) ? r.scope : undefined
    value.push({
      model: r.model,
      input: r.input,
      output: r.output,
      costMicroUsd: typeof r.costMicroUsd === "number" ? r.costMicroUsd : null,
      at: r.at,
      failed: r.failed === true,
      ...(scope === undefined ? {} : { scope }),
    })
  }
  return { value, diagnostic: null }
}

/** `stats.json`: local learning counters (steps, cards, lessons, tool calls). */
export async function readLearning(dir: string): Promise<ReadResult<LearningEvent[]>> {
  let raw: string
  try {
    raw = await readFile(join(dir, STATS_FILE), "utf8")
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return { value: EMPTY_EVENTS, diagnostic: null }
    return { value: EMPTY_EVENTS, diagnostic: diagnostic(STATS_FILE) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: EMPTY_EVENTS, diagnostic: diagnostic(STATS_FILE) }
  }
  const events = (parsed as { events?: unknown })?.events
  if (!Array.isArray(events)) return { value: EMPTY_EVENTS, diagnostic: diagnostic(STATS_FILE) }

  const value: LearningEvent[] = []
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue
    const e = event as Partial<LearningEvent>
    if (typeof e.at !== "string") continue
    if (typeof e.kind !== "string" || !(LEARNING_KINDS as readonly string[]).includes(e.kind)) continue
    const scope = asScope(e.scope) ?? "all"
    value.push({
      kind: e.kind as LearningKind,
      at: e.at,
      scope,
      ...(typeof e.name === "string" ? { name: e.name } : {}),
    })
  }
  return { value, diagnostic: null }
}

/**
 * Usage accounting (`docs/product.md` §10.2).
 *
 * Tokens and estimated cost are always available; a failed call still counts
 * what arrived; the record lives in the app data directory, never inside the
 * workspace, and is replaced atomically.
 *
 * A corrupt `usage.json` resets to empty **with** a diagnostic. It never throws
 * and never blocks a request: losing a counter must not lose the user's work.
 */
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { periodStart, type BudgetPeriod } from "./budget"
import type { ChatEvent, Usage } from "./events"

export const USAGE_SCHEMA = 1
export const USAGE_FILE = "usage.json"

/**
 * How much history is kept.
 *
 * 90 days is the longest stats window (`docs/product.md` §6.1, WP-132), so every
 * range the UI can show still has its records. Anything older can only grow the
 * file and slow every load, with nothing left that reads it. One constant, one
 * reason, no configuration: a user-tunable retention would be a way to silently
 * lose a total.
 */
export const RETENTION_DAYS = 90

/**
 * Which side produced a run. Never inferred from a model name or a path: the
 * caller states it (`swarm/packets/WP-136.md`).
 */
export type RunScope = "school" | "skills" | "work"

export const RUN_SCOPES: readonly RunScope[] = ["school", "skills", "work"]

export function isRunScope(value: unknown): value is RunScope {
  return typeof value === "string" && (RUN_SCOPES as readonly string[]).includes(value)
}

/** Which runs a retention pass kept, and why it may have refused. */
export type RetentionReport = {
  kept: number
  dropped: number
  refused: boolean
  diagnostic: string | null
}

export type RunRecord = {
  /** Provider-qualified model id, e.g. `openai/gpt-4.1-mini`. */
  model: string
  input: number
  output: number
  /** `null` when the model has no price; 0 for a free local endpoint. */
  costMicroUsd: number | null
  /** ISO-8601 UTC. */
  at: string
  /** A failed call is still a run, and still spends tokens. */
  failed: boolean
  /** Required on every new write. */
  scope: RunScope
}

/**
 * A run as it appears in `usage.json`. Records written before WP-136 have no
 * `scope`; they keep loading, count toward "all" only, and are **never**
 * rewritten to add one.
 */
export type StoredRunRecord = Omit<RunRecord, "scope"> & { scope?: RunScope }

export type UsageFile = {
  schema: typeof USAGE_SCHEMA
  runs: StoredRunRecord[]
}

export type UsageDiagnostic = {
  code: "unreadable" | "corrupt" | "wrong-shape"
  message: string
  next: string
}

export type LoadResult = {
  runs: StoredRunRecord[]
  diagnostic: UsageDiagnostic | null
}

export type UsageTotals = {
  input: number
  output: number
  /** `null` if any contributing run had an unknown price. */
  costMicroUsd: number | null
  runs: number
  failed: number
}

const EMPTY: UsageFile = { schema: USAGE_SCHEMA, runs: [] }

function parseUsageFile(raw: string): UsageFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const candidate = parsed as Partial<UsageFile>
  if (candidate.schema !== USAGE_SCHEMA || !Array.isArray(candidate.runs)) return null
  const runs: StoredRunRecord[] = []
  for (const run of candidate.runs) {
    if (typeof run !== "object" || run === null) return null
    const r = run as Partial<StoredRunRecord>
    if (typeof r.model !== "string" || typeof r.at !== "string") return null
    if (typeof r.input !== "number" || typeof r.output !== "number") return null
    if (!(typeof r.costMicroUsd === "number" || r.costMicroUsd === null)) return null
    runs.push({
      model: r.model,
      input: r.input,
      output: r.output,
      costMicroUsd: r.costMicroUsd,
      at: r.at,
      failed: r.failed === true,
      // Only a valid scope is kept; anything else means "all only".
      ...(isRunScope(r.scope) ? { scope: r.scope } : {}),
    })
  }
  return { schema: USAGE_SCHEMA, runs }
}

/** Sum `usage` events from one run: tool-loop steps included (S5: 29 + 36). */
export function sumUsageEvents(events: readonly ChatEvent[]): Usage {
  let input = 0
  let output = 0
  let total: number | null = 0
  for (const event of events) {
    if (event.type !== "usage") continue
    input += event.tokens.input
    output += event.tokens.output
    total = total === null || event.tokens.total === null ? null : total + event.tokens.total
  }
  return { input, output, total }
}

/**
 * First instant retention keeps: local midnight `RETENTION_DAYS - 1` days ago.
 * Same convention as the 90-day stats window, so a kept run is a run the stats
 * page can still show.
 */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RETENTION_DAYS - 1), 0, 0, 0, 0)
}

/**
 * Apply retention to a loaded run list. Pure: same input, same output.
 *
 * Two safety rules on top of the window:
 *
 *   - a run inside the current budget period is always kept. With a 90-day
 *     window and at most a month-long period the cutoff is always older than
 *     the period floor, so this clause is defensive: it keeps the guarantee
 *     true if the window is ever shortened. The guard below is what actually
 *     protects a skewed clock;
 *   - a pass that would drop more than half the file is refused with a
 *     diagnostic, so a clock jump (forward, making live runs look ancient)
 *     cannot erase the history that protects the budget.
 *
 * Malformed timestamps are kept: we cannot prove they are old, and silently
 * dropping an unreadable line is worse than carrying it.
 */
export function retainRuns(
  runs: readonly StoredRunRecord[],
  now: Date,
): { runs: StoredRunRecord[]; report: RetentionReport } {
  const cutoff = retentionCutoff(now).getTime()
  // The month start covers both budget periods (`day` and `month`).
  const periodFloor = periodStart(now, "month").getTime()

  const kept: StoredRunRecord[] = []
  let dropped = 0
  for (const run of runs) {
    const at = new Date(run.at).getTime()
    if (!Number.isFinite(at)) {
      kept.push(run)
      continue
    }
    if (at >= cutoff || at >= periodFloor) kept.push(run)
    else dropped += 1
  }

  if (dropped > runs.length / 2) {
    return {
      runs: [...runs],
      report: {
        kept: runs.length,
        dropped: 0,
        refused: true,
        diagnostic: `Retention would drop ${dropped} of ${runs.length} runs, which looks like a clock problem. Nothing was removed.`,
      },
    }
  }

  return {
    runs: kept,
    report: { kept: kept.length, dropped, refused: false, diagnostic: null },
  }
}

export type UsageStore = {
  /** Absolute path of `usage.json`, for diagnostics and the atomic-write test. */
  readonly path: string
  load(): Promise<LoadResult>
  /** Append one run and replace the file atomically. */
  append(run: RunRecord): Promise<void>
  /** Totals for runs at or after `since` (inclusive); no `since` = all time. */
  totals(since?: Date): Promise<UsageTotals>
  /**
   * Apply retention now and rewrite once. `append` calls this too, so the file
   * never grows past the window during normal use.
   */
  compact(now?: Date): Promise<RetentionReport>
  /** Test/diagnostic seam: drop every run. */
  reset(): Promise<void>
}

export function createUsageStore(options: { dir: string; now?: () => Date }): UsageStore {
  const path = join(options.dir, USAGE_FILE)
  const clock = options.now ?? (() => new Date())
  // Every buffer shares one store. Without a queue, two turns load the same
  // array and each rewrite only its own run, losing the other.
  let queue: Promise<unknown> = Promise.resolve()
  const serialise = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const load = async (): Promise<LoadResult> => {
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === "ENOENT") return { runs: [], diagnostic: null }
      return {
        runs: [],
        diagnostic: {
          code: "unreadable",
          message: "Could not read usage.json.",
          next: "Counters start again from zero. Check the data folder's permissions.",
        },
      }
    }
    const parsed = parseUsageFile(raw)
    if (!parsed) {
      return {
        runs: [],
        diagnostic: {
          code: "corrupt",
          message: "usage.json was unreadable and has been reset.",
          next: "Spending counters restart from zero; your sessions are unaffected.",
        },
      }
    }
    return { runs: parsed.runs, diagnostic: null }
  }

  /** temp file → fsync → rename, in the same directory (data-model §3). */
  const writeAtomic = async (file: UsageFile): Promise<void> => {
    await mkdir(dirname(path), { recursive: true })
    const tmp = join(dirname(path), `.${USAGE_FILE}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`)
    const handle = await open(tmp, "w")
    try {
      await handle.writeFile(JSON.stringify(file, null, 2) + "\n", "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(tmp, path)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }

  return {
    path,

    load,

    append(run) {
      return serialise(async () => {
        const loaded = await load()
        // A corrupt file is replaced, not appended to: the diagnostic already
        // told the user the counters restarted.
        const { runs } = retainRuns([...loaded.runs, run], clock())
        // One atomic rewrite: the new run and the trim land together or not at all.
        await writeAtomic({ schema: USAGE_SCHEMA, runs })
      })
    },

    compact(now) {
      return serialise(async () => {
        const loaded = await load()
        const { runs, report } = retainRuns(loaded.runs, now ?? clock())
        if (report.dropped > 0) await writeAtomic({ schema: USAGE_SCHEMA, runs })
        return report
      })
    },

    async totals(since) {
      const { runs } = await load()
      const inRange = since ? runs.filter((run) => new Date(run.at).getTime() >= since.getTime()) : runs
      let cost: number | null = 0
      for (const run of inRange) {
        if (run.costMicroUsd === null) cost = null
        else if (cost !== null) cost += run.costMicroUsd
      }
      const totals: UsageTotals = {
        input: inRange.reduce((sum, run) => sum + run.input, 0),
        output: inRange.reduce((sum, run) => sum + run.output, 0),
        costMicroUsd: cost,
        runs: inRange.length,
        failed: inRange.filter((run) => run.failed).length,
      }
      return totals
    },

    reset() {
      return serialise(() => writeAtomic(EMPTY))
    },
  }
}

/** Build a run record from a finished (or failed) request. */
/**
 * Build a run record from a finished (or failed) request.
 *
 * `scope` is required: a caller that does not know which side a chat belongs to
 * must not guess, and "work" is only correct for a real Work chat.
 */
export function runRecord(input: {
  model: string
  usage: Usage
  costMicroUsd: number | null
  scope: RunScope
  failed?: boolean
  at?: Date
}): RunRecord {
  return {
    model: input.model,
    input: input.usage.input,
    output: input.usage.output,
    costMicroUsd: input.costMicroUsd,
    at: (input.at ?? new Date()).toISOString(),
    failed: input.failed === true,
    scope: input.scope,
  }
}

/** What the budget gate needs to know before it lets a request out. */
export type SpendSeed = {
  /** Integer micro-USD spent inside the current period. */
  spentMicroUsd: number
  /** Runs in the period whose price is unknown; they contribute 0 to spend. */
  unpriced: number
  /** Runs in the period, priced or not. */
  runs: number
  diagnostic: string | null
}

/**
 * Sum the runs inside the current budget period.
 *
 * Period boundaries are local (`periodStart` in `budget.ts`): a user's "today"
 * is their local day, while `at` stays UTC. A run one millisecond before the
 * boundary belongs to the previous period.
 */
export function spentFor(
  runs: readonly StoredRunRecord[],
  period: BudgetPeriod,
  now: Date,
): Omit<SpendSeed, "diagnostic"> {
  const start = periodStart(now, period).getTime()
  let spentMicroUsd = 0
  let unpriced = 0
  let counted = 0
  for (const run of runs) {
    const at = new Date(run.at).getTime()
    if (!Number.isFinite(at) || at < start) continue
    counted += 1
    if (run.costMicroUsd === null) unpriced += 1
    else spentMicroUsd += run.costMicroUsd
  }
  return { spentMicroUsd, unpriced, runs: counted }
}

/**
 * Seed for `createChatController`: read `usage.json` and sum this period.
 *
 * A corrupt or unreadable file returns zero **with** a diagnostic, so the
 * caller can say "spending counters restarted" instead of silently resetting
 * the budget (`swarm/packets/WP-141.md`).
 */
export async function spentFromUsage(dir: string, period: BudgetPeriod, now: Date): Promise<SpendSeed> {
  const store = createUsageStore({ dir })
  const loaded = await store.load()
  const totals = spentFor(loaded.runs, period, now)
  return {
    ...totals,
    diagnostic: loaded.diagnostic
      ? `${loaded.diagnostic.message} ${loaded.diagnostic.next}`
      : null,
  }
}

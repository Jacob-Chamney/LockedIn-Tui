/**
 * Stats page data (`docs/product.md` §6.1, §10.2).
 *
 * Reads only the app data directory: `usage.json` (WP-203) and the local
 * learning counters. Never reads a workspace note, a prompt or a chat body —
 * `docs/architecture.md` §9 keeps content out of stats.
 */

export type StatsRange = "7d" | "30d" | "90d" | "all"
export type StatsScope = "all" | "school" | "skills" | "work"
export type StatsExportFormat = "md" | "csv"

export const RANGES: readonly StatsRange[] = ["7d", "30d", "90d", "all"]
export const SCOPES: readonly StatsScope[] = ["all", "school", "skills", "work"]

export type UsageRun = {
  model: string
  input: number
  output: number
  costMicroUsd: number | null
  at: string
  failed: boolean
  /** Optional: which side produced the run. Absent runs count toward "all". */
  scope?: StatsScope
}

export const LEARNING_KINDS = [
  "step-toggled",
  "card-known",
  "card-missed",
  "lesson-completed",
  "tool-call",
] as const

export type LearningKind = (typeof LEARNING_KINDS)[number]

export type LearningEvent = {
  kind: LearningKind
  at: string
  scope: StatsScope
  /** Only for `tool-call`. */
  name?: string
}

export type ModelTotal = {
  model: string
  runs: number
  input: number
  output: number
  costMicroUsd: number | null
}

export type ToolTotal = { name: string; calls: number }

/** One local day with activity, for the contribution calendar. */
export type ActivityDay = { date: string; runs: number; tokens: number }

/** Inclusive local-date period the summary covers, as `YYYY-MM-DD`. */
export type StatsPeriod = { from: string; to: string }

export type StatsSummary = {
  range: StatsRange
  scope: StatsScope
  overview: { runs: number; failed: number; input: number; output: number }
  /** `null` means "cost unknown" — never rendered as $0.0000. */
  costMicroUsd: number | null
  costLabel: string
  models: ModelTotal[]
  tools: ToolTotal[]
  learning: { steps: number; cardsKnown: number; cardsMissed: number; lessons: number }
  /** Days with at least one run, in local-date order. */
  activity: ActivityDay[]
  bestStreak: number
  activeDays: number
  period: StatsPeriod
  /** Present when a counter file was corrupt or unreadable. */
  diagnostic: string | null
}

export type StatsService = {
  summary(range: StatsRange, scope: StatsScope): Promise<StatsSummary>
  /** Markdown/CSV of the same view; the caller writes it. */
  export(range: StatsRange, scope: StatsScope, format: StatsExportFormat): Promise<string>
}

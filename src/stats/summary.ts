/**
 * Stats aggregation (`docs/product.md` §6.1, §10.2).
 *
 * Range boundaries are **local** midnight: a user's "last 7 days" is their
 * local days, while the instants themselves stay UTC ISO-8601. `rangeStart`
 * takes one injected clock so tests move time instead of sleeping.
 *
 * Scope totals combine counts and cost only. No prompt, note, chat body or
 * tool payload is ever read: the two counter files contain numbers and names.
 */
import { formatCost } from "../llm/pricing"
import { readLearning, readUsage } from "./read"
import type {
  ActivityDay,
  LearningEvent,
  ModelTotal,
  StatsScope,
  StatsService,
  StatsSummary,
  ToolTotal,
  UsageRun,
} from "./types"

/** First instant included in a range, or `null` for all time. */
export function rangeStart(range: StatsSummary["range"], now: Date): Date | null {
  if (range === "all") return null
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  // The window includes today, so it starts at midnight `days - 1` ago.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0)
}

function inScope(scope: StatsScope, value: StatsScope | undefined): boolean {
  if (scope === "all") return true
  return value === scope
}

function inRange(run: { at: string }, start: Date | null): boolean {
  if (!start) return true
  const at = new Date(run.at).getTime()
  return Number.isFinite(at) && at >= start.getTime()
}

const pad = (value: number): string => String(value).padStart(2, "0")

/** Local calendar date, not UTC: a "day" is the user's day. */
function localDate(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function dayDistance(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

function activityFor(runs: readonly UsageRun[]): ActivityDay[] {
  const days = new Map<string, { runs: number; tokens: number }>()
  for (const run of runs) {
    const at = new Date(run.at)
    if (Number.isNaN(at.getTime())) continue
    const date = localDate(at)
    const entry = days.get(date) ?? { runs: 0, tokens: 0 }
    entry.runs += 1
    entry.tokens += run.input + run.output
    days.set(date, entry)
  }
  return [...days.entries()]
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function streakFor(activity: readonly ActivityDay[]): number {
  let best = 0
  let current = 0
  let previous: Date | null = null
  for (const day of activity) {
    const date = parseLocalDate(day.date)
    if (date === null) continue
    current = previous !== null && dayDistance(previous, date) === 1 ? current + 1 : 1
    best = Math.max(best, current)
    previous = date
  }
  return best
}

export function aggregate(
  runs: readonly UsageRun[],
  events: readonly LearningEvent[],
  options: { range: StatsSummary["range"]; scope: StatsScope; now: Date; diagnostic?: string | null },
): StatsSummary {
  const start = rangeStart(options.range, options.now)
  const scopedRuns = runs.filter((run) => inScope(options.scope, run.scope) && inRange(run, start))
  const scopedEvents = events.filter(
    (event) => (options.scope === "all" || event.scope === options.scope) && inRange(event, start),
  )

  let cost: number | null = 0
  const models = new Map<string, ModelTotal>()
  for (const run of scopedRuns) {
    if (run.costMicroUsd === null) cost = null
    else if (cost !== null) cost += run.costMicroUsd

    const existing = models.get(run.model) ?? {
      model: run.model,
      runs: 0,
      input: 0,
      output: 0,
      costMicroUsd: 0,
    }
    existing.runs += 1
    existing.input += run.input
    existing.output += run.output
    if (run.costMicroUsd === null) existing.costMicroUsd = null
    else if (existing.costMicroUsd !== null) existing.costMicroUsd += run.costMicroUsd
    models.set(run.model, existing)
  }

  const tools = new Map<string, number>()
  const learning = { steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0 }
  for (const event of scopedEvents) {
    switch (event.kind) {
      case "step-toggled":
        learning.steps += 1
        break
      case "card-known":
        learning.cardsKnown += 1
        break
      case "card-missed":
        learning.cardsMissed += 1
        break
      case "lesson-completed":
        learning.lessons += 1
        break
      case "tool-call":
        if (event.name) tools.set(event.name, (tools.get(event.name) ?? 0) + 1)
        break
    }
  }

  const activity = activityFor(scopedRuns)
  const startDate = start ?? (activity[0] ? parseLocalDate(activity[0].date) : null)
  const period = {
    from: startDate ? localDate(startDate) : localDate(options.now),
    to: localDate(options.now),
  }

  const toolTotals: ToolTotal[] = [...tools.entries()]
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))

  return {
    range: options.range,
    scope: options.scope,
    overview: {
      runs: scopedRuns.length,
      failed: scopedRuns.filter((run) => run.failed).length,
      input: scopedRuns.reduce((sum, run) => sum + run.input, 0),
      output: scopedRuns.reduce((sum, run) => sum + run.output, 0),
    },
    costMicroUsd: cost,
    // One label for the whole view: an unknown price is never shown as $0.
    costLabel: formatCost(cost),
    models: [...models.values()].sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model)),
    tools: toolTotals,
    learning,
    activity,
    bestStreak: streakFor(activity),
    activeDays: activity.length,
    period,
    diagnostic: options.diagnostic ?? null,
  }
}

export type StatsServiceOptions = {
  /** The app data directory. Never the workspace. */
  dir: string
  now?: () => Date
}

export function createStatsService(options: StatsServiceOptions): StatsService {
  const now = options.now ?? (() => new Date())

  const summary = async (range: StatsSummary["range"], scope: StatsScope): Promise<StatsSummary> => {
    const [usage, learning] = await Promise.all([readUsage(options.dir), readLearning(options.dir)])
    const diagnostic = usage.diagnostic ?? learning.diagnostic ?? null
    return aggregate(usage.value, learning.value, { range, scope, now: now(), diagnostic })
  }

  return {
    summary,
    async export(range, scope, format) {
      const data = await summary(range, scope)
      return format === "csv" ? toCsv(data) : toMarkdown(data)
    },
  }
}

/** Markdown of exactly what the view shows. */
export function toMarkdown(summary: StatsSummary): string {
  const lines: string[] = [
    `# Stats — ${summary.range} · ${summary.scope}`,
    "",
    summary.diagnostic ? `> ${summary.diagnostic}` : "> Estimates, not a bill.",
    "",
    "## Overview",
    "",
    `- runs: ${summary.overview.runs} (${summary.overview.failed} failed)`,
    `- tokens: ${summary.overview.input} in / ${summary.overview.output} out`,
    `- cost: ${summary.costLabel}`,
    "",
    "## Models",
    "",
    "| model | runs | input | output | cost |",
    "|---|---|---|---|---|",
  ]
  for (const model of summary.models) {
    lines.push(
      `| ${model.model} | ${model.runs} | ${model.input} | ${model.output} | ${formatCost(model.costMicroUsd)} |`,
    )
  }
  if (summary.models.length === 0) lines.push("| — | 0 | 0 | 0 | — |")

  lines.push(
    "",
    "## Tools",
    "",
    "| tool | calls |",
    "|---|---|",
  )
  for (const tool of summary.tools) lines.push(`| ${tool.name} | ${tool.calls} |`)
  if (summary.tools.length === 0) lines.push("| — | 0 |")

  lines.push(
    "",
    "## Learning",
    "",
    `- steps: ${summary.learning.steps}`,
    `- cards known: ${summary.learning.cardsKnown}`,
    `- cards missed: ${summary.learning.cardsMissed}`,
    `- lessons completed: ${summary.learning.lessons}`,
    "",
  )
  return lines.join("\n")
}

/** CSV of the same view: one row per model, then the learning totals. */
export function toCsv(summary: StatsSummary): string {
  const rows: string[] = [
    "section,model,runs,input,output,cost_micro_usd,cost_label",
    ...summary.models.map((model) =>
      [
        "model",
        model.model,
        String(model.runs),
        String(model.input),
        String(model.output),
        model.costMicroUsd === null ? "" : String(model.costMicroUsd),
        formatCost(model.costMicroUsd),
      ]
        .map(csvCell)
        .join(","),
    ),
  ]
  rows.push(
    ["total", "all", String(summary.overview.runs), String(summary.overview.input), String(summary.overview.output), summary.costMicroUsd === null ? "" : String(summary.costMicroUsd), summary.costLabel]
      .map(csvCell)
      .join(","),
  )
  rows.push(
    [
      "learning",
      "steps",
      String(summary.learning.steps),
      String(summary.learning.cardsKnown),
      String(summary.learning.cardsMissed),
      String(summary.learning.lessons),
      "",
    ]
      .map(csvCell)
      .join(","),
  )
  return rows.join("\n") + "\n"
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

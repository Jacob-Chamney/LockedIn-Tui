/**
 * Stats dashboard, after OpenCode's full-window stats page.
 *
 * The page is a hero, not a table: context and period on the top row, the
 * wordmark and a large token total in the middle, a contribution calendar, and
 * three counters underneath. Every number comes from `StatsSummary` unchanged
 * — this page never re-derives a total, never reads a file and never writes the
 * export it asks for.
 */
import { parseBinding, type Binding } from "../keymap/registry"
import type { StatsRange, StatsScope, StatsSummary } from "../../stats/types"
import type { ThemePalette } from "../theme"
import { LOCKED_IN_LOGO, LOCKED_IN_LOGO_COMPACT } from "../shell/brand"
import { compactTokens } from "./big-number"
import { buildHeatmap } from "./heatmap"

export type StatsView = {
  range: StatsRange
  scope: StatsScope
  /** Set after `x`: the format the caller should write. */
  exportFormat?: "md" | "csv" | null
  notice?: string | null
}

export const initialStatsView: StatsView = { range: "all", scope: "all", exportFormat: null, notice: null }

export const RANGE_ORDER: StatsRange[] = ["7d", "30d", "90d", "all"]
export const SCOPE_ORDER: StatsScope[] = ["all", "school", "skills", "work"]

export function cycleRange(view: StatsView, delta = 1): StatsView {
  const at = RANGE_ORDER.indexOf(view.range)
  return { ...view, range: RANGE_ORDER[(at + delta + RANGE_ORDER.length) % RANGE_ORDER.length]! }
}

export function cycleScope(view: StatsView, delta = 1): StatsView {
  const at = SCOPE_ORDER.indexOf(view.scope)
  return { ...view, scope: SCOPE_ORDER[(at + delta + SCOPE_ORDER.length) % SCOPE_ORDER.length]! }
}

/** An empty range invites work instead of presenting zeros as data. */
export function isEmpty(summary: StatsSummary): boolean {
  return (
    summary.overview.runs === 0 &&
    summary.models.length === 0 &&
    summary.tools.length === 0 &&
    summary.learning.steps === 0 &&
    summary.learning.cardsKnown === 0 &&
    summary.learning.cardsMissed === 0 &&
    summary.learning.lessons === 0
  )
}

export function emptyCopy(view: StatsView): string {
  return `no usage in the last ${view.range === "all" ? "records" : view.range} · send a message or run a generation to fill this page`
}

/** `cost unknown` is verbatim; a priced range shows four decimals. */
export function costLabel(summary: StatsSummary): string {
  if (summary.costMicroUsd === null) return "cost unknown"
  const value = summary.costMicroUsd / 1_000_000
  return `$${value.toFixed(4)}`
}

/** Counts are grouped for reading, without changing the number. */
export function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function overviewRows(summary: StatsSummary): string[] {
  return [
    `runs      ${summary.overview.runs}`,
    `failed    ${summary.overview.failed}`,
    `tokens    ${summary.overview.input} in · ${summary.overview.output} out`,
    `cost      ${costLabel(summary)}`,
  ]
}

export function modelRows(summary: StatsSummary): string[] {
  return summary.models.map(
    (model) =>
      `${model.model}  ${model.runs} runs  ${formatCount(model.input + model.output)} tok  ${
        model.costMicroUsd === null ? "cost unknown" : `$${(model.costMicroUsd / 1_000_000).toFixed(4)}`
      }`,
  )
}

export function toolRows(summary: StatsSummary): string[] {
  return summary.tools.map((tool) => `${tool.name}  ${tool.calls} calls`)
}

export function learningRows(summary: StatsSummary): string[] {
  return [
    `steps     ${summary.learning.steps}`,
    `known     ${summary.learning.cardsKnown}`,
    `missed    ${summary.learning.cardsMissed}`,
    `lessons   ${summary.learning.lessons}`,
  ]
}

/** Scope is applied by the service; the page only asserts what it renders. */
export function rowsForScope(summary: StatsSummary): string[] {
  return [...modelRows(summary), ...toolRows(summary)]
}

export function exportRequest(view: StatsView, format: "md" | "csv"): { format: "md" | "csv"; range: StatsRange; scope: StatsScope } {
  return { format, range: view.range, scope: view.scope }
}

export function exportNotice(format: "md" | "csv", path: string): string {
  return `export ${format === "md" ? "Markdown" : "CSV"} ready · save as ${path}`
}

// ---------------------------------------------------------------- keys

export type StatsIntent = "range" | "scope" | "export-md" | "export-csv" | "close"

const SPECS: Array<{ intent: StatsIntent; key: string; footer: string }> = [
  { intent: "range", key: "r", footer: "r range" },
  { intent: "scope", key: "s", footer: "s scope" },
  { intent: "export-md", key: "x", footer: "x export" },
  { intent: "export-csv", key: "shift+x", footer: "" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`stats key "${key}": ${binding.message}`)
  return binding
}

export const STATS_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): StatsIntent | undefined {
  const lower = name.toLowerCase()
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower
  return STATS_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return STATS_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `Jan – Nov 2026`, `Nov 2026`, or `Dec 2025 – Nov 2026`. */
export function periodLabel(period: { from: string; to: string }): string {
  const parse = (value: string): Date | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const from = parse(period.from)
  const to = parse(period.to)
  if (from === null || to === null) return ""
  const fromMonth = MONTH_NAMES[from.getMonth()]!
  const toMonth = MONTH_NAMES[to.getMonth()]!
  if (from.getFullYear() === to.getFullYear()) {
    return from.getMonth() === to.getMonth()
      ? `${fromMonth} ${from.getFullYear()}`
      : `${fromMonth} – ${toMonth} ${to.getFullYear()}`
  }
  return `${fromMonth} ${from.getFullYear()} – ${toMonth} ${to.getFullYear()}`
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const

function monthLine(months: Array<{ week: number; label: string }>, gridWidth: number, cellWidth: number): string {
  const cells = Array.from({ length: gridWidth }, () => " ")
  for (const month of months) {
    const start = month.week * cellWidth
    if (start + month.label.length > cells.length) continue
    for (let index = 0; index < month.label.length; index++) {
      const at = start + index
      if (at < cells.length) cells[at] = month.label[index]!
    }
  }
  return cells.join("")
}

function StatColumn(props: { theme: ThemePalette; value: string; label: string }) {
  const palette = () => props.theme
  return (
    <box flexDirection="column" alignItems="center" flexGrow={1}>
      <text fg={palette().foreground} wrapMode="none">
        <b>{props.value}</b>
      </text>
      <text fg={palette().muted} wrapMode="none">
        {props.label}
      </text>
    </box>
  )
}

export function StatsPage(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  view: StatsView
  summary: StatsSummary
}) {
  const palette = () => props.theme
  const showLogo = () => props.height >= 28
  const logoLines = () =>
    props.height >= 40 && props.width >= 66
      ? LOCKED_IN_LOGO
      : showLogo()
        ? LOCKED_IN_LOGO_COMPACT
        : []
  const tokens = () => props.summary.overview.input + props.summary.overview.output
  const total = () => compactTokens(tokens(), 0)
  const period = () => periodLabel(props.summary.period)
  const cellWidth = () => (props.width >= 120 ? 2 : 1)
  const maxWeeks = () => Math.max(1, Math.floor((props.width - 6) / cellWidth()))
  const heat = () => buildHeatmap(props.summary.activity, props.summary.period, maxWeeks())
  const gridWidth = () => heat().weeks.length * cellWidth()
  const label = () => "best streak"

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      backgroundColor={palette().background}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row">
          <text fg={palette().foreground} wrapMode="none">
            <b>lockedin</b>
          </text>
          <text fg={palette().muted} wrapMode="none">
            {" / stats"}
          </text>
        </box>
        <text fg={palette().muted} wrapMode="none">
          {period()}
        </text>
      </box>

      <box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="center" alignItems="center">
        {logoLines().length > 0 ? (
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            {logoLines().map((line) => (
              <text fg={palette().primary} wrapMode="none">
                {line}
              </text>
            ))}
          </box>
        ) : null}
        {logoLines().length > 0 ? <box height={1} flexShrink={0} /> : null}
        <text fg={palette().foreground} wrapMode="none">
          <b>{total()}</b>
        </text>
        <text fg={palette().muted} wrapMode="none">
          {Array.from("TOKENS").join(" ")}
        </text>
        <box height={1} flexShrink={0} />

        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text fg={palette().muted} wrapMode="none">
            {`${"  "}${monthLine(heat().months, gridWidth(), cellWidth())}`}
          </text>
          {DAY_LABELS.map((day, row) => (
            <box flexDirection="row" height={1}>
              <text fg={palette().muted} wrapMode="none">
                {`${day} `}
              </text>
              {heat().weeks.map((week) => {
                const entry = week[row]
                const glyph = entry === null ? " " : entry.runs > 0 ? "■" : "·"
                return (
                  <text fg={entry !== null && entry.runs > 0 ? palette().primary : palette().muted} wrapMode="none">
                    {glyph.repeat(cellWidth())}
                  </text>
                )
              })}
            </box>
          ))}
        </box>
        <box height={1} flexShrink={0} />

        <box
          flexDirection="row"
          width={Math.max(24, Math.min(props.width - 4, Math.max(64, gridWidth() + 2)))}
          flexShrink={0}
        >
          <StatColumn theme={palette()} value={`${props.summary.bestStreak} days`} label={label()} />
          <StatColumn
            theme={palette()}
            value={formatCount(props.summary.activeDays)}
            label={props.width < 60 ? "active" : "active days"}
          />
          <StatColumn theme={palette()} value={formatCount(props.summary.overview.runs)} label="sessions" />
        </box>
        {props.summary.diagnostic ? (
          <text fg={palette().warning} wrapMode="none">
            {`! ${props.summary.diagnostic}`}
          </text>
        ) : null}
        {props.view.notice ? (
          <text fg={palette().warning} wrapMode="none">
            {`! ${props.view.notice}`}
          </text>
        ) : null}
      </box>

      <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
        <text fg={palette().muted} wrapMode="none">
          lockedin
        </text>
      </box>
    </box>
  )
}

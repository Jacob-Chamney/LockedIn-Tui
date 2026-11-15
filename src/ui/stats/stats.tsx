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
import { HEATMAP_RAMP, heatmapLayout } from "../heatmap"
import { Legend } from "../shell/legend"
import { Distribution } from "../shell/distribution"
import { Treemap } from "../shell/treemap"
import { Delta } from "../shell/delta"
import { LineChart } from "../shell/line-chart"
import { Sparkbar } from "../shell/sparkbar"
import { StatCard } from "../shell/stat-card"
import { ProgressRing } from "../shell/progress-ring"
import { sparklineText } from "../sparkline"
import { tabLayout } from "../tabs"
import { Bars } from "../shell/bars"
import { Callout } from "../shell/callout"

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
  /** The busiest models, as proportions of the busiest one. */
  const modelItems = () => {
    const totals = props.summary.models
      .map((model) => ({ label: model.model, value: model.input + model.output }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .slice(0, 3)
    const peak = totals[0]?.value ?? 0
    return totals.map((model) => ({
      ...model,
      text: `${Math.round((model.value / Math.max(1, peak)) * 100)}%`,
    }))
  }
  const chartWidth = () => Math.max(28, Math.min(props.width - 8, 64))
  const statsWidth = () => Math.max(24, Math.min(props.width - 4, Math.max(64, grid().width + 2)))
  const statWidth = () => Math.max(8, Math.floor(statsWidth() / 3))
  const treemapItems = () =>
    shareItems().map((model, index) => ({ id: `${index}:${model.label}`, label: model.label, value: model.value }))
  /** The busiest models by tokens, as a stacked share. */
  const shareItems = () =>
    props.summary.models
      .map((model) => ({ label: model.model, value: model.input + model.output }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .slice(0, 4)
  const rangeStrip = () =>
    tabLayout({
      tabs: RANGE_ORDER.map((label) => ({ label })),
      selected: RANGE_ORDER.indexOf(props.view.range),
      width: Math.max(0, props.width - 12),
    })
  const scopeStrip = () =>
    tabLayout({
      tabs: SCOPE_ORDER.map((label) => ({ label })),
      selected: SCOPE_ORDER.indexOf(props.view.scope),
      width: Math.max(0, props.width - 12),
    })
  const cellWidth = () => (props.width >= 120 ? 2 : 1)
  const maxWeeks = () => Math.max(1, Math.floor((props.width - 6) / cellWidth()))
  const heat = () => buildHeatmap(props.summary.activity, props.summary.period, maxWeeks())
  const grid = () =>
    heatmapLayout({ weeks: heat().weeks, months: heat().months, cellWidth: cellWidth() })
  /**
   * One glyph per day, bucketed to 60 columns for a long range. Daily buckets
   * keep a short range informative: a fortnight is a trend, not two blocks.
   */
  const trend = () => {
    const values: number[] = []
    for (const week of heat().weeks) {
      for (const day of week) if (day) values.push(day.tokens)
    }
    if (values.length === 0) return ""
    return values.some((value) => value > 0)
      ? sparklineText({ values, width: 60 })
      : ""
  }
  /** Days in the selected range, for the active-days ring. */
  const rangeDays = () =>
    heat().weeks.reduce(
      (sum, week) => sum + week.filter((day) => day !== null).length,
      0,
    )
  const activeShare = () =>
    rangeDays() === 0 ? 0 : Math.max(0, Math.min(1, props.summary.activeDays / rangeDays()))
  /** Token totals per calendar week, for the compact column chart. */
  const weeklyTokens = () =>
    heat().weeks.map((week) =>
      week.reduce((sum, day) => sum + (day === null ? 0 : day.tokens), 0),
    )
  /** Non-null daily token totals inside the selected range. */
  const dailyTokens = () => {
    const values: number[] = []
    for (const week of heat().weeks) {
      for (const day of week) if (day) values.push(day.tokens)
    }
    return values
  }
  /**
   * The last seven days against the seven before them. Only shown when the
   * range has both weeks and the earlier week has something to compare with.
   */
  const tokenDelta = () => {
    const values = dailyTokens()
    if (values.length < 14) return null
    const recent = values.slice(-7).reduce((sum, value) => sum + value, 0)
    const prior = values.slice(-14, -7).reduce((sum, value) => sum + value, 0)
    if (prior <= 0) return null
    const value = ((recent - prior) / prior) * 100
    return Number.isFinite(value) ? { value, label: "vs prior 7d" } : null
  }
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

      <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
        <box flexDirection="row" height={1}>
          <text fg={palette().muted} wrapMode="none">
            {"range "}
          </text>
          {rangeStrip().map((tab) => (
            <text
              fg={tab.selected ? palette().background : palette().muted}
              bg={tab.selected ? palette().primary : undefined}
              wrapMode="none"
            >
              {tab.text}
            </text>
          ))}
        </box>
        {props.width >= 96 ? (
          <box flexDirection="row" height={1}>
            <text fg={palette().muted} wrapMode="none">
              {"scope "}
            </text>
            {scopeStrip().map((tab) => (
              <text
                fg={tab.selected ? palette().background : palette().muted}
                bg={tab.selected ? palette().primary : undefined}
                wrapMode="none"
              >
                {tab.text}
              </text>
            ))}
          </box>
        ) : null}
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
        {trend() ? (
          <text fg={palette().primary} wrapMode="none" flexShrink={0}>
            {trend()}
          </text>
        ) : null}
        {props.height >= 40 && props.width >= 70 && dailyTokens().some((value) => value > 0) ? (
          <LineChart
            theme={palette()}
            values={dailyTokens()}
            width={Math.min(props.width - 8, 60)}
            height={4}
            axisWidth={5}
            labels={[compactTokens(Math.max(...dailyTokens())), "0"]}
          />
        ) : null}
        {props.height >= 34 && props.width >= 60 && tokenDelta() ? (
          <Delta
            theme={palette()}
            value={tokenDelta()!.value}
            label={tokenDelta()!.label}
            width={Math.min(props.width - 8, 48)}
          />
        ) : null}
        {props.height >= 42 && props.width >= 80 ? null : <box height={1} flexShrink={0} />}

        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text fg={palette().muted} wrapMode="none">
            {`${"  "}${grid().months}`}
          </text>
          {grid().cells.map((row, index) => (
            <box flexDirection="row" height={1}>
              <text fg={palette().muted} wrapMode="none">
                {`${grid().days[index]} `}
              </text>
              {row.map((cell) => (
                <text
                  fg={cell.tone === "muted" ? palette().muted : palette().primary}
                  wrapMode="none"
                >
                  {cell.glyph.repeat(grid().cellWidth)}
                </text>
              ))}
            </box>
          ))}
        </box>
        {props.height >= 30 ? (
          <Legend
            theme={palette()}
            items={HEATMAP_RAMP.map((glyph, level) => ({
              glyph,
              ...(level === 0 ? { label: "less" } : level === 4 ? { label: "more" } : {}),
              tone: level === 0 ? "muted" : "primary",
            }))}
            width={Math.min(props.width - 8, 60)}
          />
        ) : null}
        {props.height >= 42 && props.width >= 60 && weeklyTokens().some((value) => value > 0) ? (
          <box flexDirection="column" alignItems="center" width={chartWidth()} marginTop={1} flexShrink={0}>
            <text fg={palette().muted} wrapMode="none">
              {"BY WEEK"}
            </text>
            <Sparkbar
              theme={palette()}
              values={weeklyTokens()}
              width={Math.min(props.width - 8, 60)}
              height={2}
            />
          </box>
        ) : null}
        <box height={1} flexShrink={0} />

        <box flexDirection="row" alignItems="center" flexShrink={0}>
          <box flexDirection="row" width={statsWidth()} flexShrink={0}>
            <StatCard
              theme={palette()}
              value={`${props.summary.bestStreak} days`}
              label={label()}
              detail={props.height >= 34 ? "in a row" : undefined}
              width={statWidth()}
            />
            <StatCard
              theme={palette()}
              value={formatCount(props.summary.activeDays)}
              label={props.width < 60 ? "active" : "active days"}
              detail={props.height >= 34 ? "in range" : undefined}
              width={statWidth()}
            />
            <StatCard
              theme={palette()}
              value={formatCount(props.summary.overview.runs)}
              label="sessions"
              detail={props.height >= 34 ? "recorded" : undefined}
              width={statWidth()}
            />
          </box>
          {props.height >= 34 && props.width >= 120 && rangeDays() > 0 ? (
            <box flexDirection="row" alignItems="center" marginLeft={2} flexShrink={0}>
              <ProgressRing theme={palette()} value={activeShare()} size={6} />
              <box flexDirection="column" marginLeft={1}>
                <text fg={palette().muted} wrapMode="none">
                  {"ACTIVE"}
                </text>
                <text fg={palette().foreground} wrapMode="none">
                  {`${props.summary.activeDays}/${rangeDays()} days`}
                </text>
              </box>
            </box>
          ) : null}
        </box>
        {props.height >= 36 && props.width >= 60 && modelItems().length > 0 ? (
          <box
            flexDirection="column"
            alignItems="center"
            width={chartWidth()}
            marginTop={1}
            flexShrink={0}
          >
            <text fg={palette().muted} wrapMode="none">
              {"BY MODEL"}
            </text>
            {props.height >= 42 && props.width >= 80 ? (
              <Treemap
                theme={palette()}
                items={treemapItems()}
                width={chartWidth()}
                height={3}
              />
            ) : (
              <Distribution theme={palette()} items={shareItems()} width={chartWidth()} />
            )}
            <Bars
              theme={palette()}
              items={modelItems()}
              width={chartWidth()}
              labelWidth={22}
              valueWidth={4}
            />
          </box>
        ) : null}
        {props.summary.diagnostic ? (
          <Callout
            theme={palette()}
            tone="warning"
            width={props.width - 4}
            message={props.summary.diagnostic}
          />
        ) : null}
        {props.view.notice ? (
          <Callout theme={palette()} tone="warning" width={props.width - 4} message={props.view.notice} />
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

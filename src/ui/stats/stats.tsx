/**
 * Stats dashboard, after OpenCode's full-window stats page.
 *
 * The page is a hero, not a table: context and period on the top row, the
 * wordmark and a large token total in the middle, a contribution calendar, and
 * three counters underneath. Every number comes from `StatsSummary` unchanged
 * — this page never re-derives a total, never reads a file and never writes the
 * export it asks for.
 */
import { createMemo } from "solid-js"

import { parseBinding, type Binding } from "../keymap/registry"
import type { StatsRange, StatsScope, StatsSummary } from "../../stats/types"
import type { ThemePalette } from "../theme"
import { compactTokens } from "./big-number"
import { buildHeatmap } from "./heatmap"
import { HEATMAP_RAMP, heatmapLayout } from "../heatmap"
import { Legend } from "../shell/legend"
import { LineChart } from "../shell/line-chart"
import { tabLayout } from "../tabs"
import { Bars } from "../shell/bars"
import { Callout } from "../shell/callout"
import { DefinitionList } from "../shell/definition-list"

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

/** Inclusive day count for a period, independent of the heatmap width. */
export function periodDays(period: { from: string; to: string }): number {
  const parse = (value: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return null
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  const from = parse(period.from)
  const to = parse(period.to)
  if (from === null || to === null || to < from) return 0
  return Math.round((to - from) / 86_400_000) + 1
}

/**
 * The stats dashboard.
 *
 * A page, not a poster: one header with the period and the two filters, a band
 * of five figures, then activity and models side by side. Sections are chosen
 * from the space that is actually left, so a short terminal keeps the figures
 * and the calendar instead of clipping the charts below them. Every number
 * comes from `StatsSummary` unchanged.
 */
export function StatsPage(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  view: StatsView
  summary: StatsSummary
}) {
  const palette = () => props.theme
  /** A dashboard wider than this is harder to scan; centre it instead. */
  const contentWidth = () => Math.max(20, Math.min(props.width - 4, 156))
  const padX = () => Math.max(2, Math.floor((props.width - contentWidth()) / 2))
  const inner = () => contentWidth()
  const tokens = () => props.summary.overview.input + props.summary.overview.output
  const period = () => periodLabel(props.summary.period)
  const days = createMemo(() => periodDays(props.summary.period))
  const twoColumn = () => props.width >= 96
  const gutter = 3
  const leftWidth = () => (twoColumn() ? Math.floor((inner() - gutter) * 0.6) : inner())
  /** The left column keeps one cell clear of the divider. */
  const leftContent = () => Math.max(20, leftWidth() - 1)
  const rightWidth = () => inner() - leftWidth() - gutter
  const maxWeeks = () => Math.max(1, leftContent() - 3)
  const heat = createMemo(() => buildHeatmap(props.summary.activity, props.summary.period, maxWeeks()))
  const cellWidth = () => (heat().weeks.length * 2 <= leftContent() ? 2 : 1)
  const grid = createMemo(() =>
    heatmapLayout({ weeks: heat().weeks, months: heat().months, cellWidth: cellWidth() }),
  )
  const dailyTokens = createMemo(() => {
    const values: number[] = []
    for (const week of heat().weeks) for (const day of week) if (day) values.push(day.tokens)
    return values
  })
  const trendPeak = createMemo(() => (dailyTokens().length === 0 ? 0 : Math.max(...dailyTokens())))
  /** The last week in the period, for a readable day-by-day strip. */
  const lastDays = createMemo(() => {
    const days: Array<{ date: string; tokens: number; runs: number }> = []
    for (const week of heat().weeks) for (const day of week) if (day) days.push(day)
    return days.slice(-7)
  })
  const dayLabel = (date: string) => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(8)}`
  const trendHeight = () => Math.max(4, Math.min(14, bodyHeight() - 18))

  const rangeStrip = () =>
    tabLayout({
      tabs: RANGE_ORDER.map((label) => ({ label })),
      selected: RANGE_ORDER.indexOf(props.view.range),
      width: Math.max(0, Math.min(44, props.width - 12)),
    })
  const scopeStrip = () =>
    tabLayout({
      tabs: SCOPE_ORDER.map((label) => ({ label })),
      selected: SCOPE_ORDER.indexOf(props.view.scope),
      width: Math.max(0, Math.min(48, props.width - 12)),
    })

  /** Responsive KPI band: five across when wide, otherwise wrap. */
  const activeShare = () =>
    days() === 0 ? 0 : Math.round((props.summary.activeDays / days()) * 100)
  const kpiCols = () => {
    if (props.width >= 120) return 5
    if (props.width >= 80) return props.height >= 30 ? 4 : 5
    return props.width >= 62 ? 3 : 2
  }
  const kpiDetail = () => props.height >= 30
  const kpiWidth = () => Math.floor((inner() - 2 * (kpiCols() - 1)) / kpiCols())
  const wideTokens = () => kpiWidth() >= 20
  const kpis = () => {
    const compact = compactTokens(tokens())
    const detail = wideTokens()
      ? `${compactTokens(props.summary.overview.input)} in · ${compactTokens(props.summary.overview.output)} out`
      : `${compactTokens(props.summary.overview.input)} / ${compactTokens(props.summary.overview.output)}`
    const items = [
      { label: "TOKENS", value: compact, detail },
      {
        label: "SESSIONS",
        value: formatCount(props.summary.overview.runs),
        detail:
          props.summary.overview.failed > 0
            ? `${props.summary.overview.failed} failed`
            : "none failed",
        tone: props.summary.overview.failed > 0 ? ("error" as const) : undefined,
      },
      {
        label: "ACTIVE DAYS",
        value: formatCount(props.summary.activeDays),
        detail:
          kpiCols() === 4
            ? `${activeShare()}% · ${props.summary.bestStreak}d streak`
            : `${activeShare()}% of range`,
      },
      { label: "STREAK", value: `${props.summary.bestStreak} days`, detail: "in a row" },
      {
        label: "COST",
        value: props.summary.costMicroUsd === null ? "unknown" : costLabel(props.summary),
        detail: props.summary.costMicroUsd === null ? "not priced" : "est. spend",
      },
    ]
    return kpiCols() === 4 ? items.filter((item) => item.label !== "STREAK") : items
  }
  const kpiRows = () => {
    const rows: Array<ReturnType<typeof kpis>> = []
    for (let index = 0; index < kpis().length; index += kpiCols()) rows.push(kpis().slice(index, index + kpiCols()))
    return rows
  }

  const bodyHeight = () => {
    const gap = props.height >= 28 && kpiDetail() ? Math.max(0, kpiRows().length - 1) : 0
    const kpiHeight = kpiRows().length * (kpiDetail() ? 3 : 2) + gap
    // padding, title, controls, rule, KPI band, rule, footer, and the two
    // optional one-row gaps above the controls and the figures.
    const fixed = 2 + 1 + 1 + 1 + kpiHeight + 1 + 2 + (props.height >= 28 ? 2 : 0)
    return Math.max(1, props.height - fixed)
  }
  const showTrend = () => dailyTokens().some((value) => value > 0) && bodyHeight() >= 15
  /** The legend yields to the chart when the body has exactly one row to spare. */
  const showLegend = () => !showTrend() || bodyHeight() >= 16
  const showModels = () =>
    props.summary.models.length > 0 && bodyHeight() >= (twoColumn() ? 8 : 16)
  const showTools = () =>
    props.summary.tools.length > 0 && bodyHeight() >= (twoColumn() ? 15 : 23)
  const showLearning = () =>
    (props.summary.learning.steps > 0 ||
      props.summary.learning.cardsKnown > 0 ||
      props.summary.learning.cardsMissed > 0 ||
      props.summary.learning.lessons > 0) &&
    bodyHeight() >= (twoColumn() ? 12 : 20)
  /** Rows the right column already occupies above the recent-days strip. */
  const rightUsed = () => {
    const models = showModels()
      ? 1 + Math.min(4, sortedModels().length) + (sortedModels().length > 4 ? 1 : 0)
      : 0
    const tools = showTools() ? 1 + 1 + Math.min(3, props.summary.tools.length) : 0
    const learning = showLearning() ? 1 + 1 + 3 : 0
    return models + tools + learning
  }
  /** The left column's own height, so the divider ends with the chart. */
  const leftHeight = () =>
    1 + 1 + 7 + (showLegend() ? 1 : 0) + (showTrend() ? 1 + 1 + trendHeight() : 0)
  const lastRows = () =>
    Math.min(7, Math.max(0, Math.min(bodyHeight(), leftHeight()) - rightUsed() - 2))
  const showLastDays = () => twoColumn() && lastDays().length > 0 && lastRows() >= 2

  const sortedModels = createMemo(() =>
    props.summary.models
      .map((model) => ({ label: model.model, value: model.input + model.output, runs: model.runs }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
  )
  const modelTotal = () => sortedModels().reduce((sum, model) => sum + model.value, 0)
  /** The provider prefix is the least useful part when a column is narrow. */
  const modelLabel = (name: string, width: number): string => {
    if (name.length <= width) return name
    const base = name.split("/").pop() ?? name
    if (base.length <= width) return base
    return width <= 1 ? "…" : `${base.slice(0, width - 1)}…`
  }
  const modelBars = () => {
    const top = sortedModels().slice(0, 4)
    return top.map((model) => ({
      label: modelLabel(model.label, Math.max(8, labelWidth() - 1)),
      value: model.value,
      text: `${model.runs}r · ${Math.round((model.value / Math.max(1, modelTotal())) * 100)}%`,
    }))
  }
  const toolBars = () =>
    props.summary.tools
      .slice(0, 3)
      .map((tool) => ({ label: tool.name, value: tool.calls, text: `${tool.calls} call${tool.calls === 1 ? "" : "s"}` }))
  const learningItems = () => [
    { term: "steps", description: formatCount(props.summary.learning.steps) },
    {
      term: "cards",
      description: `${formatCount(props.summary.learning.cardsKnown)} known · ${formatCount(props.summary.learning.cardsMissed)} missed`,
    },
    { term: "lessons", description: formatCount(props.summary.learning.lessons) },
  ]

  const labelWidth = () => Math.max(10, Math.min(22, Math.floor(rightWidth() * 0.42)))
  const scopeLabel = () => (props.view.scope === "all" ? "all scopes" : props.view.scope)

  const sectionHead = (title: string, meta: string, width: number) => (
    <box flexDirection="row" justifyContent="space-between" width={width} flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <text fg={palette().primary} wrapMode="none">
          {"▍"}
        </text>
        <text fg={palette().secondary} wrapMode="none">
          {` ${title}`}
        </text>
      </box>
      <text fg={palette().muted} wrapMode="none">
        {meta}
      </text>
    </box>
  )

  const activity = () => (
    <box flexDirection="column" flexShrink={0} width={leftContent()}>
      {sectionHead("ACTIVITY", `${props.summary.activeDays} active days`, leftContent())}
      <text fg={palette().muted} wrapMode="none">
        {`  ${grid().months}`}
      </text>
      {grid().cells.map((row, index) => (
        <box flexDirection="row" height={1}>
          <text fg={palette().muted} wrapMode="none">
            {`${grid().days[index]} `}
          </text>
          {row.map((cell) => (
            <text fg={cell.tone === "muted" ? palette().muted : palette().primary} wrapMode="none">
              {cell.glyph.repeat(grid().cellWidth)}
            </text>
          ))}
        </box>
      ))}
      {showLegend() ? (
        <Legend
          theme={palette()}
          items={HEATMAP_RAMP.map((glyph, level) => ({
            glyph,
            ...(level === 0 ? { label: "less" } : level === 4 ? { label: "more" } : {}),
            tone: level === 0 ? "muted" : "primary",
          }))}
          width={leftContent()}
        />
      ) : null}
    </box>
  )

  const trend = () => (
    <box flexDirection="column" flexShrink={0} width={leftContent()} marginTop={1}>
      {sectionHead("TOKENS OVER TIME", `peak ${compactTokens(trendPeak())}/day`, leftContent())}
      <LineChart
        theme={palette()}
        values={dailyTokens()}
        width={leftContent()}
        height={trendHeight()}
        reduce="max"
        axisWidth={6}
        labels={[compactTokens(trendPeak()), "0"]}
      />
    </box>
  )

  const models = () => (
    <box flexDirection="column" flexShrink={0} width={rightWidth()}>
      {sectionHead(
        "MODELS",
        `${sortedModels().length} model${sortedModels().length === 1 ? "" : "s"} · ${sortedModels().reduce((sum, model) => sum + model.runs, 0)} runs`,
        rightWidth(),
      )}
      <Bars
        theme={palette()}
        items={modelBars()}
        width={rightWidth()}
        labelWidth={labelWidth()}
        valueWidth={10}
      />
      {sortedModels().length > 4 ? (
        <text fg={palette().muted} wrapMode="none">
          {`+${sortedModels().length - 4} more`}
        </text>
      ) : null}
    </box>
  )

  const tools = () => (
    <box flexDirection="column" flexShrink={0} width={rightWidth()} marginTop={1}>
      {sectionHead("TOOLS", `${props.summary.tools.reduce((sum, tool) => sum + tool.calls, 0)} calls`, rightWidth())}
      <Bars
        theme={palette()}
        items={toolBars()}
        width={rightWidth()}
        labelWidth={labelWidth()}
        valueWidth={10}
      />
    </box>
  )

  const lastWeek = () => {
    const shown = lastDays().slice(-lastRows())
    const peak = Math.max(1, ...shown.map((day) => day.tokens))
    const barWidth = Math.max(3, rightWidth() - 15)
    return (
      <box flexDirection="column" flexShrink={0} width={rightWidth()} marginTop={1}>
        {sectionHead(
          `LAST ${shown.length} DAY${shown.length === 1 ? "" : "S"}`,
          `${compactTokens(shown.reduce((sum, day) => sum + day.tokens, 0))} tokens`,
          rightWidth(),
        )}
        {shown.map((day) => {
          const filled = day.tokens > 0 ? Math.max(1, Math.round((day.tokens / peak) * barWidth)) : 0
          const bar = filled > 0 ? "█".repeat(filled) : "·"
          return (
            <box flexDirection="row" height={1}>
              <text fg={palette().muted} wrapMode="none">
                {dayLabel(day.date)}
              </text>
              <text fg={palette().primary} wrapMode="none">
                {` ${bar.padEnd(barWidth)}`}
              </text>
              <text fg={palette().muted} wrapMode="none">
                {` ${compactTokens(day.tokens).padStart(6)}`}
              </text>
            </box>
          )
        })}
      </box>
    )
  }

  const learning = () => (
    <box flexDirection="column" flexShrink={0} width={rightWidth()} marginTop={1}>
      {sectionHead(
        "LEARNING",
        `${props.summary.learning.lessons} lesson${props.summary.learning.lessons === 1 ? "" : "s"}`,
        rightWidth(),
      )}
      <DefinitionList theme={palette()} items={learningItems()} width={rightWidth()} termWidth={8} />
    </box>
  )

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection="column"
      paddingX={padX()}
      paddingY={1}
      backgroundColor={palette().surface}
    >
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={palette().foreground} wrapMode="none">
          <b>STATS</b>
        </text>
        <text fg={palette().muted} wrapMode="none">
          {props.width >= 80 ? period() : `${scopeLabel()} · ${period()}`}
        </text>
      </box>
      <box
        flexDirection="row"
        justifyContent="space-between"
        height={1}
        flexShrink={0}
        marginTop={props.height >= 28 ? 1 : 0}
      >
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
        {props.width >= 80 ? (
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
      <text fg={palette().line} wrapMode="none">
        {"─".repeat(inner())}
      </text>

      {isEmpty(props.summary) ? (
        <box flexGrow={1} minHeight={0} flexDirection="column" alignItems="center" justifyContent="center">
          <text fg={palette().foreground} wrapMode="none">
            <b>NO ACTIVITY IN THIS RANGE</b>
          </text>
          <text fg={palette().muted} wrapMode="none">
            send a message or run a generation to fill this page
          </text>
        </box>
      ) : (
        <>
          <box flexDirection="column" flexShrink={0} marginTop={props.height >= 28 ? 1 : 0}>
            {kpiRows().map((row, rowIndex) => (
              <box
                flexDirection="row"
                height={kpiDetail() ? 3 : 2}
                flexShrink={0}
                marginTop={rowIndex === 0 || props.height < 28 ? 0 : 1}
              >
                {row.map((kpi, index) => (
                  <box flexDirection="row" flexShrink={0}>
                    <box flexDirection="column" width={kpiWidth()} flexShrink={0}>
                      <text fg={palette().muted} wrapMode="none">
                        {kpi.label}
                      </text>
                      <text fg={palette().foreground} wrapMode="none">
                        <b>{kpi.value}</b>
                      </text>
                      {kpiDetail() ? (
                        <text fg={"tone" in kpi && kpi.tone === "error" ? palette().error : palette().muted} wrapMode="none">
                          {kpi.detail}
                        </text>
                      ) : null}
                    </box>
                    {index < row.length - 1 ? <box width={2} flexShrink={0} /> : null}
                  </box>
                ))}
              </box>
            ))}
          </box>
          <text fg={palette().line} wrapMode="none">
            {"─".repeat(inner())}
          </text>

          <box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="center">
            <box flexDirection={twoColumn() ? "row" : "column"} flexShrink={0}>
              <box flexDirection="column" flexShrink={0} width={leftWidth()} paddingRight={1}>
                {activity()}
                {showTrend() ? trend() : null}
              </box>
              {twoColumn() ? (
                <box
                  flexDirection="column"
                  flexGrow={1}
                  minHeight={0}
                  height={leftHeight()}
                  border={["left"]}
                  borderColor={palette().line}
                  paddingLeft={2}
                >
                  {showModels() ? models() : null}
                  {showTools() ? tools() : null}
                  {showLearning() ? learning() : null}
                  {showLastDays() ? lastWeek() : null}
                </box>
              ) : showModels() ? (
                <box flexDirection="column" minHeight={0}>
                  {models()}
                  {showTools() ? tools() : null}
                  {showLearning() ? learning() : null}
                  {showLastDays() ? lastWeek() : null}
                </box>
              ) : null}
            </box>
          </box>
        </>
      )}

      {props.summary.diagnostic ? (
        <Callout theme={palette()} tone="warning" width={props.width - 4} message={props.summary.diagnostic} />
      ) : null}
      {props.view.notice ? (
        <Callout theme={palette()} tone="warning" width={props.width - 4} message={props.view.notice} />
      ) : null}

      <box flexDirection="row" justifyContent="space-between" flexShrink={0} marginTop={1}>
        <text fg={palette().muted} wrapMode="none">
          {footerHints()}
        </text>
      </box>
    </box>
  )
}

/**
 * Usage and budget settings.
 *
 * Totals come from the usage store's snapshot and are never recomputed here;
 * changing a budget setting never deletes a recorded run.
 */
import { parseBinding, type Binding } from "../keymap/registry";
import type { BudgetConfig, BudgetPeriod } from "../../llm/budget";
import type { RunRecord, UsageTotals } from "../../llm/usage";
import type { ThemePalette } from "../theme";
export type UsageSnapshot = {
  today: UsageTotals
  month: UsageTotals
  /** Every recorded run, newest first, for the breakdown. */
  runs: readonly RunRecord[]
  /** Micro-USD spent in the current budget period. */
  spentMicroUsd: number
}

export type UsageState = {
  budget: BudgetConfig
  /** Until the user confirms, only a draft is shown. */
  draftBudget: number
  pendingPeriod?: BudgetPeriod | null
  overrideArmed: boolean
  expanded: boolean
  notice?: string | null
}

export const PRICE_TABLE_DATE = "2026-11-01"
export const DISCLAIMER = "prices are estimates, not a bill"

export function initialUsage(budget: BudgetConfig): UsageState {
  return {
    budget,
    draftBudget: budget.budget,
    pendingPeriod: null,
    overrideArmed: false,
    expanded: false,
    notice: null,
  }
}

const micro = (amount: number) => Math.round(amount * 1_000_000)

/** 0 renders `no limit` and never blocks a request. */
export function budgetLabel(budget: BudgetConfig): string {
  return budget.budget === 0 ? "no limit" : `$${budget.budget.toFixed(2)} per ${budget.period}`
}

export function totalsLine(totals: UsageTotals): string {
  const cost =
    totals.costMicroUsd === null ? "cost unknown" : `$${(totals.costMicroUsd / 1_000_000).toFixed(4)}`
  return `${totals.input + totals.output} tok · ${cost} · ${totals.runs} runs · ${totals.failed} failed`
}

/** A failed run is visible in the breakdown, never folded into a total. */
export function runLine(run: RunRecord): string {
  const cost = run.costMicroUsd === null ? "cost unknown" : `$${(run.costMicroUsd / 1_000_000).toFixed(4)}`
  return `${run.model}  ${run.input + run.output} tok  ${cost}${run.failed ? "  failed run" : ""}`
}

export function breakdownLines(snapshot: UsageSnapshot): string[] {
  return [...snapshot.runs].map(runLine)
}

/** Narrow screens collapse the breakdown to two lines behind a key. */
export function breakdownLinesFor(
  snapshot: UsageSnapshot,
  width: number,
  expanded: boolean,
): string[] {
  const all = breakdownLines(snapshot)
  if (width >= 120 || expanded) return all
  return all.slice(0, 2)
}

export type FieldResult = { kind: "patch"; patch: Record<string, unknown> } | { kind: "refused"; reason: string }

export const WARN_RANGE = { min: 0.1, max: 1 } as const

/** Percentages are shown to the user; the stored value stays 0–1. */
export function warnLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function setBudgetAmount(_state: UsageState, amount: number): FieldResult {
  if (!Number.isFinite(amount) || amount < 0) {
    return { kind: "refused", reason: `a budget is $0 or more; got ${amount}` }
  }
  return { kind: "patch", patch: { "usage.budget": amount } }
}

export function setWarnAt(_state: UsageState, ratio: number): FieldResult {
  if (!Number.isFinite(ratio) || ratio < WARN_RANGE.min || ratio > WARN_RANGE.max) {
    return {
      kind: "refused",
      reason: `warn threshold is 10–100%, got ${Math.round(ratio * 100)}%`,
    }
  }
  return { kind: "patch", patch: { "usage.warn_at": ratio } }
}

/**
 * Changing the period or the amount changes when the next warning fires — it
 * never resets recorded usage, and the screen says so in one line.
 */
export function periodEffect(state: UsageState, period: BudgetPeriod): { next: UsageState; line: string } {
  return {
    next: { ...state, pendingPeriod: period, notice: periodEffectLine(period) },
    line: periodEffectLine(period),
  }
}

export function periodEffectLine(period: BudgetPeriod): string {
  return `today's total is kept; the ${period} period restarts when the limit next applies`
}

export function confirmPeriod(state: UsageState): FieldResult {
  if (!state.pendingPeriod) return { kind: "refused", reason: "no period change is waiting" }
  return { kind: "patch", patch: { "usage.period": state.pendingPeriod } }
}

export function togglePause(state: UsageState): FieldResult {
  return { kind: "patch", patch: { "usage.pause_at_limit": !state.budget.pause_at_limit } }
}

/** At or over the limit a request is refused with the budget copy. */
export function limitReached(snapshot: UsageSnapshot, budget: BudgetConfig): boolean {
  if (budget.budget === 0) return false
  return snapshot.spentMicroUsd >= micro(budget.budget)
}

export function refusalCopy(budget: BudgetConfig): string {
  return `${budget.period} budget reached ($${budget.budget.toFixed(2)}) · press o to override once`
}

export function overrideNote(): string {
  return "the override is not remembered; the next request asks again"
}

/** The one-shot override arms exactly one request. */
export function armOverride(state: UsageState): UsageState {
  return { ...state, overrideArmed: true, notice: overrideNote() }
}

export function consumeOverride(state: UsageState): UsageState {
  return { ...state, overrideArmed: false }
}

export function disclaimerLine(): string {
  return `${DISCLAIMER} · price table ${PRICE_TABLE_DATE}`
}

// ---------------------------------------------------------------- keys

export type UsageIntent = "down" | "edit" | "period" | "pause" | "expand" | "override" | "close"

const SPECS: Array<{ intent: UsageIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "edit", key: "return", footer: "Enter edit" },
  { intent: "period", key: "p", footer: "p period" },
  { intent: "pause", key: "t", footer: "t pause" },
  { intent: "expand", key: "e", footer: "e expand" },
  { intent: "override", key: "o", footer: "o override" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`usage key "${key}": ${binding.message}`)
  return binding
}

export const USAGE_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): UsageIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return USAGE_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return USAGE_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

/** The status bar reads this too, so there is exactly one source of numbers. */
export function statusNumbers(snapshot: UsageSnapshot): { tokens: number; costMicroUsd: number | null } {
  return {
    tokens: snapshot.today.input + snapshot.today.output,
    costMicroUsd: snapshot.today.costMicroUsd,
  }
}

// ---------------------------------------------------------------- render

export function UsagePanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: UsageState
  snapshot: UsageSnapshot
}) {
  const palette = () => props.theme
  const reached = () => limitReached(props.snapshot, props.state.budget)
  const breakdown = () => breakdownLinesFor(props.snapshot, props.width, props.state.expanded)

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} USAGE · ${budgetLabel(props.state.budget)}`}
      </text>

      <text fg={palette().foreground} wrapMode="none">
        {`today  ${totalsLine(props.snapshot.today)}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`month  ${totalsLine(props.snapshot.month)}`}
      </text>
      <text fg={palette().foreground} wrapMode="none">
        {`warn at ${warnLabel(props.state.budget.warn_at)} · pause at limit ${props.state.budget.pause_at_limit ? "on" : "off"}`}
      </text>

      <text fg={palette().secondary} wrapMode="none">
        {"BREAKDOWN"}
      </text>
      {breakdown().map((line) => (
        <text fg={line.includes("failed run") ? palette().error : palette().foreground} wrapMode="none">
          {line}
        </text>
      ))}
      {props.width < 120 && !props.state.expanded && props.snapshot.runs.length > 2 ? (
        <text fg={palette().muted} wrapMode="none">
          {"… Enter expand"}
        </text>
      ) : null}

      {reached() ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${refusalCopy(props.state.budget)}`}
        </text>
      ) : null}
      {props.state.pendingPeriod ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${periodEffectLine(props.state.pendingPeriod)}`}
        </text>
      ) : null}
      {props.state.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      ) : null}

      <text fg={palette().muted} wrapMode="none">
        {disclaimerLine()}
      </text>
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}

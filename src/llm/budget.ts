/**
 * Budget gate (`docs/product.md` §10.2, `docs/architecture.md` §3.3).
 *
 * - `check()` runs **before** a request. At or over the limit with
 *   `pause_at_limit`, the caller gets `{ kind: "budget", limit, period }` and
 *   nothing is sent. This is a spend guard, not the token cap from WP-202.
 * - Crossing `warn_at` warns **once per period**, not on every request.
 * - A one-shot override lets exactly one further request through and re-arms
 *   the gate; it is never remembered.
 * - Period boundaries are local midnight / local first-of-month, computed from
 *   one injected clock so a test can move time instead of sleeping.
 */
import { usdToMicroUsd } from "./pricing"

export type BudgetPeriod = "day" | "month"

export type BudgetConfig = {
  /** USD. 0 means "no limit". */
  budget: number
  period: BudgetPeriod
  /** 0–1; 0.8 = warn at 80%. */
  warn_at: number
  pause_at_limit: boolean
}

export type BudgetBlock = { kind: "budget"; limit: number; period: BudgetPeriod }

export type BudgetState = {
  /** Integer micro-USD spent in the current period. */
  spentMicroUsd: number
  /** `null` when no limit is configured. */
  limitMicroUsd: number | null
  /** spent / limit, or `null` without a limit. */
  ratio: number | null
  /** True on the single call that crosses `warn_at` in this period. */
  warning: boolean
  /** True when this call is refused. */
  blocked: boolean
  /** True when this call is allowed by the one-shot override. */
  overridden: boolean
  periodKey: string
}

export type CheckResult = { block: BudgetBlock | null; state: BudgetState }

/**
 * Start of the current period in **local** time. Instants are stored in UTC,
 * but a user's "today" is their local day, so the boundary is local.
 */
export function periodStart(now: Date, period: BudgetPeriod): Date {
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
}

/** Stable key for "this period", used to remember what was already warned. */
export function periodKey(now: Date, period: BudgetPeriod): string {
  const start = periodStart(now, period)
  const month = String(start.getMonth() + 1).padStart(2, "0")
  if (period === "month") return `${start.getFullYear()}-${month}`
  return `${start.getFullYear()}-${month}-${String(start.getDate()).padStart(2, "0")}`
}

export type BudgetGate = {
  /** Ask permission for one request. `override` is the user's explicit yes. */
  check(spentMicroUsd: number, options?: { override?: boolean }): CheckResult
  /** Arm a single override; consumed by the next `check()`. */
  overrideOnce(): void
  /** The current period key, for diagnostics. */
  key(): string
  /** True while an override is armed. */
  isOverridden(): boolean
}

export function createBudgetGate(options: {
  config: () => BudgetConfig
  now?: () => Date
}): BudgetGate {
  const now = options.now ?? (() => new Date())
  let warnedFor: string | null = null
  let overrideArmed = false

  return {
    key: () => periodKey(now(), options.config().period),

    isOverridden: () => overrideArmed,

    overrideOnce() {
      overrideArmed = true
    },

    check(spentMicroUsd: number, opts: { override?: boolean } = {}): CheckResult {
      const config = options.config()
      const key = periodKey(now(), config.period)
      const limitMicroUsd = config.budget > 0 ? usdToMicroUsd(config.budget) : null
      const ratio = limitMicroUsd === null ? null : limitMicroUsd === 0 ? 1 : spentMicroUsd / limitMicroUsd

      const explicit = opts.override === true
      const armed = overrideArmed
      const overLimit = limitMicroUsd !== null && spentMicroUsd >= limitMicroUsd

      let blocked = false
      let overridden = false
      if (overLimit && config.pause_at_limit) {
        if (explicit) {
          overridden = true
        } else if (armed) {
          // Consume the one-shot override: the next call is gated again.
          overrideArmed = false
          overridden = true
        } else {
          blocked = true
        }
      }

      let warning = false
      if (ratio !== null && config.warn_at > 0 && ratio >= config.warn_at && warnedFor !== key) {
        warnedFor = key
        warning = true
      }

      return {
        block: blocked && limitMicroUsd !== null ? { kind: "budget", limit: limitMicroUsd, period: config.period } : null,
        state: {
          spentMicroUsd,
          limitMicroUsd,
          ratio,
          warning,
          blocked,
          overridden,
          periodKey: key,
        },
      }
    },
  }
}

/** Copy for the blocked request (design §11: say what happened and what next). */
export function budgetCopy(block: BudgetBlock): { title: string; next: string } {
  const amount = `$${(block.limit / 1_000_000).toFixed(2)}`
  return {
    title: `This ${block.period}'s budget of ${amount} is spent.`,
    next: "Raise the budget in Settings → Usage, or allow this one request.",
  }
}

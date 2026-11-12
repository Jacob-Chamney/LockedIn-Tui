/**
 * Price table and cost estimation (`docs/product.md` §10.2).
 *
 * Rules this file exists to enforce:
 *
 *   - prices are **estimates**, not a bill — the table carries its own date so
 *     Settings can say "estimates as of <date>";
 *   - money is integer **micro-USD**, never a float, so a total cannot drift;
 *   - an unknown model yields `null`, and the UI says "cost unknown" — never
 *     `$0.0000`, which would be a lie about spend;
 *   - a loopback endpoint is genuinely free and is labelled "free";
 *   - no network fetch, ever.
 */

export type ModelPrice = {
  /** USD per million tokens. */
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
}

export type PriceTable = {
  version: number
  /** ISO date the numbers were copied from the provider's published prices. */
  asOf: string
  currency: "USD"
  models: Record<string, ModelPrice>
}

/**
 * Committed table, keyed by `provider/model` (`docs/product.md` §10.2).
 * Update `version` and `asOf` together; never edit a shipped price in place
 * without changing them, so a stored run stays explainable.
 */
export const PRICE_TABLE: PriceTable = {
  version: 1,
  asOf: "2026-11-01",
  currency: "USD",
  models: {
    "openai/gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6, cacheReadPerMTok: 0.1, cacheWritePerMTok: 0.4 },
    "openai/gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8, cacheReadPerMTok: 0.5, cacheWritePerMTok: 2 },
    "anthropic/claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
    "anthropic/claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
    "google/gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.31, cacheWritePerMTok: 1.25 },
    "openrouter/anthropic/claude-sonnet-4-5": {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    },
    "opencode-go/deepseek-v4.1-flash": {
      inputPerMTok: 0.15,
      outputPerMTok: 0.6,
      cacheReadPerMTok: 0.003,
      cacheWritePerMTok: 0,
    },
  },
}

/** A local endpoint costs nothing to run; it still reports tokens. */
export const FREE_PRICE: ModelPrice = {
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheWritePerMTok: 0,
}

export type PriceLookup = { price: ModelPrice | null; free: boolean }

/**
 * `localhost`, `127.0.0.0/8`, `::1` and `0.0.0.0` are the local-model cases
 * named in `docs/product.md` §10.2 (Ollama, LM Studio, llama.cpp).
 */
export function isLoopbackUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim().toLowerCase()
  if (trimmed.length === 0) return false
  let host: string
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname
  } catch {
    return false
  }
  const bare = host.replace(/^\[|\]$/g, "")
  if (bare === "localhost" || bare === "::1" || bare === "0.0.0.0") return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return true
  return false
}

/** Price for one model. A loopback base URL wins over the table. */
export function priceFor(model: string, options: { baseUrl?: string; table?: PriceTable } = {}): PriceLookup {
  if (options.baseUrl && isLoopbackUrl(options.baseUrl)) return { price: FREE_PRICE, free: true }
  const table = options.table ?? PRICE_TABLE
  return { price: table.models[model] ?? null, free: false }
}

export type TokenCounts = { input: number; output: number; cacheRead?: number; cacheWrite?: number }

/**
 * Integer micro-USD. One million tokens at $3/M costs exactly 3,000,000
 * micro-USD = $3, so the arithmetic reduces to `tokens × price`.
 */
export function estimateCostMicroUsd(price: ModelPrice | null, tokens: TokenCounts): number | null {
  if (!price) return null
  const read = tokens.cacheRead ?? 0
  const write = tokens.cacheWrite ?? 0
  const total =
    tokens.input * price.inputPerMTok +
    tokens.output * price.outputPerMTok +
    read * price.cacheReadPerMTok +
    write * price.cacheWritePerMTok
  // `total` is already micro-USD; round once, at the end.
  return Math.round(total)
}

export type CostLabel = { costMicroUsd: number | null; label: string }

/**
 * The only place a cost becomes text. `null` is "cost unknown", 0 on a priced
 * model is `$0.0000`, and a free endpoint says "free".
 */
export const COST_UNKNOWN = "cost unknown"

export function formatCost(costMicroUsd: number | null | undefined, options: { free?: boolean } = {}): string {
  if (costMicroUsd === null || costMicroUsd === undefined) return COST_UNKNOWN
  // Only an endpoint known to be free says "free". A priced run that rounds to
  // zero micro-USD is `$0.0000`, not a claim that the call cost nothing.
  if (options.free === true) return "free"
  return `$${(costMicroUsd / 1_000_000).toFixed(4)}`
}

/** Settings copy; keeps the estimate caveat next to the numbers. */
export function priceDisclaimer(table: PriceTable = PRICE_TABLE): string {
  return `Prices are estimates as of ${table.asOf}, not a bill.`
}

/** USD (from config) → integer micro-USD. */
export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * 1_000_000)
}

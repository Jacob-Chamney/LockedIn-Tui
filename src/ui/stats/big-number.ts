/** Compact token totals and a block font for the hero number. */

export function compactTokens(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  const decimals = Math.max(0, Math.trunc(digits))
  const unit = (divisor: number, suffix: string): string =>
    `${(value / divisor).toFixed(decimals).replace(/\.0+$/, "")}${suffix}`
  if (value >= 1_000_000_000) return unit(1_000_000_000, "B")
  if (value >= 1_000_000) return unit(1_000_000, "M")
  if (value >= 1_000) return unit(1_000, "K")
  return String(Math.trunc(value))
}

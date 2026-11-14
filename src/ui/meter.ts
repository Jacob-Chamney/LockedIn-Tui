/**
 * Cell maths for a progress meter.
 *
 * The app draws a spend meter from these counts, and the SDK's `meter()`
 * feeds the same fraction into a scene progress node, so both surfaces agree
 * on how full a bar looks.
 */
export type MeterCells = {
  /** Columns of the track that are filled. */
  filled: number
  /** Columns that remain. */
  empty: number
  /** Clamped 0..1 fraction. */
  fraction: number
}

/**
 * Split a `width`-cell track at `value` out of `max`.
 *
 * A zero or missing limit yields an empty track rather than a full one; values
 * outside `0..max` are clamped, and a non-finite value counts as zero.
 */
export function meterCells(value: number, max: number, width: number): MeterCells {
  const columns = Math.max(0, Math.floor(width))
  if (columns === 0) return { filled: 0, empty: 0, fraction: 0 }
  const limit = Number.isFinite(max) && max > 0 ? max : 0
  const amount = Number.isFinite(value) ? value : 0
  const fraction = limit === 0 ? 0 : Math.max(0, Math.min(1, amount / limit))
  const filled = Math.max(0, Math.min(columns, Math.round(fraction * columns)))
  return { filled, empty: columns - filled, fraction }
}

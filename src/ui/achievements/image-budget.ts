/**
 * How large the achievement image may be.
 *
 * The map is a single native image that is replaced every animation frame.
 * Ghostty (kitty graphics) delivers a small pane smoothly and a full-screen
 * pane in visible steps, so the cost is the pixel count per frame, not the
 * camera maths. A fixed budget keeps that cost below what the terminal has
 * been measured to sustain, and it never changes during a pan.
 */

/** Pixels per frame. Roughly the load of a 90x30 pane, which animates smoothly. */
export const DEFAULT_ACHIEVEMENT_PIXELS = 600_000
export const MIN_ACHIEVEMENT_PIXELS = 120_000
export const MAX_ACHIEVEMENT_PIXELS = 8_000_000

export function resolveAchievementPixels(
  raw: string | undefined = process.env.LOCKEDIN_ACHIEVEMENT_PIXELS,
  fallback = DEFAULT_ACHIEVEMENT_PIXELS,
): number {
  const clamp = (value: number) =>
    Math.max(MIN_ACHIEVEMENT_PIXELS, Math.min(MAX_ACHIEVEMENT_PIXELS, Math.round(value)))
  const fallbackValue = clamp(fallback)
  const value = raw === undefined || raw.trim() === "" ? fallbackValue : Number(raw)
  if (!Number.isFinite(value)) return fallbackValue
  return clamp(value)
}

/** Scale that brings a native surface inside the budget; 1 when it already fits. */
export function imageScale(nativeWidth: number, nativeHeight: number, budget: number): number {
  const pixels = nativeWidth * nativeHeight
  if (!(pixels > 0) || !(budget > 0) || pixels <= budget) return 1
  return Math.sqrt(budget / pixels)
}

/**
 * Terminal pixels per cell.
 *
 * A resize clears the renderer's resolution until the terminal answers again.
 * The cell size itself does not change when a window grows, so the last real
 * value is the correct one to keep using; falling back to 8x16 is what made a
 * maximised pane look stretched and blurry.
 */
export function cellSize(
  resolution: { width: number; height: number } | null,
  columns: number,
  rows: number,
  previous: { width: number; height: number } | null,
): { width: number; height: number } {
  if (resolution && resolution.width > 0 && resolution.height > 0 && columns > 0 && rows > 0) {
    return { width: resolution.width / columns, height: resolution.height / rows }
  }
  return previous ?? { width: 8, height: 16 }
}

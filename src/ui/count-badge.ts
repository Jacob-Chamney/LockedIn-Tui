/**
 * Numeric count badges: a padded number with a 99+ overflow.
 *
 * One implementation serves the plugin SDK (`countBadge()` paints the pill) and
 * the app's Explorer. The badge is `pad` spaces each side, grows by one cell for
 * each extra digit, and shows `${max}+` above the cap. Placement helpers keep a
 * right-aligned badge inside its container.
 */
export type CountBadgeTone = "info" | "success" | "warning" | "error" | "muted"

export type CountBadgeStyle = {
  bg: string
  fg: string
}

export const COUNT_BADGE_STYLES: Readonly<Record<CountBadgeTone, CountBadgeStyle>> = {
  info: { bg: "primary", fg: "background" },
  success: { bg: "success", fg: "background" },
  warning: { bg: "warning", fg: "background" },
  error: { bg: "error", fg: "background" },
  muted: { bg: "line", fg: "foreground" },
}

export function countBadgeStyle(tone: CountBadgeTone = "info"): CountBadgeStyle {
  return COUNT_BADGE_STYLES[tone] ?? COUNT_BADGE_STYLES.info
}

export type CountBadgeOptions = {
  count: number
  /** Highest count shown exactly; above it becomes `max+`. Defaults 99. */
  max?: number
  /** Spaces on each side of the number; defaults 1. */
  pad?: number
  tone?: CountBadgeTone
  /** Available columns; defaults to the natural width. */
  width?: number
}

export type CountBadgeLayout = {
  count: number
  max: number
  /** `3`, `42` or `99+`. */
  display: string
  /** True when the count exceeded the cap. */
  overflow: boolean
  text: string
  width: number
  tone: CountBadgeTone
}

function padLabel(label: string, pad: number): string {
  const spacing = " ".repeat(Math.max(0, pad))
  return `${spacing}${label}${spacing}`
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function countBadgeLayout(options: CountBadgeOptions): CountBadgeLayout {
  const max = Math.max(1, Math.floor(options.max ?? 99))
  const count = Math.max(0, Math.floor(Number.isFinite(options.count) ? options.count : 0))
  const overflow = count > max
  const display = overflow ? `${max}+` : String(count)
  const natural = padLabel(display, Math.max(0, Math.floor(options.pad ?? 1)))
  const width = options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    count,
    max,
    display,
    overflow,
    text: fit(natural, width),
    width,
    tone: options.tone ?? "info",
  }
}

/** Left offset for a badge in a container, clamped inside it. */
export function countBadgePlacement(options: {
  container: number
  badge: number
  align?: "left" | "right" | "center"
  inset?: number
}): number {
  const container = Math.max(0, Math.floor(options.container))
  const badge = Math.max(0, Math.floor(options.badge))
  const inset = Math.max(0, Math.floor(options.inset ?? 0))
  if (options.align === "left") return Math.min(inset, Math.max(0, container - badge))
  if (options.align === "center") return Math.max(0, Math.floor((container - badge) / 2))
  return Math.max(0, container - badge - inset)
}

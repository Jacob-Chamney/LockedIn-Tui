/**
 * Status badges: small filled chips in a row.
 *
 * One implementation serves the plugin SDK (`badges()` places scene nodes) and
 * the app's Models screen. A badge is a label with one space of padding each
 * side, filled with its tone colour. Badges are measured left to right; the
 * first one that does not fit ends the row, and a lone too-wide badge is
 * truncated, so a row never runs past its pane.
 */
export type BadgeTone = "info" | "success" | "warning" | "error" | "neutral"

export type BadgeSpec = {
  label: string
  tone?: BadgeTone
}

export type BadgeStyle = {
  /** Palette role for the fill. */
  bg: string
  /** Palette role for the label. */
  fg: string
}

/** The fill and ink for a tone; `neutral` reads as a quiet line chip. */
export function badgeStyle(tone: BadgeTone = "neutral"): BadgeStyle {
  switch (tone) {
    case "success":
      return { bg: "success", fg: "background" }
    case "warning":
      return { bg: "warning", fg: "background" }
    case "error":
      return { bg: "error", fg: "background" }
    case "info":
      return { bg: "primary", fg: "background" }
    default:
      return { bg: "line", fg: "background" }
  }
}

export type BadgeSegment = {
  /** Chip text, including its padding. */
  text: string
  tone: BadgeTone
  /** Offset from the row's left edge. */
  x: number
  width: number
  index: number
}

export type BadgeLayoutOptions = {
  badges: readonly BadgeSpec[]
  /** Available columns for the whole row. */
  width: number
  /** Spaces on each side of a label; defaults to 1. */
  padding?: number
  /** Spaces between badges; defaults to 1. */
  gap?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function badgeLayout(options: BadgeLayoutOptions): BadgeSegment[] {
  const badges = options.badges
  if (badges.length === 0) return []
  const width = Math.max(0, Math.floor(options.width))
  if (width === 0) return []
  const padding = clamp(Math.floor(options.padding ?? 1), 0, 4)
  const gap = clamp(Math.floor(options.gap ?? 1), 0, 8)
  const out: BadgeSegment[] = []
  let x = 0

  for (let index = 0; index < badges.length; index++) {
    const badge = badges[index]!
    const pad = " ".repeat(padding)
    let text = `${pad}${badge.label}${pad}`
    const at = out.length === 0 ? 0 : x + gap
    if (at + text.length > width) {
      if (out.length > 0) break
      if (width <= 1) return []
      text = `${text.slice(0, width - 1)}…`
    }
    out.push({ text, tone: badge.tone ?? "neutral", x: at, width: text.length, index })
    x = at + text.length
  }
  return out
}

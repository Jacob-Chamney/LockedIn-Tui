/**
 * Tooltip layout and placement.
 *
 * One implementation serves the plugin SDK (`tooltip()` draws a bordered box)
 * and the app's Settings help hint. `tooltipLayout` wraps and clips the text;
 * `tooltipPosition` centres the box under a target, flips above it when there
 * is no room below, and clamps to the screen. The box is four cells wider than
 * its text (two borders and one padding cell each side).
 */
export type TooltipLayoutOptions = {
  text: string
  /** Outer width, including borders and padding. */
  width: number
  title?: string
  /** Maximum body lines; defaults to 6. */
  maxLines?: number
}

export type TooltipLayout = {
  /** Title (if any) followed by body lines. */
  lines: string[]
  width: number
  /** Outer height: lines plus the top and bottom borders. */
  height: number
  innerWidth: number
  truncated: boolean
}

export type TooltipTarget = { x: number; y: number; width: number; height: number }

export type TooltipPositionOptions = {
  target: TooltipTarget
  size: { width: number; height: number }
  bounds: { width: number; height: number }
  /** Gap between the target and the box; defaults to 1. */
  gap?: number
  /** Preferred side; defaults to `below` and flips when it does not fit. */
  prefer?: "below" | "above"
}

export type TooltipPlacement = {
  left: number
  top: number
  side: "below" | "above"
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/** Word wrap with a hard break for a word wider than the line. */
function wrapLines(message: string, width: number): string[] {
  if (message === "") return []
  const out: string[] = []
  for (const paragraph of message.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter((word) => word !== "")
    if (words.length === 0) {
      out.push("")
      continue
    }
    let line = ""
    for (const word of words) {
      if (word.length > width) {
        if (line !== "") {
          out.push(line)
          line = ""
        }
        let rest = word
        while (rest.length > width) {
          out.push(rest.slice(0, width))
          rest = rest.slice(width)
        }
        line = rest
        continue
      }
      if (line === "") line = word
      else if (line.length + 1 + word.length <= width) line = `${line} ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line !== "") out.push(line)
  }
  return out
}

export function tooltipLayout(options: TooltipLayoutOptions): TooltipLayout {
  const width = Math.max(4, Math.floor(options.width))
  const innerWidth = Math.max(1, width - 4)
  const body = wrapLines(options.text, innerWidth)
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 6))
  const kept = body.slice(0, maxLines)
  const truncated = body.length > maxLines
  if (truncated && kept.length > 0) {
    const at = kept.length - 1
    kept[at] = `${fit(kept[at]!, Math.max(1, innerWidth - 1))}…`
  }
  const title = options.title ? [fit(options.title, innerWidth)] : []
  const lines = [...title, ...kept]
  return {
    lines,
    width,
    height: Math.max(2, lines.length + 2),
    innerWidth,
    truncated,
  }
}

export function tooltipPosition(options: TooltipPositionOptions): TooltipPlacement {
  const gap = Math.max(0, Math.floor(options.gap ?? 1))
  const { target, size, bounds } = options
  const below = target.y + target.height + gap
  const above = target.y - gap - size.height
  const fitsBelow = below + size.height <= bounds.height
  const fitsAbove = above >= 0
  const side =
    options.prefer === "above"
      ? fitsAbove
        ? "above"
        : "below"
      : fitsBelow
        ? "below"
        : fitsAbove
          ? "above"
          : "below"
  const top = clamp(side === "below" ? below : above, 0, Math.max(0, bounds.height - size.height))
  const left = clamp(
    target.x + Math.floor((target.width - size.width) / 2),
    0,
    Math.max(0, bounds.width - size.width),
  )
  return { left, top, side }
}

/**
 * Tone-coded callouts.
 *
 * One implementation serves the plugin SDK (`callout()` places scene nodes)
 * and the app's `Callout` component. The bar is always `▌`; the message wraps
 * to the given width with a hard break for a word longer than the line, so a
 * warning never runs past the pane.
 */
export type CalloutTone = "info" | "success" | "warning" | "error"

/** The palette role each tone uses. `info` follows the app's secondary ink. */
export const CALLOUT_ROLES: Readonly<Record<CalloutTone, string>> = {
  info: "secondary",
  success: "success",
  warning: "warning",
  error: "error",
}

export const CALLOUT_GLYPH = "▌"

export function calloutRole(tone: CalloutTone = "info"): string {
  return CALLOUT_ROLES[tone] ?? "secondary"
}

/**
 * Wrap a message to `width` columns, preserving explicit newlines.
 *
 * A word wider than the line is hard-broken across lines rather than clipped.
 * An empty message yields no lines; a blank line inside the message is kept.
 */
export function calloutLines(message: string, width: number): string[] {
  if (message === "") return []
  const columns = Math.max(1, Math.floor(width))
  const out: string[] = []
  for (const paragraph of message.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter((word) => word !== "")
    if (words.length === 0) {
      out.push("")
      continue
    }
    let line = ""
    for (const word of words) {
      if (word.length > columns) {
        if (line !== "") {
          out.push(line)
          line = ""
        }
        let rest = word
        while (rest.length > columns) {
          out.push(rest.slice(0, columns))
          rest = rest.slice(columns)
        }
        line = rest
        continue
      }
      if (line === "") line = word
      else if (line.length + 1 + word.length <= columns) line = `${line} ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line !== "") out.push(line)
  }
  return out
}

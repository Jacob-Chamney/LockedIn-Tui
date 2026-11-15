/**
 * Toggle/switch labels.
 *
 * One implementation serves the plugin SDK (`toggle()` draws a pill) and the
 * app's Settings boolean rows. The switch is a state glyph (`●` on, `○` off)
 * and a label; the text is fitted to the supplied width, so a long custom label
 * truncates rather than pushing the value column.
 */
export type ToggleTone = "success" | "muted"

export type ToggleLayout = {
  on: boolean
  /** The state label (`on`/`off` by default). */
  label: string
  /** Glyph plus label, fitted to `width`. */
  text: string
  tone: ToggleTone
  width: number
}

export type ToggleOptions = {
  on: boolean
  onLabel?: string
  offLabel?: string
  /** Available columns; defaults to the natural text width. */
  width?: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function toggleLayout(options: ToggleOptions): ToggleLayout {
  const label = options.on ? (options.onLabel ?? "on") : (options.offLabel ?? "off")
  const natural = `${options.on ? "●" : "○"} ${label}`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    on: options.on,
    label,
    text: fit(natural, width),
    tone: options.on ? "success" : "muted",
    width,
  }
}

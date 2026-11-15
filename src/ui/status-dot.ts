/**
 * Status dots: a state glyph and tone with an optional label.
 *
 * One implementation serves the plugin SDK (`statusDot()` draws the glyph) and
 * the app's MCP server rows. Shape and colour both carry the state, so a
 * monochrome terminal still reads it.
 */
export type StatusState = "ok" | "warn" | "error" | "idle" | "info"

export type StatusDotGlyphs = {
  ok: string
  warn: string
  error: string
  idle: string
  info: string
}

export const STATUS_GLYPHS: Readonly<StatusDotGlyphs> = {
  ok: "●",
  warn: "▲",
  error: "×",
  idle: "○",
  info: "◆",
}

export type StatusDotTones = {
  ok: string
  warn: string
  error: string
  idle: string
  info: string
}

export const STATUS_TONES: Readonly<StatusDotTones> = {
  ok: "success",
  warn: "warning",
  error: "error",
  idle: "muted",
  info: "primary",
}

export type StatusDotOptions = {
  state: StatusState
  /** Optional text after the glyph. */
  label?: string
  /** Available columns; defaults to the natural text width. */
  width?: number
  glyphs?: Partial<StatusDotGlyphs>
  tones?: Partial<StatusDotTones>
}

export type StatusDotLayout = {
  state: StatusState
  glyph: string
  /** Palette role for the glyph. */
  tone: string
  label: string
  /** Glyph plus label, fitted. */
  text: string
  width: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function statusDotLayout(options: StatusDotOptions): StatusDotLayout {
  const glyph = options.glyphs?.[options.state] ?? STATUS_GLYPHS[options.state]
  const tone = options.tones?.[options.state] ?? STATUS_TONES[options.state]
  const label = options.label ?? ""
  const natural = label === "" ? glyph : `${glyph} ${label}`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    state: options.state,
    glyph,
    tone,
    label,
    text: fit(natural, width),
    width,
  }
}

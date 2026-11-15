/**
 * Stat deltas: a signed percentage with a direction glyph and a semantic tone.
 *
 * One implementation serves the plugin SDK (`delta()` places the text) and the
 * app's Stats hero. `good` decides whether a rise or a fall is the healthy
 * direction, so spending can read an increase as bad while output reads it as
 * good.
 */
export type DeltaDirection = "up" | "down" | "flat"
export type DeltaTone = "success" | "error" | "muted"

export type DeltaGlyphs = {
  up: string
  down: string
  flat: string
}

export const DELTA_GLYPHS: Readonly<DeltaGlyphs> = {
  up: "▲",
  down: "▼",
  flat: "—",
}

export type DeltaOptions = {
  /** Signed percentage; rounded for display. */
  value: number
  /** Optional context after the number, e.g. `vs prior 7d`. */
  label?: string
  /** Which direction is healthy; defaults to `up`. */
  good?: "up" | "down"
  /** Available columns; defaults to the natural text width. */
  width?: number
  glyphs?: Partial<DeltaGlyphs>
}

export type DeltaLayout = {
  value: number
  percent: number
  direction: DeltaDirection
  tone: DeltaTone
  glyph: string
  text: string
  width: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function deltaLayout(options: DeltaOptions): DeltaLayout {
  const glyphs = { ...DELTA_GLYPHS, ...options.glyphs }
  const finite = Number.isFinite(options.value) ? options.value : 0
  const percent = Math.round(finite)
  const direction: DeltaDirection = percent > 0 ? "up" : percent < 0 ? "down" : "flat"
  const good = options.good ?? "up"
  const tone: DeltaTone =
    direction === "flat" ? "muted" : direction === good ? "success" : "error"
  const glyph = direction === "up" ? glyphs.up : direction === "down" ? glyphs.down : glyphs.flat
  const number = direction === "flat" ? "0%" : `${Math.abs(percent)}%`
  const label = options.label === undefined || options.label === "" ? "" : ` ${options.label}`
  const natural = `${glyph} ${number}${label}`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    value: finite,
    percent,
    direction,
    tone,
    glyph,
    text: fit(natural, width),
    width,
  }
}

/** The delta text without placement. */
export function deltaText(options: DeltaOptions): string {
  return deltaLayout(options).text
}

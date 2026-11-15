/**
 * Spinner frames: a deterministic frame for an index and a fitted label.
 *
 * One implementation serves the plugin SDK (`spinner()` places the text) and
 * the app's plugin discovery line. The caller owns the clock: a renderer that
 * ticks increments the frame index, so tests can pin an exact glyph.
 */
export type SpinnerGlyphs = readonly string[]

export const SPINNER_FRAMES: SpinnerGlyphs = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export type SpinnerOptions = {
  /** Frame index; wrapped into the glyph list. */
  frame: number
  /** Text after the glyph. */
  label?: string
  /** Glyph list; defaults to the ten braille frames. */
  frames?: SpinnerGlyphs
  /** Available columns; defaults to the natural text width. */
  width?: number
}

export type SpinnerLayout = {
  frame: number
  glyph: string
  label: string
  text: string
  width: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function spinnerLayout(options: SpinnerOptions): SpinnerLayout {
  const frames = options.frames !== undefined && options.frames.length > 0 ? options.frames : SPINNER_FRAMES
  const index =
    frames.length === 0 ? 0 : ((Math.floor(options.frame) % frames.length) + frames.length) % frames.length
  const glyph = frames[index] ?? ""
  const label = options.label ?? ""
  const natural = label === "" ? glyph : `${glyph} ${label}`
  const width =
    options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  return {
    frame: index,
    glyph,
    label,
    text: fit(natural, width),
    width,
  }
}

/** The spinner text for a frame, without placement. */
export function spinnerText(options: SpinnerOptions): string {
  return spinnerLayout(options).text
}

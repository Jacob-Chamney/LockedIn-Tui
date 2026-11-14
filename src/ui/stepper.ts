/**
 * Stepper rows: completed, current and pending entries with a rail.
 *
 * One implementation serves the plugin SDK (`stepper()` places scene nodes)
 * and the app's assignment-steps reader. The prefix is fixed at five cells:
 * the selection bar, the status glyph and two spaces, so wrapped text and the
 * rail line up under the glyph.
 */
export type StepStatus = "done" | "current" | "pending"

export type StepperGlyphs = {
  /** A completed entry. */
  done: string
  /** The entry under the cursor. */
  current: string
  /** An entry that is neither done nor current. */
  pending: string
  /** The selection bar to the left of the glyph. */
  selected: string
  /** The rail under the glyph. */
  rail: string
}

export const STEPPER_GLYPHS: Readonly<StepperGlyphs> = {
  done: "✓",
  current: "▸",
  pending: "○",
  selected: "▌",
  rail: "│",
}

/** Characters in `stepPrefix`/`stepRail`; wrapped text starts after it. */
export const STEPPER_PREFIX_WIDTH = 5

export function stepperGlyphs(overrides?: Partial<StepperGlyphs>): StepperGlyphs {
  return { ...STEPPER_GLYPHS, ...overrides }
}

/** A checked entry is done even when the cursor is on it. */
export function stepStatus(checked: boolean, selected: boolean): StepStatus {
  return checked ? "done" : selected ? "current" : "pending"
}

export function stepMarker(status: StepStatus, glyphs: StepperGlyphs = STEPPER_GLYPHS): string {
  if (status === "done") return glyphs.done
  if (status === "current") return glyphs.current
  return glyphs.pending
}

/**
 * `▌ ✓  ` for a selected done step, `  ○  ` for a pending one.
 *
 * The leading bar marks the cursor independently of status, so a done step
 * that is also selected still reads as done.
 */
export function stepPrefix(
  status: StepStatus,
  selected: boolean,
  glyphs: StepperGlyphs = STEPPER_GLYPHS,
): string {
  return `${selected ? glyphs.selected : " "} ${stepMarker(status, glyphs)}  `
}

/** The rail line, aligned under the status glyph. */
export function stepRail(glyphs: StepperGlyphs = STEPPER_GLYPHS): string {
  return `  ${glyphs.rail}  `
}

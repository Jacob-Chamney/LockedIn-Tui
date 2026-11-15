/**
 * Inline number steppers: a minus button, the value and a plus button.
 *
 * One implementation serves the plugin SDK (`numberStepper()` paints the
 * controls) and the app's Settings budget row. Values are clamped to `min`/`max`
 * and rounded to the step grid; disabled or at-limit controls keep their shape
 * but read muted. The text is fitted to `width`.
 */
export type NumberStepperGlyphs = {
  minus: string
  plus: string
}

export const NUMBER_STEPPER_GLYPHS: Readonly<NumberStepperGlyphs> = {
  minus: "−",
  plus: "+",
}

export type NumberStepperOptions = {
  value: number
  min?: number
  max?: number
  /** Increment; defaults 1. */
  step?: number
  /** Decimal places for the default text; defaults 0. */
  precision?: number
  /** Text override, e.g. a currency label. */
  text?: string
  /** Available columns; defaults to the natural width. */
  width?: number
  disabled?: boolean
  glyphs?: Partial<NumberStepperGlyphs>
}

export type NumberStepperSegmentKind = "minus" | "value" | "plus"

export type NumberStepperSegment = {
  kind: NumberStepperSegmentKind
  text: string
  x: number
  width: number
  enabled: boolean
}

export type NumberStepperLayout = {
  value: number
  min: number
  max: number
  step: number
  text: string
  width: number
  disabled: boolean
  canDecrement: boolean
  canIncrement: boolean
  segments: NumberStepperSegment[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function numberStepperLayout(options: NumberStepperOptions): NumberStepperLayout {
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const maxRaw = Number.isFinite(options.max) ? (options.max as number) : Number.MAX_SAFE_INTEGER
  const max = maxRaw >= min ? maxRaw : min
  const step = Number.isFinite(options.step) && options.step! > 0 ? options.step! : 1
  const value = clamp(Number.isFinite(options.value) ? options.value : min, min, max)
  const disabled = options.disabled === true
  const glyphs = { ...NUMBER_STEPPER_GLYPHS, ...options.glyphs }
  const precision = Math.max(0, Math.min(6, Math.floor(options.precision ?? 0)))
  const label = options.text ?? value.toFixed(precision)
  const canDecrement = !disabled && value > min
  const canIncrement = !disabled && value < max
  const natural = `${glyphs.minus} ${label} ${glyphs.plus}`
  const width = options.width === undefined ? natural.length : Math.max(0, Math.floor(options.width))
  if (width === 0) {
    return {
      value,
      min,
      max,
      step,
      text: "",
      width: 0,
      disabled,
      canDecrement,
      canIncrement,
      segments: [],
    }
  }
  const segments: NumberStepperSegment[] = []
  const minus = `${glyphs.minus} `
  segments.push({ kind: "minus", text: minus, x: 0, width: minus.length, enabled: canDecrement })
  const room = Math.max(0, width - minus.length - (glyphs.plus.length + 1))
  const shown = fit(label, room)
  segments.push({ kind: "value", text: shown, x: minus.length, width: shown.length, enabled: !disabled })
  const plusX = width - glyphs.plus.length
  const gap = Math.max(0, plusX - (minus.length + shown.length))
  if (gap > 0) segments.push({ kind: "value", text: " ".repeat(gap), x: minus.length + shown.length, width: gap, enabled: !disabled })
  segments.push({ kind: "plus", text: glyphs.plus, x: plusX, width: glyphs.plus.length, enabled: canIncrement })
  return {
    value,
    min,
    max,
    step,
    text: fit(`${glyphs.minus} ${shown}${" ".repeat(Math.max(1, gap))}${glyphs.plus}`, width),
    width,
    disabled,
    canDecrement,
    canIncrement,
    segments,
  }
}

/** The stepper text without placement. */
export function numberStepperText(options: NumberStepperOptions): string {
  return numberStepperLayout(options).text
}

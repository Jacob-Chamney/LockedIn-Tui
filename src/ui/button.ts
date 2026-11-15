/**
 * Buttons: a keycap and a fitted label on one row.
 *
 * One implementation serves the plugin SDK (`button()` paints the keycap) and
 * the app's permission gate. The keycap carries the tone fill while the label
 * uses a readable ink; disabled buttons keep their shape and read muted.
 */
export type ButtonTone = "primary" | "secondary" | "success" | "warning" | "error" | "ghost"

export type ButtonStyle = {
  /** Fill behind the keycap. */
  keyBg: string
  /** Ink inside the keycap. */
  keyFg: string
  /** Label ink. */
  labelFg: string
}

export const BUTTON_STYLES: Readonly<Record<ButtonTone, ButtonStyle>> = {
  primary: { keyBg: "primary", keyFg: "background", labelFg: "primary" },
  secondary: { keyBg: "secondary", keyFg: "background", labelFg: "foreground" },
  success: { keyBg: "success", keyFg: "background", labelFg: "success" },
  warning: { keyBg: "warning", keyFg: "background", labelFg: "warning" },
  error: { keyBg: "error", keyFg: "background", labelFg: "error" },
  ghost: { keyBg: "line", keyFg: "foreground", labelFg: "muted" },
}

export function buttonStyle(tone: ButtonTone = "primary"): ButtonStyle {
  return BUTTON_STYLES[tone] ?? BUTTON_STYLES.primary
}

export type ButtonOptions = {
  label: string
  /** Key that activates the button; drawn as `[key]`. */
  key?: string
  tone?: ButtonTone
  disabled?: boolean
  /** Total width; defaults to the natural row width. */
  width?: number
  /** Spaces between the keycap and label; defaults 1. */
  gap?: number
}

export type ButtonSegmentKind = "key" | "label"

export type ButtonSegment = {
  kind: ButtonSegmentKind
  text: string
  x: number
  width: number
}

export type ButtonLayout = {
  text: string
  segments: ButtonSegment[]
  width: number
  tone: ButtonTone
  disabled: boolean
  keyWidth: number
  gap: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function buttonLayout(options: ButtonOptions): ButtonLayout {
  const tone = options.tone ?? "primary"
  const disabled = options.disabled === true
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  const keyText = options.key === undefined || options.key === "" ? "" : `[${options.key}]`
  const natural = keyText.length + (keyText === "" ? 0 : gap) + options.label.length
  const width = options.width === undefined ? natural : Math.max(0, Math.floor(options.width))
  if (width === 0) {
    return { text: "", segments: [], width: 0, tone, disabled, keyWidth: 0, gap }
  }
  const keyWidth = Math.min(keyText.length, width)
  const shownKey = fit(keyText, keyWidth)
  const labelX = keyWidth + (keyWidth > 0 ? gap : 0)
  const labelWidth = Math.max(0, width - labelX)
  const shownLabel = fit(options.label, labelWidth)
  const segments: ButtonSegment[] = []
  if (shownKey !== "") {
    const keyPart = fit(`${shownKey}${" ".repeat(gap)}`, width)
    segments.push({ kind: "key", text: keyPart, x: 0, width: keyPart.length })
  }
  if (shownLabel !== "") segments.push({ kind: "label", text: shownLabel, x: labelX, width: shownLabel.length })
  return {
    text: fit(segments.map((segment) => segment.text).join(""), width),
    segments,
    width,
    tone,
    disabled,
    keyWidth: shownKey.length,
    gap,
  }
}

/** The button text without placement. */
export function buttonText(options: ButtonOptions): string {
  return buttonLayout(options).text
}

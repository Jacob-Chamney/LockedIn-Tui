/**
 * Status banners: one filled line with a state glyph, message and action hint.
 *
 * One implementation serves the plugin SDK (`statusBanner()` draws the bar) and
 * the app's Sources status line. The glyph and tone both carry the state, so a
 * monochrome terminal still reads it. An action is right-aligned when it fits;
 * the message is fitted between the glyph and the action.
 */
export type StatusBannerTone = "info" | "success" | "warning" | "error" | "muted"

export type StatusBannerStyle = {
  fill: string
  ink: string
  glyph: string
}

export const STATUS_BANNER_STYLES: Readonly<Record<StatusBannerTone, StatusBannerStyle>> = {
  info: { fill: "primary", ink: "background", glyph: "·" },
  success: { fill: "success", ink: "background", glyph: "✓" },
  warning: { fill: "warning", ink: "background", glyph: "!" },
  error: { fill: "error", ink: "background", glyph: "×" },
  muted: { fill: "line", ink: "foreground", glyph: "·" },
}

export function statusBannerStyle(tone: StatusBannerTone = "muted"): StatusBannerStyle {
  return STATUS_BANNER_STYLES[tone] ?? STATUS_BANNER_STYLES.muted
}

export type StatusBannerOptions = {
  message: string
  width: number
  tone?: StatusBannerTone
  /** Right-aligned hint, such as `Esc clear`. */
  action?: string
}

export type StatusBannerLayout = {
  message: string
  action: string
  glyph: string
  tone: StatusBannerTone
  /** Glyph and message. */
  text: string
  /** Spaces before the action. */
  gap: string
  width: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function statusBannerLayout(options: StatusBannerOptions): StatusBannerLayout {
  const width = Math.max(0, Math.floor(options.width))
  const tone = options.tone ?? "muted"
  const style = statusBannerStyle(tone)
  if (width === 0) {
    return { message: "", action: "", glyph: "", tone, text: "", gap: "", width }
  }
  const prefix = `${style.glyph} `
  let action = options.action ?? ""
  let room = Math.max(0, width - prefix.length)
  if (action !== "" && room < action.length + 2) action = ""
  if (action !== "") room -= action.length + 1
  const message = fit(options.message, room)
  const label = `${prefix}${message}`
  const gap = action === "" ? "" : " ".repeat(Math.max(1, width - label.length - action.length))
  return {
    message,
    action,
    glyph: style.glyph,
    tone,
    text: `${label}${gap}${action}`.slice(0, width),
    gap,
    width,
  }
}

/** The banner text without placement. */
export function statusBannerText(options: StatusBannerOptions): string {
  return statusBannerLayout(options).text
}

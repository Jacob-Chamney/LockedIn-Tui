/**
 * Toast layout: tone, fitted text and a vertical stack.
 *
 * One implementation serves the plugin SDK (`toasts()` draws the stack) and the
 * app's notice surface. A toast's width is clamped between a minimum and a cap;
 * its text wraps inside the glyph column; the stack keeps the newest entries and
 * reports how many older ones were dropped.
 */
import { calloutLines } from "./callout"

export type ToastTone = "info" | "warn" | "error"

export type ToastStyle = {
  /** Palette role for the banner fill. */
  fill: string
  /** Palette role for the text and glyph. */
  ink: string
  glyph: string
}

export const TOAST_STYLES: Readonly<Record<ToastTone, ToastStyle>> = {
  info: { fill: "panel", ink: "foreground", glyph: "·" },
  warn: { fill: "warning", ink: "background", glyph: "!" },
  error: { fill: "error", ink: "background", glyph: "×" },
}

export function toastStyle(tone: ToastTone = "info"): ToastStyle {
  return TOAST_STYLES[tone] ?? TOAST_STYLES.info
}

export function toastGlyph(tone: ToastTone = "info"): string {
  return toastStyle(tone).glyph
}

export type ToastItem = {
  id: string
  text: string
  tone?: ToastTone
}

export type ToastLayoutOptions = {
  toasts: readonly ToastItem[]
  /** Surface width; the toast may use at most half of it. */
  width: number
  /** Widest a toast grows; defaults to 52. */
  maxWidth?: number
  /** Narrowest a toast grows; defaults to 20. */
  minWidth?: number
  /** Rows kept in the stack; defaults to 4. */
  maxVisible?: number
  /** Wrapped body lines kept per toast; defaults to 4. */
  maxLines?: number
  /** Rows between stacked toasts; defaults to 1. */
  gap?: number
}

export type ToastLayoutItem = {
  id: string
  text: string
  tone: ToastTone
  style: ToastStyle
  /** Outer banner width. */
  width: number
  /** Wrapped body lines, including an ellipsis row when clipped. */
  lines: string[]
  /** Content rows (lines, excluding the frame). */
  height: number
  /** Outer height including a one-cell frame above and below. */
  frameHeight: number
  /** Top offset within the stack. */
  y: number
  /** Index in the visible slice. */
  index: number
  newest: boolean
}

export type ToastStackLayout = {
  items: ToastLayoutItem[]
  /** Older toasts dropped by `maxVisible`. */
  hidden: number
  width: number
  available: number
  gap: number
  totalHeight: number
}

/** The widest a banner may grow on a surface `width` cells wide. */
export function toastAvailable(width: number, maxWidth = 52): number {
  return Math.max(1, Math.min(maxWidth, Math.floor(width * 0.5)))
}

/** Banner width: glyph + gap + padding, clamped to the available column. */
export function toastWidth(
  text: string,
  available: number,
  options: { minWidth?: number; maxWidth?: number } = {},
): number {
  const max = Math.max(1, Math.min(options.maxWidth ?? 52, available))
  const min = Math.min(options.minWidth ?? 20, max)
  const wanted = text.length + 4
  return Math.max(min, Math.min(max, wanted))
}

/** Wrap a toast's body to the cells left inside the glyph row. */
export function toastLines(text: string, width: number, maxLines = 4): string[] {
  const inner = Math.max(1, width - 4)
  const all = calloutLines(text, inner)
  const limit = Math.max(1, Math.floor(maxLines))
  if (all.length <= limit) return all
  const kept = all.slice(0, limit)
  const last = kept[limit - 1] ?? ""
  kept[limit - 1] = last.length >= inner ? `${last.slice(0, Math.max(0, inner - 1))}…` : `${last}…`
  return kept
}

export function toastStackLayout(options: ToastLayoutOptions): ToastStackLayout {
  const width = Math.max(0, Math.floor(options.width))
  const maxWidth = options.maxWidth ?? 52
  const minWidth = options.minWidth ?? 20
  const maxVisible = Math.max(0, Math.floor(options.maxVisible ?? 4))
  const gap = Math.max(0, Math.floor(options.gap ?? 1))
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? 4))
  const available = toastAvailable(width, maxWidth)
  if (width === 0 || options.toasts.length === 0 || maxVisible === 0) {
    return {
      items: [],
      hidden: options.toasts.length,
      width,
      available,
      gap,
      totalHeight: 0,
    }
  }

  const visible = options.toasts.slice(-maxVisible)
  let y = 0
  const items = visible.map((toast, index) => {
    const tone = toast.tone ?? "info"
    const bannerWidth = toastWidth(toast.text, available, { minWidth, maxWidth })
    const lines = toastLines(toast.text, bannerWidth, maxLines)
    const frameHeight = lines.length + 2
    const item: ToastLayoutItem = {
      id: toast.id,
      text: toast.text,
      tone,
      style: toastStyle(tone),
      width: bannerWidth,
      lines,
      height: lines.length,
      frameHeight,
      y,
      index,
      newest: index === visible.length - 1,
    }
    y += frameHeight + gap
    return item
  })

  return {
    items,
    hidden: options.toasts.length - visible.length,
    width,
    available,
    gap,
    totalHeight: Math.max(0, y - gap),
  }
}

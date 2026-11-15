/**
 * Page indicators: dots, numbers or a count.
 *
 * One implementation serves the plugin SDK (`pagination()` draws the tokens)
 * and the app's help overlay. The current page is clamped; a dot or number row
 * that does not fit the width falls back to a fitted `current/total` count.
 */
export type PaginationStyle = "count" | "dots" | "numbers"

export type PaginationGlyphs = {
  current: string
  other: string
  ellipsis: string
}

export const PAGINATION_GLYPHS: Readonly<PaginationGlyphs> = {
  current: "●",
  other: "○",
  ellipsis: "…",
}

export type PaginationTokenKind = "page" | "count"

export type PaginationToken = {
  kind: PaginationTokenKind
  text: string
  /** Zero-based page number for a page token. */
  page: number | null
  current: boolean
  x: number
  width: number
}

export type PaginationOptions = {
  /** Zero-based current page. */
  page: number
  total: number
  /** Available columns; 0 means unlimited. */
  width?: number
  /** Defaults to `dots`. */
  style?: PaginationStyle
  glyphs?: Partial<PaginationGlyphs>
}

export type PaginationLayout = {
  page: number
  total: number
  /** The whole indicator as one string. */
  text: string
  tokens: PaginationToken[]
  width: number
  /** True when the requested style fell back to a count. */
  fallback: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function paginationLayout(options: PaginationOptions): PaginationLayout {
  const total = Math.max(1, Math.floor(options.total))
  const page = clamp(Math.floor(options.page), 0, total - 1)
  const width = Math.max(0, Math.floor(options.width ?? 0))
  const style = options.style ?? "dots"
  const glyphs = { ...PAGINATION_GLYPHS, ...options.glyphs }

  if (style === "count") {
    const text = width === 0 ? `${page + 1}/${total}` : fit(`${page + 1}/${total}`, width)
    return {
      page,
      total,
      text,
      tokens: [{ kind: "count", text, page: null, current: true, x: 0, width: text.length }],
      width,
      fallback: false,
    }
  }

  const labels =
    style === "dots"
      ? Array.from({ length: total }, (_, index) => (index === page ? glyphs.current : glyphs.other))
      : Array.from({ length: total }, (_, index) => String(index + 1))
  const full = labels.join(" ")
  if (width > 0 && full.length > width) {
    const text = fit(`${page + 1}/${total}`, width)
    return {
      page,
      total,
      text,
      tokens: [{ kind: "count", text, page: null, current: true, x: 0, width: text.length }],
      width,
      fallback: true,
    }
  }

  const tokens: PaginationToken[] = []
  let x = 0
  labels.forEach((text, index) => {
    if (index > 0) {
      tokens.push({
        kind: "page",
        text: " ",
        page: null,
        current: false,
        x,
        width: 1,
      })
      x += 1
    }
    tokens.push({
      kind: "page",
      text,
      page: index,
      current: index === page,
      x,
      width: text.length,
    })
    x += text.length
  })
  return { page, total, text: full, tokens, width, fallback: false }
}

/**
 * Breadcrumb layout with fitting and elision.
 *
 * One implementation serves the plugin SDK (`breadcrumbs()` places scene nodes)
 * and the app's top bar. The full trail is used when it fits; otherwise the
 * middle is elided first (`ROOT › … › current`), then the root, and finally the
 * last crumb is truncated. The current crumb always survives.
 */
export type BreadcrumbKind = "crumb" | "separator" | "ellipsis"

export type BreadcrumbSegment = {
  text: string
  kind: BreadcrumbKind
  /** The first item in the trail. */
  first: boolean
  /** The current (last) item in the trail. */
  last: boolean
}

export type BreadcrumbLayout = {
  text: string
  segments: BreadcrumbSegment[]
  /** True when any crumb or separator was elided. */
  truncated: boolean
}

export type BreadcrumbOptions = {
  items: readonly string[]
  /** Available columns. */
  width: number
  /** Separator between crumbs; defaults to ` › `. */
  separator?: string
  /** Elision mark; defaults to `…`. */
  ellipsis?: string
}

/** The default separator used by the app and the SDK. */
export const BREADCRUMB_SEPARATOR = " › "

function fit(text: string, width: number, ellipsis: string): string {
  if (width <= 0) return ""
  if (text.length <= width) return text
  if (width <= ellipsis.length) return ellipsis.slice(0, width)
  return `${text.slice(0, width - ellipsis.length)}${ellipsis}`
}

function fullLayout(
  items: readonly string[],
  separator: string,
): BreadcrumbLayout {
  const segments: BreadcrumbSegment[] = []
  items.forEach((item, index) => {
    if (index > 0) {
      segments.push({ text: separator, kind: "separator", first: false, last: false })
    }
    segments.push({
      text: item,
      kind: "crumb",
      first: index === 0,
      last: index === items.length - 1,
    })
  })
  return {
    text: segments.map((segment) => segment.text).join(""),
    segments,
    truncated: false,
  }
}

export function breadcrumbs(options: BreadcrumbOptions): BreadcrumbLayout {
  const items = options.items.filter((item) => item !== "")
  const width = Math.max(0, Math.floor(options.width))
  const separator = options.separator ?? BREADCRUMB_SEPARATOR
  const ellipsis = options.ellipsis ?? "…"
  if (items.length === 0 || width === 0) {
    return { text: "", segments: [], truncated: items.length > 0 }
  }
  const full = items.join(separator)
  if (full.length <= width) return fullLayout(items, separator)

  const last = items[items.length - 1]!
  if (items.length >= 3) {
    const first = items[0]!
    const compact = `${first}${separator}${ellipsis}${separator}${last}`
    if (compact.length <= width) {
      const segments: BreadcrumbSegment[] = [
        { text: first, kind: "crumb", first: true, last: false },
        { text: separator, kind: "separator", first: false, last: false },
        { text: ellipsis, kind: "ellipsis", first: false, last: false },
        { text: separator, kind: "separator", first: false, last: false },
        { text: last, kind: "crumb", first: false, last: true },
      ]
      return { text: compact, segments, truncated: true }
    }
  }

  const elided = `${ellipsis}${separator}${last}`
  if (elided.length <= width) {
    const segments: BreadcrumbSegment[] = [
      { text: ellipsis, kind: "ellipsis", first: false, last: false },
      { text: separator, kind: "separator", first: false, last: false },
      { text: last, kind: "crumb", first: false, last: true },
    ]
    return { text: elided, segments, truncated: true }
  }

  const text = fit(last, width, ellipsis)
  return {
    text,
    segments: [
      {
        text,
        kind: "crumb",
        first: items.length === 1,
        last: true,
      },
    ],
    truncated: true,
  }
}

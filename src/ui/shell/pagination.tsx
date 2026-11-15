/**
 * Page indicators for app surfaces.
 *
 * The Solid counterpart of the SDK's `pagination()`: dot/number tokens and the
 * count fallback come from `src/ui/pagination.ts`.
 */
import { paginationLayout, type PaginationGlyphs, type PaginationStyle } from "../pagination"
import type { ThemePalette } from "../theme"

export function Pagination(props: {
  theme: ThemePalette
  page: number
  total: number
  width?: number
  style?: PaginationStyle
  glyphs?: Partial<PaginationGlyphs>
  currentFg?: keyof ThemePalette
  otherFg?: keyof ThemePalette
  countFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    paginationLayout({
      page: props.page,
      total: props.total,
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.style === undefined ? {} : { style: props.style }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().tokens.map((token) => (
        <text
          fg={
            token.kind === "count"
              ? palette()[props.countFg ?? "foreground"]
              : token.current
                ? palette()[props.currentFg ?? "primary"]
                : palette()[props.otherFg ?? "muted"]
          }
          wrapMode="none"
          width={token.width}
        >
          {token.text}
        </text>
      ))}
    </box>
  )
}

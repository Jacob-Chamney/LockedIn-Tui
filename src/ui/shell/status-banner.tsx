/**
 * Filled status banners for app surfaces.
 *
 * The Solid counterpart of the SDK's `statusBanner()`: tone roles, fitting and
 * the action slot come from `src/ui/status-banner.ts`.
 */
import { statusBannerLayout, statusBannerStyle, type StatusBannerTone } from "../status-banner"
import type { ThemePalette } from "../theme"

export function StatusBanner(props: {
  theme: ThemePalette
  width: number
  message: string
  tone?: StatusBannerTone
  action?: string
  bg?: keyof ThemePalette
  fg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    statusBannerLayout({
      width: props.width,
      message: props.message,
      ...(props.tone === undefined ? {} : { tone: props.tone }),
      ...(props.action === undefined ? {} : { action: props.action }),
    })
  const style = () => statusBannerStyle(layout().tone)

  return (
    <text
      fg={palette()[props.fg ?? (style().ink as keyof ThemePalette)]}
      bg={palette()[props.bg ?? (style().fill as keyof ThemePalette)]}
      wrapMode="none"
      width={layout().width}
    >
      {layout().text}
    </text>
  )
}

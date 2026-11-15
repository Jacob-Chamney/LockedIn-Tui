/**
 * Monogram avatars for app surfaces.
 *
 * The Solid counterpart of the SDK's `avatar()`: initials, tone and fitting
 * come from `src/ui/avatar.ts`.
 */
import { avatarLayout, type AvatarTone } from "../avatar"
import type { ThemePalette } from "../theme"

export function Avatar(props: {
  theme: ThemePalette
  name: string
  width?: number
  tone?: AvatarTone
  bg?: string
  fg?: string
}) {
  const palette = () => props.theme
  const layout = () =>
    avatarLayout({
      name: props.name,
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.tone === undefined ? {} : { tone: props.tone }),
    })

  return (
    <text
      fg={palette()[(props.fg ?? "background") as keyof ThemePalette]}
      bg={palette()[(props.bg ?? layout().tone) as keyof ThemePalette]}
      wrapMode="none"
      width={layout().width}
    >
      {layout().text}
    </text>
  )
}

/**
 * Stacked monogram rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `avatarGroup()`: offsets, overlap and the
 * overflow count come from `src/ui/avatar-group.ts`. Members are absolutely
 * placed so their cells can overlap; later members draw over earlier ones.
 */
import { avatarGroupLayout, type AvatarGroupItem } from "../avatar-group"
import type { ThemePalette } from "../theme"

export function AvatarGroup(props: {
  theme: ThemePalette
  items: readonly AvatarGroupItem[]
  width: number
  avatarWidth?: number
  overlap?: number
  fg?: keyof ThemePalette
  overflowFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    avatarGroupLayout({
      items: props.items,
      width: props.width,
      ...(props.avatarWidth === undefined ? {} : { avatarWidth: props.avatarWidth }),
      ...(props.overlap === undefined ? {} : { overlap: props.overlap }),
    })

  return (
    <box position="relative" width={layout().totalWidth} height={1} flexShrink={0}>
      {layout().members.map((member) => (
        <text
          position="absolute"
          left={member.x}
          top={0}
          fg={palette()[props.fg ?? "background"]}
          bg={palette()[member.tone]}
          wrapMode="none"
          width={member.width}
        >
          {member.avatar.text}
        </text>
      ))}
      {layout().overflow !== "" ? (
        <text
          position="absolute"
          left={layout().overflowX}
          top={0}
          fg={palette()[props.overflowFg ?? "muted"]}
          wrapMode="none"
        >
          {layout().overflow}
        </text>
      ) : null}
    </box>
  )
}

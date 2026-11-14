/**
 * Status badges for app surfaces.
 *
 * The Solid counterpart of the SDK's `badges()`: filling, padding and fitting
 * all come from `src/ui/badges.ts`, so a plugin badge and a settings badge are
 * the same element.
 */
import { badgeLayout, badgeStyle, type BadgeSpec, type BadgeTone } from "../badges"
import type { ThemePalette } from "../theme"

export function Badges(props: {
  theme: ThemePalette
  badges: readonly BadgeSpec[]
  /** Available columns for the whole row. */
  width: number
  padding?: number
  gap?: number
}) {
  const palette = () => props.theme
  const segments = () =>
    badgeLayout({
      badges: props.badges,
      width: props.width,
      ...(props.padding === undefined ? {} : { padding: props.padding }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
    })
  const ink = (tone: BadgeTone) =>
    palette()[badgeStyle(tone).fg as keyof ThemePalette] ?? palette().background
  const fill = (tone: BadgeTone) =>
    palette()[badgeStyle(tone).bg as keyof ThemePalette] ?? palette().line

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {segments().map((segment) => (
        <text fg={ink(segment.tone)} bg={fill(segment.tone)} wrapMode="none">
          {segment.text}
        </text>
      ))}
    </box>
  )
}

/** One badge, for a list row or a header. */
export function Badge(props: {
  theme: ThemePalette
  label: string
  tone?: BadgeTone
  /** Available columns; defaults to the label plus its padding. */
  width?: number
}) {
  return (
    <Badges
      theme={props.theme}
      badges={[{ label: props.label, tone: props.tone }]}
      width={props.width ?? props.label.length + 2}
    />
  )
}

/**
 * A tone-coded warning or notice for app surfaces.
 *
 * This is the Solid counterpart of the SDK's `callout()`: the same bar, the
 * same tone roles and the same wrapping come from `src/ui/callout.ts`, so a
 * plugin warning and a settings warning look like the same element.
 */
import { CALLOUT_GLYPH, calloutLines, calloutRole, type CalloutTone } from "../callout"
import type { ThemePalette } from "../theme"

export function Callout(props: {
  theme: ThemePalette
  tone?: CalloutTone
  /** Total width available, including the bar and its space. */
  width: number
  message: string
  /** One title line above the message. */
  title?: string
}) {
  const palette = () => props.theme
  const ink = () => palette()[calloutRole(props.tone) as keyof ThemePalette] ?? palette().warning
  const lines = () => calloutLines(props.message, Math.max(1, Math.floor(props.width) - 2))

  return (
    <box flexDirection="column" flexShrink={0}>
      {props.title ? (
        <text fg={ink()} wrapMode="none">
          {`${CALLOUT_GLYPH} ${props.title}`}
        </text>
      ) : null}
      {lines().map((line) => (
        <text fg={ink()} wrapMode="none">
          {`${CALLOUT_GLYPH} ${line}`.trimEnd()}
        </text>
      ))}
    </box>
  )
}

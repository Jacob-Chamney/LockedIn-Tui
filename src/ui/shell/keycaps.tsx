/**
 * Keycaps for app surfaces.
 *
 * The Solid counterpart of the SDK's `keycaps()`: chord splitting and fitting
 * come from `src/ui/keycaps.ts`; caps get a filled background without adding
 * characters, so the chord text stays intact.
 */
import { keycapLayout } from "../keycaps"
import type { ThemePalette } from "../theme"

export function Keycaps(props: {
  theme: ThemePalette
  chord: string
  width: number
  capBg?: keyof ThemePalette
  capFg?: keyof ThemePalette
  separatorFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const tokens = () => keycapLayout({ chord: props.chord, width: props.width }).tokens

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {tokens().map((token) =>
        token.kind === "cap" ? (
          <text
            fg={palette()[props.capFg ?? "background"]}
            bg={palette()[props.capBg ?? "line"]}
            wrapMode="none"
          >
            {token.text}
          </text>
        ) : (
          <text fg={palette()[props.separatorFg ?? "muted"]} wrapMode="none">
            {token.text}
          </text>
        ),
      )}
    </box>
  )
}

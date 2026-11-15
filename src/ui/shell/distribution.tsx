/**
 * Stacked distribution bar for app surfaces.
 *
 * The Solid counterpart of the SDK's `distribution()`: cell allocation and
 * shares come from `src/ui/distribution.ts`, and the legend reuses the shared
 * `Legend`.
 */
import { distributionSegments, type DistributionItem } from "../distribution"
import { Legend } from "./legend"
import type { ThemePalette } from "../theme"

export function Distribution(props: {
  theme: ThemePalette
  items: readonly DistributionItem[]
  width: number
  tones?: readonly string[]
  glyph?: string
  legend?: boolean
  legendGap?: number
  legendLabelFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const segments = () =>
    distributionSegments({
      items: props.items,
      width: props.width,
      ...(props.tones === undefined ? {} : { tones: props.tones }),
    })
  const ink = (role: string) => palette()[role as keyof ThemePalette] ?? palette().muted
  const glyph = () => props.glyph ?? "█"

  return (
    <box flexDirection="column" flexShrink={0} width={props.width}>
      <box flexDirection="row" height={1}>
        {segments().map((segment) =>
          segment.cells > 0 ? (
            <text fg={ink(segment.tone)} wrapMode="none">
              {glyph().repeat(segment.cells)}
            </text>
          ) : null,
        )}
      </box>
      {props.legend === false || segments().length === 0 ? null : (
        <Legend
          theme={palette()}
          items={segments().map((segment) => ({
            glyph: glyph(),
            label: `${segment.label} ${Math.round(segment.fraction * 100)}%`,
            tone: segment.tone,
          }))}
          width={props.width}
          gap={props.legendGap ?? 2}
          labelFg={props.legendLabelFg ?? "muted"}
        />
      )}
    </box>
  )
}

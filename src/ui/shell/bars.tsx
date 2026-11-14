/**
 * Proportional bar rows for app surfaces.
 *
 * The Solid counterpart of the SDK's `bars()`: column widths, fractions and
 * the one-cell minimum come from `src/ui/bars.ts`, so a plugin chart and a
 * settings chart are the same element.
 */
import { barRows, type BarItem } from "../bars"
import type { ThemePalette } from "../theme"

export function Bars(props: {
  theme: ThemePalette
  items: readonly BarItem[]
  /** Total row width in cells. */
  width: number
  labelWidth?: number
  valueWidth?: number
  barWidth?: number
  gap?: number
  max?: number
  minBar?: number
  /** Fill colour; defaults to primary. */
  tone?: keyof ThemePalette
  labelFg?: keyof ThemePalette
  valueFg?: keyof ThemePalette
  trackFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const rows = () =>
    barRows({
      items: props.items,
      width: props.width,
      ...(props.labelWidth === undefined ? {} : { labelWidth: props.labelWidth }),
      ...(props.valueWidth === undefined ? {} : { valueWidth: props.valueWidth }),
      ...(props.barWidth === undefined ? {} : { barWidth: props.barWidth }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.minBar === undefined ? {} : { minBar: props.minBar }),
    })
  const ink = (role: keyof ThemePalette | undefined, fallback: keyof ThemePalette) =>
    palette()[role ?? fallback]

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows().map((row) => (
        <box flexDirection="row" height={1} flexShrink={0}>
          <text fg={ink(props.labelFg, "foreground")} wrapMode="none">
            {row.label}
          </text>
          {row.gap > 0 ? (
            <text fg={ink(props.tone, "primary")} wrapMode="none">
              {" ".repeat(row.gap)}
            </text>
          ) : null}
          {row.filled > 0 ? (
            <text fg={ink(props.tone, "primary")} wrapMode="none">
              {"█".repeat(row.filled)}
            </text>
          ) : null}
          {row.empty > 0 ? (
            <text fg={ink(props.trackFg, "line")} wrapMode="none">
              {"░".repeat(row.empty)}
            </text>
          ) : null}
          {row.valueWidth > 0 ? (
            <>
              {row.gap > 0 ? (
                <text fg={ink(props.valueFg, "muted")} wrapMode="none">
                  {" ".repeat(row.gap)}
                </text>
              ) : null}
              <text fg={ink(props.valueFg, "muted")} wrapMode="none">
                {row.text.padStart(row.valueWidth)}
              </text>
            </>
          ) : null}
        </box>
      ))}
    </box>
  )
}

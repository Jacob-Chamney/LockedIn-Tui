/**
 * Wizard strips for app surfaces.
 *
 * The Solid counterpart of the SDK's `wizard()`: step fitting, markers and the
 * current-step fallback come from `src/ui/wizard.ts`.
 */
import { wizardLayout, type WizardGlyphs, type WizardStep } from "../wizard"
import type { ThemePalette } from "../theme"

export function Wizard(props: {
  theme: ThemePalette
  steps: readonly WizardStep[]
  current: number
  width: number
  gap?: number
  glyphs?: Partial<WizardGlyphs>
  doneFg?: keyof ThemePalette
  currentFg?: keyof ThemePalette
  upcomingFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    wizardLayout({
      steps: props.steps,
      current: props.current,
      width: props.width,
      ...(props.gap === undefined ? {} : { gap: props.gap }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })
  const ink = (status: "done" | "current" | "upcoming") =>
    status === "done"
      ? palette()[props.doneFg ?? "success"]
      : status === "current"
        ? palette()[props.currentFg ?? "primary"]
        : palette()[props.upcomingFg ?? "muted"]

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().segments.map((segment, index) => {
        const previous = index > 0 ? layout().segments[index - 1]! : null
        const room = previous === null ? 0 : segment.x - (previous.x + previous.width)
        return (
          <>
            {room > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {" ".repeat(room)}
              </text>
            ) : null}
            <text fg={ink(segment.status)} wrapMode="none" width={segment.width}>
              {segment.text}
            </text>
          </>
        )
      })}
    </box>
  )
}

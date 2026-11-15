/**
 * Buttons for app surfaces.
 *
 * The Solid counterpart of the SDK's `button()`: keycap fill, label ink and
 * fitting come from `src/ui/button.ts`.
 */
import { buttonLayout, buttonStyle, type ButtonTone } from "../button"
import type { ThemePalette } from "../theme"

export function Button(props: {
  theme: ThemePalette
  label: string
  key?: string
  tone?: ButtonTone
  disabled?: boolean
  width?: number
  gap?: number
}) {
  const palette = () => props.theme
  const layout = () =>
    buttonLayout({
      label: props.label,
      ...(props.key === undefined ? {} : { key: props.key }),
      ...(props.tone === undefined ? {} : { tone: props.tone }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
    })
  const style = () => buttonStyle(layout().tone)

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().segments.map((segment) =>
        segment.kind === "key" ? (
          <text
            fg={palette()[layout().disabled ? "muted" : (style().keyFg as keyof ThemePalette)]}
            bg={palette()[layout().disabled ? "line" : (style().keyBg as keyof ThemePalette)]}
            wrapMode="none"
            width={segment.width}
          >
            {segment.text}
          </text>
        ) : (
          <text
            fg={palette()[layout().disabled ? "muted" : (style().labelFg as keyof ThemePalette)]}
            wrapMode="none"
            width={segment.width}
          >
            {segment.text}
          </text>
        ),
      )}
    </box>
  )
}

/**
 * Toggle pills for app surfaces.
 *
 * The Solid counterpart of the SDK's `toggle()`: state text and fitting come
 * from `src/ui/toggle.ts`.
 */
import { toggleLayout } from "../toggle"
import type { ThemePalette } from "../theme"

export function Toggle(props: {
  theme: ThemePalette
  on: boolean
  onLabel?: string
  offLabel?: string
  width?: number
}) {
  const palette = () => props.theme
  const layout = () =>
    toggleLayout({
      on: props.on,
      ...(props.onLabel === undefined ? {} : { onLabel: props.onLabel }),
      ...(props.offLabel === undefined ? {} : { offLabel: props.offLabel }),
      ...(props.width === undefined ? {} : { width: props.width }),
    })

  return (
    <text
      fg={props.on ? palette().background : palette().foreground}
      bg={props.on ? palette().success : palette().line}
      wrapMode="none"
      width={layout().width}
    >
      {layout().text}
    </text>
  )
}

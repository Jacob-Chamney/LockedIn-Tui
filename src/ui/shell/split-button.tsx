/**
 * Split buttons for app surfaces.
 *
 * The Solid counterpart of the SDK's `splitButton()`: token positions, fitting
 * and secondary visibility come from `src/ui/split-button.ts`.
 */
import { splitButtonLayout, type SplitAction } from "../split-button"
import type { ThemePalette } from "../theme"

export function SplitButton(props: {
  theme: ThemePalette
  primary: SplitAction
  secondary?: SplitAction
  width?: number
  disabled?: boolean
  separator?: string
  primaryBg?: keyof ThemePalette
  secondaryBg?: keyof ThemePalette
  primaryFg?: keyof ThemePalette
  secondaryFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
  disabledFg?: keyof ThemePalette
  separatorFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    splitButtonLayout({
      primary: props.primary,
      ...(props.secondary === undefined ? {} : { secondary: props.secondary }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.separator === undefined ? {} : { separator: props.separator }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().tokens.map((token) =>
        token.kind === "key" ? (
          <text
            fg={palette()[props.disabled ? (props.disabledFg ?? "muted") : token.primary ? (props.primaryFg ?? "background") : (props.secondaryFg ?? "foreground")]}
            bg={palette()[props.disabled ? "line" : token.primary ? (props.primaryBg ?? "primary") : (props.secondaryBg ?? "line")]}
            wrapMode="none"
            width={token.width}
          >
            {token.text}
          </text>
        ) : (
          <text
            fg={palette()[token.kind === "separator" ? (props.separatorFg ?? "muted") : props.disabled ? (props.disabledFg ?? "muted") : (props.labelFg ?? "foreground")]}
            wrapMode="none"
            width={token.width}
          >
            {token.text}
          </text>
        ),
      )}
    </box>
  )
}

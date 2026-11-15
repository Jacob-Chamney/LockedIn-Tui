/**
 * Action bars for app surfaces.
 *
 * The Solid counterpart of the SDK's `actionBar()`: grouping, token positions
 * and hidden counts come from `src/ui/actions.ts`.
 */
import { actionBarLayout, type ActionGroup } from "../actions"
import type { ThemePalette } from "../theme"

export function ActionBar(props: {
  theme: ThemePalette
  groups: readonly ActionGroup[]
  width: number
  actionGap?: number
  groupSeparator?: string
  keyBg?: keyof ThemePalette
  keyFg?: keyof ThemePalette
  labelFg?: keyof ThemePalette
  separatorFg?: keyof ThemePalette
  disabledFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    actionBarLayout({
      groups: props.groups,
      width: props.width,
      ...(props.actionGap === undefined ? {} : { actionGap: props.actionGap }),
      ...(props.groupSeparator === undefined ? {} : { groupSeparator: props.groupSeparator }),
    })

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().tokens.map((token) =>
        token.kind === "key" ? (
          <text
            fg={palette()[token.disabled ? (props.disabledFg ?? "muted") : (props.keyFg ?? "background")]}
            bg={palette()[props.keyBg ?? "line"]}
            wrapMode="none"
            width={token.width}
          >
            {token.text}
          </text>
        ) : (
          <text
            fg={
              token.kind === "separator"
                ? palette()[props.separatorFg ?? "line"]
                : token.disabled
                  ? palette()[props.disabledFg ?? "muted"]
                  : palette()[props.labelFg ?? "foreground"]
            }
            wrapMode="none"
          >
            {token.text}
          </text>
        ),
      )}
    </box>
  )
}

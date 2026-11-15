/**
 * Single-line text fields for app surfaces.
 *
 * The Solid counterpart of the SDK's `textField()`: fitting, caret position and
 * suffix placement come from `src/ui/text-field.ts`.
 */
import { textFieldLayout } from "../text-field"
import type { ThemePalette } from "../theme"

export function TextField(props: {
  theme: ThemePalette
  width: number
  value: string
  prefix?: string
  suffix?: string
  suffixGap?: number
  placeholder?: string
  cursor?: boolean
  invalid?: boolean
  prefixFg?: keyof ThemePalette
  valueFg?: keyof ThemePalette
  placeholderFg?: keyof ThemePalette
  caretFg?: keyof ThemePalette
  suffixFg?: keyof ThemePalette
  invalidFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    textFieldLayout({
      width: props.width,
      value: props.value,
      ...(props.prefix === undefined ? {} : { prefix: props.prefix }),
      ...(props.suffix === undefined ? {} : { suffix: props.suffix }),
      ...(props.suffixGap === undefined ? {} : { suffixGap: props.suffixGap }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.cursor === undefined ? {} : { cursor: props.cursor }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
    })
  const valueInk = () =>
    layout().invalid
      ? palette()[props.invalidFg ?? "error"]
      : layout().placeholder !== ""
        ? palette()[props.placeholderFg ?? "muted"]
        : palette()[props.valueFg ?? "foreground"]

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().prefix !== "" ? (
        <text
          fg={
            layout().invalid
              ? palette()[props.invalidFg ?? "error"]
              : palette()[props.prefixFg ?? "primary"]
          }
          wrapMode="none"
          width={layout().prefix.length}
        >
          {layout().prefix}
        </text>
      ) : null}
      <text fg={valueInk()} wrapMode="none">
        {`${layout().value}${layout().caret}`}
      </text>
      {layout().suffix !== "" ? (
        <>
          <text fg={palette()[props.caretFg ?? "muted"]} wrapMode="none">
            {layout().gap}
          </text>
          <text fg={palette()[props.suffixFg ?? "muted"]} wrapMode="none">
            {layout().suffix}
          </text>
        </>
      ) : null}
    </box>
  )
}

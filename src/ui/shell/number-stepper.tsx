/**
 * Inline number steppers for app surfaces.
 *
 * The Solid counterpart of the SDK's `numberStepper()`: clamping, limits and
 * fitting come from `src/ui/number-stepper.ts`.
 */
import { numberStepperLayout, type NumberStepperGlyphs } from "../number-stepper"
import type { ThemePalette } from "../theme"

export function NumberStepper(props: {
  theme: ThemePalette
  value: number
  min?: number
  max?: number
  step?: number
  precision?: number
  text?: string
  width?: number
  disabled?: boolean
  glyphs?: Partial<NumberStepperGlyphs>
  controlFg?: keyof ThemePalette
  valueFg?: keyof ThemePalette
  disabledFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    numberStepperLayout({
      value: props.value,
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.precision === undefined ? {} : { precision: props.precision }),
      ...(props.text === undefined ? {} : { text: props.text }),
      ...(props.width === undefined ? {} : { width: props.width }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.glyphs === undefined ? {} : { glyphs: props.glyphs }),
    })
  const ink = (kind: "minus" | "value" | "plus", enabled: boolean) =>
    kind === "value"
      ? palette()[props.valueFg ?? "foreground"]
      : enabled
        ? palette()[props.controlFg ?? "primary"]
        : palette()[props.disabledFg ?? "muted"]

  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      {layout().segments.map((segment) => (
        <text fg={ink(segment.kind, segment.enabled)} wrapMode="none" width={segment.width}>
          {segment.text}
        </text>
      ))}
    </box>
  )
}

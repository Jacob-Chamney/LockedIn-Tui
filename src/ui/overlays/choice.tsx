/** A small chooser, built from the shared frame and selection list. */
import type { ThemePalette } from "../theme"
import { SelectList } from "../panels/select-list"
import { ModalFrame } from "./modal-frame"

export type ChoiceOption = { label: string; detail?: string; value: string }

export type Choice = {
  title: string
  hint: string
  options: ChoiceOption[]
  index: number
}

export function ChoiceOverlay(props: { theme: ThemePalette; width: number; height: number; choice: Choice }) {
  const palette = () => props.theme
  const boxWidth = () => Math.max(40, Math.min(64, Math.floor(props.width * 0.55)))
  const boxHeight = () =>
    props.choice.options.reduce((rows, option) => rows + 1 + (option.detail ? 1 : 0), 0) + 5

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={boxWidth()}
      boxHeight={boxHeight()}
      title={props.choice.title}
      hint={props.choice.hint}
      footer="j/k · 1-9 pick · Enter · Esc"
    >
      <SelectList
        theme={palette()}
        rows={props.choice.options.map((option) => ({
          id: option.value,
          label: option.label,
          ...(option.detail ? { detail: option.detail } : {}),
        }))}
        cursor={props.choice.index}
      />
    </ModalFrame>
  )
}

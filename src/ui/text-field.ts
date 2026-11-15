/**
 * Single-line text fields: prefix, value (or placeholder), caret and suffix.
 *
 * One implementation serves the Sources search line and the plugin SDK. A value
 * wider than the field is tail-truncated so the caret stays visible; the suffix
 * is right-aligned when it fits and dropped otherwise. `invalid` only selects a
 * tone; validation itself belongs to the caller.
 */
export type TextFieldOptions = {
  value: string
  /** Available columns. */
  width: number
  prefix?: string
  /** Right-aligned context, such as a scope label. */
  suffix?: string
  /** Spaces before the suffix; defaults to 1. */
  suffixGap?: number
  placeholder?: string
  /** Draw the caret; defaults true. */
  cursor?: boolean
  invalid?: boolean
}

export type TextFieldLayout = {
  prefix: string
  value: string
  placeholder: string
  caret: string
  suffix: string
  /** Spaces between the input and the suffix. */
  gap: string
  text: string
  width: number
  cursorX: number
  invalid: boolean
}

export const TEXT_FIELD_CARET = "▏"

function fitTail(text: string, width: number): string {
  if (width <= 0) return ""
  const characters = Array.from(text)
  if (characters.length <= width) return text
  if (width === 1) return "…"
  return `…${characters.slice(characters.length - (width - 1)).join("")}`
}

export function textFieldLayout(options: TextFieldOptions): TextFieldLayout {
  const width = Math.max(0, Math.floor(options.width))
  const prefix = options.prefix ?? ""
  const placeholder = options.placeholder ?? ""
  const cursor = options.cursor !== false
  const caret = cursor ? TEXT_FIELD_CARET : ""
  const suffixGap = Math.max(0, Math.floor(options.suffixGap ?? 1))
  let suffix = options.suffix ?? ""
  if (width === 0) {
    return {
      prefix: "",
      value: "",
      placeholder: "",
      caret: "",
      suffix: "",
      gap: "",
      text: "",
      width,
      cursorX: 0,
      invalid: options.invalid === true,
    }
  }

  let room = Math.max(0, width - prefix.length - caret.length)
  if (suffix !== "" && room >= suffix.length + suffixGap + 4) {
    room -= suffix.length + suffixGap
  } else {
    suffix = ""
  }

  const usePlaceholder = options.value === "" && !cursor
  const shown = options.value === "" ? (usePlaceholder ? placeholder : "") : options.value
  const value = fitTail(shown, room)
  const gap = suffix === "" ? "" : " ".repeat(Math.max(0, width - prefix.length - value.length - caret.length - suffix.length))
  const text = `${prefix}${value}${caret}${gap}${suffix}`.slice(0, width)
  return {
    prefix,
    value,
    placeholder: usePlaceholder ? value : "",
    caret,
    suffix,
    gap,
    text,
    width,
    cursorX: prefix.length + value.length,
    invalid: options.invalid === true,
  }
}

/** The field text without placement. */
export function textFieldText(options: TextFieldOptions): string {
  return textFieldLayout(options).text
}

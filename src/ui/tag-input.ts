/**
 * Tag inputs: bracketed tokens, an optional cursor and an input tail.
 *
 * One implementation serves the plugin SDK (`tagInput()` draws the field) and
 * the app's Settings rows. Tags are fitted left to right; the first that does
 * not fit ends the row and the rest are reported as hidden. An invalid tag uses
 * the error tone, the cursor tag the primary tone, and the input tail keeps a
 * caret so the field reads as editable.
 */
export type TagTone = "normal" | "active" | "invalid"

export type TagItem = {
  id: string
  label: string
  /** Draw the trailing remove marker; defaults true. */
  removable?: boolean
  invalid?: boolean
}

export type TagSegment = {
  id: string
  label: string
  text: string
  x: number
  width: number
  active: boolean
  invalid: boolean
  tone: TagTone
  index: number
}

export type TagInputOptions = {
  tags: readonly TagItem[]
  /** Available columns. */
  width: number
  /** Active tag; -1 or omitted means no cursor. */
  cursor?: number
  /** Draft text after the tags; omit for a read-only field. */
  input?: string
  /** Placeholder when `input` is empty. */
  placeholder?: string
  /** Removing marker; defaults `×`. */
  marker?: string
  /** Spaces between tags; defaults 1. */
  gap?: number
}

export type TagInputLayout = {
  segments: TagSegment[]
  hidden: number
  invalidCount: number
  activeIndex: number
  /** Fitted input text, including the caret, or "". */
  inputText: string
  inputX: number
  /** `+N` for tags that did not fit, or "". */
  overflow: string
  overflowX: number
  width: number
  gap: number
  /** The whole field as one string. */
  text: string
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function tagInputLayout(options: TagInputOptions): TagInputLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  const marker = options.marker ?? "×"
  const cursor = options.cursor !== undefined && options.cursor >= 0 ? Math.floor(options.cursor) : -1
  const activeIndex = cursor >= 0 && cursor < options.tags.length ? cursor : -1
  const invalidCount = options.tags.filter((tag) => tag.invalid === true).length
  if (width === 0 || options.tags.length === 0) {
    const input = options.input
    const text = input === undefined ? "" : `${input}${options.placeholder && input === "" ? options.placeholder : ""}▏`
    return {
      segments: [],
      hidden: options.tags.length,
      invalidCount,
      activeIndex,
      inputText: text === "" ? "" : fit(text, width),
      inputX: 0,
      overflow: "",
      overflowX: 0,
      width,
      gap,
      text: text === "" ? "" : fit(text, width),
    }
  }

  const segments: TagSegment[] = []
  let x = 0
  for (let index = 0; index < options.tags.length; index++) {
    const tag = options.tags[index]!
    const active = index === activeIndex
    const removable = tag.removable !== false
    const base = removable ? `[${tag.label} ${marker}]` : `[${tag.label}]`
    let text = `${active ? "▸" : ""}${base}`
    const at = segments.length === 0 ? 0 : x + gap
    if (at + text.length > width) {
      if (segments.length > 0) break
      text = fit(text, width)
    }
    segments.push({
      id: tag.id,
      label: tag.label,
      text,
      x: at,
      width: text.length,
      active,
      invalid: tag.invalid === true,
      tone: tag.invalid === true ? "invalid" : active ? "active" : "normal",
      index,
    })
    x = at + text.length
  }

  const hidden = options.tags.length - segments.length
  const rawOverflow = hidden > 0 ? `+${hidden}` : ""
  let overflow = ""
  let overflowX = 0
  if (rawOverflow !== "") {
    overflowX = segments.length === 0 ? 0 : x + gap
    if (overflowX + rawOverflow.length <= width) overflow = rawOverflow
  }

  let inputText = ""
  let inputX = 0
  if (options.input !== undefined) {
    const draft = options.input === "" && options.placeholder ? options.placeholder : options.input
    const tail = `${draft}▏`
    const start =
      overflow !== ""
        ? overflowX + overflow.length + gap
        : segments.length === 0
          ? 0
          : x + gap
    inputX = start
    const room = width - inputX
    if (room > 0) inputText = fit(tail, room)
  }

  const body = segments.map((segment) => segment.text).join(" ".repeat(gap))
  return {
    segments,
    hidden: options.tags.length - segments.length,
    invalidCount,
    activeIndex,
    inputText,
    inputX,
    overflow,
    overflowX,
    width,
    gap,
    text: `${body}${overflow === "" ? "" : `${segments.length > 0 ? " ".repeat(gap) : ""}${overflow}`}${inputText === "" ? "" : `${overflow !== "" || segments.length > 0 ? " ".repeat(gap) : ""}${inputText}`}`,
  }
}

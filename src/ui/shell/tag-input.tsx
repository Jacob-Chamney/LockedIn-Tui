/**
 * Tag fields for app surfaces.
 *
 * The Solid counterpart of the SDK's `tagInput()`: fitting, cursor and
 * validation tones come from `src/ui/tag-input.ts`.
 */
import { tagInputLayout, type TagItem } from "../tag-input"
import type { ThemePalette } from "../theme"

export function TagInput(props: {
  theme: ThemePalette
  tags: readonly TagItem[]
  width: number
  cursor?: number
  input?: string
  placeholder?: string
  marker?: string
  gap?: number
  fg?: keyof ThemePalette
  activeFg?: keyof ThemePalette
  invalidFg?: keyof ThemePalette
  inputFg?: keyof ThemePalette
  overflowFg?: keyof ThemePalette
}) {
  const palette = () => props.theme
  const layout = () =>
    tagInputLayout({
      tags: props.tags,
      width: props.width,
      ...(props.cursor === undefined ? {} : { cursor: props.cursor }),
      ...(props.input === undefined ? {} : { input: props.input }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.marker === undefined ? {} : { marker: props.marker }),
      ...(props.gap === undefined ? {} : { gap: props.gap }),
    })
  const tone = (segment: (typeof layout extends never ? never : ReturnType<typeof layout>)["segments"][number]) =>
    segment.tone === "invalid"
      ? palette()[props.invalidFg ?? "error"]
      : segment.tone === "active"
        ? palette()[props.activeFg ?? "primary"]
        : palette()[props.fg ?? "secondary"]

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
            <text fg={tone(segment)} wrapMode="none" width={segment.width}>
              {segment.text}
            </text>
          </>
        )
      })}
      {layout().overflow !== "" ? (
        <text fg={palette()[props.overflowFg ?? "muted"]} wrapMode="none">
          {`${layout().segments.length > 0 ? " " : ""}${layout().overflow}`}
        </text>
      ) : null}
      {layout().inputText !== "" ? (
        <text fg={palette()[props.inputFg ?? "foreground"]} wrapMode="none">
          {`${layout().segments.length > 0 || layout().overflow !== "" ? " " : ""}${layout().inputText}`}
        </text>
      ) : null}
    </box>
  )
}

/**
 * The course reader.
 *
 * A chapter list and a chapter, in the right-hand pane beside the chat — the way
 * glow shows a document next to what you are doing. `j`/`k` move the list,
 * `Enter` opens a chapter, `b` goes back to the list, `c` marks the chapter read,
 * `p` switches between the guide and its practical. The chat on the left keeps
 * working, so questions about the chapter can be asked while it is open.
 */
import type { ThemePalette } from "../../theme"
import type { Course } from "../../../services/skills/course"
import { MarkdownBody, blockCount } from "../../reader/markdown-body"
import { WindowFooter } from "../../panels/floating-window"
import { windowStart } from "../../panels/select-list"

export function CourseReader(props: {
  theme: ThemePalette
  width: number
  height: number
  course: Course
  cursor: number
  /** The open chapter, or null while the list is showing. */
  open: { id: string; practical: boolean } | null
  text: string
  /** The reader has keyboard focus; the chapter list and the body say so. */
  focused?: boolean
  /** First block of the open document, driven by j/k when focused. */
  offset?: number
}) {
  const palette = () => props.theme
  const listSize = () => Math.max(1, props.height - 4)
  const listStart = () => windowStart(props.cursor, props.course.chapters.length, listSize())
  const maxOffset = () => Math.max(0, blockCount(props.text) - Math.max(1, props.height - 4))

  return (
    <box
      width={props.width}
      height={props.height}
      flexDirection="column"
      backgroundColor={palette().background}
      border={["left"]}
      borderColor={props.focused ? palette().primary : palette().line}
      paddingX={1}
    >
      <text fg={props.focused ? palette().foreground : palette().muted} wrapMode="none" flexShrink={0}>
        {props.course.goal}
      </text>

      <box flexDirection="column" flexGrow={1} minHeight={0}>
        {props.open ? (
          <MarkdownBody
            theme={palette()}
            text={props.text}
            width={props.width - 2}
            height={Math.max(1, props.height - 4)}
            offset={Math.min(props.offset ?? 0, maxOffset())}
            scrollable
          />
        ) : (
          <>
            <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
              <b>Chapters</b>
            </text>
            <box flexDirection="column" marginTop={1}>
              {props.course.chapters
                .slice(listStart(), listStart() + listSize())
                .map((entry, offset) => {
                const index = listStart() + offset
                const selected = index === props.cursor
                const mark = props.focused && selected
                return (
                  <box backgroundColor={mark ? palette().panel : palette().background} paddingX={1}>
                    <text fg={mark ? palette().foreground : palette().muted} wrapMode="none">
                      {mark ? <b>{`▌ ${entry.done ? "✓" : "☐"} ${entry.title}`}</b> : `  ${entry.done ? "✓" : "☐"} ${entry.title}`}
                    </text>
                  </box>
                )
              })}
            </box>
          </>
        )}
      </box>

      <WindowFooter
        theme={palette()}
        hints={
          props.focused
            ? props.open
              ? [
                  "j/k scroll",
                  "c complete",
                  `p ${props.open.practical ? "lesson" : "practical"}`,
                  "b list",
                  "Tab chat",
                  "Esc close",
                ]
              : ["j/k move", "Enter read", "Tab chat", "Esc close"]
            : ["Tab reader", "Esc close"]
        }
        width={props.width}
      />
    </box>
  )
}

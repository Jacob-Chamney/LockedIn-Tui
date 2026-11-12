/**
 * Global chat defaults: response length and tutoring policy.
 *
 * These are edited here rather than by typing special commands into the chat
 * composer. Changes apply to existing chats immediately and become the default
 * for new ones.
 */
import type { ThemePalette } from "../../theme"
import { PanelWindow } from "../../panels/panel-window"

export type ChatSettingsValue = {
  responseStyle: string
  tutorPolicy: string
  cursor: number
}

/** The controls a surface actually offers, in display order. */
export type ChatSettingsRow = "style" | "tutor"

export function chatSettingRows(capabilities?: {
  responseStyle: boolean
  tutorPolicy: boolean
}): ChatSettingsRow[] {
  const rows: ChatSettingsRow[] = []
  if (capabilities?.responseStyle) rows.push("style")
  if (capabilities?.tutorPolicy) rows.push("tutor")
  return rows
}

const ROWS = [
  {
    key: "style",
    label: "Response style",
    values: ["brief", "normal", "detailed"],
    detail: "brief: short and direct · normal: answer and stop · detailed: thorough",
  },
  {
    key: "tutor",
    label: "Tutor policy",
    values: ["direct", "guided", "socratic"],
    detail: "direct answers · guided asks check-ins · socratic asks one question at a time",
  },
] as const

export function nextChatSetting(value: string, values: readonly string[]): string {
  const at = values.indexOf(value)
  return values[(at + 1) % values.length] ?? values[0]!
}

export function ChatSettingsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  value: ChatSettingsValue
  /** Which rows apply here; Chill has none. */
  rows: ChatSettingsRow[]
}) {
  const palette = () => props.theme
  const rowFor = (key: ChatSettingsRow) => ROWS.find((entry) => entry.key === key)!
  const current = (index: number) =>
    props.rows[index] === "tutor" ? props.value.tutorPolicy : props.value.responseStyle

  return (
    <PanelWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      title="Chat settings"
      meta={props.rows.length === 0 ? "not for Chill" : "applies to sessions"}
      detail={
        props.rows.length === 0
          ? "Chill is a plain conversation; response style and tutoring apply to sessions."
          : "Soft response controls; they change how the model explains, not what it is allowed to read."
      }
      hints={props.rows.length === 0 ? ["Esc close"] : ["j/k move", "Enter change", "Esc close"]}
    >
      {props.rows.map((key, index) => {
        const entry = rowFor(key)
        const selected = props.value.cursor === index
        return (
          <box flexDirection="column" marginBottom={1}>
            <box flexDirection="row" height={1}>
              <text fg={palette().primary} wrapMode="none">
                {selected ? "▌" : " "}
              </text>
              <text fg={selected ? palette().foreground : palette().secondary} wrapMode="none">
                {selected ? <b>{` ${entry.label}`}</b> : ` ${entry.label}`}
              </text>
              <text fg={palette().muted} wrapMode="none">
                {`  ${current(index)}`}
              </text>
            </box>
            {selected ? (
              <text fg={palette().muted} wrapMode="word">
                {`  ${entry.detail}`}
              </text>
            ) : null}
          </box>
        )
      })}
    </PanelWindow>
  )
}

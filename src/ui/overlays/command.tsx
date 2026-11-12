/**
 * The `:` command palette.
 *
 * A prompt line, matching commands ranked underneath, one selected row, and a
 * footer. Nothing here knows a command: the registry supplies the catalogue.
 */
import type { ThemePalette } from "../theme"
import type { CommandEntry } from "../shell/commands"
import { SelectList } from "../panels/select-list"
import { ModalFrame } from "./modal-frame"

export function CommandBar(props: {
  theme: ThemePalette
  width: number
  height: number
  query: string
  /** The selected suggestion, already clamped by the shell. */
  index: number
  message: string | null
  matches: CommandEntry[]
}) {
  const palette = () => props.theme
  const boxWidth = () => Math.max(30, Math.min(72, Math.floor(props.width * 0.6)))
  const rows = () => Math.max(2, Math.min(10, props.matches.length))
  const boxHeight = () => rows() + 5

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={boxWidth()}
      boxHeight={boxHeight()}
      header={
        <box flexDirection="column" flexShrink={0}>
          <text fg={palette().foreground} wrapMode="none">
            {"Commands"}
          </text>
          <box flexDirection="row" height={1}>
            <text fg={palette().primary} wrapMode="none">
              {props.query === "" ? ": " : ":"}
            </text>
            <text fg={props.query === "" ? palette().muted : palette().foreground} wrapMode="none">
              {props.query === "" ? "Search commands" : props.query}
            </text>
            <text fg={palette().muted} wrapMode="none">
              {"▏"}
            </text>
          </box>
        </box>
      }
      footer={
        props.message ? `! ${props.message}` : "Tab cycle · ↑↓ move · Enter run · Esc close"
      }
      footerTone={props.message ? "warning" : "muted"}
    >
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <SelectList
          theme={palette()}
          variant="inline"
          labelWidth={Math.max(10, boxWidth() - 22)}
          cursor={props.index}
          rows={props.matches.slice(0, rows()).map((entry) => ({
            id: entry.name,
            label: entry.name,
            meta: entry.alias ? `→ ${entry.label}` : entry.label,
          }))}
        />
      </box>
    </ModalFrame>
  )
}

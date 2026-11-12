/**
 * Session settings: the assignment instructions and their original file.
 *
 * Reading is the default. `e` opens a textarea, `f` loads a file through the
 * source picker, and `r` re-extracts the copied original. The pane never writes
 * on its own; the App owns the save and import actions.
 */
import type { TextareaRenderable } from "@opentui/core"

import type { ThemePalette } from "../../theme"
import { FloatingWindow, WindowBody, WindowFooter, WindowHeader } from "../../panels/floating-window"
import {
  previewLimit,
  promptPreview,
  provenanceLine,
  selectedRow,
  settingsRows,
  type SessionSettingsState,
} from "./session-settings-model"

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function SessionSettingsPanel(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  sessionName: string
  state: SessionSettingsState
  onEditorReady?: (editor: TextareaRenderable | null) => void
}) {
  const palette = () => props.theme
  const data = () => props.state.data
  const instructions = () => data()?.instructions ?? null
  const rows = () => settingsRows(props.state)
  const preview = () => promptPreview(data()?.prompt ?? "", previewLimit(props.height))

  return (
    <FloatingWindow
      theme={palette()}
      width={props.width}
      height={props.height}
      header={
        <WindowHeader
          theme={palette()}
          title={props.state.mode === "edit" ? "Edit instructions" : "Session settings"}
          meta={props.state.mode === "edit" ? "editing" : props.sessionName}
          detailLines={
            props.state.mode === "edit"
              ? ["Ctrl+S saves · Esc cancels · a second Esc discards unsaved changes"]
              : [provenanceLine(instructions())]
          }
        />
      }
      footer={
        <WindowFooter
          theme={palette()}
          width={props.width}
          hints={
            props.state.mode === "edit"
              ? ["Ctrl+S save", "Esc cancel"]
              : ["j/k move", "Enter run", "e edit", "f file", "r re-extract", "Esc close"]
          }
        />
      }
      pending={props.state.error}
      notice={props.state.notice}
    >
      <WindowBody>
        {props.state.mode === "edit" ? (
          <textarea
            ref={(value: TextareaRenderable) => props.onEditorReady?.(value)}
            initialValue={props.state.draft}
            focused
            width={Math.max(20, props.width - 4)}
            height={Math.max(4, props.height - 10)}
            wrapMode="word"
            backgroundColor={palette().surface}
            textColor={palette().foreground}
            focusedBackgroundColor={palette().panel}
            focusedTextColor={palette().foreground}
            placeholder="Write the assignment instructions here…"
            placeholderColor={palette().muted}
          />
        ) : (
          <>
            <text fg={palette().muted} wrapMode="none">
              ASSIGNMENT INSTRUCTIONS · prompt.md
            </text>
            {preview().empty ? (
              <text fg={palette().warning} wrapMode="word">
                no instructions yet · press f to load a PDF, DOCX or text file, or e to write them
              </text>
            ) : (
              preview().lines.map((line) => (
                <text fg={palette().foreground} wrapMode="word">
                  {line || " "}
                </text>
              ))
            )}
            {preview().more > 0 ? (
              <text fg={palette().muted} wrapMode="none">
                {`… ${preview().more} more line${preview().more === 1 ? "" : "s"} · press e to edit`}
              </text>
            ) : null}

            <text fg={palette().muted} wrapMode="none" marginTop={1}>
              ACTIONS
            </text>
            {rows().map((row, index) => {
              const selected = index === props.state.cursor
              return (
                <box flexDirection="row" height={1}>
                  <text fg={palette().primary} wrapMode="none">
                    {selected ? "▌" : " "}
                  </text>
                  <text
                    fg={!row.enabled ? palette().muted : selected ? palette().foreground : palette().secondary}
                    wrapMode="none"
                  >
                    {selected ? <b>{` ${row.label}`}</b> : ` ${row.label}`}
                  </text>
                  <text fg={palette().muted} wrapMode="none">
                    {`  ${fit(row.detail, Math.max(8, props.width - row.label.length - 8))}`}
                  </text>
                </box>
              )
            })}
            <text fg={palette().muted} wrapMode="word" marginTop={1}>
              {selectedRow(props.state)?.detail ?? "Select an action."}
            </text>
          </>
        )}
      </WindowBody>
    </FloatingWindow>
  )
}

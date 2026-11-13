/** Host-owned confirm, prompt and menu requests from a plugin command. */
import type { ThemePalette } from "../theme"
import { ModalFrame } from "./modal-frame"

export type PluginRequest =
  | {
      kind: "confirm"
      message: string
      confirmLabel: string
      cancelLabel: string
    }
  | {
      kind: "prompt"
      message: string
      value: string
      placeholder?: string
    }
  | {
      kind: "menu"
      title: string
      options: string[]
      index: number
    }

export function PluginRequestOverlay(props: {
  theme: ThemePalette
  width: number
  height: number
  request: PluginRequest
}) {
  const palette = () => props.theme
  const request = props.request
  const title = () =>
    request.kind === "menu" ? request.title : request.kind === "prompt" ? "Input" : "Confirm"
  const hint = () =>
    request.kind === "menu"
      ? "Choose an option"
      : request.kind === "confirm"
        ? `${request.confirmLabel} or ${request.cancelLabel}`
        : request.message
  const footer = () =>
    request.kind === "confirm"
      ? "Enter yes · Esc no"
      : request.kind === "menu"
        ? "j/k · Enter · Esc"
        : "Enter save · Esc cancel"
  const boxHeight = () => (request.kind === "menu" ? request.options.length + 6 : 7)

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={Math.max(40, Math.min(70, Math.floor(props.width * 0.6)))}
      boxHeight={boxHeight()}
      title={title()}
      hint={hint()}
      footer={footer()}
    >
      {request.kind === "menu" ? (
        <box flexDirection="column">
          {request.options.map((option, index) => (
            <text
              fg={index === request.index ? palette().primary : palette().foreground}
              wrapMode="none"
            >
              {`${index === request.index ? "▸ " : "  "}${option}`}
            </text>
          ))}
        </box>
      ) : request.kind === "prompt" ? (
        <box flexDirection="row" height={1}>
          <text fg={palette().foreground} wrapMode="none">
            {request.value || request.placeholder || ""}
          </text>
          <text fg={palette().muted} wrapMode="none">
            {"▏"}
          </text>
        </box>
      ) : (
        <text fg={palette().foreground} wrapMode="word">
          {request.message}
        </text>
      )}
    </ModalFrame>
  )
}

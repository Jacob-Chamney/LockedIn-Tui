/** Host-owned confirm, prompt and menu requests from a plugin command. */
import type { ThemePalette } from "../theme"
import { ModalFrame } from "./modal-frame"

export type PluginRequest =
  | {
      kind: "confirm"
      message: string
      confirmLabel: string
      cancelLabel: string
      index: number
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
  const menu = () => (props.request.kind === "menu" ? props.request : null)
  const prompt = () => (props.request.kind === "prompt" ? props.request : null)
  const confirm = () => (props.request.kind === "confirm" ? props.request : null)
  const title = () =>
    menu()?.title ?? (prompt() ? "Input" : "Confirm")
  const hint = () =>
    menu() ? "Choose an option" : confirm() ? "Choose an action" : (prompt()?.message ?? "")
  const footer = () =>
    confirm()
      ? "j/k · y/n · Enter · Esc"
      : menu()
        ? "j/k · 1-9 · Enter · Esc"
        : "Enter save · Esc cancel"
  const boxHeight = () =>
    menu() ? menu()!.options.length + 6 : confirm() ? 9 : 7

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
      {menu() ? (
        <box flexDirection="column">
          {menu()!.options.map((option, index) => (
            <text
              fg={index === menu()!.index ? palette().primary : palette().foreground}
              wrapMode="none"
            >
              {`${index === menu()!.index ? "▸ " : "  "}${option}`}
            </text>
          ))}
        </box>
      ) : prompt() ? (
        <box flexDirection="row" height={1}>
          <text
            fg={prompt()!.value ? palette().foreground : palette().muted}
            wrapMode="none"
          >
            {prompt()!.value || prompt()!.placeholder || ""}
          </text>
          <text fg={palette().muted} wrapMode="none">
            {"▏"}
          </text>
        </box>
      ) : confirm() ? (
        <box flexDirection="column" gap={0}>
          <text fg={palette().foreground} wrapMode="word">
            {confirm()!.message}
          </text>
          <text
            fg={confirm()!.index === 0 ? palette().primary : palette().foreground}
            wrapMode="none"
          >
            {`${confirm()!.index === 0 ? "▸ " : "  "}${confirm()!.confirmLabel}`}
          </text>
          <text
            fg={confirm()!.index === 1 ? palette().primary : palette().foreground}
            wrapMode="none"
          >
            {`${confirm()!.index === 1 ? "▸ " : "  "}${confirm()!.cancelLabel}`}
          </text>
        </box>
      ) : null}
    </ModalFrame>
  )
}

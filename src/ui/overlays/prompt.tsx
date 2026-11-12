/** A one-line prompt, in the shared floating window. */
import type { ThemePalette } from "../theme"
import { ModalFrame } from "./modal-frame"

export type Prompt = {
  title: string
  hint: string
  value: string
  /** Render the value as bullets (provider keys). */
  mask?: boolean
  /** A suggested value: the first typed character replaces it. */
  preselect?: boolean
  /** The provider a `provider-key` prompt is linking. */
  provider?: string
  /**
   * What the answer creates or edits; the shell decides what to do with it.
   * Project setup is three questions: name, folder, then chat or swarm.
   */
  kind:
    | "swarm"
    | "agent"
    | "project-name"
    | "project-folder"
    | "project-mode"
    | "agent-model"
    | "agent-task"
    | "skill-goal"
    | "skill-prior"
    | "lockin-name"
    | "lockin-goal"
    | "agent-name"
    | "agent-task-edit"
    | "provider-key"
}

export function PromptOverlay(props: { theme: ThemePalette; width: number; height: number; prompt: Prompt }) {
  const palette = () => props.theme
  const boxWidth = () => Math.max(36, Math.min(70, Math.floor(props.width * 0.6)))

  return (
    <ModalFrame
      theme={palette()}
      width={props.width}
      height={props.height}
      boxWidth={boxWidth()}
      boxHeight={6}
      title={props.prompt.title}
      hint={props.prompt.hint}
      footer="Enter save · Esc cancel"
    >
      <box flexDirection="row" height={1}>
        <text fg={palette().foreground} wrapMode="none">
          {props.prompt.mask ? "•".repeat(Array.from(props.prompt.value).length) : props.prompt.value}
        </text>
        <text fg={palette().muted} wrapMode="none">
          {"▏"}
        </text>
      </box>
    </ModalFrame>
  )
}

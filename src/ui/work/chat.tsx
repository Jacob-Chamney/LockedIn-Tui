/**
 * Work project chat.
 *
 * Reuses the WP-204 chat primitives (`ChatPane`, its model and composer) so
 * there is exactly one composer implementation; this file only adds the Work
 * rows: tool lines, the proposed-write row and its review key.
 */
import { ChatPane } from "../chat"
import { composerRows, type ChatState } from "../chat/model"
import { parseBinding, type Binding } from "../keymap/registry"
import type { ProposedWrite } from "../../services/work/diff"
import type { ThemePalette } from "../theme"

export type ToolCall = { name: string; lines?: number }

/** `read_file · 3 lines`, one per call while streaming. */
export function toolLine(call: ToolCall): string {
  return call.lines === undefined ? call.name : `${call.name} · ${call.lines} line${call.lines === 1 ? "" : "s"}`
}

export function proposalRow(write: ProposedWrite): string {
  return `proposed write · ${write.path} (+${write.stats.added} −${write.stats.removed})`
}

export function busyLine(): string {
  return "a reply is already streaming · Esc stop, then send"
}

export function writeOptInCopy(): string {
  return "writes are off · the proposal is shown, approval is refused until you enable writes"
}

export type WorkChatView = {
  tools: ToolCall[]
  proposal?: ProposedWrite | null
  /** Inline, never a modal. */
  busy?: boolean
  noDefaultAgent?: boolean
  writeOptIn?: boolean
  budgetPaused?: boolean
}

export const initialWorkChat: WorkChatView = { tools: [], proposal: null }

/** Esc discards the partial answer; the caller cancels through the service. */
export function stopCopy(): string {
  return "Esc stop"
}

export type WorkChatIntent = "review" | "stop" | "agents"

const SPECS: Array<{ intent: WorkChatIntent; key: string; footer: string }> = [
  { intent: "review", key: "r", footer: "r review write" },
  { intent: "stop", key: "escape", footer: "Esc stop" },
  { intent: "agents", key: "a", footer: "a agents" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`work chat key "${key}": ${binding.message}`)
  return binding
}

export const WORK_CHAT_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): WorkChatIntent | undefined {
  const key = name.toLowerCase()
  return WORK_CHAT_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return WORK_CHAT_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

export function WorkChatPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: ChatState
  view: WorkChatView
}) {
  const palette = () => props.theme
  const rows = () => composerRows(props.state, Math.max(1, props.width - 6))

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().background}>
      <ChatPane
        theme={props.theme}
        width={props.width}
        height={Math.max(3, props.height - 4 - rows())}
        focused={props.focused}
        state={props.state}
      />

      <box flexDirection="column" paddingX={1}>
        {props.view.tools.map((call) => (
          <text fg={palette().secondary} wrapMode="none">
            {`  ▸ ${toolLine(call)}`}
          </text>
        ))}
        {props.state.status === "streaming" ? (
          <text fg={palette().warning} wrapMode="none">
            {`  ${stopCopy()}`}
          </text>
        ) : null}
        {props.view.proposal ? (
          <text fg={palette().accent} wrapMode="none">
            {`  ${proposalRow(props.view.proposal)} · press ${proposalKey()} to review`}
          </text>
        ) : null}
        {props.view.busy ? (
          <text fg={palette().warning} wrapMode="none">
            {`  ! ${busyLine()}`}
          </text>
        ) : null}
        {props.view.noDefaultAgent ? (
          <text fg={palette().warning} wrapMode="none">
            {"  ! no default agent · press a to choose one"}
          </text>
        ) : null}
        {props.view.writeOptIn === false ? (
          <text fg={palette().muted} wrapMode="none">
            {`  ! ${writeOptInCopy()}`}
          </text>
        ) : null}
        {props.view.budgetPaused ? (
          <text fg={palette().warning} wrapMode="none">
            {"  ! budget paused · press ␣ , to raise the limit"}
          </text>
        ) : null}
        <text fg={palette().muted} wrapMode="none">
          {footerHints()}
        </text>
      </box>
    </box>
  )
}

export function proposalKey(): string {
  const entry = WORK_CHAT_KEYS.find((item) => item.intent === "review")!
  return entry.binding.kind === "direct" ? entry.binding.key : entry.binding.key
}

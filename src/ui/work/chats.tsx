/**
 * Saved work chats.
 *
 * Lists a project's conversations, reopens one and continues it in the same
 * file. Persistence belongs to WP-502: this pane asks for intents and performs
 * no IO. The transcript on reopen is the WP-204 one (12 mounted + load older).
 */
import { INITIAL_MOUNT, loadMore, mountedMessages, type ChatState, type Message } from "../chat/model"
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export type ChatSummary = {
  id: string
  /** First user line, truncated for the row. */
  title: string
  updatedAt: string
  messages: number
  lastAgent: string
  /** Set when the file is missing or unparseable; the row stays selectable. */
  broken?: string
}

export const TITLE_MAX = 40
export const RENAME_MAX = 80

/** The row title is the first user line, truncated with an ellipsis. */
export function titleOf(firstUserLine: string, max = TITLE_MAX): string {
  const trimmed = firstUserLine.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/** Newest first; a chat with no timestamp sorts by its numeric id. */
export function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt)
    return b.id.localeCompare(a.id)
  })
}

export type ChatsState = {
  chats: ChatSummary[]
  cursor: number
  /** Title being edited, and its draft. */
  renaming?: { id: string; draft: string } | null
  pendingDelete?: { id: string; title: string } | null
  notice?: string | null
}

export const initialChats = (chats: ChatSummary[] = []): ChatsState => ({
  chats: sortChats(chats),
  cursor: 0,
  renaming: null,
  pendingDelete: null,
  notice: null,
})

export function selected(state: ChatsState): ChatSummary | undefined {
  return state.chats[state.cursor]
}

export function move(state: ChatsState, delta: number): ChatsState {
  const count = state.chats.length
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.cursor + delta))
  return { ...state, cursor }
}

export function chatLine(chat: ChatSummary): string {
  const broken = chat.broken ? `  × broken: ${chat.broken}` : ""
  return `${chat.title}  ${chat.updatedAt}  ${chat.messages} msg  ${chat.lastAgent}${broken}`
}

export function emptyCopy(): string {
  return "no chats yet · n to start one"
}

// ---------------------------------------------------------------- actions

export type ChatsAction =
  | { kind: "new" }
  | { kind: "open"; id: string }
  | { kind: "rename"; id: string; title: string }
  | { kind: "delete"; id: string }

export function startNew(): ChatsAction {
  return { kind: "new" }
}

/** Reopening continues the same file; the intent carries its id. */
export function openSelected(state: ChatsState): ChatsAction | { kind: "refused"; reason: string } {
  const chat = selected(state)
  if (!chat) return { kind: "refused", reason: "select a chat first" }
  return { kind: "open", id: chat.id }
}

export function beginRename(state: ChatsState): ChatsState {
  const chat = selected(state)
  if (!chat) return { ...state, notice: "select a chat first" }
  return { ...state, renaming: { id: chat.id, draft: chat.title }, notice: null }
}

export function typeRename(state: ChatsState, draft: string): ChatsState {
  if (!state.renaming) return state
  return { ...state, renaming: { id: state.renaming.id, draft } }
}

/** Empty is refused; a valid title changes only the title record. */
export function commitRename(state: ChatsState): ChatsAction | { kind: "refused"; reason: string } {
  if (!state.renaming) return { kind: "refused", reason: "press r to rename a chat" }
  const title = state.renaming.draft.trim()
  if (title.length === 0) return { kind: "refused", reason: "a chat title cannot be empty" }
  if (title.length > RENAME_MAX) {
    return { kind: "refused", reason: `a chat title is at most ${RENAME_MAX} characters` }
  }
  return { kind: "rename", id: state.renaming.id, title }
}

export function cancelRename(state: ChatsState): ChatsState {
  return { ...state, renaming: null, notice: null }
}

/** The first `d` names the chat and states that the project is untouched. */
export function armDelete(state: ChatsState): ChatsState {
  const chat = selected(state)
  if (!chat) return { ...state, notice: "select a chat first" }
  return { ...state, pendingDelete: { id: chat.id, title: chat.title }, notice: null }
}

export function deleteCopy(title: string): string {
  return `delete “${title}”? the project files are untouched · press d again to confirm`
}

export function confirmDelete(state: ChatsState): ChatsAction | { kind: "refused"; reason: string } {
  if (!state.pendingDelete) {
    return { kind: "refused", reason: state.chats.length === 0 ? emptyCopy() : "press d twice to delete a chat" }
  }
  return { kind: "delete", id: state.pendingDelete.id }
}

export function cancelDelete(state: ChatsState): ChatsState {
  return { ...state, pendingDelete: null, notice: null }
}

/** Deleting the last chat is allowed; the list simply shows the empty copy. */
export function afterDelete(state: ChatsState, id: string): ChatsState {
  const chats = sortChats(state.chats.filter((chat) => chat.id !== id))
  return {
    ...state,
    chats,
    pendingDelete: null,
    notice: null,
    cursor: chats.length === 0 ? 0 : Math.min(state.cursor, chats.length - 1),
  }
}

/** A rename changes only the title record; messages are never rewritten. */
export function afterRename(state: ChatsState, id: string, title: string): ChatsState {
  return {
    ...state,
    renaming: null,
    notice: null,
    chats: sortChats(state.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat))),
  }
}

/** Reopening mounts the last 12 messages; `e` loads older ones. */
export function reopen(messages: Message[]): ChatState {
  return {
    username: "friend",
    model: "work",
    vision: false,
    capabilities: { responseStyle: true, tutorPolicy: false },
    status: "idle",
    responseStyle: "normal",
    tutorPolicy: "direct",
    messages,
    streamed: "",
    composer: "",
    attachments: [],
    pastes: [],
    scrolledUp: false,
    toolMode: "build",
    toolModeLocked: false,
    toolsAvailable: false,
    mounted: INITIAL_MOUNT,
    thinkingOpen: false,
  }
}

export function reopenView(chat: ChatState): { visible: Message[]; hidden: number } {
  return {
    visible: mountedMessages(chat),
    hidden: Math.max(0, chat.messages.length - chat.mounted),
  }
}

export function loadOlder(chat: ChatState): ChatState {
  return loadMore(chat)
}

/** A cancelled turn appends nothing: only a terminal `done` is persisted. */
export function appendsOn(event: "done" | "cancelled" | "error"): boolean {
  return event === "done"
}

// ---------------------------------------------------------------- keys

export type ChatsIntent = "down" | "up" | "new" | "open" | "rename" | "delete" | "load" | "close"

const SPECS: Array<{ intent: ChatsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "new", key: "n", footer: "n new" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "rename", key: "r", footer: "r rename" },
  { intent: "delete", key: "d", footer: "d delete" },
  { intent: "load", key: "e", footer: "e load older" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`chats key "${key}": ${binding.message}`)
  return binding
}

export const CHAT_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string): ChatsIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return CHAT_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === key)?.intent
}

export function footerHints(): string {
  return CHAT_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

/** Rows truncate with `…` at narrow widths; the footer keys stay visible. */
export function fitRow(text: string, width: number): string {
  const room = Math.max(8, width - 2)
  return text.length <= room ? text : `${text.slice(0, room - 1)}…`
}

// ---------------------------------------------------------------- render

export function WorkChatsPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  state: ChatsState
}) {
  const palette = () => props.theme

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} SAVED CHATS · ${props.state.chats.length}`}
      </text>

      {props.state.chats.length === 0 ? (
        <text fg={palette().muted} wrapMode="none">
          {emptyCopy()}
        </text>
      ) : (
        props.state.chats.map((chat, index) => (
          <text
            fg={chat.broken ? palette().error : index === props.state.cursor ? palette().primary : palette().foreground}
            wrapMode="none"
          >
            {`${index === props.state.cursor ? "▸" : " "} ${fitRow(chatLine(chat), props.width - 2)}`}
          </text>
        ))
      )}

      {props.state.renaming ? (
        <text fg={palette().accent} wrapMode="none">
          {`rename  ${props.state.renaming.draft || "…"}  · Enter save · Esc cancel`}
        </text>
      ) : null}
      {props.state.pendingDelete ? (
        <text fg={palette().error} wrapMode="none">
          {`! ${deleteCopy(props.state.pendingDelete.title)}`}
        </text>
      ) : null}
      {props.state.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.state.notice}`}
        </text>
      ) : null}

      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}

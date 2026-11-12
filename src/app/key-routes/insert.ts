/** INSERT belongs to the chat composer, not the shell. */
import type { ChatState } from "../../ui/chat/model"
import { canSend, composerKey } from "../../ui/chat/model"
import { reduce, type ShellState } from "../../ui/shell/state"
import type { TaskRegistry } from "../../domain/tasks"
import type { ChatController } from "../chat-controller"
import { typedText, type ShellPress } from "../keys/press"

export type ChatCommandMatch = {
  handled: boolean
  run?: () => Promise<void>
}

export type InsertKeyDeps = {
  chat: () => ChatState
  activeChat: ChatController
  update: (next: ShellState) => void
  taskRegistry: TaskRegistry
  chatTasks: Map<string, ChatController>
  /** A local command recognised before the text becomes a model request. */
  command?: (text: string) => ChatCommandMatch
  notify?: (text: string, level?: "info" | "warn" | "error") => void
}

export function handleInsertKeys(
  state: ShellState,
  press: ShellPress,
  event: { preventDefault: () => void; sequence?: string },
  deps: InsertKeyDeps,
): boolean {
  if (state.overlay !== null || state.mode !== "insert" || state.focus !== "chat" || state.pane !== "chat") return false

  if (press.name === "escape") {
    if (deps.chat().status === "streaming") deps.activeChat.cancel()
    // Leaving insert mode starts the next visit clean; a stale draft was the
    // only way to keep text the user could not select or clear.
    deps.activeChat.clearComposer()
    deps.update(reduce(state, { type: "action", id: "escape" }))
    event.preventDefault()
    return true
  }

  // A terminal composer has no selection model; Ctrl+A is the clear-all
  // gesture, matching the draft-on-exit rule above.
  if (press.ctrl && press.name === "a") {
    deps.activeChat.clearComposer()
    event.preventDefault()
    return true
  }

  const intent = composerKey(press)
  if (intent === "send") {
    const current = deps.chat()
    if (current.status === "streaming") {
      event.preventDefault()
      return true
    }
    const allowed = canSend(current)
    if (!allowed.ok && allowed.reason === "nothing to send") {
      event.preventDefault()
      return true
    }
    const typed = current.composer.trim()
    const command = deps.command?.(typed)
    if (command?.handled) {
      deps.activeChat.clearComposer()
      void command.run?.().catch((error) => {
        deps.notify?.(String(error instanceof Error ? error.message : error).slice(0, 160), "error")
      })
      event.preventDefault()
      return true
    }
    const taskId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const registry = deps.taskRegistry
    const owner = deps.activeChat
    deps.chatTasks.set(taskId, owner)
    registry.start({
      id: taskId,
      kind: "chat",
      label: (current.composer.trim() || "chat").slice(0, 60),
    })
    void owner
      .send()
      .then((outcome) => {
        if (outcome.kind !== "sent") registry.finish(taskId, { type: "failed", error: outcome.reason })
        else if (outcome.outcome === "done") registry.finish(taskId, { type: "done" })
        else if (outcome.outcome === "cancelled") registry.finish(taskId, { type: "cancelled" })
        else registry.finish(taskId, { type: "failed", error: "the reply failed" })
      })
      .catch((error) => registry.finish(taskId, { type: "failed", error: String(error).slice(0, 120) }))
      .finally(() => deps.chatTasks.delete(taskId))
    event.preventDefault()
    return true
  }
  if (intent === "newline") {
    deps.activeChat.newline()
    event.preventDefault()
    return true
  }
  if (press.name === "backspace" || press.name === "delete") {
    deps.activeChat.backspace()
    event.preventDefault()
    return true
  }
  const character = typedText(press, event)
  if (character !== null) {
    deps.activeChat.insert(character)
    event.preventDefault()
  }
  return true
}

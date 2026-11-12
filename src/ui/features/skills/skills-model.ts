/**
 * Skills manager view model. Pure: rows in, intent out.
 *
 * Archiving, deleting and exporting are **calls the shell makes**; this module
 * only decides what a key means and what copy names the object, so a cancel
 * path is provably zero service calls.
 */
import { managerHints } from "../../managers/manager-actions"
import {
  armPending,
  cancelPending as cancelManagerPending,
  confirmPending as confirmManagerPending,
  type PendingOutcome,
} from "../../panels/pending"
export type GoalRow = {
  id: string
  name: string
  stage: { done: number; total: number }
  /** Course rows count chapters; goals without a course count stages. */
  chapters?: { done: number; total: number }
  lastOpened: string
  chats: number
  archived: boolean
  /** Set when the goal folder cannot be read; rendered instead of crashing. */
  broken?: string
}

export type ChatRow = { id: string; title: string; lastUsed: string; messages: number }

export type Pending = { kind: "archive" | "delete" | "export"; id: string; name: string }

export type SkillsState = {
  goals: GoalRow[]
  chats: ChatRow[]
  cursor: number
  chatCursor: number
  /** Which column receives the keys. */
  pane: "goals" | "chats"
  pending?: Pending
  notice?: string | null
}

export const initialSkills = (goals: GoalRow[] = [], chats: ChatRow[] = []): SkillsState => ({
  goals,
  chats,
  cursor: 0,
  chatCursor: 0,
  pane: "goals",
  pending: undefined,
  notice: null,
})

export function goalProgress(goal: GoalRow): string {
  if (goal.chapters) return `${goal.chapters.done} of ${goal.chapters.total} chapters`
  return `${goal.stage.done} of ${goal.stage.total} stages`
}

/** The date column is a day; the service stores an ISO instant. */
export function dayOf(date: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(date) ? date.slice(0, 10) : date
}

/** Row content only: the panel owns the bar, fill and bold. */
export function goalText(goal: GoalRow): string {
  const archived = goal.archived ? "  [archived]" : ""
  const broken = goal.broken ? `  × ${goal.broken}` : ""
  return `${goal.name}  ${goalProgress(goal)}  ${goal.chats} chat${goal.chats === 1 ? "" : "s"}  ${dayOf(goal.lastOpened)}${archived}${broken}`
}

export function chatText(chat: ChatRow): string {
  return `${chat.title}  ${chat.messages} msg  ${chat.lastUsed}`
}

export function moveGoal(state: SkillsState, delta: number): SkillsState {
  const count = state.goals.length
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.cursor + delta))
  return { ...state, cursor }
}

export function moveChat(state: SkillsState, delta: number): SkillsState {
  const count = state.chats.length
  const chatCursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.chatCursor + delta))
  return { ...state, chatCursor }
}

export function focusPane(state: SkillsState, pane: "goals" | "chats"): SkillsState {
  return { ...state, pane }
}

export function selectedGoal(state: SkillsState): GoalRow | undefined {
  return state.goals[state.cursor]
}

export function selectedChat(state: SkillsState): ChatRow | undefined {
  return state.chats[state.chatCursor]
}

/** The first press arms; nothing is called until the second. */
export function arm(state: SkillsState, kind: "archive" | "delete" | "export"): SkillsState {
  return armPending(state, selectedGoal(state), kind, "no goal selected")
}

export const cancelPending = cancelManagerPending

export type Outcome = PendingOutcome

export function confirm(state: SkillsState, kind: "archive" | "delete" | "export"): Outcome {
  return confirmManagerPending(state, selectedGoal(state), kind)
}

export function warningFor(state: SkillsState, kind: "archive" | "delete" | "export"): string {
  const goal = selectedGoal(state)
  if (!goal) return "no goal selected"
  switch (kind) {
    case "delete":
      return `Delete “${goal.name}” and its ${goal.chats} chat${goal.chats === 1 ? "" : "s"}? press d again to confirm`
    case "archive":
      return `Archive “${goal.name}”? Chat history is not included; press a again to confirm`
    case "export":
      return `Export “${goal.name}” to a zip? press x again to confirm`
  }
}

/** A goal must keep one chat: the last one is refused with the documented line. */
export const LAST_CHAT_COPY = "a goal keeps one chat · press n to start another before deleting this one"

export function deleteChat(state: SkillsState): Outcome {
  const chat = selectedChat(state)
  if (!chat) return { kind: "refused", reason: "no chat selected" }
  if (state.chats.length <= 1) return { kind: "refused", reason: LAST_CHAT_COPY }
  return { kind: "call", action: "delete", id: chat.id }
}

export function emptyCopy(state: SkillsState): string {
  return state.goals.length === 0
    ? "no skill sessions yet"
    : state.chats.length === 0
      ? "no chats in this goal yet"
      : ""
}

export function emptyHint(state: SkillsState): string {
  return state.goals.length === 0
    ? "n creates one: goal, then what you already know"
    : state.chats.length === 0
      ? "n starts a chat in this goal"
      : ""
}

/** Keys, in one table, parsed by the registry. */
export type SkillsIntent = "down" | "up" | "pane" | "new" | "open" | "archive" | "delete" | "export" | "close"

const SPECS: Array<{ intent: SkillsIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "pane", key: "l", footer: "h/l pane" },
  { intent: "new", key: "n", footer: "n new" },
  { intent: "open", key: "return", footer: "Enter open" },
  { intent: "archive", key: "a", footer: "a archive" },
  { intent: "delete", key: "d", footer: "d delete" },
  { intent: "export", key: "x", footer: "x export" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

export const SKILLS_KEYS = SPECS

export function intentFor(name: string): SkillsIntent | undefined {
  const key = name.toLowerCase() === "enter" ? "return" : name.toLowerCase()
  return SKILLS_KEYS.find((entry) => entry.key === key)?.intent
}

export function footerHints(): string {
  return managerHints().join(" · ")
}

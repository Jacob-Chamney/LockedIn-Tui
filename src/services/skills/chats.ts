/**
 * Skill chats: several conversations per goal, one file each.
 *
 * A chat is `chats/chat-<n>.jsonl`, monotonic per goal, and the goal's `chats[]`
 * list is updated atomically in the same operation. A turn is appended only after
 * a successful `done`; a cancelled or failed turn writes nothing.
 */

import { appendFile, readFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { confinedJoin } from "../../storage/paths"

import { err, ok, type Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import { goalFolderFor, readMeta, writeMeta, type Emit, type ProgressError } from "./progress"

export type ChatError =
  | ProgressError
  | { kind: "blocked"; message: string; next: string }
  | { kind: "storage"; path: string; message: string }

export const CHATS_DIR = "chats"
export const LAST_CHAT_REFUSAL = "a goal keeps at least one chat"

export type ChatRef = { id: string; goalId: string; path: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chatsDir(workspace: Workspace, goalId: string): string {
  return join(goalFolderFor(workspace, goalId), CHATS_DIR)
}

const CHAT_ID = /^chat-\d+$/

function chatPath(workspace: Workspace, goalId: string, chatId: string): string {
  const directory = chatsDir(workspace, goalId)
  return confinedJoin(directory, `${chatId}.jsonl`) ?? join(directory, ".invalid-chat.jsonl")
}

function nextChatId(existing: readonly string[]): string {
  let highest = 0
  for (const id of existing) {
    const match = /^chat-(\d+)$/.exec(id)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `chat-${highest + 1}`
}

/** Chat ids recorded in `meta.json`, in order. */
export async function listChats(workspace: Workspace, goalId: string): Promise<Result<string[], ChatError>> {
  const loaded = await readMeta(goalFolderFor(workspace, goalId))
  if (!loaded.ok) return loaded
  const chats = loaded.value.meta.chats
  return ok(Array.isArray(chats) ? (chats as string[]) : [])
}

/**
 * Open a chat.
 *
 * With no id, the next `chat-<n>` is created and registered in `meta.json` once.
 * With an id, the existing chat is returned and nothing is written — reopening
 * must never create a file.
 */
export async function openChat(input: {
  workspace: Workspace
  goalId: string
  chatId?: string
  emit?: Emit
}): Promise<Result<ChatRef, ChatError>> {
  const folder = goalFolderFor(input.workspace, input.goalId)
  const loaded = await readMeta(folder)
  if (!loaded.ok) return loaded
  const { meta } = loaded.value
  const chats = Array.isArray(meta.chats) ? (meta.chats as string[]) : []

  if (input.chatId !== undefined) {
    if (!CHAT_ID.test(input.chatId) || !chats.includes(input.chatId)) {
      return err({
        kind: "storage",
        path: chatPath(input.workspace, input.goalId, input.chatId),
        message: `there is no chat "${input.chatId}" in this goal`,
      })
    }
    return ok({
      id: input.chatId,
      goalId: input.goalId,
      path: chatPath(input.workspace, input.goalId, input.chatId),
    })
  }

  const id = nextChatId(chats)
  const path = chatPath(input.workspace, input.goalId, id)

  try {
    await Bun.write(path, "")
  } catch (error) {
    return err({ kind: "storage", path, message: messageOf(error) })
  }

  const written = await writeMeta(folder, { ...meta, chats: [...chats, id] }, loaded.value.goal.stages)
  if (!written.ok) return written

  input.emit?.({ type: "goal.updated", id: input.goalId, action: "chat" })
  return ok({ id, goalId: input.goalId, path })
}

/** Delete one chat. The last chat cannot go: every goal opens on a chat. */
export async function deleteChat(input: {
  workspace: Workspace
  goalId: string
  chatId: string
  confirmed?: boolean
  emit?: Emit
}): Promise<Result<{ deleted: boolean; remaining: string[] }, ChatError>> {
  const folder = goalFolderFor(input.workspace, input.goalId)
  const loaded = await readMeta(folder)
  if (!loaded.ok) return loaded
  const { meta } = loaded.value
  const chats = Array.isArray(meta.chats) ? (meta.chats as string[]) : []

  if (!CHAT_ID.test(input.chatId) || !chats.includes(input.chatId)) {
    return err({
      kind: "storage",
      path: chatPath(input.workspace, input.goalId, input.chatId),
      message: `there is no chat "${input.chatId}" in this goal`,
    })
  }
  if (chats.length <= 1) {
    return err({
      kind: "blocked",
      message: LAST_CHAT_REFUSAL,
      next: "create another chat first, then delete this one",
    })
  }
  if (input.confirmed === false) return ok({ deleted: false, remaining: chats })

  const remaining = chats.filter((id) => id !== input.chatId)
  const target = chatPath(input.workspace, input.goalId, input.chatId)
  // Stage the file first: if meta.json cannot be rewritten, put it back rather
  // than leave a listed chat with no file.
  const staged = `${target}.deleting-${crypto.randomUUID()}`
  try {
    await rename(target, staged)
  } catch (error) {
    return err({ kind: "storage", path: target, message: messageOf(error) })
  }

  const written = await writeMeta(folder, { ...meta, chats: remaining }, loaded.value.goal.stages)
  if (!written.ok) {
    await rename(staged, target).catch(() => {})
    return written
  }

  await rm(staged, { force: true }).catch(() => {})
  input.emit?.({ type: "goal.updated", id: input.goalId, action: "chat" })
  return ok({ deleted: true, remaining })
}

export type ChatRecord = {
  role: "user" | "assistant"
  content: string
  at: string
}

/**
 * Append one turn.
 *
 * Gated on the terminal event: only `done` is appended. A cancelled or failed
 * turn leaves the file byte-identical.
 */
export async function appendTurn(input: {
  workspace: Workspace
  goalId: string
  chatId: string
  outcome: "done" | "cancelled" | "error"
  record: ChatRecord
}): Promise<Result<{ written: boolean }, ChatError>> {
  if (input.outcome !== "done") return ok({ written: false })

  const chats = await listChats(input.workspace, input.goalId)
  if (!chats.ok) return chats
  if (!chats.value.includes(input.chatId)) {
    return err({
      kind: "storage",
      path: chatPath(input.workspace, input.goalId, input.chatId),
      message: `there is no chat "${input.chatId}" in this goal`,
    })
  }

  const path = chatPath(input.workspace, input.goalId, input.chatId)
  try {
    const existing = await readFile(path, "utf8").catch(() => "")
    const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n"
    await appendFile(path, `${prefix}${JSON.stringify(input.record)}\n`)
    return ok({ written: true })
  } catch (error) {
    return err({ kind: "storage", path, message: messageOf(error) })
  }
}

/** Read a chat back as records; a malformed line is skipped, not fatal. */
export async function readChat(input: {
  workspace: Workspace
  goalId: string
  chatId: string
}): Promise<Result<ChatRecord[], ChatError>> {
  const path = chatPath(input.workspace, input.goalId, input.chatId)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    return err({ kind: "storage", path, message: messageOf(error) })
  }
  const records: ChatRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      records.push(JSON.parse(line) as ChatRecord)
    } catch {
      continue
    }
  }
  return ok(records)
}


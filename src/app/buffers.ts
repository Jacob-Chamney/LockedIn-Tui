/** Buffer identity and the per-buffer chat wiring. Pure: no signals, no IO. */
import { join } from "node:path"

import type { ChatMode } from "../llm/chat"
import type { RunScope } from "../llm/usage"
import type { Workspace } from "../storage/workspace"

export type WorkBuffer = {
  id: string
  label: string
  kind: "chat" | "project" | "agent" | "session" | "skill" | "achievements"
  projectId?: string
  agentId?: string
  /** The goals/<id> behind a skill buffer. */
  courseId?: string
  /** Which `chats/chat-<n>.jsonl` a skill buffer opened; defaults to chat-1. */
  chatId?: string
}

export const HOME_BUFFER: WorkBuffer = { id: "home", label: "Chill", kind: "chat" }

/** The independent chat file for one buffer, or null for Chill. */
export function chatPathFor(buffer: WorkBuffer, workspace: Workspace | undefined): string | null {
  if (!workspace) return null
  switch (buffer.kind) {
    case "skill":
      return join(
        workspace.paths.goals,
        buffer.courseId ?? buffer.id.replace(/^skill:/, ""),
        "chats",
        `${buffer.chatId ?? "chat-1"}.jsonl`,
      )
    case "session":
      return join(workspace.paths.schoolSessions, buffer.id.replace(/^session:/, ""), "chat.jsonl")
    case "project":
      return join(workspace.paths.workProjects, buffer.projectId ?? buffer.id, "chat.jsonl")
    case "agent":
      return join(
        workspace.paths.workProjects,
        buffer.projectId ?? "",
        "agents",
        buffer.agentId ?? buffer.id,
        "chat.jsonl",
      )
    default:
      return null
  }
}

/** Stats attribute each buffer to its own side, never the app-wide default. */
export function scopeForBuffer(buffer: WorkBuffer, fallback: RunScope): RunScope {
  if (buffer.kind === "session") return "school"
  if (buffer.kind === "skill") return "skills"
  if (buffer.kind === "project" || buffer.kind === "agent") return "work"
  return fallback
}

export function chatModeFor(buffer: WorkBuffer): ChatMode {
  if (buffer.kind === "session") return "lockin"
  if (buffer.kind === "skill") return "skill"
  if (buffer.kind === "project" || buffer.kind === "agent") return "work"
  return "chill"
}

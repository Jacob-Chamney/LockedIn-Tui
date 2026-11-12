/** Session-manager reads. The shell maps these rows into its UI state. */
import { join } from "node:path"
import { readFile, readdir } from "node:fs/promises"

import { parseProgress } from "../../domain/progress"
import { SESSION_FILES } from "../../domain/session"
import { listSessions, openSession } from "../../services/lockin/manager"
import { readSteps } from "../../services/lockin/steps"
import type { SessionHome } from "../../domain/session-home"
import type { Workspace } from "../../storage/workspace"

export type SessionListRow = {
  id: string
  name: string
  date: string
  sources: number
  steps: { done: number; total: number }
  archived: boolean
  broken?: string
}

export async function loadSessionRows(workspace: Workspace): Promise<SessionListRow[]> {
  const rows = await listSessions({ workspace })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    date: row.created,
    sources: row.sourceCount,
    steps: { done: row.stepCounts.checked, total: row.stepCounts.total },
    archived: row.archived,
    ...(row.broken ? { broken: row.reason ?? "cannot be opened" } : {}),
  }))
}

/**
 * Everything the session home renders, read once when the buffer opens.
 *
 * The home is shown only while the session has no chat. Coverage uses this same
 * source list and document text, so the panel and the home cannot disagree.
 */
export async function loadSessionHome(
  workspace: Workspace,
  id: string,
): Promise<SessionHome | null> {
  const opened = await openSession({ workspace, id })
  if (!opened.ok) return null
  const folder = opened.value.folder
  const outputs = join(workspace.paths.root, "school", "outputs", id)

  const read = (path: string) => readFile(path, "utf8").catch(() => "")
  const entries = await readdir(outputs).catch(() => [] as string[])
  const steps = (await readSteps(folder)) ?? ""
  const counts = parseProgress(steps)
  const chat = await read(opened.value.chatPath)
  const memory = await read(join(folder, SESSION_FILES.memory))
  const guide = entries.includes("study-guide.md") ? await read(join(outputs, "study-guide.md")) : ""
  const cards = entries.includes("flashcards.md") ? await read(join(outputs, "flashcards.md")) : ""

  const documents: SessionHome["documents"] = []
  if (steps.trim() !== "") documents.push({ kind: "steps", text: steps })
  if (chat.trim() !== "") documents.push({ kind: "chat", text: chat })
  if (guide !== "" || cards !== "") documents.push({ kind: "outputs", text: `${guide}\n${cards}` })
  if (memory.trim() !== "") documents.push({ kind: "memory", text: memory })

  return {
    name: opened.value.session.name,
    created: opened.value.session.created,
    sources: opened.value.session.sources.map((source) => ({
      name: source.name,
      originalPath: source.originalPath,
      hash: source.hash,
    })),
    steps: {
      done: counts.ok ? counts.value.checked : 0,
      total: counts.ok ? counts.value.total : 0,
      exists: steps.trim() !== "",
    },
    studyGuide: entries.includes("study-guide.md") ? "ready" : "build",
    flashcards: entries.includes("flashcards.md") ? "ready" : "build",
    // Related history needs the note index; the home renders its empty state
    // until that lookup exists, rather than inventing a citation.
    history: [],
    documents,
  }
}

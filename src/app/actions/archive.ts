/** Session archive/delete/export, with the backend choice kept out of the UI. */
import type { ArchiveBackend } from "../../archive/types"
import type { Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"

export type SessionAction = "archive" | "delete" | "export"

export type SessionActionInput = {
  workspace: Workspace
  id: string
  action: SessionAction
  archiveRoot: string
  /** Present only when Settings selects GitHub. */
  createGithubArchive?: () => Promise<Result<ArchiveBackend, import("../../archive/types").ArchiveError>>
}

export type SessionActionOutcome =
  | { ok: true; action: "delete" | "archive"; backend: "folder" | "github" }
  | { ok: true; action: "export"; path: string }
  | { ok: false; message: string }

export async function runSessionAction(input: SessionActionInput): Promise<SessionActionOutcome> {
  const {
    archiveSession,
    archiveSessionToBackend,
    deleteSession,
    exportSession,
  } = await import("../../services/lockin/archive")

  if (input.action === "export") {
    const result = await exportSession({ workspace: input.workspace, id: input.id })
    return result.ok
      ? { ok: true, action: "export", path: result.value.path }
      : { ok: false, message: result.error.message }
  }

  if (input.action === "delete") {
    const result = await deleteSession({ workspace: input.workspace, id: input.id, confirmed: true })
    return result.ok
      ? { ok: true, action: "delete", backend: "folder" }
      : { ok: false, message: result.error.message }
  }

  if (input.createGithubArchive) {
    const backend = await input.createGithubArchive()
    if (!backend.ok) return { ok: false, message: backend.error.message }
    const result = await archiveSessionToBackend({
      workspace: input.workspace,
      id: input.id,
      backend: backend.value,
    })
    return result.ok
      ? { ok: true, action: "archive", backend: "github" }
      : { ok: false, message: result.error.message }
  }

  if (input.archiveRoot === "") {
    return { ok: false, message: "set an archive folder in Settings first" }
  }
  const result = await archiveSession({
    workspace: input.workspace,
    id: input.id,
    confirmed: true,
    archiveRoot: input.archiveRoot,
  })
  return result.ok
    ? { ok: true, action: "archive", backend: "folder" }
    : { ok: false, message: result.error.message }
}

export type ArchiveListRow = {
  id: string
  side: "school" | "skills"
  name: string
  date: string
  sizeBytes: number
  backend: "folder" | "github"
  kind: "session" | "goal" | "project"
}

export async function loadArchiveRows(input: {
  archiveRoot: string
  backend: "folder" | "github"
  workspaceRoot?: string
  createGithubArchive?: () => Promise<Result<ArchiveBackend, import("../../archive/types").ArchiveError>>
}): Promise<{ ok: true; rows: ArchiveListRow[] } | { ok: false; message: string }> {
  let backend: ArchiveBackend
  if (input.backend === "github") {
    if (!input.createGithubArchive) {
      return { ok: false, message: "the GitHub archive backend is not available in this build" }
    }
    const made = await input.createGithubArchive()
    if (!made.ok) return { ok: false, message: made.error.message }
    backend = made.value
  } else {
    if (input.archiveRoot === "") return { ok: true, rows: [] }
    const { openFolderArchive } = await import("../../archive/folder")
    const opened = openFolderArchive({
      archiveRoot: input.archiveRoot,
      ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
    })
    if (!opened.ok) return { ok: false, message: opened.error.message }
    backend = opened.value
  }

  const [school, skills] = await Promise.all([backend.list("school"), backend.list("skills")])
  return {
    ok: true,
    rows: [
      ...(school.ok ? school.value.entries.map((entry) => ({ ...entry, side: "school" as const })) : []),
      ...(skills.ok ? skills.value.entries.map((entry) => ({ ...entry, side: "skills" as const })) : []),
    ].map((entry) => ({
      id: entry.id,
      side: entry.side,
      name: entry.title,
      date: entry.archivedAt,
      sizeBytes: entry.sizeBytes,
      backend: entry.backend,
      kind: entry.kind,
    })),
  }
}

export async function restoreArchived(input: {
  workspace: Workspace
  archiveRoot: string
  row: {
    id: string
    side: "school" | "skills"
    backend: "folder" | "github"
    kind?: "session" | "goal" | "project"
    name: string
  }
  createGithubArchive?: () => Promise<Result<ArchiveBackend, import("../../archive/types").ArchiveError>>
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { join } = await import("node:path")
  const kind = input.row.kind ?? (input.row.side === "school" ? "session" : "goal")
  const ref = { side: input.row.side, id: input.row.id, backend: input.row.backend, kind }
  const destination =
    input.row.side === "school"
      ? join(input.workspace.paths.schoolSessions, input.row.id)
      : join(input.workspace.paths.goals, input.row.id)

  let restored: Result<unknown, { message: string }>
  if (input.row.backend === "github") {
    if (!input.createGithubArchive) {
      return { ok: false, message: "the GitHub archive backend is not available in this build" }
    }
    const made = await input.createGithubArchive()
    if (!made.ok) return { ok: false, message: made.error.message }
    const result = await made.value.restore(ref, destination)
    restored = result.ok ? { ok: true, value: result.value } : { ok: false, error: { message: result.error.message } }
  } else {
    if (input.archiveRoot === "") return { ok: false, message: "set an archive folder in Settings first" }
    const { openFolderArchive } = await import("../../archive/folder")
    const opened = openFolderArchive({ archiveRoot: input.archiveRoot, workspaceRoot: input.workspace.root })
    if (!opened.ok) return { ok: false, message: opened.error.message }
    const result = await opened.value.restore(ref, destination)
    restored = result.ok ? { ok: true, value: result.value } : { ok: false, error: { message: result.error.message } }
  }
  return restored.ok ? { ok: true } : { ok: false, message: restored.error.message }
}

export type GoalAction = "archive" | "delete" | "export"

export type GoalActionInput = {
  workspace: Workspace
  id: string
  action: GoalAction
  archiveRoot: string
  createGithubArchive?: () => Promise<Result<ArchiveBackend, import("../../archive/types").ArchiveError>>
}

export type GoalActionOutcome =
  | { ok: true; action: "delete" | "archive"; backend: "folder" | "github" }
  | { ok: true; action: "export"; path: string }
  | { ok: false; message: string }

export async function runGoalAction(input: GoalActionInput): Promise<GoalActionOutcome> {
  if (input.action === "export") {
    const { exportGoal } = await import("../../services/skills/archive")
    const result = await exportGoal({ workspace: input.workspace, id: input.id })
    return result.ok
      ? { ok: true, action: "export", path: result.value }
      : { ok: false, message: result.error.message }
  }

  if (input.action === "delete") {
    const { deleteGoal } = await import("../../services/skills/delete")
    const result = await deleteGoal({ workspace: input.workspace, id: input.id, confirmed: true })
    return result.ok ? { ok: true, action: "delete", backend: "folder" } : { ok: false, message: result.error.message }
  }

  let backend: ArchiveBackend
  if (input.createGithubArchive) {
    const made = await input.createGithubArchive()
    if (!made.ok) return { ok: false, message: made.error.message }
    backend = made.value
  } else {
    if (input.archiveRoot === "") return { ok: false, message: "set an archive folder in Settings first" }
    const { openFolderArchive } = await import("../../archive/folder")
    const opened = openFolderArchive({ archiveRoot: input.archiveRoot, workspaceRoot: input.workspace.root })
    if (!opened.ok) return { ok: false, message: opened.error.message }
    backend = opened.value
  }
  const { archiveGoal } = await import("../../services/skills/archive")
  const result = await archiveGoal({ workspace: input.workspace, id: input.id, backend })
  return result.ok
    ? { ok: true, action: "archive", backend: backend.id === "github" ? "github" : "folder" }
    : { ok: false, message: result.error.message }
}

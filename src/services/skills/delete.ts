/**
 * Deleting a skill goal.
 *
 * A goal is a folder under `skills/goals/`, and a course (its chapters) lives in
 * the same folder, so one delete removes both. The operation is confined to that
 * root and takes an explicit confirmation: a `confirmed: false` probe reports
 * what would go without touching a byte.
 */
import { rm, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"

import type { Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"

export type GoalDeleteError = { kind: "path" | "storage" | "missing"; path: string; message: string }

export type GoalDeleteOutcome = {
  deleted: boolean
  /** Files and folders removed, for the confirmation sentence. */
  entries: string[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The folder for a goal id, refusing anything that escapes the goals root. */
export function goalFolderFor(workspace: Workspace, id: string): Result<string, GoalDeleteError> {
  const root = resolve(workspace.paths.goals)
  const folder = resolve(join(root, id))
  const inside = relative(root, folder)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || id.includes("\0")) {
    return { ok: false, error: { kind: "path", path: folder, message: `"${id}" is not a goal in this workspace` } }
  }
  return { ok: true, value: folder }
}

async function listTop(folder: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises")
    return (await readdir(folder)).sort()
  } catch {
    return []
  }
}

export async function deleteGoal(input: {
  workspace: Workspace
  id: string
  /** False reports what would be deleted and changes nothing. */
  confirmed: boolean
}): Promise<Result<GoalDeleteOutcome, GoalDeleteError>> {
  const folder = goalFolderFor(input.workspace, input.id)
  if (!folder.ok) return folder

  try {
    await stat(folder.value)
  } catch {
    return {
      ok: false,
      error: { kind: "missing", path: folder.value, message: `there is no skill session "${input.id}"` },
    }
  }

  const entries = await listTop(folder.value)
  if (!input.confirmed) return { ok: true, value: { deleted: false, entries } }

  try {
    await rm(folder.value, { recursive: true, force: true })
  } catch (error) {
    return {
      ok: false,
      error: { kind: "storage", path: folder.value, message: messageOf(error) },
    }
  }
  return { ok: true, value: { deleted: true, entries } }
}

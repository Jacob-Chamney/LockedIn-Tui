/** Project export, with the service result flattened for the shell. */
import type { Workspace } from "../../storage/workspace"
import { exportProject, type ProjectExportInput } from "../../services/work/export"

export type ProjectExportOutcome =
  | { ok: true; path: string }
  | { ok: false; message: string }

export async function runProjectExport(input: {
  workspace: Workspace
  project: ProjectExportInput
}): Promise<ProjectExportOutcome> {
  const result = await exportProject(input)
  return result.ok ? { ok: true, path: result.value } : { ok: false, message: result.error.message }
}

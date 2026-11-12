/** The work changes summary as reader lines. */
import type { Workspace } from "../../storage/workspace"
import { changes } from "../../services/work/changes"

export type ChangesView = { title: string; lines: string[] }

export async function loadProjectChanges(input: {
  workspace: Workspace
  projectId: string
}): Promise<{ ok: true; value: ChangesView } | { ok: false; message: string }> {
  const result = await changes(input)
  if (!result.ok) return { ok: false, message: result.error.message }
  const summary = result.value
  if (!summary.available) return { ok: false, message: summary.message }

  const lines = [
    `${summary.branch}${summary.detached ? " (detached)" : ""} · ${summary.staged} staged · ${summary.unstaged} unstaged`,
    "",
  ]
  if (summary.files.length === 0) {
    lines.push("working tree clean")
  } else {
    for (const file of summary.files) {
      const flags = [
        file.staged ? "staged" : "",
        file.unstaged ? "unstaged" : "",
      ].filter(Boolean).join("+")
      lines.push(
        `${file.status.padEnd(10)} ${file.path}  +${file.added} −${file.removed}${flags ? `  (${flags})` : ""}`,
      )
    }
  }
  return { ok: true, value: { title: "Changes", lines } }
}

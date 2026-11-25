/**
 * Reading and updating a swarm run report.
 *
 * A board is process state; the report is the durable record. This service is
 * the file half of the report format (`src/domain/swarm-report.ts`), so a
 * verification queue can outlive a core restart: the protocol reads reports for
 * runs it no longer remembers and rewrites one line when a task is verified.
 *
 * Every write is temp → fsync → rename, and a failure leaves the report as it
 * was. No model, no network, no project-file access.
 */

import { open, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import {
  parseSwarmReport,
  verifyReportTask,
  type SwarmReport,
} from "../../domain/swarm-report"
import type { Workspace } from "../../storage/workspace"
import { reportPath, reportsDir } from "./swarm"

export type ReportError = { kind: "report"; message: string }

export type StoredReport = {
  /** Absolute path; never sent to the shell. */
  path: string
  report: SwarmReport
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${crypto.randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, "w")
    await handle.writeFile(text, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // nothing useful to do with a failing close
    }
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** The run ids with a report on disk, oldest first by name (run ids sort). */
export async function listReportRuns(
  workspace: Workspace,
  projectId: string,
): Promise<string[]> {
  try {
    const entries = await readdir(reportsDir(workspace, projectId))
    return entries
      .filter((name) => name.endsWith(".md") && !name.startsWith("."))
      .map((name) => basename(name, ".md"))
      .sort()
  } catch {
    return []
  }
}

/**
 * Read one run's report, or `null` when it does not exist or cannot be parsed.
 *
 * A broken report is skipped by the queue rather than failing it, exactly as a
 * broken session is: one unreadable file never hides the rest of the work.
 */
export async function readReport(
  workspace: Workspace,
  projectId: string,
  runId: string,
): Promise<StoredReport | null> {
  const path = reportPath(workspace, projectId, runId)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return null
  }
  const report = parseSwarmReport(text)
  return report === null ? null : { path, report }
}

/**
 * Mark one task verified in its report.
 *
 * Used when the run is no longer in memory (a restart). The line's `[done]`
 * becomes `[verified]`; every other byte stays. An already-verified task is a
 * success that writes nothing.
 */
export async function verifyReportTaskFile(input: {
  workspace: Workspace
  projectId: string
  runId: string
  taskId: string
}): Promise<Result<{ path: string; already: boolean }, ReportError>> {
  const path = reportPath(input.workspace, input.projectId, input.runId)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch {
    return err({
      kind: "report",
      message: `there is no report for run ${input.runId}, so ${input.taskId} cannot be verified`,
    })
  }
  const outcome = verifyReportTask(text, input.taskId)
  if (!outcome.ok) return err({ kind: "report", message: outcome.message })
  if (!outcome.already) {
    try {
      await writeAtomic(path, outcome.markdown)
    } catch (error) {
      return err({
        kind: "report",
        message: `the report could not be written: ${messageOf(error)}`,
      })
    }
  }
  return ok({ path, already: outcome.already })
}

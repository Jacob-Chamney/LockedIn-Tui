/**
 * The swarm run report's data format.
 *
 * A run writes one Markdown report (`docs/data-model.md` §6.2): frontmatter with
 * the run id, objective, status and agent count, a Plan section and a Task
 * results section. The report is the **durable** record of a run — a board is
 * process state and is forgotten on restart — so the task ids live here too.
 *
 * The current writer emits `task-N` ids on both plan and result lines. Reports
 * written before ids existed are still read: a missing id falls back to the
 * line's 1-based position, which is exactly the id the service assigns because
 * tasks are created in plan order.
 *
 * Pure: no file IO, no UI, no model.
 */

export type SwarmReportState =
  | "pending"
  | "running"
  | "done"
  | "verified"
  | "failed"
  | "blocked"
  | "cancelled"

export type SwarmReportTask = {
  /** `task-<n>`; explicit in the current format, positional in the old one. */
  id: string
  title: string
  state: SwarmReportState
  /** The one-line result, or `""` when the line carried none. */
  summary: string
}

export type SwarmReport = {
  run: string
  objective: string
  status: string
  tasks: SwarmReportTask[]
}

const PLAN_NEW = /^-\s+(task-\d+)\s*·\s*(.*)$/
const PLAN_OLD = /^-\s+(.*)$/
const RESULT_NEW = /^-\s+\[([a-z]+)\]\s+(task-\d+)\s*·\s*(.*)$/
const RESULT_OLD = /^-\s+\[([a-z]+)\]\s+(.*)$/
const STATES: readonly SwarmReportState[] = [
  "pending",
  "running",
  "done",
  "verified",
  "failed",
  "blocked",
  "cancelled",
];

function stateOf(raw: string): SwarmReportState | null {
  return (STATES as readonly string[]).includes(raw) ? (raw as SwarmReportState) : null;
}

/** Split `title — agent name` on the last separator, so a title may contain one. */
function splitTitle(line: string): string {
  const at = line.lastIndexOf(" — ")
  return at <= 0 ? line.trim() : line.slice(0, at).trim()
}

/** Split `agent name — summary` on the first separator. */
function splitSummary(line: string): string {
  const at = line.indexOf(" — ")
  return at < 0 ? "" : line.slice(at + 3).trim()
}

/**
 * Parse one report.
 *
 * A missing or malformed plan/results line is skipped rather than failing the
 * report: one odd line never hides the rest of a run. `null` means the document
 * is not a report at all (no frontmatter and no task results).
 */
export function parseSwarmReport(markdown: string): SwarmReport | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const frontmatter: Record<string, string> = {}
  const plan: Array<{ id: string; title: string }> = []
  const results: Array<{ id: string; state: SwarmReportState; summary: string }> = []

  let section: "frontmatter" | "plan" | "results" | "other" | null = null
  let seenFrontmatter = false
  let sawResultsHeading = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === "---") {
      if (!seenFrontmatter) {
        seenFrontmatter = true
        section = "frontmatter"
      } else if (section === "frontmatter") {
        section = "other"
      }
      continue
    }
    if (section === "frontmatter") {
      const colon = line.indexOf(":")
      if (colon > 0) {
        const key = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim()
        if (key !== "") frontmatter[key] = value
      }
      continue
    }
    if (line === "## Plan") {
      section = "plan"
      continue
    }
    if (line === "## Task results") {
      section = "results"
      sawResultsHeading = true
      continue
    }
    if (line.startsWith("## ")) {
      section = "other"
      continue
    }

    if (section === "plan") {
      const next = PLAN_NEW.exec(line)
      if (next !== null) {
        plan.push({ id: next[1]!, title: splitTitle(next[2] ?? "") })
        continue
      }
      const old = PLAN_OLD.exec(line)
      if (old !== null) {
        const title = splitTitle(old[1] ?? "")
        if (title !== "") plan.push({ id: `task-${plan.length + 1}`, title })
      }
      continue
    }

    if (section === "results") {
      const next = RESULT_NEW.exec(line)
      if (next !== null) {
        const state = stateOf(next[1]!)
        if (state !== null) {
          results.push({ id: next[2]!, state, summary: splitSummary(next[3] ?? "") })
        }
        continue
      }
      const old = RESULT_OLD.exec(line)
      if (old !== null) {
        const state = stateOf(old[1]!)
        if (state !== null) {
          results.push({
            id: `task-${results.length + 1}`,
            state,
            summary: splitSummary(old[2] ?? ""),
          })
        }
      }
    }
  }

  if (!seenFrontmatter && !sawResultsHeading) return null

  const parsedObjective = frontmatter.objective ?? ""
  let objective = parsedObjective
  if (parsedObjective.startsWith('"')) {
    try {
      const value = JSON.parse(parsedObjective) as unknown
      if (typeof value === "string") objective = value
    } catch {
      // Keep the raw value; a hand-edited report is still readable.
    }
  }

  const titles = new Map(plan.map((entry) => [entry.id, entry.title]))
  const tasks: SwarmReportTask[] = results.map((entry, index) => ({
    id: entry.id,
    // The plan and results are written in task order; the fallback keeps a
    // report whose plan line was edited from losing every title.
    title: titles.get(entry.id) ?? plan[index]?.title ?? entry.id,
    state: entry.state,
    summary: entry.summary,
  }))

  return {
    run: (frontmatter.run ?? "").trim(),
    objective,
    status: (frontmatter.status ?? "").trim(),
    tasks,
  }
}

export type VerifyReportOutcome =
  | { ok: true; markdown: string; already: boolean }
  | { ok: false; message: string }

/**
 * Mark one task's result line verified.
 *
 * `[verified]` replaces `[done]` and every other byte stays: the report is the
 * durable record, and a rewrite must not drop a task or a summary. An
 * already-verified task is a no-op success; a task that is not done cannot be
 * verified. An id is matched explicitly when the line carries one and by
 * position otherwise.
 */
export function verifyReportTask(markdown: string, taskId: string): VerifyReportOutcome {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  let section: "plan" | "results" | "other" | null = null
  let ordinal = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line === "## Plan") {
      section = "plan"
      continue
    }
    if (line === "## Task results") {
      section = "results"
      ordinal = 0
      continue
    }
    if (line.startsWith("## ")) {
      section = "other"
      continue
    }
    if (section !== "results") continue

    const next = RESULT_NEW.exec(line)
    const old = next === null ? RESULT_OLD.exec(line) : null
    const match = next ?? old
    if (match === null) continue
    ordinal += 1
    const explicit = next === null ? null : next[2]!
    const id = explicit ?? `task-${ordinal}`
    if (id !== taskId) continue

    const state = stateOf(match[1]!)
    if (state === null) {
      return { ok: false, message: `task ${taskId} has an unknown state "${match[1]}"` }
    }
    if (state === "verified") return { ok: true, markdown, already: true }
    if (state !== "done") {
      return { ok: false, message: `task ${taskId} is ${state}, not done` }
    }
    const bracket = `[${match[1]}]`
    const at = line.indexOf(bracket)
    lines[index] = `${line.slice(0, at)}[verified]${line.slice(at + bracket.length)}`
    return { ok: true, markdown: lines.join("\n"), already: false }
  }
  return { ok: false, message: `the report has no task ${taskId}` }
}

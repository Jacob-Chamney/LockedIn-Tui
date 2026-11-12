/**
 * Activity log — what Work decided, never what it decided about (WP-507).
 *
 * One append-only JSONL file at `<dataDir>/activity.jsonl`, outside the
 * workspace, excluded from archives (`docs/data-model.md` §6.3, §1.1). It records
 * approvals, denials and swarm lifecycle events so a user can answer "did I
 * approve that write?" without the app keeping any of the code it wrote.
 *
 * The rule that shapes this module is **metadata only**. Every record is
 * re-serialised through a per-kind whitelist, so a caller that accidentally
 * passes `content`, `diff`, `prompt` or `stdout` cannot leak it into the file:
 * the field is dropped before a byte is written, not filtered afterwards. Field
 * values are additionally bounded, so a model answer cannot be smuggled into
 * `path` or `status`.
 *
 * Two failure modes are deliberate:
 *
 * - a **corrupt line** is skipped and counted; the rest of the file still loads,
 *   because one truncated append must not hide every other decision;
 * - a **bad record** is refused with a typed error and nothing is appended. The
 *   caller already applied or refused the write (the sink never changes that),
 *   but the log stays clean.
 *
 * Appends are serialised per file in-process and written with one `O_APPEND`
 * write per line, so two decisions land as two whole lines, never as an
 * interleaved fragment.
 */

import { mkdir, open, readFile, stat } from "node:fs/promises"
import { dirname } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { dataPaths, isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import type { CommandDecisionEvent } from "./commands"
import type { WorkError } from "./register"
import type { SwarmActivityEvent } from "./swarm"
import type { WriteDecisionEvent } from "./writes"

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

export const ACTIVITY_KINDS = ["write-decision", "command-decision", "swarm"] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** Every record `activity.jsonl` may hold (`docs/data-model.md` §6.3). */
export type ActivityRecord = WriteDecisionEvent | CommandDecisionEvent | SwarmActivityEvent

export type ActivityQuery = {
  kind?: ActivityKind
  /** A project id. Ids are stable, so a rename does not split the history. */
  project?: string
  /** Newest first. Defaults to `DEFAULT_LIMIT`; must be a positive integer. */
  limit?: number
}

export type ActivityList = {
  path: string
  records: ActivityRecord[]
  /** Lines that were not recoverable records; skipped, never fatal. */
  skipped: number
  /** True when the file does not exist yet — an empty state, not an error. */
  empty: boolean
}

export type ActivityError =
  | WorkError
  | {
      kind: "unknown-kind"
      /** The offending value. Not `kind`: that name is the discriminant. */
      value: string
      accepted: readonly ActivityKind[]
      message: string
    }
  | {
      /** A record tried to store something outside the whitelist's bounds. */
      kind: "invalid-record"
      field: string
      message: string
    }
  | {
      /** The log must not live inside the workspace it describes. */
      kind: "log-inside-workspace"
      path: string
      message: string
    }

export type ActivityLog = {
  /** Absolute path of the JSONL file. Never inside the workspace root. */
  readonly path: string
  /** Append one record. Resolves with exactly what was written. */
  append(record: ActivityRecord): Promise<Result<ActivityRecord, ActivityError>>
  /** Newest first, filtered, with corrupt lines counted. */
  list(query?: ActivityQuery): Promise<Result<ActivityList, ActivityError>>
  /** The file as text, for an "open in editor" action. */
  text(): Promise<Result<string, ActivityError>>
}

export type ActivityOptions = {
  /** Override the data directory. Tests use this; production uses `workspace.data`. */
  dataDir?: string
  /** Default page size for `list()` when the caller passes no limit. */
  limit?: number
}

export const DEFAULT_LIMIT = 200

/* -------------------------------------------------------------------------- */
/* field bounds                                                                */
/* -------------------------------------------------------------------------- */

/** Long enough for any path, id or status; short enough that a body cannot hide. */
const MAX_TEXT = 500

const MAX_ARGV = 64

const MAX_HUNKS = 512

/* -------------------------------------------------------------------------- */
/* whitelist                                                                   */
/* -------------------------------------------------------------------------- */

type FieldKind = "text" | "time" | "decision" | "strings" | "hunks" | "number" | "boolean" | "enum"

type FieldSpec = {
  name: string
  kind: FieldKind
  required: boolean
  /** For `decision`/`enum`. */
  values?: readonly string[]
  /** `null` is a meaningful value for `exitCode`. */
  nullable?: boolean
}

const WRITE_FIELDS: readonly FieldSpec[] = [
  { name: "kind", kind: "enum", required: true, values: ["write-decision"] },
  { name: "project", kind: "text", required: true },
  { name: "path", kind: "text", required: true },
  { name: "decision", kind: "decision", required: true, values: ["approve", "reject"] },
  { name: "hunks", kind: "hunks", required: false },
  { name: "at", kind: "time", required: true },
]

const COMMAND_FIELDS: readonly FieldSpec[] = [
  { name: "kind", kind: "enum", required: true, values: ["command-decision"] },
  { name: "project", kind: "text", required: true },
  { name: "argv", kind: "strings", required: true },
  { name: "cwd", kind: "text", required: true },
  { name: "decision", kind: "decision", required: true, values: ["approve", "deny"] },
  { name: "exitCode", kind: "number", required: true, nullable: true },
  { name: "durationMs", kind: "number", required: false },
  { name: "timedOut", kind: "boolean", required: false },
  { name: "at", kind: "time", required: true },
]

const SWARM_FIELDS: readonly FieldSpec[] = [
  { name: "kind", kind: "enum", required: true, values: ["swarm"] },
  { name: "project", kind: "text", required: true },
  { name: "run", kind: "text", required: true },
  {
    name: "event",
    kind: "enum",
    required: true,
    values: ["started", "task", "finished", "cancelled", "failed"],
  },
  { name: "task", kind: "text", required: false },
  { name: "status", kind: "text", required: false },
  { name: "at", kind: "time", required: true },
]

function fieldsFor(kind: string): readonly FieldSpec[] | null {
  if (kind === "write-decision") return WRITE_FIELDS
  if (kind === "command-decision") return COMMAND_FIELDS
  if (kind === "swarm") return SWARM_FIELDS
  return null
}

function invalid(field: string, message: string): ActivityError {
  return { kind: "invalid-record", field, message }
}

/**
 * Copy the whitelisted fields in a fixed order.
 *
 * Anything not named here — `content`, `diff`, `prompt`, `stdout`, `stderr`,
 * `token`, an image body — is discarded before serialisation. That is why the
 * file cannot contain a file body even if a caller tries.
 */
export function normalise(record: unknown): Result<ActivityRecord, ActivityError> {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return err(invalid("record", "an activity record must be an object"))
  }

  const raw = record as Record<string, unknown>
  const kind = typeof raw.kind === "string" ? raw.kind : ""
  const specs = fieldsFor(kind)
  if (!specs) {
    return err({
      kind: "unknown-kind",
      value: kind,
      accepted: ACTIVITY_KINDS,
      message: `"${kind}" is not an activity kind; use one of ${ACTIVITY_KINDS.join(", ")}`,
    })
  }

  const stored: Record<string, unknown> = {}

  for (const spec of specs) {
    const value = raw[spec.name]
    if (value === undefined) {
      if (spec.required) {
        return err(invalid(spec.name, `${kind} records need a “${spec.name}” field`))
      }
      continue
    }

    switch (spec.kind) {
      case "text":
      case "decision":
      case "enum": {
        if (typeof value !== "string" || value === "") {
          return err(invalid(spec.name, `${spec.name} must be non-empty text`))
        }
        if (value.length > MAX_TEXT) {
          // Keep the head and mark the cut. A long path or prompt must not make
          // the decision unloggable; the log stores metadata, not content.
          stored[spec.name] = `${value.slice(0, MAX_TEXT)}…`
        } else {
          stored[spec.name] = value
        }
        if (spec.values && !spec.values.includes(stored[spec.name] as string)) {
          return err(
            invalid(spec.name, `${spec.name} must be one of ${spec.values.join(", ")}`),
          )
        }
        break
      }
      case "time": {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
          return err(invalid(spec.name, "at must be an ISO-8601 timestamp"))
        }
        stored[spec.name] = value
        break
      }
      case "strings": {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          return err(invalid(spec.name, `${spec.name} must be a list of strings`))
        }
        if (value.length > MAX_ARGV) {
          return err(invalid(spec.name, `${spec.name} has more than ${MAX_ARGV} entries`))
        }
        const items: string[] = []
        for (const item of value as string[]) {
          // Truncate instead of rejecting: an approved `node -e <script>` is
          // exactly the decision the audit trail must still record.
          items.push(item.length > MAX_TEXT ? `${item.slice(0, MAX_TEXT)}…` : item)
        }
        stored[spec.name] = items
        break
      }
      case "hunks": {
        if (
          !Array.isArray(value) ||
          value.some((item) => !Number.isInteger(item) || (item as number) < 0)
        ) {
          return err(invalid(spec.name, "hunks must be a list of non-negative integers"))
        }
        if (value.length > MAX_HUNKS) {
          return err(invalid(spec.name, `hunks has more than ${MAX_HUNKS} entries`))
        }
        stored[spec.name] = [...(value as number[])]
        break
      }
      case "number": {
        if (value === null && spec.nullable === true) {
          stored[spec.name] = null
          break
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return err(
            invalid(spec.name, `${spec.name} must be a finite number${spec.nullable ? " or null" : ""}`),
          )
        }
        stored[spec.name] = value
        break
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          return err(invalid(spec.name, `${spec.name} must be true or false`))
        }
        stored[spec.name] = value
        break
      }
    }
  }

  return ok(stored as ActivityRecord)
}

/* -------------------------------------------------------------------------- */
/* serialisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One chain per file path. A rejection in one append does not poison the next,
 * and entries are kept after settling so the map cannot grow beyond one per
 * open log.
 */
const chains = new Map<string, Promise<unknown>>()

function serialised<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(path) ?? Promise.resolve()
  const next = previous.then(task, task)
  chains.set(
    path,
    next.catch(() => undefined),
  )
  return next
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

/** True when the file exists and its last byte is not a newline. */
async function needsLineBreak(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return false
  const handle = await open(path, "r")
  try {
    const byte = Buffer.alloc(1)
    await handle.read(byte, 0, 1, info.size - 1)
    return byte[0] !== 10
  } finally {
    await handle.close()
  }
}

async function appendLine(
  path: string,
  record: ActivityRecord,
): Promise<Result<ActivityRecord, ActivityError>> {
  let prefix = ""
  try {
    await mkdir(dirname(path), { recursive: true })
    // A truncated earlier write must not swallow the next record: start fresh.
    if (await needsLineBreak(path)) prefix = "\n"
  } catch (error) {
    return err({
      kind: "storage",
      path,
      message: `the activity log could not be prepared (${describe(error)})`,
    })
  }

  const line = prefix + JSON.stringify(record) + "\n"
  try {
    const handle = await open(path, "a")
    try {
      await handle.writeFile(line)
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    return err({
      kind: "storage",
      path,
      message: `the activity log could not be written (${describe(error)})`,
    })
  }

  return ok(record)
}

/* -------------------------------------------------------------------------- */
/* reading                                                                     */
/* -------------------------------------------------------------------------- */

function compare(left: { at: string; index: number }, right: { at: string; index: number }): number {
  const leftAt = Date.parse(left.at)
  const rightAt = Date.parse(right.at)
  if (leftAt !== rightAt) return rightAt - leftAt
  // Two records in the same millisecond: the later line is newer.
  return right.index - left.index
}

export function filterAndSort(
  lines: readonly string[],
  query: ActivityQuery,
  limit: number,
): { records: ActivityRecord[]; skipped: number } {
  const entries: { record: ActivityRecord; at: string; index: number }[] = []
  let skipped = 0

  lines.forEach((line, index) => {
    if (line.trim() === "") return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      return
    }
    const record = normalise(parsed)
    if (!record.ok) {
      skipped += 1
      return
    }
    if (query.kind !== undefined && record.value.kind !== query.kind) return
    if (query.project !== undefined && record.value.project !== query.project) return
    entries.push({ record: record.value, at: record.value.at, index })
  })

  entries.sort(compare)
  return { records: entries.slice(0, limit).map((entry) => entry.record), skipped }
}

/* -------------------------------------------------------------------------- */
/* log                                                                         */
/* -------------------------------------------------------------------------- */

function assertQuery(query: ActivityQuery | undefined): Result<ActivityQuery, ActivityError> {
  if (query === undefined) return ok({})
  if (query.kind !== undefined && !ACTIVITY_KINDS.includes(query.kind)) {
    return err({
      kind: "unknown-kind",
      value: query.kind,
      accepted: ACTIVITY_KINDS,
      message: `"${query.kind}" is not an activity kind; use one of ${ACTIVITY_KINDS.join(", ")}`,
    })
  }
  if (query.project !== undefined && (typeof query.project !== "string" || query.project === "")) {
    return err({ kind: "invalid-input", field: "project", message: "project must be a project id" })
  }
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 0) {
      return err({
        kind: "invalid-input",
        field: "limit",
        message: "limit must be a non-negative whole number",
      })
    }
  }
  return ok(query)
}

/**
 * Open the activity log for a workspace.
 *
 * The path comes from `workspace.data` (outside the root) and is checked: a log
 * inside the workspace would end up in exports and archives, so it is refused
 * rather than silently relocated.
 */
export function createActivityLog(
  workspace: Workspace,
  options: ActivityOptions = {},
): Result<ActivityLog, ActivityError> {
  const data = options.dataDir === undefined ? workspace.data : dataPaths(options.dataDir)
  const path = data.activity
  const defaultLimit = options.limit ?? DEFAULT_LIMIT

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    return err({
      kind: "invalid-input",
      field: "limit",
      message: "limit must be a positive whole number",
    })
  }

  if (isPathInside(workspace.paths.root, path)) {
    return err({
      kind: "log-inside-workspace",
      path,
      message:
        "the activity log must live outside the workspace, so it is never exported or archived",
    })
  }

  const log: ActivityLog = {
    path,

    async append(record) {
      const stored = normalise(record)
      if (!stored.ok) return stored
      return serialised(path, () => appendLine(path, stored.value))
    },

    async list(query) {
      const checked = assertQuery(query)
      if (!checked.ok) return checked

      const limit = checked.value.limit ?? defaultLimit
      let text: string
      try {
        text = await readFile(path, "utf8")
      } catch (error) {
        if (codeOf(error) === "ENOENT") {
          return ok({ path, records: [], skipped: 0, empty: true })
        }
        return err({
          kind: "storage",
          path,
          message: `the activity log could not be read (${describe(error)})`,
        })
      }

      const lines = text.split("\n")
      // A trailing newline produces a final empty entry; it is not a record.
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

      const { records, skipped } = filterAndSort(lines, checked.value, limit)
      return ok({ path, records, skipped, empty: text === "" })
    },

    async text() {
      try {
        return ok(await readFile(path, "utf8"))
      } catch (error) {
        if (codeOf(error) === "ENOENT") return ok("")
        return err({
          kind: "storage",
          path,
          message: `the activity log could not be read (${describe(error)})`,
        })
      }
    },
  }

  return ok(log)
}

/**
 * The sink `applyWrite`, `runCommand` and `runSwarm` accept.
 *
 * It never throws: a log failure must not turn a completed write into an error
 * the user could read as "nothing happened". The result is returned for callers
 * that want to surface it, and ignored by the services.
 */
export function activitySink(
  log: ActivityLog,
): (record: ActivityRecord) => Promise<Result<ActivityRecord, ActivityError>> {
  return (record) => log.append(record)
}

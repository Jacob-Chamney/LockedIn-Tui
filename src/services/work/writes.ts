/**
 * Write approval and atomic apply (WP-504).
 *
 * The rule this module exists to enforce is short: **a file changes only when a
 * person approved that exact change**, on top of the global opt-in and the
 * agent profile's permission (`docs/product.md` §8.2, `AGENTS.md` §2.9, §2.12,
 * §2.14).
 *
 * ```
 * settings.allowWrite  (global opt-in, Settings)
 * agent.allowWrite     (the profile that proposed it)
 * approval             (this write, this time)
 * ```
 *
 * Any one of them missing means nothing is written and the caller gets a typed
 * reason to show. There is no "apply all pending", no remembered approval and
 * no bypass for a trusted agent.
 *
 * The sequence for an accepted write is:
 *
 * 1. resolve the proposal's path again (a value can be old, or crafted);
 * 2. re-read and re-hash the file — a changed base is a conflict, not a merge;
 * 3. rebuild the result from the hunks and check it equals `newContent`, so the
 *    bytes written are the bytes the diff showed;
 * 4. write a temp file in the same directory, fsync, rename (`docs/data-model.md`
 *    §3), or `rm` for an approved delete.
 *
 * The activity event is emitted exactly once per decision. It carries metadata
 * only — path, decision, hunk indices — never a line of the file
 * (`docs/data-model.md` §6.3). WP-507 owns the writer; this module returns the
 * event and calls an optional sink.
 */

import { randomUUID } from "node:crypto"
import { open, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import { loadProjectMeta, type AgentError, type AgentProfile } from "./agents"
import {
  applyHunks,
  readCurrentFile,
  resolveWriteTarget,
  type ProposeError,
  type ProposedWrite,
} from "./diff"
import { assertProjectId, type WorkError } from "./register"

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

/** The global Settings opt-in. Off is the default everywhere. */
export type WriteSettings = {
  allowWrite: boolean
}

/**
 * The user's decision for one proposal.
 *
 * `hunks` absent means "approve all"; an explicit list applies only those hunk
 * indices. `reject` is always available and never needs the opt-in.
 */
export type WriteApproval =
  | { decision: "reject"; reason?: string }
  | { decision: "approve"; hunks?: readonly number[] }

/** One line in `activity.jsonl` (`docs/data-model.md` §6.3). Metadata only. */
export type WriteDecisionEvent = {
  kind: "write-decision"
  project: string
  path: string
  decision: "approve" | "reject"
  hunks: number[]
  at: string
}

export type WriteError =
  | ProposeError
  | {
      kind: "conflict"
      path: string
      reason: "base-hash" | "context"
      message: string
      /** Present when one hunk no longer matches. */
      hunk?: number
    }
  | {
      kind: "blocked"
      path: string
      reason: "opt-in-off" | "profile-disallowed"
      message: string
    }
  | { kind: "selection"; path: string; message: string }
  | WorkError
  /** A profile lookup failed (missing project, unreadable meta, bad agent). */
  | AgentError

export type WriteOutcome = {
  decision: "approve" | "reject"
  /** False only for a rejection; a blocked write is an error, not an outcome. */
  applied: boolean
  path: string
  hunks: number[]
  bytes: number
  event: WriteDecisionEvent
}

/** Test seam for the crash simulation; never used by production callers. */
export type WriteHooks = {
  /** Called after the temp file is written and synced, before the rename. */
  beforeRename?: (temporary: string, destination: string) => Promise<void> | void
}

/* -------------------------------------------------------------------------- */
/* atomic file replace                                                         */
/* -------------------------------------------------------------------------- */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

/**
 * Temp file in the destination directory → fsync → rename (`docs/data-model.md`
 * §3). A failure at any point, including inside the injected hook, leaves the
 * destination either as it was or fully replaced — never half-written.
 *
 * The destination's permission bits are copied onto the temp file, so replacing
 * an executable script does not silently drop its `+x`.
 */
export async function writeFileAtomic(
  destination: string,
  content: string,
  hooks: WriteHooks = {},
): Promise<Result<{ bytes: number }, WriteError>> {
  const directory = dirname(destination)
  const temporary = join(directory, `.${basename(destination)}.tmp-${randomUUID()}`)
  const existing = await stat(destination).catch(() => null)
  const mode = existing ? existing.mode & 0o777 : 0o644
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temporary, "w", mode)
    const payload = Buffer.from(content, "utf8")
    await handle.writeFile(payload)
    await handle.sync()
    await handle.close()
    handle = undefined
    if (hooks.beforeRename) await hooks.beforeRename(temporary, destination)
    await rename(temporary, destination)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // A close failure is not more interesting than the write failure.
    }
    await rm(temporary, { force: true }).catch(() => {})
    return err({
      kind: "storage",
      path: destination,
      message: `the file could not be written (${messageOf(error)})`,
    })
  }

  try {
    const directoryHandle = await open(directory, "r")
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch {
    // Directory fsync is unsupported on some filesystems; the rename landed.
  }

  return ok({ bytes: Buffer.byteLength(content, "utf8") })
}

/* -------------------------------------------------------------------------- */
/* approval                                                                    */
/* -------------------------------------------------------------------------- */

export type ApplyWriteInput = {
  workspace: Workspace
  projectId: string
  proposal: ProposedWrite
  /** The profile that proposed the write. A swarm copy always has `false`. */
  agent: AgentProfile
  settings: WriteSettings
  approval: WriteApproval
  /** WP-507's writer. A failing sink never undoes a completed write. */
  onActivity?: (event: WriteDecisionEvent) => void | Promise<void>
  hooks?: WriteHooks
}

function eventFor(
  project: string,
  path: string,
  decision: "approve" | "reject",
  hunks: number[],
): WriteDecisionEvent {
  return {
    kind: "write-decision",
    project,
    path,
    decision,
    hunks,
    at: new Date().toISOString(),
  }
}

async function emit(
  sink: ApplyWriteInput["onActivity"],
  event: WriteDecisionEvent,
): Promise<void> {
  if (!sink) return
  try {
    await sink(event)
  } catch {
    // The decision is already on disk; a log failure must not turn it into an
    // error the user could read as "nothing happened".
  }
}

/**
 * Approve or reject one proposal.
 *
 * Order matters: confinement first (even a rejection must name a real file),
 * then the rejection path, then the two permission gates, then the hash check,
 * then the write. Nothing touches the disk before step 4.
 */
export async function applyWrite(
  input: ApplyWriteInput,
): Promise<Result<WriteOutcome, WriteError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project

  const meta = await loadProjectMeta(input.workspace, project.value)
  if (!meta.ok) return meta

  const target = await resolveWriteTarget(meta.value.root, input.proposal.path)
  if (!target.ok) return target

  const relativePath = target.value.relative

  if (input.approval.decision === "reject") {
    const event = eventFor(meta.value.id, relativePath, "reject", [])
    await emit(input.onActivity, event)
    return ok({
      decision: "reject",
      applied: false,
      path: relativePath,
      hunks: [],
      bytes: 0,
      event,
    })
  }

  if (input.settings.allowWrite !== true) {
    return err({
      kind: "blocked",
      path: relativePath,
      reason: "opt-in-off",
      message:
        "writes are off in Settings, so this was not applied; turn on “allow project writes” and approve it again",
    })
  }
  if (input.agent.allowWrite !== true) {
    return err({
      kind: "blocked",
      path: relativePath,
      reason: "profile-disallowed",
      message: `the agent “${input.agent.name}” is not allowed to write; give it permission in its profile first`,
    })
  }

  const current = await readCurrentFile(target.value)
  if (!current.ok) return current

  if (input.proposal.baseHash === null) {
    if (current.value) {
      return err({
        kind: "conflict",
        path: relativePath,
        reason: "base-hash",
        message: `"${relativePath}" already exists; nothing was written. Re-read the folder and propose again.`,
      })
    }
  } else if (!current.value || current.value.hash !== input.proposal.baseHash) {
    return err({
      kind: "conflict",
      path: relativePath,
      reason: "base-hash",
      message: `"${relativePath}" changed after this proposal was made; nothing was written. Re-read the file and propose again.`,
    })
  }

  const baseText = current.value?.text ?? ""
  const allIndices = input.proposal.hunks.map((hunk) => hunk.index)

  // Integrity: the hunks must reproduce `newContent`. A proposal whose diff and
  // content disagree would apply bytes the user never saw.
  const whole = applyHunks(baseText, input.proposal.hunks, allIndices)
  if (!whole.ok) {
    return err({
      kind: "conflict",
      path: relativePath,
      reason: "context",
      message: `this proposal no longer applies: ${whole.error.message}`,
      hunk: whole.error.index,
    })
  }
  if (whole.value !== (input.proposal.newContent ?? "")) {
    return err({
      kind: "conflict",
      path: relativePath,
      reason: "context",
      message:
        "this proposal does not match its own diff; nothing was written. Propose the change again.",
    })
  }

  let chosen: number[]
  if (input.approval.hunks === undefined) {
    chosen = [...allIndices]
  } else {
    chosen = [...new Set(input.approval.hunks)].sort((left, right) => left - right)
    if (chosen.length === 0) {
      return err({
        kind: "selection",
        path: relativePath,
        message: "no hunks were selected, so there is nothing to apply",
      })
    }
    const known = new Set(allIndices)
    const unknown = chosen.find((index) => !known.has(index))
    if (unknown !== undefined) {
      return err({
        kind: "selection",
        path: relativePath,
        message: `there is no hunk ${unknown} in this proposal`,
      })
    }
  }

  if (input.proposal.newContent === null && chosen.length !== allIndices.length) {
    return err({
      kind: "selection",
      path: relativePath,
      message: "a delete is approved as a whole; it cannot be applied hunk by hunk",
    })
  }

  const applied = applyHunks(baseText, input.proposal.hunks, chosen)
  if (!applied.ok) {
    return err({
      kind: "conflict",
      path: relativePath,
      reason: "context",
      message: `this proposal no longer applies: ${applied.error.message}`,
      hunk: applied.error.index,
    })
  }

  let bytes = 0
  if (input.proposal.newContent === null) {
    try {
      await rm(target.value.absolute)
    } catch (error) {
      if (codeOf(error) === "ENOENT") {
        return err({
          kind: "conflict",
          path: relativePath,
          reason: "base-hash",
          message: `"${relativePath}" was removed after this proposal was made; nothing was deleted.`,
        })
      }
      return err({
        kind: "storage",
        path: relativePath,
        message: `the file could not be deleted (${messageOf(error)})`,
      })
    }
  } else {
    const written = await writeFileAtomic(target.value.absolute, applied.value, input.hooks)
    if (!written.ok) return written
    bytes = written.value.bytes
  }

  const event = eventFor(meta.value.id, relativePath, "approve", chosen)
  await emit(input.onActivity, event)
  return ok({
    decision: "approve",
    applied: true,
    path: relativePath,
    hunks: chosen,
    bytes,
    event,
  })
}

/**
 * Changes — the read-only git summary for a registered project (WP-507).
 *
 * The panel answers "what changed?" and nothing else. It never stages, never
 * commits, never checks out, and never refreshes the index as a side effect
 * (`docs/product.md` §8.5). Two consequences shape this module:
 *
 * - **The git CLI, with a fixed argument list.** No shell string, no
 *   user-supplied argument, no `-c` from user input. Every argv here is a
 *   literal in this file, so a file name in a project cannot become a command.
 * - **Porcelain parsing, not screen-scraping.** `status --porcelain=v1 -z` and
 *   `diff --numstat -z` are machine formats; they stay stable across locales and
 *   versions, and `-z` removes quoting and ambiguity for odd file names.
 *
 * Byte-identity is protected two ways: every git call runs with
 * `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0`, so git may not take the
 * index lock and rewrite it behind the user's back (`git status` does that by
 * default, just to cache stat information).
 *
 * Degrading is deliberate. A folder that is not a repository, or a machine
 * without `git`, is **not** an error: it returns `available: false` with a
 * reason, the panel says why, and the rest of Work keeps working. A git command
 * that actually fails on a real repository is a typed `storage` error naming the
 * command and the first line of stderr, because that is a bug or a broken
 * checkout and hiding it would be worse than showing it.
 */

import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { loadProjectMeta, type AgentError } from "./agents"
import { safeEnvironment } from "./commands"
import { assertProjectId } from "./register"

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One file's kind of change. A file can be both staged and unstaged at once
 * (`MM`); `status` reports the strongest fact and the two flags say where it
 * lives.
 */
export type ChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "conflicted"

export type ChangeFile = {
  /** Repository-relative, `/`-separated, exactly as git reports it. */
  path: string
  status: ChangeStatus
  /** Lines added by the staged plus unstaged change. `0` for binary files. */
  added: number
  /** Lines removed by the staged plus unstaged change. `0` for binary files. */
  removed: number
  /** At least part of this change is in the index. */
  staged: boolean
  /** At least part of this change is only in the working tree. */
  unstaged: boolean
}

/** Why there is nothing to show. Each is a sentence the panel can print. */
export type ChangesUnavailable =
  | "not a git repository"
  | "git not found"
  | "missing folder"

export type ChangeSummary =
  | {
      available: true
      branch: string
      /** True when HEAD is not on a branch; `branch` is then a short sha. */
      detached: boolean
      dirty: boolean
      /** Files with something in the index. */
      staged: number
      /** Files with something only in the working tree. */
      unstaged: number
      /** Sorted by path, so two runs over one tree agree. */
      files: ChangeFile[]
    }
  | {
      available: false
      reason: ChangesUnavailable
      message: string
    }

export type ChangesError = AgentError

/* -------------------------------------------------------------------------- */
/* git invocation                                                              */
/* -------------------------------------------------------------------------- */

/** The empty tree, for a repository that has no commit yet. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const DEFAULT_TIMEOUT_MS = 15_000

/** Untracked files are counted by reading them; past this size they count 0. */
const MAX_UNTRACKED_BYTES = 4 * 1024 * 1024

export type GitOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "missing" }
  | { kind: "failed"; argv: string[]; exitCode: number | null; stderr: string }

/** Test seam: lets a test prove the failure path without a broken machine. */
export type GitRunner = (args: readonly string[]) => Promise<GitOutcome>

export type ChangesInput = {
  workspace: Workspace
  projectId: string
  /** Resolve a different `git`. Defaults to `git` on `PATH`. */
  gitPath?: string
  /** Replace the CLI entirely; used by tests only. */
  runGit?: GitRunner
  timeoutMs?: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

/** First non-empty line of stderr — the part a person needs, not the whole dump. */
function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed !== "") return trimmed
  }
  return ""
}

/**
 * `git --no-optional-locks -C <root> <fixed args>`.
 *
 * The command is spawned with an argv array: there is no shell, so a path or a
 * branch name can never be re-interpreted as syntax. `-C <root>` keeps the
 * repository choice fixed to the registered project root instead of whatever
 * directory the app happens to be in.
 */
function cliRunner(options: {
  gitPath: string
  root: string
  env: Record<string, string | undefined>
  timeoutMs: number
}): GitRunner {
  const { gitPath, root, env, timeoutMs } = options

  return async (args) => {
    const cmd = [gitPath, "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args]
    let process: Bun.Subprocess<"ignore", "pipe", "pipe">
    try {
      process = Bun.spawn({
        cmd,
        cwd: root,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      if (codeOf(error) === "ENOENT") return { kind: "missing" }
      return {
        kind: "failed",
        argv: [...args],
        exitCode: null,
        stderr: messageOf(error),
      }
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      process.kill()
    }, timeoutMs)

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ])
      if (timedOut) {
        return {
          kind: "failed",
          argv: [...args],
          exitCode: null,
          stderr: `timed out after ${timeoutMs} ms`,
        }
      }
      if (exitCode !== 0) {
        return { kind: "failed", argv: [...args], exitCode, stderr }
      }
      return { kind: "ok", stdout }
    } catch (error) {
      return {
        kind: "failed",
        argv: [...args],
        exitCode: null,
        stderr: messageOf(error),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * One failing command becomes one message: the command that failed and the
 * first line of stderr. Nothing is retried.
 */
function gitFailure(outcome: Extract<GitOutcome, { kind: "failed" }>, root: string) {
  const command = `git ${outcome.argv.join(" ")}`
  const detail = firstLine(outcome.stderr) || "no output"
  return err<ChangesError>({
    kind: "storage",
    path: root,
    message: `${command} failed (${detail})`,
  })
}

/* -------------------------------------------------------------------------- */
/* parsing                                                                     */
/* -------------------------------------------------------------------------- */

type StatusEntry = {
  x: string
  y: string
  path: string
  from?: string
}

/** `status --porcelain=v1 -z`: `XY <new path>\0<old path>\0` for renames. */
export function parseStatus(stdout: string): StatusEntry[] {
  const fields = stdout.split("\0")
  const entries: StatusEntry[] = []

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    if (field === undefined || field === "") continue
    if (field.length < 4) continue
    const x = field[0] ?? " "
    const y = field[1] ?? " "
    const path = field.slice(3)
    let from: string | undefined
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const previous = fields[index + 1]
      if (previous !== undefined && previous !== "") {
        from = previous
        index += 1
      }
    }
    entries.push({ x, y, path, ...(from === undefined ? {} : { from }) })
  }

  return entries
}

/**
 * `diff --numstat -z`: `added\tremoved\t<path>\0`, and for a rename
 * `added\tremoved\t\0<old>\0<new>\0`. `-` marks a binary file.
 */
export function parseNumstat(stdout: string, into: Map<string, { added: number; removed: number }>) {
  const fields = stdout.split("\0")

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    if (field === undefined || field === "") continue
    const parts = field.split("\t")
    if (parts.length < 3) continue

    const addedText = parts[0] ?? "-"
    const removedText = parts[1] ?? "-"
    let path = parts[2] ?? ""

    if (path === "") {
      // A rename or copy carries the old and the new name as separate fields.
      index += 2
      path = fields[index] ?? ""
    }
    if (path === "") continue

    const added = addedText === "-" ? 0 : Number.parseInt(addedText, 10)
    const removed = removedText === "-" ? 0 : Number.parseInt(removedText, 10)
    const previous = into.get(path)
    into.set(path, {
      added: (previous?.added ?? 0) + (Number.isFinite(added) ? added : 0),
      removed: (previous?.removed ?? 0) + (Number.isFinite(removed) ? removed : 0),
    })
  }

  return into
}

/**
 * Collapse the two status letters into one word.
 *
 * Precedence is chosen so the most consequential fact wins: a conflict is not
 * "modified", a rename is not "added + deleted", and a deletion is not
 * "modified".
 */
export function statusOf(x: string, y: string): ChangeStatus {
  if (x === "?") return "untracked"
  const both = `${x}${y}`
  if (both.includes("U") || both === "AA" || both === "DD") return "conflicted"
  if (both.includes("R")) return "renamed"
  if (both.includes("C")) return "copied"
  if (both.includes("D")) return "deleted"
  if (both.includes("A")) return "added"
  if (both.includes("T")) return "typechange"
  return "modified"
}

/** Lines in a text file, counted the way `git diff --numstat` counts them. */
export function countLines(text: string): number {
  if (text === "") return 0
  let newlines = 0
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) newlines += 1
  }
  return text.endsWith("\n") ? newlines : newlines + 1
}

/**
 * An untracked file has no `numstat` row, so it is counted by reading it.
 *
 * The path comes from git, not from the user, but it is still a path from disk:
 * a repository can contain a symlink to anywhere, and following one would read
 * a file outside the project (or a special file that never ends). Symlinks are
 * therefore refused outright, and the resolved path must stay inside the
 * project root once more after `realpath`.
 */
async function untrackedLines(root: string, path: string): Promise<number> {
  const absolute = join(root, path)
  try {
    const link = await lstat(absolute)
    if (link.isSymbolicLink() || !link.isFile()) return 0
    if (link.size === 0) return 0
    if (link.size > MAX_UNTRACKED_BYTES) return 0
    const real = await realpath(absolute)
    if (!isPathInside(root, real)) return 0
    const bytes = await readFile(real)
    if (bytes.includes(0)) return 0 // binary: same "no line count" git reports
    return countLines(bytes.toString("utf8"))
  } catch {
    return 0
  }
}

/* -------------------------------------------------------------------------- */
/* summary                                                                     */
/* -------------------------------------------------------------------------- */

function unavailable(reason: ChangesUnavailable, message: string): ChangeSummary {
  return { available: false, reason, message }
}

/**
 * Read the summary for a registered project. Nothing is written, and no git
 * command in this function can modify the repository.
 */
export async function changes(
  input: ChangesInput,
): Promise<Result<ChangeSummary, ChangesError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project

  const meta = await loadProjectMeta(input.workspace, project.value)
  if (!meta.ok) return meta

  const root = meta.value.root

  const folder = await stat(root).catch(() => null)
  if (!folder || !folder.isDirectory()) {
    return ok(
      unavailable(
        "missing folder",
        `the folder for “${meta.value.name}” is not here any more (${root}); reconnect it or remove the project`,
      ),
    )
  }

  const run =
    input.runGit ??
    cliRunner({
      gitPath: input.gitPath ?? "git",
      root,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: {
        // Git is a child process like any other: do not hand it API keys or
        // tokens that happen to be exported in the app's environment.
        ...safeEnvironment(),
        // Belt and braces beside `--no-optional-locks`: no index refresh write.
        GIT_OPTIONAL_LOCKS: "0",
        // Never open an editor, never prompt, never page.
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_ASKPASS: "",
        LC_ALL: "C",
      },
    })

  // 1. Is this folder the root of a repository? The probe is the only call whose
  //    failure is a *state* rather than an error.
  const top = await run(["rev-parse", "--show-toplevel"])
  if (top.kind === "missing") {
    return ok(
      unavailable(
        "git not found",
        "git is not installed or not on PATH, so changes cannot be listed; the rest of Work still works",
      ),
    )
  }
  if (top.kind === "failed") {
    if (/not a git repository/i.test(top.stderr)) {
      return ok(
        unavailable(
          "not a git repository",
          `“${meta.value.name}” is not a git repository, so there are no changes to show`,
        ),
      )
    }
    return gitFailure(top, root)
  }

  const [topLevel, topRoot] = await Promise.all([
    realpath(top.stdout.trim()).catch(() => top.stdout.trim()),
    realpath(root).catch(() => root),
  ])
  if (topLevel !== topRoot) {
    return ok(
      unavailable(
        "not a git repository",
        `“${meta.value.name}” sits inside another repository (${topLevel}); changes are only listed for a project that is its own repository root`,
      ),
    )
  }

  // 2. Branch, or a short sha when HEAD is detached.
  const symbolic = await run(["symbolic-ref", "--short", "-q", "HEAD"])
  let branch = ""
  let detached = false
  if (symbolic.kind === "missing") {
    return ok(
      unavailable("git not found", "git disappeared while listing changes; install it and try again"),
    )
  }
  if (symbolic.kind === "ok" && symbolic.stdout.trim() !== "") {
    branch = symbolic.stdout.trim()
  } else {
    const sha = await run(["rev-parse", "--short", "HEAD"])
    if (sha.kind === "failed" || sha.kind === "missing") {
      // An unborn branch (a repository with no commit yet) has no sha.
      branch = ""
    } else {
      branch = sha.stdout.trim()
      detached = branch !== ""
    }
  }

  // 3. Which files changed, and where.
  const status = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  if (status.kind === "missing") {
    return ok(
      unavailable("git not found", "git disappeared while listing changes; install it and try again"),
    )
  }
  if (status.kind === "failed") return gitFailure(status, root)

  const entries = parseStatus(status.stdout)

  // 4. Line counts. Staged and unstaged are summed per path, because the panel
  //    shows one row per file. A repository with no commit diffs against the
  //    empty tree.
  const head = await run(["rev-parse", "--verify", "--quiet", "HEAD"])
  const base = head.kind === "ok" && head.stdout.trim() !== "" ? ["HEAD"] : [EMPTY_TREE]

  const numbers = new Map<string, { added: number; removed: number }>()
  const stagedDiff = await run([
    "diff",
    "--cached",
    "--numstat",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    ...base,
  ])
  if (stagedDiff.kind === "missing") {
    return ok(
      unavailable("git not found", "git disappeared while listing changes; install it and try again"),
    )
  }
  if (stagedDiff.kind === "failed") return gitFailure(stagedDiff, root)
  parseNumstat(stagedDiff.stdout, numbers)

  const worktreeDiff = await run([
    "diff",
    "--numstat",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
  ])
  if (worktreeDiff.kind === "missing") {
    return ok(
      unavailable("git not found", "git disappeared while listing changes; install it and try again"),
    )
  }
  if (worktreeDiff.kind === "failed") return gitFailure(worktreeDiff, root)
  parseNumstat(worktreeDiff.stdout, numbers)

  // 5. Build one row per path, in a stable order.
  const files: ChangeFile[] = []
  for (const entry of entries.sort((left, right) => (left.path < right.path ? -1 : 1))) {
    const counts = numbers.get(entry.path)
    const untracked = entry.x === "?"
    const added = untracked ? await untrackedLines(root, entry.path) : (counts?.added ?? 0)
    files.push({
      path: entry.path,
      status: statusOf(entry.x, entry.y),
      added,
      removed: untracked ? 0 : (counts?.removed ?? 0),
      staged: entry.x !== " " && entry.x !== "?" && entry.x !== "!",
      unstaged: entry.x === "?" || (entry.y !== " " && entry.y !== "?" && entry.y !== "!"),
    })
  }

  return ok({
    available: true,
    branch,
    detached,
    dirty: files.length > 0,
    staged: files.filter((file) => file.staged).length,
    unstaged: files.filter((file) => file.unstaged).length,
    files,
  })
}

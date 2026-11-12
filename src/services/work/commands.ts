/**
 * Command approval and shell-free execution (WP-505).
 *
 * The rule this module exists to enforce is short: **a process starts only when
 * a person approved that exact argv**, on top of the global opt-in and the
 * agent profile's permission (`docs/product.md` §8.2, `AGENTS.md` §2.12,
 * `docs/architecture.md` §9, `docs/testing.md` §6).
 *
 * ```
 * settings.allowCommand  (global opt-in, Settings)
 * agent.allowCommand     (the profile that wants to run it)
 * approval               (this command, this once)
 * ```
 *
 * There is no shell anywhere in this file. A command is an **argv array**, and
 * the process is spawned with that array: the OS receives the arguments as data,
 * so `;`, `|`, `$(…)` and `>` in a token are inert. We still refuse them, because
 * a token carrying shell syntax means the model is reasoning about a command
 * *line*, and approving it would teach the wrong mental model. The refusal names
 * the offending token, which is the one thing a user can act on.
 *
 * The activity event is emitted exactly once per decision and carries argv, cwd,
 * exit code, duration and the timeout flag — never a byte of stdout/stderr
 * (`docs/data-model.md` §6.3). WP-507 owns the writer; this module returns the
 * event and calls an optional sink.
 */

import { realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"
import { loadProjectMeta, type AgentError, type AgentProfile } from "./agents"
import type { ProposeError } from "./diff"
import { assertProjectId, type WorkError } from "./register"
import type { ToolSpec } from "../../llm/tools"

/* -------------------------------------------------------------------------- */
/* constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The only command tool a project chat can ever be offered. */
export const COMMAND_TOOL_NAME = "run_command"

/** Per-stream capture cap (`docs/product.md` §8.2). */
export const STREAM_CAP_BYTES = 64 * 1024

/** Fixed, shown on every approval: a process is not confined to the project. */
export const COMMAND_RISK =
  "This process can read and write outside the project and can reach the network."

/** A command that outlives this is killed; partial output is kept. */
export const COMMAND_TIMEOUT_MS = 120_000

export const COMMAND_TRUNCATION_MARKER = "\n… [truncated at 64 KiB]"

/**
 * Executables that interpret the next argument as a command string. `sh -c ls`
 * is a command string with extra steps, so it never reaches approval.
 */
const SHELL_EXECUTABLES: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "ksh",
  "mksh",
  "ash",
  "fish",
  "csh",
  "tcsh",
  "busybox",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
])

/**
 * Environment names never forwarded. The app's own secrets live in the OS
 * keychain, so this is belt-and-braces: a key that leaked into the environment
 * of the app process must not leak into a child the user just approved.
 */
const SECRET_NAME =
  /(API_?KEY|ACCESS_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY)/i

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

/** The global Settings opt-in. Off is the default everywhere. */
export type CommandSettings = {
  allowCommand: boolean
}

/**
 * A command as proposed to the user (`swarm/contracts.md` §4.4).
 *
 * `cwd` is relative to the project root, like every other tool argument. `risk`
 * is a fixed sentence rather than model text, so the approval cannot be talked
 * out of its warning.
 */
export type ProposedCommand = {
  argv: string[]
  cwd: string
  reason: string
  risk: string
}

/** The user's decision for one proposal. There is no "remember this". */
export type CommandApproval = { decision: "approve" } | { decision: "deny"; reason?: string }

/** One line in `activity.jsonl` (`docs/data-model.md` §6.3). Metadata only. */
export type CommandDecisionEvent = {
  kind: "command-decision"
  project: string
  argv: string[]
  /** Relative to the project root; `"."` is the root itself. */
  cwd: string
  decision: "approve" | "deny"
  /** `null` when nothing ran (deny, refusal, spawn failure). */
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  at: string
}

export type ArgvError =
  | { kind: "argv-shape"; message: string }
  | {
      kind: "argv-token"
      token: string
      index: number
      reason: "metacharacter" | "shell-flag" | "control"
      message: string
    }

export type CommandBlocked = {
  kind: "blocked"
  reason: "opt-in-off" | "profile-disallowed"
  message: string
}

export type CommandError =
  | ArgvError
  | ProposeError
  | CommandBlocked
  | {
      kind: "timeout"
      argv: string[]
      cwd: string
      timeoutMs: number
      exitCode: number | null
      durationMs: number
      stdout: string
      stderr: string
      truncated: boolean
      event: CommandDecisionEvent
      message: string
    }
  | { kind: "spawn"; argv: string[]; message: string }
  | WorkError
  | AgentError

export type CommandOutcome = {
  decision: "approve" | "deny"
  argv: string[]
  cwd: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  event: CommandDecisionEvent
}

/** What the executor needs from a spawned process. Faked in tests. */
export type CommandProcess = {
  stdout: AsyncIterable<Uint8Array>
  stderr: AsyncIterable<Uint8Array>
  exited: Promise<number>
  /** SIGTERM by default; the timeout escalates to SIGKILL. */
  kill(signal?: "SIGTERM" | "SIGKILL"): void
}

export type CommandSpawn = (
  argv: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
) => CommandProcess

export type CommandHooks = {
  /** Test seam: it must never be called for a refusal or a denial. */
  spawn?: CommandSpawn
}

export type RunCommandInput = {
  workspace: Workspace
  projectId: string
  command: ProposedCommand
  /** The profile that proposed it. A swarm copy always has `false`. */
  agent: AgentProfile
  settings: CommandSettings
  approval: CommandApproval
  /** WP-507's writer. A failing sink never changes what was executed. */
  onActivity?: (event: CommandDecisionEvent) => void | Promise<void>
  hooks?: CommandHooks
  limits?: { timeoutMs?: number; stdoutCap?: number; stderrCap?: number }
}

/* -------------------------------------------------------------------------- */
/* argv validation                                                             */
/* -------------------------------------------------------------------------- */

function shapeError(message: string): ArgvError {
  return { kind: "argv-shape", message }
}

function tokenError(
  token: string,
  index: number,
  reason: "metacharacter" | "shell-flag" | "control",
  detail: string,
): ArgvError {
  return {
    kind: "argv-token",
    token,
    index,
    reason,
    message: `the argument ${JSON.stringify(token)} ${detail}; commands are argv arrays, not shell lines`,
  }
}

/** The shell syntax we refuse, most specific first so the message is useful. */
const METACHARACTERS: readonly string[] = ["&&", "||", "$", "`", "|", ";", ">", "<", "&", "*", "?"]

/**
 * Validate an argv array.
 *
 * `unknown` on purpose: a model can send a string, numbers, or an object, and a
 * bad shape must be a typed refusal rather than a crash. Nothing here touches
 * the disk or a process.
 */
export function validateArgv(raw: unknown): Result<string[], ArgvError> {
  if (typeof raw === "string") {
    return err(
      shapeError(
        "a command is an argv array, not a string: pass [\"program\", \"arg\", …] so no shell is involved",
      ),
    )
  }
  if (!Array.isArray(raw)) {
    return err(shapeError("a command is an argv array: [\"program\", \"arg\", …]"))
  }
  if (raw.length === 0) {
    return err(shapeError("a command needs at least a program name"))
  }

  const argv: string[] = []
  for (const [index, value] of raw.entries()) {
    if (typeof value !== "string") {
      return err(shapeError(`argument ${index} is not text`))
    }
    if (index === 0 && value.trim() === "") {
      return err(shapeError("the program name cannot be empty"))
    }
    argv.push(value)
  }

  for (const [index, token] of argv.entries()) {
    if (/[\u0000\r\n]/.test(token)) {
      return err(tokenError(token, index, "control", "contains a control character or a newline"))
    }
    for (const character of METACHARACTERS) {
      if (token.includes(character)) {
        return err(tokenError(token, index, "metacharacter", `contains ${JSON.stringify(character)}`))
      }
    }
    // A glob the shell would expand: `[` only matters as a bracket expression.
    if (/\[[^\]]*\]/.test(token)) {
      return err(tokenError(token, index, "metacharacter", "contains a glob pattern"))
    }
  }

  // A shell can also be the second word: `env bash -c …`, `nohup sh -c …`.
  // Scanning every token closes the wrapper bypass, not just `argv[0]`.
  for (const [at, token] of argv.entries()) {
    const executable = basename(token).toLowerCase()
    if (!SHELL_EXECUTABLES.has(executable)) continue
    for (let index = at + 1; index < argv.length; index++) {
      const flag = argv[index]!
      const runsString =
        /^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag) ||
        flag.toLowerCase() === "--command" ||
        flag.toLowerCase() === "-command" ||
        /^\/[ck]$/i.test(flag)
      if (runsString) {
        return err(
          tokenError(flag, index, "shell-flag", `asks ${executable} to run a command string`),
        )
      }
    }
  }

  return ok(argv)
}

/* -------------------------------------------------------------------------- */
/* cwd confinement                                                             */
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
 * Resolve `cwd` inside the project root.
 *
 * `resolveWriteTarget` is the write resolver and insists on a regular file, so
 * a folder cannot go through it. This is the same confinement algorithm as
 * `scope.ts` — refuse absolute names, refuse `..` as a shape, resolve the real
 * path and compare it with the real root — applied to a directory that must
 * already exist. One rule, two call sites; neither accepts an absolute path.
 */
export async function resolveCommandCwd(
  root: string,
  cwd: string,
): Promise<Result<string, ProposeError>> {
  const requested = cwd.trim() === "" ? "." : cwd.trim()

  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err({
        kind: "path",
        path: root,
        reason: "missing",
        message: `“${root}” is not on disk any more`,
      })
    }
    return err({ kind: "storage", path: root, message: messageOf(error) })
  }

  if (requested.includes("\u0000")) {
    return err({ kind: "path", path: requested, reason: "escape", message: "a path cannot contain a null byte" })
  }
  if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) {
    return err({
      kind: "path",
      path: requested,
      reason: "escape",
      message: `"${requested}" is absolute; the working directory is relative to the project root`,
    })
  }
  for (const segment of requested.split(/[\\/]/)) {
    if (segment === "..") {
      return err({
        kind: "path",
        path: requested,
        reason: "escape",
        message: `"${requested}" climbs out of the project root`,
      })
    }
  }

  const target = resolve(rootReal, requested)
  if (!isPathInside(rootReal, target)) {
    return err({
      kind: "path",
      path: requested,
      reason: "escape",
      message: `"${requested}" climbs out of the project root`,
    })
  }

  let real: string
  try {
    real = await realpath(target)
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err({
        kind: "path",
        path: requested,
        reason: "missing",
        message: `the working directory "${requested}" does not exist in this project`,
      })
    }
    return err({ kind: "storage", path: requested, message: messageOf(error) })
  }

  if (!isPathInside(rootReal, real)) {
    return err({
      kind: "path",
      path: requested,
      reason: "symlink",
      message: `"${requested}" is a symlink leading outside the project root`,
    })
  }

  const info = await stat(real).catch(() => null)
  if (!info || !info.isDirectory()) {
    return err({
      kind: "unsupported",
      path: requested,
      message: `the working directory "${requested}" is not a folder`,
    })
  }
  return ok(real)
}

function relativeToRoot(root: string, absolute: string): string {
  const path = relative(root, absolute)
  return path === "" ? "." : path.split(sep).join("/")
}

/* -------------------------------------------------------------------------- */
/* availability                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Both gates, in one place: the global opt-in **and** the profile's permission.
 * A swarm worker is a `forSwarm()` copy with `allowCommand: false`, so it can
 * never pass this check even when the profile it came from could.
 */
export function commandAvailable(input: {
  settings: CommandSettings
  agent: Pick<AgentProfile, "name" | "allowCommand">
}): Result<void, CommandBlocked> {
  if (input.settings.allowCommand !== true) {
    return err({
      kind: "blocked",
      reason: "opt-in-off",
      message:
        "commands are off in Settings, so no process was started; turn on “allow project commands” and approve again",
    })
  }
  if (input.agent.allowCommand !== true) {
    return err({
      kind: "blocked",
      reason: "profile-disallowed",
      message: `the agent “${input.agent.name}” is not allowed to run commands; give it permission in its profile first`,
    })
  }
  return ok(undefined)
}

/**
 * The command tool, offered only when both gates are open.
 *
 * Returning `[]` rather than a disabled tool is deliberate: a tool the model
 * cannot use must not appear in the list it chooses from
 * (`docs/product.md` §8.2 "Shell execution is unavailable by default").
 */
export function commandToolSpecs(input: {
  settings: CommandSettings
  agent: Pick<AgentProfile, "name" | "allowCommand">
}): ToolSpec[] {
  if (!commandAvailable(input).ok) return []
  return [
    {
      name: COMMAND_TOOL_NAME,
      description:
        "Propose one command for the user to approve. Arguments are an array; no shell, no pipes, no redirects. Nothing runs until the user approves it.",
      inputSchema: {
        type: "object",
        properties: {
          argv: {
            type: "array",
            items: { type: "string" },
            description: "The program and its arguments, e.g. [\"git\", \"status\", \"--short\"].",
            minItems: 1,
          },
          cwd: {
            type: "string",
            description: "Working directory relative to the project root; empty means the root.",
          },
          reason: {
            type: "string",
            description: "One sentence on why this command is needed.",
          },
        },
        required: ["argv"],
        additionalProperties: false,
      },
      side: "work",
      write: false,
      command: true,
    },
  ]
}

/** Build the value the UI reviews. `risk` is fixed, never model text. */
export function proposeCommand(input: { argv: string[]; cwd?: string; reason?: string }): ProposedCommand {
  return {
    argv: [...input.argv],
    cwd: input.cwd ?? "",
    reason: input.reason ?? "",
    risk: COMMAND_RISK,
  }
}

/* -------------------------------------------------------------------------- */
/* environment                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The child's environment: inherited, minus anything that looks like a secret.
 * The app never injects a keychain value; this only stops an already-exported
 * key from riding along into an approved command.
 */
export function safeEnvironment(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (SECRET_NAME.test(name)) continue
    env[name] = value
  }
  return env
}

/* -------------------------------------------------------------------------- */
/* execution                                                                   */
/* -------------------------------------------------------------------------- */

const defaultSpawn: CommandSpawn = (argv, options) => {
  const spawned = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Its own process group, so a timeout reaches descendants that inherited
    // stdout and would otherwise keep the pipe (and this call) open forever.
    // Windows has no process groups here; the parent kill is the fallback.
    detached: process.platform !== "win32",
  })
  return {
    stdout: spawned.stdout as AsyncIterable<Uint8Array>,
    stderr: spawned.stderr as AsyncIterable<Uint8Array>,
    exited: spawned.exited,
    kill: (signal = "SIGTERM") => {
      try {
        spawned.kill(signal)
      } catch {
        // Already gone.
      }
      try {
        // Negative pid = the whole process group on POSIX.
        process.kill(-spawned.pid, signal)
      } catch {
        // No process group (or the platform refused); the parent kill stands.
      }
    },
  }
}

type Captured = { text: string; truncated: boolean; bytes: number }

/**
 * Read one stream up to `cap`, draining the rest without keeping it. Draining
 * matters: a child blocked on a full pipe would otherwise never exit and the
 * timeout would look like a hang.
 */
async function readCapped(stream: AsyncIterable<Uint8Array>, cap: number): Promise<Captured> {
  const kept: Buffer[] = []
  let keptBytes = 0
  let total = 0

  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk)
    total += bytes.byteLength
    if (keptBytes >= cap) continue
    const slice = bytes.byteLength <= cap - keptBytes ? bytes : bytes.subarray(0, cap - keptBytes)
    kept.push(slice)
    keptBytes += slice.byteLength
  }

  const text = new TextDecoder("utf-8").decode(Buffer.concat(kept))
  const truncated = total > cap
  return {
    text: truncated ? `${text}${COMMAND_TRUNCATION_MARKER}` : text,
    truncated,
    bytes: total,
  }
}

function eventFor(input: {
  project: string
  argv: string[]
  cwd: string
  decision: "approve" | "deny"
  exitCode: number | null
  durationMs: number
  timedOut: boolean
}): CommandDecisionEvent {
  return {
    kind: "command-decision",
    project: input.project,
    argv: [...input.argv],
    cwd: input.cwd,
    decision: input.decision,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    timedOut: input.timedOut,
    at: new Date().toISOString(),
  }
}

async function emit(
  sink: RunCommandInput["onActivity"],
  event: CommandDecisionEvent,
): Promise<void> {
  if (!sink) return
  try {
    await sink(event)
  } catch {
    // The decision already happened; a log failure must not read as "nothing ran".
  }
}

/**
 * Approve or deny one command.
 *
 * Order: confinement and argv first (even a denial names a real place), then the
 * denial path, then the two permission gates, then the spawn. Nothing can start
 * a process before the permission checks; nothing can skip them.
 */
export async function runCommand(
  input: RunCommandInput,
): Promise<Result<CommandOutcome, CommandError>> {
  const project = assertProjectId(input.projectId)
  if (!project.ok) return project

  const meta = await loadProjectMeta(input.workspace, project.value)
  if (!meta.ok) return meta

  const validated = validateArgv(input.command.argv)
  if (!validated.ok) return validated
  const argv = validated.value

  const resolved = await resolveCommandCwd(meta.value.root, input.command.cwd)
  if (!resolved.ok) return resolved
  const cwd = relativeToRoot(meta.value.root, resolved.value)

  if (input.approval.decision === "deny") {
    const event = eventFor({
      project: meta.value.id,
      argv,
      cwd,
      decision: "deny",
      exitCode: null,
      durationMs: 0,
      timedOut: false,
    })
    await emit(input.onActivity, event)
    return ok({
      decision: "deny",
      argv,
      cwd,
      exitCode: null,
      durationMs: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      event,
    })
  }

  const available = commandAvailable({ settings: input.settings, agent: input.agent })
  if (!available.ok) return available

  const timeoutMs = Math.max(1, input.limits?.timeoutMs ?? COMMAND_TIMEOUT_MS)
  const stdoutCap = Math.max(0, input.limits?.stdoutCap ?? STREAM_CAP_BYTES)
  const stderrCap = Math.max(0, input.limits?.stderrCap ?? STREAM_CAP_BYTES)
  const spawn = input.hooks?.spawn ?? defaultSpawn

  const started = performance.now()
  let child: CommandProcess
  try {
    child = spawn(argv, { cwd: resolved.value, env: safeEnvironment() })
  } catch (error) {
    const durationMs = Math.round(performance.now() - started)
    const event = eventFor({
      project: meta.value.id,
      argv,
      cwd,
      decision: "approve",
      exitCode: null,
      durationMs,
      timedOut: false,
    })
    await emit(input.onActivity, event)
    return err({
      kind: "spawn",
      argv,
      message: `the command could not be started (${messageOf(error)})`,
    })
  }

  let timedOut = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  let hardTimer: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill("SIGTERM")
    } catch {
      // Already gone; the exit code below is the answer.
    }
    // A process that ignores SIGTERM (or keeps a descendant alive) gets a
    // short grace period, then SIGKILL.
    forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    }, 1500)
  }, timeoutMs)

  let exitCode: number
  let stdout: Captured
  let stderr: Captured
  try {
    const completed = Promise.all([
      readCapped(child.stdout, stdoutCap),
      readCapped(child.stderr, stderrCap),
      child.exited,
    ])
    // Never wait forever on a stream the killed process still holds.
    const hard = new Promise<never>((_, reject) => {
      hardTimer = setTimeout(() => reject(new Error("the command did not release its output after the timeout")), timeoutMs + 4000)
    })
    const [out, error, code] = await Promise.race([completed, hard])
    stdout = out
    stderr = error
    exitCode = code
  } catch (error) {
    clearTimeout(timer)
    if (forceTimer !== undefined) clearTimeout(forceTimer)
    if (hardTimer !== undefined) clearTimeout(hardTimer)
    const durationMs = Math.round(performance.now() - started)
    const event = eventFor({
      project: meta.value.id,
      argv,
      cwd,
      decision: "approve",
      exitCode: null,
      durationMs,
      timedOut,
    })
    await emit(input.onActivity, event)
    return err({
      kind: "spawn",
      argv,
      message: `the command ended abnormally (${messageOf(error)})`,
    })
  }
  clearTimeout(timer)
  if (forceTimer !== undefined) clearTimeout(forceTimer)
  if (hardTimer !== undefined) clearTimeout(hardTimer)

  const durationMs = Math.round(performance.now() - started)
  const event = eventFor({
    project: meta.value.id,
    argv,
    cwd,
    decision: "approve",
    exitCode,
    durationMs,
    timedOut,
  })
  await emit(input.onActivity, event)

  if (timedOut) {
    return err({
      kind: "timeout",
      argv,
      cwd,
      timeoutMs,
      exitCode,
      durationMs,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      event,
      message: `the command was still running after ${timeoutMs} ms, so it was stopped; the output above is what it had produced`,
    })
  }

  return ok({
    decision: "approve",
    argv,
    cwd,
    exitCode,
    durationMs,
    timedOut: false,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    event,
  })
}

/**
 * WP-507 — changes and the activity log.
 *
 * Two promises are under test here, and both are about bytes rather than calls:
 *
 * - **Changes never writes.** The summary is read from git's machine formats
 *   (`status --porcelain=v1 -z`, `diff --numstat -z`) and the whole repository —
 *   `.git` included — must hash identically before and after. That is why every
 *   git call in the module runs with `--no-optional-locks` and
 *   `GIT_OPTIONAL_LOCKS=0`.
 * - **The activity log stores metadata, never content.** Records are
 *   re-serialised through a per-kind whitelist, so a caller that passes
 *   `content`, `diff`, `prompt` or `stdout` cannot leak it into the file. The
 *   scan tests use sentinel strings from a fake file body, a fake prompt and a
 *   fake provider key, and assert none of them reach `activity.jsonl`.
 *
 * Git fixtures are built at runtime. `tests/fixtures/git/` holds only seed files;
 * each test copies them, then runs `git init` with `GIT_CONFIG_GLOBAL=/dev/null`
 * and explicit `-c user.name` / `-c user.email`, so the machine's git config can
 * never change the result. The expected counts are read back from the git CLI
 * with a different invocation than the module uses, so the test compares two
 * independent parsers rather than asserting the module against itself.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { removeTemp } from "../helpers/cleanup"
import { existsSync } from "node:fs"
import {
  appendFile,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"

import { type Result } from "../../src/domain/markdown"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import { register } from "../../src/services/work/register"
import {
  changes,
  type ChangeFile,
  type ChangeSummary,
  type ChangesError,
  type GitRunner,
} from "../../src/services/work/changes"
import {
  ACTIVITY_KINDS,
  createActivityLog,
  type ActivityError,
  type ActivityKind,
  type ActivityLog,
  type ActivityRecord,
} from "../../src/services/work/activity"
import type { WriteDecisionEvent } from "../../src/services/work/writes"
import type { CommandDecisionEvent } from "../../src/services/work/commands"
import type { SwarmActivityEvent } from "../../src/services/work/swarm"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const NULL_DEVICE = isWindows ? "NUL" : "/dev/null"
const FIXTURES = join(import.meta.dir, "..", "fixtures", "git")

const IDENTITY = [
  "-c",
  "user.name=WP-507 Fixture",
  "-c",
  "user.email=wp507@example.invalid",
]

/**
 * A bare git environment: no user or system config, no prompts, no pager, no
 * locale-dependent output, and optional locks disabled so `git status` cannot
 * rewrite the index behind the test's back.
 */
const GIT_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: isWindows ? "more" : "cat",
  LC_ALL: "C",
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

function available(summary: ChangeSummary): Extract<ChangeSummary, { available: true }> {
  if (!summary.available) throw new Error(`expected a summary, got “${summary.reason}”`)
  return summary
}

function fileOf(summary: Extract<ChangeSummary, { available: true }>, path: string): ChangeFile {
  const found = summary.files.find((file) => file.path === path)
  if (!found) {
    throw new Error(`expected a row for ${path}, got ${summary.files.map((file) => file.path).join(", ")}`)
  }
  return found
}

/* -------------------------------------------------------------------------- */
/* git fixture                                                                 */
/* -------------------------------------------------------------------------- */

async function git(root: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn({
    cmd: ["git", ...IDENTITY, ...args],
    cwd: root,
    env: GIT_ENV,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr.trim()}`)
  }
  return stdout
}

/** Copy the static seed files and make them the first commit on `main`. */
async function seedRepo(root: string): Promise<void> {
  await cp(FIXTURES, root, { recursive: true })
  await git(root, ["init", "-q", "-b", "main"])
  await git(root, ["add", "-A"])
  await git(root, ["commit", "-q", "-m", "seed"])
}

/** The acceptance scenario: one staged change, two unstaged changes. */
async function oneStagedTwoUnstaged(root: string): Promise<void> {
  await appendFile(
    join(root, "src", "app.ts"),
    "\nexport const version = 2\nexport const flag = true\n",
  )
  await git(root, ["add", "src/app.ts"])
  await appendFile(join(root, "src", "util.ts"), "\nexport const name = 'util'\n")
  await rm(join(root, "docs", "guide.md"))
}

/** Relative paths of every entry under `root`, sorted. */
async function tree(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      out.push(relative(root, path))
      if (entry.isDirectory()) await walk(path)
    }
  }
  if (existsSync(root)) await walk(root)
  return out.sort()
}

/**
 * A content hash of the whole tree: relative path, kind, mode and bytes, with
 * symlinks hashing their target. `changes()` must not change a single bit of
 * this, `.git/index` included.
 */
async function treeHash(root: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const path of await tree(root)) {
    const full = join(root, path)
    const info = await lstat(full)
    if (info.isSymbolicLink()) {
      hasher.update(`${path}\u0000link\u0000${await readlink(full)}`)
      continue
    }
    if (info.isDirectory()) {
      hasher.update(`${path}\u0000dir\u0000`)
      continue
    }
    const bytes = new Bun.CryptoHasher("sha256").update(await readFile(full)).digest("hex")
    hasher.update(`${path}\u0000file\u0000${bytes}\u0000${info.mode}\u0000`)
  }
  return hasher.digest("hex")
}

async function fileHash(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex")
}

/** Counts from the plain, human-readable `git status --porcelain` output. */
function countStatus(porcelain: string): { staged: number; unstaged: number } {
  let staged = 0
  let unstaged = 0
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue
    const x = line[0] ?? " "
    const y = line[1] ?? " "
    if (x !== " " && x !== "?" && x !== "!") staged += 1
    if (x === "?" || (y !== " " && y !== "?" && y !== "!")) unstaged += 1
  }
  return { staged, unstaged }
}

/** `git diff --numstat` (non-`-z`), summed per path. */
function parseNumstat(text: string, into: Map<string, { added: number; removed: number }>) {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const [addedText, removedText, path] = parts
    if (path === undefined || path === "") continue
    const added = addedText === "-" ? 0 : Number.parseInt(addedText ?? "", 10)
    const removed = removedText === "-" ? 0 : Number.parseInt(removedText ?? "", 10)
    const previous = into.get(path) ?? { added: 0, removed: 0 }
    into.set(path, {
      added: previous.added + (Number.isFinite(added) ? added : 0),
      removed: previous.removed + (Number.isFinite(removed) ? removed : 0),
    })
  }
  return into
}

async function cliNumstat(root: string): Promise<Map<string, { added: number; removed: number }>> {
  const numbers = new Map<string, { added: number; removed: number }>()
  parseNumstat(await git(root, ["diff", "--cached", "--numstat"]), numbers)
  parseNumstat(await git(root, ["diff", "--numstat"]), numbers)
  return numbers
}

/* -------------------------------------------------------------------------- */
/* activity helpers                                                            */
/* -------------------------------------------------------------------------- */

const PROJECT = "fixture-app-4f2a1c"
const OTHER_PROJECT = "other-app-123abc"

function at(minute: number): string {
  return new Date(Date.UTC(2026, 10, 1, 10, minute, 0)).toISOString()
}

function writeRecord(overrides: Partial<WriteDecisionEvent> = {}): WriteDecisionEvent {
  return {
    kind: "write-decision",
    project: PROJECT,
    path: "src/app.ts",
    decision: "approve",
    hunks: [0, 2],
    at: at(1),
    ...overrides,
  }
}

function commandRecord(overrides: Partial<CommandDecisionEvent> = {}): CommandDecisionEvent {
  return {
    kind: "command-decision",
    project: PROJECT,
    argv: ["bun", "test", "--filter", "work"],
    cwd: ".",
    decision: "approve",
    exitCode: 0,
    durationMs: 1234,
    timedOut: false,
    at: at(2),
    ...overrides,
  }
}

function swarmRecord(overrides: Partial<SwarmActivityEvent> = {}): SwarmActivityEvent {
  return {
    kind: "swarm",
    project: PROJECT,
    run: "2026-11-01T10-00-00Z",
    event: "started",
    at: at(3),
    ...overrides,
  }
}

/** Add fields the whitelist must drop. Kept outside the typed record on purpose. */
function withExtras(record: ActivityRecord, extras: Record<string, unknown>): ActivityRecord {
  return Object.assign({}, record, extras) as ActivityRecord
}

/* -------------------------------------------------------------------------- */
/* sentinels: none of these may ever reach activity.jsonl                       */
/* -------------------------------------------------------------------------- */

const FILE_BODY = "const password = 'BODY-SENTINEL-9f2c'\n"
const DIFF_TEXT = "@@ -1,2 +1,2 @@ BODY-SENTINEL-9f2c replaced"
const PROMPT_TEXT = "PROMPT-SENTINEL: explain the hidden plan for the user"
const STDOUT_TEXT = "STDOUT-SENTINEL: total 42 files"
const API_KEY = "sk-live-KEY-SENTINEL-abc123"

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

let base: string
let workspace: Workspace
let projects: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-changes-"))
  workspace = unwrap(
    await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") }),
  )
  projects = join(base, "projects")
  await mkdir(projects, { recursive: true })
})

afterEach(async () => {
  await removeTemp(base)
})

/** A registered project, optionally a real repository seeded from the fixture. */
async function setupProject(
  name: string,
  options: { git?: boolean } = {},
): Promise<{ root: string; id: string }> {
  const folder = join(projects, name)
  if (options.git === false) {
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, "README.md"), "# A plain folder\n")
  } else {
    await seedRepo(folder)
  }
  const registered = unwrap(await register({ workspace, root: folder, name: "Fixture app" }))
  return { root: registered.meta.root, id: registered.meta.id }
}

/* ========================================================================== */
/* changes                                                                     */
/* ========================================================================== */

describe("changes", () => {
  test("matches git for 1 staged and 2 unstaged changes, with per-file line counts", async () => {
    const project = await setupProject("solo")
    await oneStagedTwoUnstaged(project.root)

    const porcelain = await git(project.root, ["status", "--porcelain=v1"])
    const expectedCounts = countStatus(porcelain)
    expect(expectedCounts).toEqual({ staged: 1, unstaged: 2 })

    const summary = available(unwrap(await changes({ workspace, projectId: project.id })))

    expect(summary.branch).toBe("main")
    expect(summary.detached).toBe(false)
    expect(summary.dirty).toBe(true)
    expect(summary.staged).toBe(expectedCounts.staged)
    expect(summary.unstaged).toBe(expectedCounts.unstaged)
    expect(summary.files.map((file) => file.path)).toEqual([
      "docs/guide.md",
      "src/app.ts",
      "src/util.ts",
    ])

    const numbers = await cliNumstat(project.root)
    expect(numbers.get("src/app.ts")).toEqual({ added: 3, removed: 0 })
    expect(numbers.get("src/util.ts")).toEqual({ added: 2, removed: 0 })
    expect(numbers.get("docs/guide.md")).toEqual({ added: 0, removed: 4 })

    for (const file of summary.files) {
      const expected = numbers.get(file.path) ?? { added: 0, removed: 0 }
      expect({ path: file.path, added: file.added, removed: file.removed }).toEqual({
        path: file.path,
        added: expected.added,
        removed: expected.removed,
      })
    }

    expect(fileOf(summary, "src/app.ts")).toMatchObject({
      status: "modified",
      staged: true,
      unstaged: false,
      added: 3,
      removed: 0,
    })
    expect(fileOf(summary, "src/util.ts")).toMatchObject({
      status: "modified",
      staged: false,
      unstaged: true,
      added: 2,
      removed: 0,
    })
    expect(fileOf(summary, "docs/guide.md")).toMatchObject({
      status: "deleted",
      staged: false,
      unstaged: true,
      added: 0,
      removed: 4,
    })
  })

  test("a clean repo reports dirty false and zero changes", async () => {
    const project = await setupProject("clean")

    const summary = available(unwrap(await changes({ workspace, projectId: project.id })))

    expect(summary).toMatchObject({
      available: true,
      branch: "main",
      detached: false,
      dirty: false,
      staged: 0,
      unstaged: 0,
      files: [],
    })
  })

  test("counts untracked files and renames, and reads untracked lines itself", async () => {
    const project = await setupProject("move")
    await git(project.root, ["mv", "old-name.txt", "new-name.txt"])
    await writeFile(join(project.root, "notes.txt"), "first line\nsecond line\n")

    const porcelain = await git(project.root, ["status", "--porcelain=v1"])
    const expectedCounts = countStatus(porcelain)
    expect(expectedCounts).toEqual({ staged: 1, unstaged: 1 })

    const summary = available(unwrap(await changes({ workspace, projectId: project.id })))

    expect(summary.staged).toBe(expectedCounts.staged)
    expect(summary.unstaged).toBe(expectedCounts.unstaged)
    expect(summary.dirty).toBe(true)

    expect(fileOf(summary, "new-name.txt")).toMatchObject({
      status: "renamed",
      added: 0,
      removed: 0,
      staged: true,
      unstaged: false,
    })
    expect(fileOf(summary, "notes.txt")).toMatchObject({
      status: "untracked",
      added: 2,
      removed: 0,
      staged: false,
      unstaged: true,
    })
    expect(summary.files.map((file) => file.path)).toEqual(["new-name.txt", "notes.txt"])
  })

  test("an untracked symlink is not followed outside the project", async () => {
    if (isWindows) return // creating symlinks needs a privilege Windows may not grant
    const project = await setupProject("symlink")
    const outside = join(base, "outside-secret.txt")
    await writeFile(outside, "one\ntwo\nthree\nfour\nfive\n")
    await symlink(outside, join(project.root, "link.txt"))

    const summary = available(unwrap(await changes({ workspace, projectId: project.id })))

    expect(fileOf(summary, "link.txt")).toMatchObject({
      status: "untracked",
      added: 0,
      removed: 0,
      staged: false,
      unstaged: true,
    })
  })

  test("does not run a repository-controlled fsmonitor command", async () => {
    if (isWindows) return // a shell script is not the Windows case here
    const project = await setupProject("fsmonitor")
    const marker = join(base, "fsmonitor-ran")
    const script = join(base, "fsmonitor.sh")
    await writeFile(script, `#!/bin/sh\necho ran > ${marker}\nexit 0\n`)
    await chmod(script, 0o755)
    await git(project.root, ["config", "core.fsmonitor", script])

    available(unwrap(await changes({ workspace, projectId: project.id })))
    expect(existsSync(marker)).toBe(false)
  })

  test("a non-git folder is unavailable with a reason, not an error", async () => {
    const project = await setupProject("plain", { git: false })

    const result = await changes({ workspace, projectId: project.id })
    expect(result.ok).toBe(true)

    const summary = unwrap(result)
    expect(summary).toMatchObject({ available: false, reason: "not a git repository" })
    if (summary.available) throw new Error("unreachable")
    expect(summary.message).toContain("Fixture app")
    expect(summary.message).toContain("not a git repository")
  })

  test("a folder inside a larger repository is not treated as its own repo", async () => {
    const outer = join(projects, "outer")
    await seedRepo(outer)
    const nested = join(outer, "nested")
    await mkdir(nested)
    await writeFile(join(nested, "note.md"), "# nested\n")

    const registered = unwrap(await register({ workspace, root: nested, name: "Nested" }))
    const summary = unwrap(await changes({ workspace, projectId: registered.meta.id }))

    expect(summary).toMatchObject({ available: false, reason: "not a git repository" })
    if (summary.available) throw new Error("unreachable")
    expect(summary.message).toContain("sits inside another repository")
    expect(summary.message).toContain(await realpath(outer))
  })

  test("a missing git binary is unavailable with “git not found”", async () => {
    const project = await setupProject("no-git")

    const summary = unwrap(
      await changes({
        workspace,
        projectId: project.id,
        gitPath: join(base, "no-such-git-binary"),
      }),
    )

    expect(summary).toMatchObject({ available: false, reason: "git not found" })
    if (summary.available) throw new Error("unreachable")
    expect(summary.message).toContain("git is not installed")
  })

  test("a failing git command is a typed storage error naming the command and first stderr line", async () => {
    const project = await setupProject("failing")
    const seen: string[] = []

    const runGit: GitRunner = async (args) => {
      seen.push(args.join(" "))
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { kind: "ok", stdout: `${project.root}\n` }
      }
      if (args[0] === "symbolic-ref") return { kind: "ok", stdout: "main\n" }
      if (args[0] === "status") {
        return {
          kind: "failed",
          argv: [...args],
          exitCode: 128,
          stderr: "fatal: index file corrupt\nsecond line must not surface",
        }
      }
      return { kind: "ok", stdout: "" }
    }

    const failure: ChangesError = errorOf(
      await changes({ workspace, projectId: project.id, runGit }),
    )

    expect(failure.kind).toBe("storage")
    if (failure.kind !== "storage") throw new Error("unreachable")
    expect(failure.path).toBe(project.root)
    expect(failure.message).toContain(
      "git status --porcelain=v1 -z --untracked-files=all failed",
    )
    expect(failure.message).toContain("fatal: index file corrupt")
    expect(failure.message).not.toContain("second line must not surface")
    expect(seen).toContain("status --porcelain=v1 -z --untracked-files=all")
  })

  test("leaves .git and the working tree byte-identical, including the index", async () => {
    const project = await setupProject("readonly")
    await oneStagedTwoUnstaged(project.root)

    const index = join(project.root, ".git", "index")
    const beforeTree = await treeHash(project.root)
    const beforeIndex = await fileHash(index)
    const beforeIndexStat = await stat(index)

    const summary = available(unwrap(await changes({ workspace, projectId: project.id })))
    expect(summary.files).toHaveLength(3)

    expect(await treeHash(project.root)).toBe(beforeTree)
    expect(await fileHash(index)).toBe(beforeIndex)

    const afterIndexStat = await stat(index)
    expect(afterIndexStat.size).toBe(beforeIndexStat.size)
    expect(afterIndexStat.mtimeMs).toBe(beforeIndexStat.mtimeMs)
  })
})

/* ========================================================================== */
/* activity                                                                    */
/* ========================================================================== */

describe("activity", () => {
  function logFor(options?: { dataDir?: string; limit?: number }): ActivityLog {
    return unwrap(createActivityLog(workspace, options))
  }

  test("lives outside the workspace and refuses a data directory inside it", () => {
    const log = logFor()
    expect(log.path).toBe(join(workspace.data.dir, "activity.jsonl"))
    expect(log.path.startsWith(workspace.paths.root + sep)).toBe(false)

    const refused: ActivityError = errorOf(
      createActivityLog(workspace, { dataDir: join(workspace.paths.root, "app-data") }),
    )
    expect(refused.kind).toBe("log-inside-workspace")
    if (refused.kind !== "log-inside-workspace") throw new Error("unreachable")
    expect(refused.path).toContain(join(workspace.paths.root, "app-data"))
  })

  test("an unwritten log is an empty list, not an error", async () => {
    const log = logFor()

    const listed = unwrap(await log.list())
    expect(listed).toEqual({ path: log.path, records: [], skipped: 0, empty: true })
    expect(unwrap(await log.text())).toBe("")
    expect(existsSync(log.path)).toBe(false)
  })

  test("one write decision appends one line with path and hunks and no content", async () => {
    const log = logFor()
    const record = writeRecord({ hunks: [0, 3, 7] })

    const stored = unwrap(await log.append(record))
    expect(stored).toEqual(record)

    const text = unwrap(await log.text())
    const lines = text.trimEnd().split("\n")
    expect(lines).toHaveLength(1)

    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>
    expect(line).toEqual(record)
    expect(Object.keys(line)).toEqual(["kind", "project", "path", "decision", "hunks", "at"])

    const listed = unwrap(await log.list())
    expect(listed.empty).toBe(false)
    expect(listed.records).toEqual([record])
  })

  test("one command decision appends argv, cwd, decision and exitCode, and no output", async () => {
    const log = logFor()
    const record = commandRecord()

    expect(unwrap(await log.append(record))).toEqual(record)

    const lines = unwrap(await log.text()).trimEnd().split("\n")
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>

    expect(line).toMatchObject({
      kind: "command-decision",
      project: PROJECT,
      argv: ["bun", "test", "--filter", "work"],
      cwd: ".",
      decision: "approve",
      exitCode: 0,
      durationMs: 1234,
      timedOut: false,
    })
    expect(line).not.toHaveProperty("stdout")
    expect(line).not.toHaveProperty("stderr")
  })

  test("the whitelist drops content, diff, prompt, stdout and keys before writing", async () => {
    const log = logFor()

    const write = withExtras(writeRecord(), {
      content: FILE_BODY,
      diff: DIFF_TEXT,
      prompt: PROMPT_TEXT,
      stdout: STDOUT_TEXT,
      apiKey: API_KEY,
    })
    const command = withExtras(commandRecord({ at: at(2) }), {
      stdout: STDOUT_TEXT,
      stderr: STDOUT_TEXT,
      output: STDOUT_TEXT,
      prompt: PROMPT_TEXT,
    })

    const storedWrite = unwrap(await log.append(write))
    const storedCommand = unwrap(await log.append(command))

    for (const stored of [storedWrite, storedCommand]) {
      const keys = Object.keys(stored as Record<string, unknown>)
      for (const forbidden of ["content", "diff", "prompt", "stdout", "stderr", "output", "apiKey"]) {
        expect(keys).not.toContain(forbidden)
      }
    }

    const text = unwrap(await log.text())
    for (const sentinel of [FILE_BODY, DIFF_TEXT, PROMPT_TEXT, STDOUT_TEXT, API_KEY]) {
      expect(text).not.toContain(sentinel)
    }
    // The metadata that is allowed is still there.
    expect(text).toContain('"path":"src/app.ts"')
    expect(text).toContain('"argv":["bun","test","--filter","work"]')
  })

  test("a scan over all three kinds finds no prompt, key or file body", async () => {
    const log = logFor()

    const extra = {
      content: FILE_BODY,
      diff: DIFF_TEXT,
      prompt: PROMPT_TEXT,
      stdout: STDOUT_TEXT,
      token: API_KEY,
    }
    unwrap(await log.append(withExtras(writeRecord(), extra)))
    unwrap(await log.append(withExtras(commandRecord(), extra)))
    unwrap(await log.append(withExtras(swarmRecord(), extra)))

    const text = unwrap(await log.text())
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(3)
    for (const sentinel of [FILE_BODY, DIFF_TEXT, PROMPT_TEXT, STDOUT_TEXT, API_KEY]) {
      expect(text).not.toContain(sentinel)
    }
  })

  test("long metadata is truncated and genuinely invalid metadata is refused", async () => {
    const log = logFor()
    unwrap(await log.append(writeRecord()))

    // A long path or argv entry must still be auditable: keep the head, mark
    // the cut, and append the decision.
    unwrap(await log.append(writeRecord({ path: "x".repeat(501) })))
    unwrap(await log.append(commandRecord({ argv: ["echo", "y".repeat(501)], at: at(2) })))
    const afterLong = unwrap(await log.text())
    expect(afterLong).toContain(`${"x".repeat(500)}…`)
    expect(afterLong).toContain(`${"y".repeat(500)}…`)

    const badHunk = errorOf(await log.append(writeRecord({ hunks: [0, -1], at: at(3) })))
    expect(badHunk.kind).toBe("invalid-record")
    if (badHunk.kind !== "invalid-record") throw new Error("unreachable")
    expect(badHunk.field).toBe("hunks")

    const badTime = errorOf(await log.append(writeRecord({ at: "not a time" })))
    expect(badTime.kind).toBe("invalid-record")
    if (badTime.kind !== "invalid-record") throw new Error("unreachable")
    expect(badTime.field).toBe("at")

    const unknown = errorOf(
      await log.append({ kind: "prompt", project: PROJECT, at: at(4) } as unknown as ActivityRecord),
    )
    expect(unknown.kind).toBe("unknown-kind")
    if (unknown.kind !== "unknown-kind") throw new Error("unreachable")
    expect(unknown.value).toBe("prompt")
    expect(unknown.accepted).toEqual(ACTIVITY_KINDS)

    // Three refusals, and the two truncated records above.
    expect(unwrap(await log.text()).split("\n").filter((line) => line !== "")).toHaveLength(3)
  })

  test("list filters by kind and returns newest first", async () => {
    const log = logFor()

    // Appended out of chronological order on purpose: sorting is by `at`.
    unwrap(await log.append(swarmRecord({ at: at(3), event: "task", task: "task-2" })))
    unwrap(await log.append(writeRecord({ at: at(2) })))
    unwrap(await log.append(swarmRecord({ at: at(5), event: "finished" })))
    unwrap(await log.append(commandRecord({ at: at(4) })))
    unwrap(await log.append(swarmRecord({ at: at(1), event: "started" })))

    const swarms = unwrap(await log.list({ kind: "swarm" }))
    expect(swarms.records).toHaveLength(3)
    expect(swarms.records.every((record) => record.kind === "swarm")).toBe(true)
    expect(swarms.records.map((record) => record.at)).toEqual([at(5), at(3), at(1)])

    const writes = unwrap(await log.list({ kind: "write-decision" }))
    expect(writes.records).toHaveLength(1)
    expect(writes.records[0]?.kind).toBe("write-decision")

    const commands = unwrap(await log.list({ kind: "command-decision" }))
    expect(commands.records).toHaveLength(1)
    expect(commands.records[0]?.kind).toBe("command-decision")
  })

  test("list filters by project, alone and with a kind", async () => {
    const log = logFor()

    unwrap(await log.append(writeRecord({ project: PROJECT, at: at(1) })))
    unwrap(await log.append(commandRecord({ project: OTHER_PROJECT, at: at(2) })))
    unwrap(await log.append(swarmRecord({ project: PROJECT, at: at(3) })))
    unwrap(await log.append(writeRecord({ project: OTHER_PROJECT, at: at(4) })))

    const other = unwrap(await log.list({ project: OTHER_PROJECT }))
    expect(other.records.map((record) => record.at)).toEqual([at(4), at(2)])
    expect(other.records.every((record) => record.project === OTHER_PROJECT)).toBe(true)

    const mine = unwrap(await log.list({ project: PROJECT, kind: "write-decision" }))
    expect(mine.records).toHaveLength(1)
    expect(mine.records[0]?.project).toBe(PROJECT)
    expect(mine.records[0]?.kind).toBe("write-decision")
  })

  test("an unknown kind is a typed error naming the accepted values", async () => {
    const log = logFor()

    const failure = errorOf(await log.list({ kind: "content" as ActivityKind }))
    expect(failure.kind).toBe("unknown-kind")
    if (failure.kind !== "unknown-kind") throw new Error("unreachable")
    expect(failure.value).toBe("content")
    expect(failure.accepted).toEqual(ACTIVITY_KINDS)
    expect(failure.message).toContain("write-decision")
    expect(failure.message).toContain("command-decision")
    expect(failure.message).toContain("swarm")
  })

  test("a corrupt line is skipped with a count and the rest still load", async () => {
    const log = logFor()
    unwrap(await log.append(writeRecord({ at: at(1) })))

    // A truncated append with no trailing newline: the classic torn write.
    await appendFile(log.path, '{"kind":"write-decision","project":"fixture-app-4f2a1c"')

    const first = unwrap(await log.list())
    expect(first.skipped).toBe(1)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]?.at).toBe(at(1))

    // The next append starts on a fresh line rather than completing the fragment.
    unwrap(await log.append(swarmRecord({ at: at(2) })))

    const second = unwrap(await log.list())
    expect(second.skipped).toBe(1)
    expect(second.records).toHaveLength(2)
    expect(second.records.map((record) => record.at)).toEqual([at(2), at(1)])

    const text = unwrap(await log.text())
    expect(text.endsWith("\n")).toBe(true)
    expect(text).toContain("\n{\"kind\":\"swarm\"")

    // Valid JSON that is not a valid record is skipped the same way.
    await appendFile(log.path, `${JSON.stringify({ kind: "prompt", project: PROJECT, at: at(9) })}\n`)
    const third = unwrap(await log.list())
    expect(third.skipped).toBe(2)
    expect(third.records).toHaveLength(2)
  })

  test("is append-only: a later append never rewrites earlier bytes", async () => {
    const log = logFor()

    unwrap(await log.append(writeRecord({ at: at(1) })))
    const afterOne = unwrap(await log.text())
    unwrap(await log.append(commandRecord({ at: at(2) })))
    const afterTwo = unwrap(await log.text())

    expect(afterTwo.startsWith(afterOne)).toBe(true)
    expect(afterTwo.slice(afterOne.length).startsWith('{"kind":"command-decision"')).toBe(true)

    unwrap(await log.append(swarmRecord({ at: at(3) })))
    const afterThree = unwrap(await log.text())
    expect(afterThree.startsWith(afterTwo)).toBe(true)
    expect(afterThree.split("\n").filter((line) => line !== "")).toHaveLength(3)
  })

  test("concurrent appends from two log instances produce whole lines", async () => {
    const first = logFor()
    const second = logFor()

    const writes = Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? first : second).append(
        swarmRecord({
          run: `run-${index}`,
          event: "task",
          task: `task-${index}`,
          status: "done",
          at: at(index + 1),
        }),
      ),
    )
    for (const result of await Promise.all(writes)) expect(result.ok).toBe(true)

    const text = unwrap(await first.text())
    const lines = text.split("\n").filter((line) => line !== "")
    expect(lines).toHaveLength(20)

    const runs = new Set<string>()
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(parsed.kind).toBe("swarm")
      expect(typeof parsed.run).toBe("string")
      expect(line.startsWith("{")).toBe(true)
      expect(line.endsWith("}")).toBe(true)
      runs.add(String(parsed.run))
    }
    expect(runs.size).toBe(20)

    const listed = unwrap(await first.list({ kind: "swarm" }))
    expect(listed.records).toHaveLength(20)
    expect(listed.skipped).toBe(0)
  })

  test("records are bounded by an explicit limit and by the log default", async () => {
    const log = logFor()
    for (let index = 0; index < 6; index++) {
      unwrap(await log.append(writeRecord({ at: at(index + 1), path: `src/file-${index}.ts` })))
    }

    const two = unwrap(await log.list({ limit: 2 }))
    expect(two.records).toHaveLength(2)
    expect(two.records.map((record) => record.at)).toEqual([at(6), at(5)])

    const none = unwrap(await log.list({ limit: 0 }))
    expect(none.records).toEqual([])
    // Skipped still reflects the whole file, not the page.
    expect(none.skipped).toBe(0)

    const capped = logFor({ limit: 3 })
    expect(unwrap(await capped.list()).records).toHaveLength(3)

    const negative = errorOf(await log.list({ limit: -1 }))
    expect(negative.kind).toBe("invalid-input")
    if (negative.kind !== "invalid-input") throw new Error("unreachable")
    expect(negative.field).toBe("limit")

    const zeroDefault = errorOf(createActivityLog(workspace, { limit: 0 }))
    expect(zeroDefault.kind).toBe("invalid-input")
    if (zeroDefault.kind !== "invalid-input") throw new Error("unreachable")
    expect(zeroDefault.field).toBe("limit")
  })

  test("appends elsewhere when the log is opened for another data directory", async () => {
    const otherData = join(base, "other-data")
    const log = logFor({ dataDir: otherData })

    unwrap(await log.append(writeRecord()))
    expect(log.path).toBe(join(otherData, "activity.jsonl"))
    expect(await Bun.file(log.path).text()).toContain('"kind":"write-decision"')
    expect(existsSync(join(workspace.paths.root, "activity.jsonl"))).toBe(false)
  })
})

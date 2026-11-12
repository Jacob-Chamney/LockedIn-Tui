/**
 * WP-504 — write approval on a real project folder.
 *
 * Every acceptance row is a test name below. The project is a real temp folder
 * with a real `meta.json`, so "writes nothing" means the bytes on disk are equal,
 * not that a mock was not called.
 *
 * The fixture (`tests/fixtures/diffs/`) is shared with the unit test: `base.txt`
 * is the file on disk, `proposed.txt` is the model's full `newContent`, and
 * `expected-hunks-1-3.txt` is what a partial approval must produce.
 *
 * Three rules are asserted here and nowhere else:
 *
 * - rejection and refusals are byte-preserving, and the activity event carries
 *   metadata only — never a line of the file;
 * - `../` and symlink escapes are refused at resolution time, before the write
 *   path is reached, including for a create through a linked directory;
 * - a crash between the temp write and the rename leaves the original bytes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createAgent, type AgentProfile } from "../../src/services/work/agents";
import { proposeWrite, type ProposedWrite, type ProposeError } from "../../src/services/work/diff";
import { register } from "../../src/services/work/register";
import { applyWrite, type WriteApproval, type WriteDecisionEvent, type WriteError, type WriteHooks, type WriteOutcome } from "../../src/services/work/writes";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const FIXTURES = join(import.meta.dir, "..", "fixtures", "diffs")

const BASE = await Bun.file(join(FIXTURES, "base.txt")).text()
const PROPOSED = await Bun.file(join(FIXTURES, "proposed.txt")).text()
const EXPECTED_1_3 = await Bun.file(join(FIXTURES, "expected-hunks-1-3.txt")).text()

const NOTE = "src/notes.txt"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function refused(result: { ok: boolean; error?: unknown }): WriteError {
  if (result.ok) throw new Error("expected a refusal, got a value")
  return result.error as WriteError
}

function proposeError(result: { ok: boolean; error?: unknown }): ProposeError {
  if (result.ok) throw new Error("expected a refusal, got a value")
  return result.error as ProposeError
}

let base: string
let workspace: Workspace
let projectRoot: string
let projectId: string
let writer: AgentProfile
let reader: AgentProfile
let notePath: string

async function propose(path: string, newContent: string | null): Promise<ProposedWrite> {
  return unwrap(await proposeWrite({ root: projectRoot, path, newContent }))
}

/** One call to `applyWrite`, with the event sink collected for assertion. */
async function decide(
  proposal: ProposedWrite,
  options: {
    agent?: AgentProfile
    allowWrite?: boolean
    approval?: WriteApproval
    hooks?: WriteHooks
  } = {},
): Promise<{ result: Result<WriteOutcome, WriteError>; events: WriteDecisionEvent[] }> {
  const events: WriteDecisionEvent[] = []
  const result = await applyWrite({
    workspace,
    projectId,
    proposal,
    agent: options.agent ?? writer,
    settings: { allowWrite: options.allowWrite ?? true },
    approval: options.approval ?? { decision: "approve" },
    onActivity: (event) => {
      events.push(event)
    },
    hooks: options.hooks,
  })
  return { result, events }
}

function tempNames(entries: readonly string[]): string[] {
  return entries.filter((name) => name.includes(".tmp-"))
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-writes-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  projectRoot = join(base, "project")
  await mkdir(join(projectRoot, "src"), { recursive: true })
  notePath = join(projectRoot, "src", "notes.txt")
  await writeFile(notePath, BASE)
  projectId = unwrap(await register({ workspace, root: projectRoot, name: "My app" })).meta.id
  writer = unwrap(
    await createAgent({ workspace, projectId, name: "Builder", allowWrite: true }),
  )
  reader = unwrap(
    await createAgent({ workspace, projectId, name: "Reviewer", allowWrite: false }),
  )
})

afterEach(async () => {
  await removeTemp(base)
})

describe("rejection", () => {
  test("rejecting leaves the file byte-identical and emits one event with no body", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    const before = await readFile(notePath)

    const { result, events } = await decide(proposal, { approval: { decision: "reject" } })
    const outcome = unwrap(result)

    expect(outcome.decision).toBe("reject")
    expect(outcome.applied).toBe(false)
    expect(outcome.bytes).toBe(0)
    expect(outcome.hunks).toEqual([])

    const after = await readFile(notePath)
    expect(after.equals(before)).toBe(true)

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.kind).toBe("write-decision")
    expect(event.project).toBe(projectId)
    expect(event.path).toBe(NOTE)
    expect(event.decision).toBe("reject")
    expect(event.hunks).toEqual([])
    expect(Number.isNaN(Date.parse(event.at))).toBe(false)

    // The record is metadata only: no line of the base file, the proposal, or a
    // body field that a later writer could reinterpret.
    const record = JSON.stringify(event)
    expect(record).not.toContain("alpha: old value")
    expect(record).not.toContain("alpha: new value")
    expect(record).not.toContain("stable 01")
    expect(Object.keys(event).sort()).toEqual([
      "at",
      "decision",
      "hunks",
      "kind",
      "path",
      "project",
    ])
  })
})

describe("permission gates", () => {
  test("with the global opt-in off, an approved write refuses with the reason and writes nothing", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    const before = await readFile(notePath)

    const { result, events } = await decide(proposal, { allowWrite: false })
    const error = refused(result)

    if (error.kind !== "blocked") throw new Error(`expected blocked, got ${error.kind}`)
    expect(error.reason).toBe("opt-in-off")
    expect(error.path).toBe(NOTE)
    expect(error.message).toContain("writes are off in Settings")
    expect(error.message).toContain("turn on")

    const after = await readFile(notePath)
    expect(after.equals(before)).toBe(true)
    // A refused write is not a decision: nothing is logged as approved/rejected.
    expect(events).toHaveLength(0)
  })

  test("a profile without write permission refuses with the profile named", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    const before = await readFile(notePath)

    const { result, events } = await decide(proposal, { agent: reader })
    const error = refused(result)

    if (error.kind !== "blocked") throw new Error(`expected blocked, got ${error.kind}`)
    expect(error.reason).toBe("profile-disallowed")
    expect(error.path).toBe(NOTE)
    expect(error.message).toContain("Reviewer")
    expect(error.message).toContain("not allowed to write")

    const after = await readFile(notePath)
    expect(after.equals(before)).toBe(true)
    expect(events).toHaveLength(0)
  })
})

describe("base identity", () => {
  test("a file changed after the proposal is refused by name and left untouched", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    const external = "edited outside the proposal\n"
    await writeFile(notePath, external)

    const { result, events } = await decide(proposal)
    const error = refused(result)

    if (error.kind !== "conflict") throw new Error(`expected conflict, got ${error.kind}`)
    expect(error.reason).toBe("base-hash")
    expect(error.path).toBe(NOTE)
    expect(error.message).toContain(NOTE)
    expect(error.message).toContain("changed after this proposal was made")

    // The external edit survives; the stale proposal does not overwrite it.
    expect(await readFile(notePath, "utf8")).toBe(external)
    expect(events).toHaveLength(0)
  })
})

describe("applied writes", () => {
  test("approve-all writes exactly newContent and emits one metadata-only event", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    expect(proposal.hunks.map((hunk) => hunk.index)).toEqual([0, 1, 2, 3])

    const { result, events } = await decide(proposal)
    const outcome = unwrap(result)

    expect(outcome.decision).toBe("approve")
    expect(outcome.applied).toBe(true)
    expect(await readFile(notePath, "utf8")).toBe(PROPOSED)
    expect(outcome.bytes).toBe(Buffer.byteLength(PROPOSED, "utf8"))

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe("write-decision")
    expect(events[0].decision).toBe("approve")
    expect(events[0].path).toBe(NOTE)
    expect(events[0].hunks).toEqual([0, 1, 2, 3])
    expect(JSON.stringify(events[0])).not.toContain("alpha: new value")
  })

  test("approving hunks 1 and 3 writes only those edits", async () => {
    const proposal = await propose(NOTE, PROPOSED)

    const { result, events } = await decide(proposal, {
      approval: { decision: "approve", hunks: [1, 3] },
    })
    unwrap(result)

    expect(await readFile(notePath, "utf8")).toBe(EXPECTED_1_3)
    expect(events).toHaveLength(1)
    expect(events[0].hunks).toEqual([1, 3])
  })

  test("a new file is created atomically and only after approval", async () => {
    const created = join(projectRoot, "src", "created.txt")
    const proposal = await propose("src/created.txt", "created by approval\nsecond line\n")

    expect(proposal.kind).toBe("create")
    expect(proposal.baseHash).toBeNull()
    expect(existsSync(created)).toBe(false)

    const { result, events } = await decide(proposal)
    const outcome = unwrap(result)

    expect(outcome.applied).toBe(true)
    expect(await readFile(created, "utf8")).toBe("created by approval\nsecond line\n")
    expect(tempNames(await readdir(join(projectRoot, "src")))).toEqual([])
    expect(events).toHaveLength(1)
    expect(events[0].path).toBe("src/created.txt")
    expect(events[0].hunks).toEqual([0])
  })

  test("a delete removes the file after approval only", async () => {
    const proposal = await propose(NOTE, null)
    expect(proposal.kind).toBe("delete")

    // A proposal is a value: nothing is gone yet.
    expect(existsSync(notePath)).toBe(true)
    const before = await readFile(notePath)

    const rejected = await decide(proposal, { approval: { decision: "reject" } })
    expect(unwrap(rejected.result).applied).toBe(false)
    expect(rejected.events).toHaveLength(1)
    expect(rejected.events[0].decision).toBe("reject")
    expect((await readFile(notePath)).equals(before)).toBe(true)

    const approved = await decide(proposal)
    const outcome = unwrap(approved.result)
    expect(outcome.applied).toBe(true)
    expect(existsSync(notePath)).toBe(false)
    expect(approved.events).toHaveLength(1)
    expect(approved.events[0].decision).toBe("approve")
    expect(tempNames(await readdir(join(projectRoot, "src")))).toEqual([])
  })
})

describe("confinement", () => {
  test("a ../ path is refused before any write, in a proposal and in a crafted value", async () => {
    const outside = join(base, "outside.txt")

    const climb = await proposeWrite({
      root: projectRoot,
      path: "../outside.txt",
      newContent: "escaped\n",
    })
    const proposalError = proposeError(climb)
    expect(proposalError.kind).toBe("path")
    if (proposalError.kind !== "path") throw new Error("unreachable")
    expect(proposalError.reason).toBe("escape")
    expect(existsSync(outside)).toBe(false)

    // A value is not trusted just because it is typed: apply re-resolves it.
    const crafted: ProposedWrite = {
      path: "../outside.txt",
      baseHash: null,
      newContent: "escaped\n",
      diff: "",
      hunks: [],
      stats: { added: 0, removed: 0 },
      kind: "create",
    }
    const { result, events } = await decide(crafted)
    const error = refused(result)
    expect(error.kind).toBe("path")
    if (error.kind !== "path") throw new Error("unreachable")
    expect(error.reason).toBe("escape")
    expect(existsSync(outside)).toBe(false)
    expect(events).toHaveLength(0)
  })

  test.skipIf(isWindows)("a symlink out of the root is refused for an existing file and for a create", async () => {
    const outsideFile = join(base, "outside.txt")
    await writeFile(outsideFile, "outside original\n")
    const link = join(projectRoot, "escape.txt")
    await symlink(outsideFile, link)

    const viaFile = await proposeWrite({
      root: projectRoot,
      path: "escape.txt",
      newContent: "hacked\n",
    })
    const fileError = proposeError(viaFile)
    expect(fileError.kind).toBe("path")
    if (fileError.kind !== "path") throw new Error("unreachable")
    expect(fileError.reason).toBe("symlink")
    expect(await readFile(outsideFile, "utf8")).toBe("outside original\n")

    // A create through a linked directory must not invent the file outside.
    const outsideDir = join(base, "outside-dir")
    await mkdir(outsideDir)
    await symlink(outsideDir, join(projectRoot, "escape-dir"))

    const viaDir = await proposeWrite({
      root: projectRoot,
      path: "escape-dir/new.txt",
      newContent: "hacked\n",
    })
    const dirError = proposeError(viaDir)
    expect(dirError.kind).toBe("path")
    if (dirError.kind !== "path") throw new Error("unreachable")
    expect(dirError.reason).toBe("symlink")
    expect(existsSync(join(outsideDir, "new.txt"))).toBe(false)
  })
})

describe("atomic replace", () => {
  test("an injected failure between temp write and rename leaves the original bytes", async () => {
    const proposal = await propose(NOTE, PROPOSED)
    const before = await readFile(notePath)

    const { result, events } = await decide(proposal, {
      hooks: {
        beforeRename: () => {
          throw new Error("simulated crash")
        },
      },
    })
    const error = refused(result)

    expect(error.kind).toBe("storage")
    expect(error.message).toContain("simulated crash")

    const after = await readFile(notePath)
    expect(after.equals(before)).toBe(true)
    // The temp file is cleaned up, so a retry starts from a clean folder.
    expect(tempNames(await readdir(join(projectRoot, "src")))).toEqual([])
    expect(events).toHaveLength(0)
  })
})

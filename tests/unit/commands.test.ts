/**
 * WP-505 — commands and approval.
 *
 * Every acceptance row from the packet is a test name below. The project is a
 * real temp workspace with a real registered folder, and the approving tests
 * spawn a real process, so "runs exactly once" and "captures stdout" mean bytes
 * from a child, not a mock.
 *
 * The refusing tests install a spawn seam that throws if it is reached: a
 * refusal that started a process is the failure this packet exists to prevent.
 *
 * Argv shapes that must be refused live in `tests/fixtures/argv/refusals.json`
 * so the table is reviewable without reading the test body.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { createAgent, forSwarm, type AgentProfile } from "../../src/services/work/agents";
import { COMMAND_RISK, COMMAND_TOOL_NAME, COMMAND_TRUNCATION_MARKER, STREAM_CAP_BYTES, commandAvailable, commandToolSpecs, proposeCommand, resolveCommandCwd, runCommand, safeEnvironment, validateArgv, type ArgvError, type CommandDecisionEvent, type CommandError, type CommandHooks, type CommandOutcome, type CommandProcess, type CommandSpawn, type ProposedCommand } from "../../src/services/work/commands";
import { register } from "../../src/services/work/register";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURES = join(import.meta.dir, "..", "fixtures", "argv")

type Refusal = { argv: unknown; error: "argv-shape" | "argv-token"; token?: string }

const REFUSALS: Refusal[] = JSON.parse(await Bun.file(join(FIXTURES, "refusals.json")).text())

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function refused(result: { ok: boolean; error?: unknown }): CommandError {
  if (result.ok) throw new Error("expected a refusal, got a value")
  return result.error as CommandError
}

let base: string
let workspace: Workspace
let projectRoot: string
let projectId: string
let runner: AgentProfile
let reader: AgentProfile

/** A spawn seam that fails the test the moment anything tries to start. */
function forbiddenSpawn(): { readonly calls: number; hooks: CommandHooks } {
  const state = { calls: 0 }
  const spawn: CommandSpawn = () => {
    state.calls++
    throw new Error("a process must not start")
  }
  return {
    get calls() {
      return state.calls
    },
    hooks: { spawn },
  }
}

function streamOf(text: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    if (text !== "") yield new TextEncoder().encode(text)
  })()
}

/** A fake child for environment assertions; it never runs anything. */
function fakeProcess(stdout: string, exitCode = 0): CommandProcess {
  return {
    stdout: streamOf(stdout),
    stderr: streamOf(""),
    exited: Promise.resolve(exitCode),
    kill() {},
  }
}

async function run(
  command: ProposedCommand,
  options: {
    agent?: AgentProfile
    allowCommand?: boolean
    approval?: "approve" | "deny"
    hooks?: CommandHooks
    timeoutMs?: number
  } = {},
): Promise<{ result: Result<CommandOutcome, CommandError>; events: CommandDecisionEvent[] }> {
  const events: CommandDecisionEvent[] = []
  const result = await runCommand({
    workspace,
    projectId,
    command,
    agent: options.agent ?? runner,
    settings: { allowCommand: options.allowCommand ?? true },
    approval: { decision: options.approval ?? "approve" },
    onActivity: (event) => {
      events.push(event)
    },
    hooks: options.hooks,
    limits: options.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs },
  })
  return { result, events }
}

function command(argv: string[], cwd = ""): ProposedCommand {
  return proposeCommand({ argv, cwd, reason: "test" })
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-commands-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  projectRoot = join(base, "project")
  await mkdir(join(projectRoot, "src"), { recursive: true })
  await writeFile(join(projectRoot, "src", "greeting.txt"), "hello world\n")
  projectId = unwrap(await register({ workspace, root: projectRoot, name: "My app" })).meta.id
  runner = unwrap(
    await createAgent({ workspace, projectId, name: "Runner", allowCommand: true }),
  )
  reader = unwrap(
    await createAgent({ workspace, projectId, name: "Reviewer", allowCommand: false }),
  )
})

afterEach(async () => {
  await removeTemp(base)
})

describe("argv validation", () => {
  test("a single shell string is refused as a shape, before any process", async () => {
    const spy = forbiddenSpawn()
    const proposed = { ...proposeCommand({ argv: [], reason: "x" }), argv: "ls; rm -rf /" as unknown as string[] }
    const { result, events } = await run(proposed, { hooks: spy.hooks })
    const error = refused(result)
    expect(error.kind).toBe("argv-shape")
    expect(error.message).toContain("argv array")
    expect(spy.calls).toBe(0)
    expect(events).toHaveLength(0)
  })

  test("a token carrying a shell separator is named and never spawned", async () => {
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls; rm -rf /"]), { hooks: spy.hooks })
    const error = refused(result)
    expect(error.kind).toBe("argv-token")
    expect(error).toMatchObject({ token: "ls; rm -rf /", index: 0 })
    expect(spy.calls).toBe(0)
  })

  test("sh -c is refused because -c runs a command string", async () => {
    for (const argv of [
      ["sh", "-c", "ls"],
      ["/bin/bash", "-lc", "ls"],
      ["cmd.exe", "/c", "dir"],
    ]) {
      const spy = forbiddenSpawn()
      const { result } = await run(command(argv), { hooks: spy.hooks })
      const error = refused(result)
      expect(error.kind).toBe("argv-token")
      expect(error).toMatchObject({ reason: "shell-flag" })
      expect(spy.calls).toBe(0)
    }
  })

  test("a redirect token is refused", async () => {
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls", ">", "out.txt"]), { hooks: spy.hooks })
    const error = refused(result)
    expect(error.kind).toBe("argv-token")
    expect(error).toMatchObject({ token: ">", index: 1 })
    expect(spy.calls).toBe(0)
  })

  test("the refusal table names the offending token for $(), |, && and globs", async () => {
    for (const row of REFUSALS) {
      const validated = validateArgv(row.argv)
      expect(validated.ok).toBe(false)
      const error = (validated as { ok: false; error: ArgvError }).error
      expect(error.kind).toBe(row.error)
      if (row.token !== undefined) {
        expect(error).toMatchObject({ token: row.token })
      }
    }

    for (const argv of [["echo", "$(whoami)"], ["ls", "|", "wc"], ["a", "b && c"], ["ls", "*.ts"]]) {
      const spy = forbiddenSpawn()
      const { result } = await run(command(argv), { hooks: spy.hooks })
      expect(refused(result).kind).toBe("argv-token")
      expect(spy.calls).toBe(0)
    }
  })

  test("a non-string or empty argv is a typed shape error", () => {
    expect(validateArgv([])).toMatchObject({ ok: false, error: { kind: "argv-shape" } })
    expect(validateArgv(["ls", 3])).toMatchObject({ ok: false, error: { kind: "argv-shape" } })
    expect(validateArgv([""])).toMatchObject({ ok: false, error: { kind: "argv-shape" } })
  })
})

describe("cwd confinement", () => {
  test("a ../ cwd is refused and nothing starts", async () => {
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls"], "../../"), { hooks: spy.hooks })
    const error = refused(result)
    expect(error.kind).toBe("path")
    expect(error).toMatchObject({ reason: "escape" })
    expect(spy.calls).toBe(0)
  })

  test("an absolute cwd is refused", async () => {
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls"], "/etc"), { hooks: spy.hooks })
    expect(refused(result)).toMatchObject({ kind: "path", reason: "escape" })
    expect(spy.calls).toBe(0)
  })

  test("a cwd inside the root resolves to that real folder", async () => {
    const resolved = unwrap(await resolveCommandCwd(projectRoot, "src"))
    expect(resolved).toBe(await realpath(join(projectRoot, "src")))
    expect(unwrap(await resolveCommandCwd(projectRoot, ""))).toBe(await realpath(projectRoot))
  })

  test("a missing cwd is a typed error, not a spawn failure", async () => {
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls"], "nope"), { hooks: spy.hooks })
    expect(refused(result)).toMatchObject({ kind: "path", reason: "missing" })
    expect(spy.calls).toBe(0)
  })
})

describe("availability", () => {
  test("with the opt-in off the tool is absent and a direct call is refused", async () => {
    expect(commandToolSpecs({ settings: { allowCommand: false }, agent: runner })).toHaveLength(0)
    const spy = forbiddenSpawn()
    const { result, events } = await run(command(["ls"]), {
      allowCommand: false,
      hooks: spy.hooks,
    })
    const error = refused(result)
    expect(error.kind).toBe("blocked")
    expect(error).toMatchObject({ reason: "opt-in-off" })
    expect(spy.calls).toBe(0)
    expect(events).toHaveLength(0)
  })

  test("a profile without command permission is refused even with the opt-in on", async () => {
    expect(commandToolSpecs({ settings: { allowCommand: true }, agent: reader })).toHaveLength(0)
    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls"]), { agent: reader, hooks: spy.hooks })
    const error = refused(result)
    expect(error.kind).toBe("blocked")
    expect(error).toMatchObject({ reason: "profile-disallowed" })
    expect(error.message).toContain("Reviewer")
    expect(spy.calls).toBe(0)
  })

  test("when both gates are open the tool is offered and describes the approval", () => {
    const specs = commandToolSpecs({ settings: { allowCommand: true }, agent: runner })
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({
      name: COMMAND_TOOL_NAME,
      side: "work",
      write: false,
      command: true,
    })
    expect(specs[0].inputSchema.required).toEqual(["argv"])
    expect(commandAvailable({ settings: { allowCommand: true }, agent: runner }).ok).toBe(true)
  })

  test("a swarm worker's forced copy can never satisfy the availability check", async () => {
    const worker = forSwarm(runner)
    expect(worker.allowCommand).toBe(false)
    expect(commandToolSpecs({ settings: { allowCommand: true }, agent: worker })).toHaveLength(0)

    const spy = forbiddenSpawn()
    const { result } = await run(command(["ls"]), { agent: worker, hooks: spy.hooks })
    expect(refused(result)).toMatchObject({ kind: "blocked", reason: "profile-disallowed" })
    expect(spy.calls).toBe(0)
  })
})

describe("approval", () => {
  test("denying starts no process and emits exactly one deny event", async () => {
    const spy = forbiddenSpawn()
    const { result, events } = await run(command(["ls"]), {
      approval: "deny",
      hooks: spy.hooks,
      // A denial needs no permission: the user may always say no.
      allowCommand: false,
      agent: reader,
    })
    const outcome = unwrap(result)
    expect(spy.calls).toBe(0)
    expect(outcome).toMatchObject({ decision: "deny", exitCode: null, timedOut: false })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "command-decision", decision: "deny", argv: ["ls"] })
  })

  test("approving runs exactly once, captures stdout and exit code, and logs no body", async () => {
    const marker = "hello world"
    // The marker lives in a script, not in argv, so the event assertion below
    // is about the output body and nothing else.
    await writeFile(join(projectRoot, "src", "emit.ts"), `process.stdout.write(${JSON.stringify(marker)})\n`)
    const { result, events } = await run(command([process.execPath, "emit.ts"], "src"))

    const outcome = unwrap(result)
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdout).toBe(marker)
    expect(outcome.cwd).toBe("src")
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "command-decision",
      decision: "approve",
      exitCode: 0,
      cwd: "src",
    })
    expect(events[0].argv[0]).toBe(process.execPath)
    // Metadata only: the output body is not in the activity record.
    expect(JSON.stringify(events)).not.toContain(marker)
  })

  test("a non-zero exit is reported with its code, not hidden and not retried", async () => {
    const { result, events } = await run(
      command([process.execPath, "-e", "process.exit(3)"]),
      {},
    )
    const outcome = unwrap(result)
    expect(outcome.exitCode).toBe(3)
    expect(events).toHaveLength(1)
  })

  test("the child environment is inherited without secret-looking names", async () => {
    const seen: Record<string, string | undefined>[] = []
    const hooks: CommandHooks = {
      spawn: (_argv, options) => {
        seen.push(options.env)
        return fakeProcess("ok")
      },
    }
    const { result } = await run(command(["anything"]), { hooks })
    expect(unwrap(result).stdout).toBe("ok")

    const env = seen[0]
    // Windows spells the variable `Path`; the adapter preserves whatever the
    // parent used rather than normalising it.
    expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path)
    expect(Object.keys(env).some((name) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name))).toBe(false)

    const stripped = safeEnvironment({
      PATH: "/bin",
      HOME: "/home/me",
      OPENAI_API_KEY: "sk-live",
      GITHUB_TOKEN: "ghp_live",
      DB_PASSWORD: "hunter2",
      PRIVATE_KEY: "-----BEGIN",
    })
    expect(stripped).toEqual({ PATH: "/bin", HOME: "/home/me" })
  })
})

describe("capture and limits", () => {
  test("a 200 KiB stdout is truncated with a marker and the exit code is kept", async () => {
    const chunk = 200 * 1024
    const { result } = await run(
      command([process.execPath, "-e", `process.stdout.write("x".repeat(${chunk}))`]),
      {},
    )
    const outcome = unwrap(result)
    expect(outcome.exitCode).toBe(0)
    expect(outcome.stdoutTruncated).toBe(true)
    expect(outcome.stdout.startsWith("x")).toBe(true)
    expect(outcome.stdout.endsWith(COMMAND_TRUNCATION_MARKER)).toBe(true)
    // The kept body is the cap, not the whole 200 KiB.
    expect(outcome.stdout.length).toBeLessThan(chunk)
    expect(outcome.stdout.length).toBe(STREAM_CAP_BYTES + COMMAND_TRUNCATION_MARKER.length)
  })

  test("a command over the timeout is killed, partial output kept, and the timeout reported once", async () => {
    await writeFile(
      join(projectRoot, "slow.ts"),
      'process.stdout.write("started"); await Bun.sleep(5000)\n',
    )
    const started = performance.now()
    const { result, events } = await run(command([process.execPath, "slow.ts"]), {
      timeoutMs: 400,
    })
    const elapsed = performance.now() - started

    const error = refused(result)
    expect(error.kind).toBe("timeout")
    if (error.kind !== "timeout") throw new Error("unreachable")
    expect(error.stdout).toContain("started")
    expect(error.timeoutMs).toBe(400)
    expect(elapsed).toBeLessThan(3000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ decision: "approve", timedOut: true })
    expect(JSON.stringify(events)).not.toContain("started")
  }, 10_000)
})

describe("proposed command shape", () => {
  test("risk is a fixed sentence and argv is copied", () => {
    const argv = ["git", "status"]
    const proposed = proposeCommand({ argv, cwd: "src", reason: "see the tree" })
    expect(proposed).toEqual({ argv, cwd: "src", reason: "see the tree", risk: COMMAND_RISK })
    proposed.argv.push("--short")
    expect(argv).toEqual(["git", "status"])
    expect(COMMAND_RISK).toContain("outside the project")
  })
})

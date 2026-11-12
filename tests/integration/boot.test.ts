/**
 * WP-809 — the composition root.
 *
 * Every case boots a real directory. The chat service is a fake so no provider
 * is contacted; boot itself must never make a network call.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { boot, bootFailureLine, createHistoryPort, type BootFailure } from "../../src/app/boot";
import type { ChatRequest, ChatService } from "../../src/llm/chat";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, BootFailure>): BootFailure {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

/** A chat service that records the request and finishes immediately. */
function fakeService(seen: ChatRequest[]): ChatService {
  return {
    active: () => [],
    cancel() {},
    async *send(request: ChatRequest) {
      seen.push(request)
      yield { type: "done", text: "ok", steps: [], usage: { input: 1, output: 1, total: 2 }, durationMs: 1 }
    },
  } as ChatService
}

let base: string
let workspaceRoot: string
let dataDir: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "boot-"))
  workspaceRoot = join(base, "workspace")
  dataDir = join(base, "data")
})

afterEach(async () => {
  await removeTemp(base)
})

function options(overrides: Record<string, unknown> = {}) {
  return { workspaceRoot, dataDir, env: {}, now: () => new Date("2026-11-01T12:00:00Z"), ...overrides }
}

describe("a fresh boot", () => {
  test("creates the workspace and returns ready services", async () => {
    const booted = unwrap(await boot(options()))

    expect(existsSync(join(workspaceRoot, "workspace.json"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "config.toml"))).toBe(true)
    expect(booted.workspace.root).toBe(workspaceRoot)
    expect(booted.controller).toBeDefined()
    expect(booted.usageStore).toBeDefined()
    expect(booted.budget).toBeDefined()
    expect(booted.spentMicroUsd).toBe(0)
    // The defaults file was written, so the diagnostic says so once.
    expect(booted.diagnostics.some((line) => line.includes("config.toml"))).toBe(true)
  })

  test("creates the data directory outside the workspace on first history write", async () => {
    const booted = unwrap(await boot(options()))
    await booted.history.save([{ role: "user", content: "hi", at: "2026-11-01T12:00:00Z" }])

    expect(existsSync(join(dataDir, "chill.json"))).toBe(true)
    expect(existsSync(join(workspaceRoot, "chill.json"))).toBe(false)
    const saved = JSON.parse(await readFile(join(dataDir, "chill.json"), "utf8")) as {
      schema: number
      messages: Array<{ role: string; content: string }>
    }
    expect(saved.schema).toBe(1)
    expect(saved.messages).toEqual([{ role: "user", content: "hi", at: "2026-11-01T12:00:00Z" }] as never)
  })

  test("booting twice over one workspace is stable", async () => {
    const first = unwrap(await boot(options()))
    const configBefore = await readFile(join(workspaceRoot, "config.toml"), "utf8")

    const second = unwrap(await boot(options()))

    expect(second.workspace.root).toBe(first.workspace.root)
    expect(second.usageStore.path).toBe(first.usageStore.path)
    expect(await readFile(join(workspaceRoot, "config.toml"), "utf8")).toBe(configBefore)
    // A second boot does not re-create the config, so it reports no creation.
    expect(second.diagnostics.some((line) => line.includes("config.toml"))).toBe(false)
  })
})

describe("refusals", () => {
  test("a legacy v0.7 folder is a typed failure naming the path", async () => {
    const legacy = join(base, "old")
    await mkdir(join(legacy, "school", "sessions"), { recursive: true })
    await writeFile(join(legacy, "config.toml"), "[ui]\ntheme = 'lockedin'\n")

    const failure = errorOf(await boot({ ...options(), workspaceRoot: legacy }))
    expect(failure.kind).toBe("boot")
    expect(failure.path).toBe(legacy)
    expect(failure.message.length).toBeGreaterThan(0)
    expect(failure.next.length).toBeGreaterThan(0)
    expect(bootFailureLine(failure)).toContain(legacy)

    // Nothing was created inside the legacy folder.
    expect(existsSync(join(legacy, "workspace.json"))).toBe(false)
  })
})

describe("config reaches the controller", () => {
  test("model, caps, history limit and budget come from config.toml", async () => {
    unwrap(await boot(options()))
    const path = join(workspaceRoot, "config.toml")
    const text = await readFile(path, "utf8")
    await writeFile(
      path,
      text
        .replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"')
        .replace(/^max_tool_calls = .*$/m, "max_tool_calls = 3")
        .replace(/^max_tokens_per_request = .*$/m, "max_tokens_per_request = 2048")
        .replace(/^chill_history_limit = .*$/m, "chill_history_limit = 4")
        .replace(/^budget = .*$/m, "budget = 5"),
    )

    const seen: ChatRequest[] = []
    const booted = unwrap(
      await boot(options({ createService: () => fakeService(seen) })),
    )

    expect(booted.config.models.chat).toBe("openai/gpt-4.1-mini")
    expect(booted.config.models.max_tool_calls).toBe(3)
    expect(booted.config.ui.chill_history_limit).toBe(4)

    await booted.controller.load()
    const outcome = await booted.controller.send("hello")
    expect(outcome.kind).toBe("sent")
    expect(seen[0]?.model).toBe("openai/gpt-4.1-mini")
    expect(seen[0]?.caps).toEqual({ maxToolCalls: 3, maxTokens: 2048 })

    // Budget from config: a 5 USD limit is 5,000,000 micro-USD, not reached at 0 spend.
    const check = booted.budget.check(0)
    expect(check.state.limitMicroUsd).toBe(5_000_000)
    expect(check.state.blocked).toBe(false)
  })

  test("plan generation is a recorded, budgeted run", async () => {
    unwrap(await boot(options()))
    const path = join(workspaceRoot, "config.toml")
    const text = await readFile(path, "utf8")
    await writeFile(
      path,
      text.replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"'),
    )

    const seen: ChatRequest[] = []
    const booted = unwrap(await boot(options({ createService: () => fakeService(seen) })))
    if (!booted.generate) throw new Error("generate should exist with a model")

    expect(await booted.generate("plan a course")).toBe("ok")
    expect(seen[0]?.mode).toBe("chill")

    const saved = await booted.usageStore.load()
    expect(saved.runs).toHaveLength(1)
    expect(saved.runs[0]).toMatchObject({
      model: "openai/gpt-4.1-mini",
      input: 1,
      output: 1,
      scope: "skills",
      failed: false,
      // 1 * $0.40/M + 1 * $1.60/M = 2 micro-USD.
      costMicroUsd: 2,
    })
  })

  test("generation uses the configured generation model", async () => {
    unwrap(await boot(options()))
    const path = join(workspaceRoot, "config.toml")
    const text = await readFile(path, "utf8")
    await writeFile(
      path,
      text
        .replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"')
        .replace(/^generation = .*$/m, 'generation = "openai/gpt-4.1"'),
    )

    const seen: ChatRequest[] = []
    const booted = unwrap(await boot(options({ createService: () => fakeService(seen) })))
    if (!booted.generate) throw new Error("generate should exist with a model")

    expect(await booted.generate("plan a course")).toBe("ok")
    expect(seen[0]?.model).toBe("openai/gpt-4.1")
    expect(await booted.usageStore.load()).toMatchObject({
      runs: [expect.objectContaining({ model: "openai/gpt-4.1" })],
    })
  })

  test("a reached budget stops generation before the provider is called", async () => {
    unwrap(await boot(options()))
    const configPath = join(workspaceRoot, "config.toml")
    const text = await readFile(configPath, "utf8")
    await writeFile(
      configPath,
      text
        .replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"')
        .replace(/^budget = .*$/m, "budget = 0.01")
        .replace(/^pause_at_limit = .*$/m, "pause_at_limit = true"),
    )
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, "usage.json"),
      JSON.stringify({
        schema: 1,
        runs: [
          {
            model: "openai/gpt-4.1-mini",
            input: 1_000_000,
            output: 0,
            costMicroUsd: 1_000_000,
            at: "2026-11-01T09:00:00Z",
            failed: false,
            scope: "school",
          },
        ],
      }),
    )

    const seen: ChatRequest[] = []
    const booted = unwrap(await boot(options({ createService: () => fakeService(seen) })))
    if (!booted.generate) throw new Error("generate should exist with a model")
    const error = await booted.generate("plan").then(() => null, (caught: unknown) => caught)
    expect(String(error)).toContain("budget")
    expect(seen).toHaveLength(0)
  })

  test("each boot clears the Chill transcript", async () => {
    const first = unwrap(await boot(options()))
    await first.history.save([
      { role: "user", content: "old question", at: "2026-11-01T11:00:00Z" },
    ])
    expect(
      (JSON.parse(await readFile(join(dataDir, "chill.json"), "utf8")) as { messages: unknown[] })
        .messages,
    ).toHaveLength(1)

    const second = unwrap(await boot(options()))
    const saved = JSON.parse(await readFile(join(dataDir, "chill.json"), "utf8")) as {
      messages: unknown[]
    }
    expect(saved.messages).toEqual([])
    await second.controller.load()
    expect(second.controller.state().messages).toEqual([])
  })

  test("the history port keeps only the configured number of messages", async () => {
    const port = createHistoryPort({ dataDir, limit: 2 })
    await port.save([
      { role: "user", content: "one", at: "2026-11-01T12:00:00Z" },
      { role: "assistant", content: "two", at: "2026-11-01T12:00:01Z" },
      { role: "user", content: "three", at: "2026-11-01T12:00:02Z" },
    ])
    expect((await port.load()).map((record) => record.content)).toEqual(["two", "three"])

    const none = createHistoryPort({ dataDir, limit: 0 })
    await none.save([{ role: "user", content: "dropped", at: "2026-11-01T12:00:00Z" }])
    expect(await none.load()).toEqual([])
  })
})

describe("no provider", () => {
  test("no model configured still boots, with the blocked send copy", async () => {
    const booted = unwrap(await boot(options()))
    expect(booted.config.models.chat).toBe("")

    await booted.controller.load()
    const outcome = await booted.controller.send("anything")
    expect(outcome.kind).toBe("no-model")
    if (outcome.kind !== "no-model") return
    expect(outcome.reason).toBe("no model configured")
    expect(outcome.fix).toContain("Settings")
  })

  test("a configured model with no linked key reports one actionable line", async () => {
    // WP-813 wired the real provider glue, so the old "no provider glue" state
    // is gone. The equivalent gap now is a provider that needs a key and has
    // none: boot still succeeds and the turn still refuses to send.
    unwrap(await boot(options()))
    const path = join(workspaceRoot, "config.toml")
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"'),
    )

    const booted = unwrap(await boot(options({ readKey: async () => null })))
    expect(booted.diagnostics.some((line) => line.includes("No OpenAI key is linked"))).toBe(true)

    await booted.controller.load()
    const outcome = await booted.controller.send("hello")
    // Boot succeeded; the turn reports the configuration gap rather than hanging.
    expect(outcome.kind).toBe("no-model")
  })

  test("boot reads no secret when no model is configured", async () => {
    let reads = 0
    const booted = unwrap(
      await boot(
        options({
          readKey: async () => {
            reads++
            return "sk-should-never-be-read"
          },
        }),
      ),
    )
    expect(booted.config.models.chat).toBe("")
    expect(reads).toBe(0)
  })
})

describe("the entry point", () => {
  test("index.tsx boots and hands the controller to App", async () => {
    const source = await readFile(join(import.meta.dir, "..", "..", "src", "index.tsx"), "utf8")
    expect(source).toContain("await boot(")
    expect(source).toContain("bootFailureLine")
    expect(source).toContain("controller={controller}")
    expect(source).toContain("usageStore={usageStore}")
    // A failed boot must not render an empty app: it prints and sets an exit code.
    expect(source).toContain("process.exitCode = 1")
  })

  test("App is rendered with the booted dependencies, never bare", async () => {
    const source = await readFile(join(import.meta.dir, "..", "..", "src", "index.tsx"), "utf8")
    expect(source).not.toMatch(/<App\s*\/>/)
  })
})

describe("a machine that only has the old LockedIn", () => {
  test("boot moves to ~/LockedIn-Tui instead of refusing to start", async () => {
    const home = join(base, "home")
    const legacy = join(home, "LockedIn")
    await mkdir(join(legacy, "school", "sessions"), { recursive: true })
    await writeFile(join(legacy, "config.toml"), "[ui]\ntheme = 'lockedin'\n")
    const before = await readFile(join(legacy, "config.toml"), "utf8")

    // No workspaceRoot and no LOCKEDIN_WORKSPACE: the documented default path.
    const booted = unwrap(
      await boot({ env: { HOME: home, USERPROFILE: home }, dataDir: join(base, "home-data"), now: () => new Date("2026-11-01T12:00:00Z") }),
    )

    expect(booted.workspace.root).toBe(join(home, "LockedIn-Tui"))
    expect(existsSync(join(home, "LockedIn-Tui", "workspace.json"))).toBe(true)
    // The old folder was not read or written.
    expect(await readFile(join(legacy, "config.toml"), "utf8")).toBe(before)
    expect(existsSync(join(legacy, "workspace.json"))).toBe(false)
    // The move is reported, not silent.
    expect(booted.diagnostics.some((line) => line.includes("old LockedIn"))).toBe(true)
  })

  test("an explicit LOCKEDIN_WORKSPACE is honoured verbatim, even when it is legacy", async () => {
    const home = join(base, "home2")
    const legacy = join(home, "LockedIn")
    await mkdir(join(legacy, "skills", "goals"), { recursive: true })
    await writeFile(join(legacy, "config.toml"), "[ui]\ntheme = 'lockedin'\n")

    const failure = errorOf(
      await boot({ env: { HOME: home, LOCKEDIN_WORKSPACE: legacy }, dataDir: join(base, "home2-data") }),
    )
    expect(failure.kind).toBe("boot")
    expect(failure.path).toBe(legacy)
    // The copy names the knob that exists.
    expect(failure.next).toContain("LOCKEDIN_WORKSPACE")
    expect(failure.next).not.toContain("--workspace")
    expect(existsSync(join(home, "LockedIn-Tui", "workspace.json"))).toBe(false)
  })
})

test("a configured plugin server contributes read-only chat tools", async () => {
  unwrap(await boot(options()))
  const server = join(import.meta.dir, "..", "fixtures", "plugins", "server.ts")
  const path = join(workspaceRoot, "config.toml")
  const text = await readFile(path, "utf8")
  await writeFile(
    path,
    `${text.replace(/^chat = .*$/m, 'chat = "openai/gpt-4.1-mini"')}\n[plugins.servers.notes]\ntransport = "stdio"\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(server)}]\nenabled = true\n`,
  )
  const seen: ChatRequest[] = []
  const booted = unwrap(await boot(options({ createService: () => fakeService(seen) })))
  try {
    await booted.pluginRuntime.refresh()
    expect(booted.pluginRuntime.rows()[0]?.status).toBe("connected")
    await booted.controller.load()
    await booted.controller.send("hello")
    const tools = seen[0]?.tools?.map((tool) => tool.name).sort() ?? []
    expect(tools).toContain("read_note")
    expect(tools).not.toContain("write_note")
  } finally {
    await booted.pluginRuntime.dispose()
  }
}, 30_000)

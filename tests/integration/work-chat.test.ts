/**
 * WP-502 — project chat and scoped tools, on real folders and real bytes.
 *
 * The acceptance rows are the outline: every refusal shape, the 64 KiB read
 * cap, the search hit shape, the exact tool list, the blocked no-agent send,
 * and the four persistence cases (done, cancelled, failed, resumed) plus
 * `busy`. Nothing here touches a model: the engine is a deterministic async
 * generator, so the chat file is the only thing that can change on disk.
 *
 * Every project root is a copy of `tests/fixtures/work-chat/project` inside a
 * temp directory. No test reads a real user project, and no fixture path points
 * at a machine-specific location.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import type { ChatEvent, Usage } from "../../src/llm/events";
import type { ChatRequest } from "../../src/llm/chat";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { projectMetaPath, register } from "../../src/services/work/register";
import { BUSY, CHATS_DIR, NO_DEFAULT_AGENT, chatPath, chatsDir, createWorkChat, prepareTurn, readChat, type ChatEngine } from "../../src/services/work/chat";
import { READ_CAP_BYTES, READ_ONLY_TOOL_NAMES, TRUNCATION_MARKER, createProjectScope, projectToolSpecs, type ProjectScope, type ScopeError } from "../../src/services/work/scope";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const isWindows = process.platform === "win32"
const FIXTURES = join(import.meta.dir, "..", "fixtures", "work-chat")
const PROJECT_FIXTURE = join(FIXTURES, "project")

const USAGE: Usage = { input: 10, output: 5, total: 15 }

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function refusal(result: { ok: boolean; error?: unknown }): ScopeError {
  if (result.ok) throw new Error("expected a refusal, got a value")
  return result.error as ScopeError
}

async function collect(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type FakeEngine = {
  engine: (scope: ProjectScope) => ChatEngine
  requests: ChatRequest[]
  scopes: ProjectScope[]
}

/** A deterministic engine that records what the chat asked for. */
function fakeEngine(script: (request: ChatRequest) => AsyncGenerator<ChatEvent>): FakeEngine {
  const requests: ChatRequest[] = []
  const scopes: ProjectScope[] = []
  return {
    requests,
    scopes,
    engine(scope) {
      scopes.push(scope)
      return {
        send(request) {
          requests.push(request)
          return script(request)
        },
        cancel() {
          // Tests drive terminal events from the script itself.
        },
      }
    },
  }
}

let base: string
let workspace: Workspace
let projectRoot: string
let projectId: string

/** Replace the registered meta with one of the fixture templates. */
async function useMeta(fixture: "meta.json" | "meta-no-default.json"): Promise<void> {
  const template = JSON.parse(await readFile(join(FIXTURES, fixture), "utf8"))
  const meta = { ...template, id: projectId, root: await realpath(projectRoot) }
  await writeFile(projectMetaPath(workspace, projectId), `${JSON.stringify(meta, null, 2)}\n`)
}

/** Copy the 22-record fixture chat into the project as `chat-<n>.jsonl`. */
async function seedChat(chatId = "chat-1"): Promise<string> {
  const directory = chatsDir(workspace, projectId)
  await mkdir(directory, { recursive: true })
  const target = chatPath(workspace, projectId, chatId)
  await cp(join(FIXTURES, "chat-resume.jsonl"), target)
  return target
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-chat-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  projectRoot = join(base, "project")
  await cp(PROJECT_FIXTURE, projectRoot, { recursive: true })

  const registered = unwrap(
    await register({ workspace, root: projectRoot, name: "Fixture project" }),
  )
  projectId = registered.meta.id
  await useMeta("meta.json")
})

afterEach(async () => {
  await removeTemp(base)
})

describe("project scope confinement", () => {
  test("refuses ../, absolute, symlink and missing paths with the right reason and no content", async () => {
    const scope = unwrap(await createProjectScope({ root: projectRoot }))

    const outside = join(base, "outside")
    await mkdir(outside, { recursive: true })
    const secret = join(outside, "secret.txt")
    await writeFile(secret, "TOP SECRET — must never be returned\n")
    // Creating symlinks on Windows needs Developer Mode or elevation.
    if (!isWindows) await symlink(secret, join(projectRoot, "escape.txt"))

    const cases = [
      { name: "../outside/secret.txt", reason: "escape" as const },
      { name: "src/../../outside/secret.txt", reason: "escape" as const },
      { name: secret, reason: "escape" as const },
      ...(isWindows ? [] : [{ name: "escape.txt", reason: "symlink" as const }]),
      { name: "does-not-exist.txt", reason: "missing" as const },
    ]

    for (const { name, reason } of cases) {
      const refused = refusal(await scope.tools.readFile(name))
      expect(refused.kind).toBe("path")
      if (refused.kind !== "path") throw new Error("unreachable")
      expect(refused.reason).toBe(reason)
      expect(refused.path).toBe(name)
      expect(JSON.stringify(refused)).not.toContain("TOP SECRET")
    }

    // The same rule holds through the resolver the chat loop actually calls.
    const viaTool = await scope.resolveTool("read_file", { path: secret })
    expect(JSON.parse(viaTool)).toMatchObject({ ok: false, error: { kind: "path", reason: "escape" } })
    expect(viaTool).not.toContain("TOP SECRET")
  })

  test("reads text inside the root and truncates a 200 KiB file with a marker", async () => {
    const scope = unwrap(await createProjectScope({ root: projectRoot }))

    const readme = unwrap(await scope.tools.readFile("README.md"))
    expect(readme.path).toBe("README.md")
    expect(readme.text).toContain("The boundary conditions decide the limits.")
    expect(readme.truncated).toBe(false)
    expect(readme.bytes).toBe(Buffer.byteLength(await readFile(join(projectRoot, "README.md"))))

    const big = join(projectRoot, "big.txt")
    await writeFile(big, "A".repeat(200 * 1024))
    const capped = unwrap(await scope.tools.readFile("big.txt"))
    expect(capped.truncated).toBe(true)
    expect(capped.bytes).toBe(200 * 1024)
    expect(capped.text.endsWith(TRUNCATION_MARKER)).toBe(true)
    // The marker is on the returned text; the body is the capped prefix only.
    expect(capped.text.slice(0, READ_CAP_BYTES)).toBe("A".repeat(READ_CAP_BYTES))
    expect(capped.text.length).toBe(READ_CAP_BYTES + TRUNCATION_MARKER.length)

    // A binary file is a typed tool error, not mojibake and not a throw.
    await writeFile(join(projectRoot, "blob.bin"), Buffer.from([0, 1, 2, 3, 0]))
    const binary = refusal(await scope.tools.readFile("blob.bin"))
    expect(binary.kind).toBe("unsupported")

    if (!isWindows) {
      const pipe = join(projectRoot, "pipe")
      const made = Bun.spawnSync({ cmd: ["mkfifo", pipe], stdout: "pipe", stderr: "pipe" })
      expect(made.exitCode).toBe(0)
      const special = refusal(await scope.tools.readFile("pipe"))
      expect(special.kind).toBe("unsupported")
      expect(special.message).toContain("not a regular file")
    }

    // A directory is not a file.
    const directory = refusal(await scope.tools.readFile("src"))
    expect(directory.kind).toBe("unsupported")
  })

  test("search_files finds a term in two files and reports both with line numbers", async () => {
    const scope = unwrap(await createProjectScope({ root: projectRoot }))

    const result = unwrap(await scope.tools.searchFiles("BOUNDARY"))
    expect(result.truncated).toBe(false)
    expect(result.total).toBe(2)
    expect(result.hits.map((hit) => `${hit.path}:${hit.line}`).sort()).toEqual([
      "README.md:3",
      "src/index.ts:2",
    ])
    for (const hit of result.hits) expect(hit.snippet.toLowerCase()).toContain("boundary")

    const empty = unwrap(await scope.tools.searchFiles(""))
    expect(empty).toEqual({ hits: [], total: 0, truncated: false })

    const none = unwrap(await scope.tools.searchFiles("no-such-term-anywhere"))
    expect(none.hits).toEqual([])
    expect(none.total).toBe(0)
  })

  test("lists relative entries, depth-limited, skipping .git and node_modules", async () => {
    const scope = unwrap(await createProjectScope({ root: projectRoot }))
    await mkdir(join(projectRoot, ".git"), { recursive: true })
    await writeFile(join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n")
    await mkdir(join(projectRoot, "node_modules", "pkg"), { recursive: true })
    await writeFile(join(projectRoot, "node_modules", "pkg", "index.js"), "module.exports = 1\n")
    if (!isWindows) await symlink(join(projectRoot, "README.md"), join(projectRoot, "linked.md"))

    const listing = unwrap(await scope.tools.listFiles({ depth: 2 }))
    const paths = listing.entries.map((entry) => entry.path)
    expect(paths).toContain("README.md")
    expect(paths).toContain("src")
    expect(paths).toContain("src/index.ts")
    expect(paths).toContain("src/util.ts")
    expect(paths).toContain("docs/notes.md")
    expect(paths).not.toContain(".git")
    expect(paths).not.toContain(".git/HEAD")
    expect(paths).not.toContain("node_modules")
    expect(paths).not.toContain("node_modules/pkg/index.js")
    expect(paths).not.toContain("linked.md")
    expect(listing.truncated).toBe(false)
  })
})

describe("tool catalogue", () => {
  test("with the write opt-in off the list is exactly the three read-only tools", () => {
    for (const allowWrite of [undefined, false, true] as const) {
      const specs = projectToolSpecs({ allowWrite })
      expect(specs.map((spec) => spec.name)).toEqual([...READ_ONLY_TOOL_NAMES])
      for (const spec of specs) {
        expect(spec.side).toBe("work")
        expect(spec.write).toBe(false)
        expect(spec.command).toBe(false)
      }
    }
    // There is no write or command tool to disable anywhere in this packet.
    expect(projectToolSpecs().some((spec) => spec.write || spec.command)).toBe(false)
  })
})

describe("project chat", () => {
  test("a swarm project with no default agent blocks the send with the documented sentence and issues zero requests", async () => {
    await useMeta("meta-no-default.json")
    const fake = fakeEngine(async function* () {
      throw new Error("the engine must not be built for a blocked chat")
    })
    const chat = createWorkChat({ workspace, engine: fake.engine })

    const events = await collect(chat.send({ projectId, text: "Summarise the repo" }))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: "error",
      error: { kind: "config", message: NO_DEFAULT_AGENT },
    })
    expect(fake.requests).toHaveLength(0)
    expect(fake.scopes).toHaveLength(0)
    expect(existsSync(chatsDir(workspace, projectId))).toBe(false)
  })

  test("a single-agent project chats with the project tools and no agent profile", async () => {
    const template = JSON.parse(await readFile(join(FIXTURES, "meta-no-default.json"), "utf8")) as Record<string, unknown>
    await writeFile(
      projectMetaPath(workspace, projectId),
      `${JSON.stringify({ ...template, id: projectId, root: await realpath(projectRoot), mode: "chat" }, null, 2)}\n`,
    )

    const prepared = await prepareTurn(
      { workspace, engine: () => ({ async *send() {}, cancel() {} }), defaultModel: "openai/gpt-4.1-mini" },
      { projectId, text: "Summarise the repo" },
    )
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.error))
    expect(prepared.value.tools.map((tool) => tool.name)).toEqual([...READ_ONLY_TOOL_NAMES])
    expect(prepared.value.model).toBe("openai/gpt-4.1-mini")
  })

  test("a chat project with a stale default id falls back to the implicit profile", async () => {
    const template = JSON.parse(await readFile(join(FIXTURES, "meta-no-default.json"), "utf8")) as Record<string, unknown>
    await writeFile(
      projectMetaPath(workspace, projectId),
      `${JSON.stringify({ ...template, id: projectId, root: await realpath(projectRoot), mode: "chat", default_agent: "missing-agent" }, null, 2)}\n`,
    )
    const prepared = await prepareTurn(
      { workspace, engine: () => ({ async *send() {}, cancel() {} }), defaultModel: "openai/gpt-4.1-mini" },
      { projectId, text: "still there?" },
    )
    expect(prepared.ok).toBe(true)
  })

  test("a completed turn appends exactly one user/assistant pair", async () => {
    const fake = fakeEngine(async function* () {
      yield { type: "text", delta: "Reading " }
      yield {
        type: "done",
        text: "Reading README.md",
        usage: USAGE,
        durationMs: 12,
        steps: ["Reading README.md"],
      }
    })
    const chat = createWorkChat({
      workspace,
      engine: fake.engine,
      now: () => new Date("2026-11-01T12:00:00Z"),
    })

    const events = await collect(chat.send({ projectId, text: "Summarise the repo" }))
    expect(events.at(-1)?.type).toBe("done")

    // The agent's model, caps and read-only tool list drove the request.
    expect(fake.requests).toHaveLength(1)
    const request = fake.requests[0]!
    expect(request.model).toBe("fixture/model")
    expect(request.mode).toBe("work")
    expect(request.tools?.map((tool) => tool.name)).toEqual([...READ_ONLY_TOOL_NAMES])
    expect(request.caps).toEqual({ maxToolCalls: 4, maxTokens: 16_000 })
    expect(fake.scopes[0]?.root).toBe(await realpath(projectRoot))

    const path = chatPath(workspace, projectId, "chat-1")
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n")
    expect(lines).toHaveLength(2)
    const [user, assistant] = lines.map((line) => JSON.parse(line))
    expect(user).toMatchObject({ role: "user", content: "Summarise the repo" })
    expect(assistant).toMatchObject({
      role: "assistant",
      content: "Reading README.md",
      model: "fixture/model",
      usage: USAGE,
    })
    expect(user.at).toBe("2026-11-01T12:00:00.000Z")
    expect(assistant.at).toBe("2026-11-01T12:00:00.000Z")

    expect(existsSync(chatPath(workspace, projectId, "chat-2"))).toBe(false)
  })

  test("a cancelled turn leaves the chat file byte-identical", async () => {
    const path = await seedChat()
    const before = await readFile(path)
    const fake = fakeEngine(async function* () {
      yield { type: "text", delta: "partial answer that must not be saved" }
      yield { type: "cancelled" }
    })
    const chat = createWorkChat({ workspace, engine: fake.engine })

    const events = await collect(chat.send({ projectId, chatId: "chat-1", text: "Keep going" }))

    expect(events.at(-1)).toEqual({ type: "cancelled" })
    expect(events.some((event) => event.type === "done")).toBe(false)
    expect(await readFile(path)).toEqual(before)
    const records = unwrap(await readChat(workspace, projectId, "chat-1"))
    expect(records).toHaveLength(22)
  })

  test("a failed turn leaves the chat file byte-identical and shows one error", async () => {
    const path = await seedChat()
    const before = await readFile(path)
    const failure = {
      kind: "provider",
      provider: "fixture",
      status: 500,
      message: "the provider failed once",
    } as const
    const fake = fakeEngine(async function* () {
      yield { type: "text", delta: "partial answer that must not be saved" }
      yield { type: "error", error: failure }
    })
    const chat = createWorkChat({ workspace, engine: fake.engine })

    const events = await collect(chat.send({ projectId, chatId: "chat-1", text: "Keep going" }))

    expect(events.filter((event) => event.type === "error")).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: "error", error: failure })
    expect(events.some((event) => event.type === "done")).toBe(false)
    expect(await readFile(path)).toEqual(before)
  })

  test("a second send while streaming yields error(busy) and starts no request", async () => {
    const gate = deferred()
    const fake = fakeEngine(async function* () {
      yield { type: "text", delta: "working" }
      await gate.promise
      yield {
        type: "done",
        text: "working",
        usage: USAGE,
        durationMs: 5,
        steps: ["working"],
      }
    })
    const chat = createWorkChat({ workspace, engine: fake.engine })

    const first = chat.send({ projectId, text: "first" })
    const firstEvent = await first.next()
    expect(firstEvent.value).toMatchObject({ type: "text", delta: "working" })
    expect(chat.active()).toEqual([projectId])

    const second = await collect(chat.send({ projectId, text: "second" }))
    expect(second).toEqual([{ type: "error", error: { kind: "busy", message: BUSY } }])
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.messages.at(-1)?.content).toBe("first")

    gate.resolve()
    const rest = await collect(first)
    expect(rest.at(-1)?.type).toBe("done")
    expect(chat.active()).toEqual([])

    // Only the first turn was persisted.
    const records = unwrap(await readChat(workspace, projectId, "chat-1"))
    expect(records.map((record) => record.content)).toEqual(["first", "working"])
  })

  test("resuming a chat replays the last 20 records and appends to the same file", async () => {
    const path = await seedChat()
    const fake = fakeEngine(async function* () {
      yield {
        type: "done",
        text: "continued",
        usage: USAGE,
        durationMs: 7,
        steps: ["continued"],
      }
    })
    const chat = createWorkChat({
      workspace,
      engine: fake.engine,
      now: () => new Date("2026-11-01T12:30:00Z"),
    })

    const events = await collect(
      chat.send({ projectId, chatId: "chat-1", text: "continue from here" }),
    )
    expect(events.at(-1)?.type).toBe("done")

    const request = fake.requests[0]!
    expect(request.messages).toHaveLength(21)
    expect(request.messages[0]).toEqual({ role: "user", content: "history 3" })
    expect(request.messages[19]).toEqual({ role: "assistant", content: "history 22" })
    expect(request.messages[20]).toEqual({ role: "user", content: "continue from here" })

    const records = unwrap(await readChat(workspace, projectId, "chat-1"))
    expect(records).toHaveLength(24)
    expect(records[22]).toMatchObject({ role: "user", content: "continue from here" })
    expect(records[23]).toMatchObject({ role: "assistant", content: "continued" })
    expect(await readFile(path, "utf8")).toContain("history 1")
    expect(existsSync(chatPath(workspace, projectId, "chat-2"))).toBe(false)
  })
})

describe("project chat storage layout", () => {
  test("no chat file exists before the first completed turn", async () => {
    // A fresh project: the folder is created only when a turn is persisted.
    expect(CHATS_DIR).toBe("chats")
    expect(existsSync(chatsDir(workspace, projectId))).toBe(false)
  })
})

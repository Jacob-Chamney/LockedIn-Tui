/**
 * Plugin host contract test (WP-127).
 *
 * The only server started is `tests/fixtures/plugins/server.ts` — a local file
 * from this repository. No third-party server, no network, no real data.
 */
import { afterAll, describe, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMcpHost, pidAlive } from "../../src/mcp/stdio";
import { coreServersFor, decidePolicy } from "../../src/mcp/policy";
import type { ChatMode, McpServerConfig, McpTool } from "../../src/mcp/types";
import { mcpErrorCopy } from "../../src/mcp/types";
const ROOT = join(import.meta.dir, "..", "..")
const SERVER = join(ROOT, "tests", "fixtures", "plugins", "server.ts")
const matrix = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "plugins", "policy-matrix.json"), "utf8")) as {
  matrix: { mode: ChatMode; tool: "read" | "write"; enabled: boolean; explicit: boolean; approval: boolean | null; expect: string }[]
}

function configs(extra: Partial<McpServerConfig> = {}): McpServerConfig[] {
  return [
    { id: "notes", command: process.execPath, args: [SERVER], ...extra },
    { id: "crasher", command: process.execPath, args: [SERVER], env: { PLUGIN_MODE: "crash-on-call" }, ...extra },
    { id: "noisy", command: process.execPath, args: [SERVER], env: { PLUGIN_STDERR: "noisy" }, ...extra },
    { id: "missing", command: "definitely-not-a-real-plugin-binary-xyz", args: [], ...extra },
  ]
}

const host = createMcpHost(configs())
const results: { name: string; ok: boolean; detail: string }[] = []
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
}

const kinds = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? "ok" : (r.error?.kind ?? "?"))

const tool = (readOnly: boolean): McpTool => ({
  name: readOnly ? "read_note" : "write_note",
  description: "",
  readOnly,
  destructive: !readOnly,
  label: "external explanation",
})

describe("plugin host", () => {
  test("connect, list and call a read-only tool", async () => {
    const connected = await host.connect("notes")
    check("connect spawns the server", connected.ok, connected.ok ? `pid ${connected.value.pid}` : kinds(connected))

    const listed = await host.listTools("notes")
    const tools = listed.ok ? listed.value : []
    const read = tools.find((t) => t.name === "read_note")
    const write = tools.find((t) => t.name === "write_note")
    check(
      "list distinguishes read-only from write-capable",
      listed.ok && read?.readOnly === true && write?.readOnly === false && write.destructive,
      tools.map((t) => `${t.name}:readOnly=${t.readOnly}`).join(", "),
    )
    check(
      "every plugin tool is labelled external explanation",
      tools.length > 0 && tools.every((t) => t.label === "external explanation"),
      `${tools.length} tools`,
    )

    const call = await host.call("notes", "read_note", { path: "concepts/a.md" }, { mode: "chill" })
    check(
      "read-only call returns content",
      call.ok && !call.value.isError && call.value.text.includes("concepts/a.md") && call.value.label === "external explanation",
      call.ok ? `${call.value.ms} ms` : kinds(call),
    )
  })

  test("a write tool without approval never reaches the server", async () => {
    const before = host.stderrOf("notes").length
    const call = await host.call("notes", "write_note", { path: "a.md", body: "hi" }, { mode: "chill" })
    const reached = host
      .stderrOf("notes")
      .slice(before)
      .some((line) => line.includes("CALL write_note"))
    check(
      "write without approval is denied before the server sees it",
      !call.ok && call.error.kind === "approval-required" && !reached,
      `${kinds(call)}, reachedServer=${reached}`,
    )

    const rejected = await host.call(
      "notes",
      "write_note",
      { path: "a.md", body: "hi" },
      { mode: "chill", approval: { granted: false } },
    )
    check("a rejected write is denied", !rejected.ok && rejected.error.kind === "denied", kinds(rejected))

    const approved = await host.call(
      "notes",
      "write_note",
      { path: "a.md", body: "hi" },
      { mode: "chill", approval: { granted: true } },
    )
    check(
      "an approved write reaches the server",
      approved.ok && approved.value.text.includes("wrote 2 bytes"),
      approved.ok ? approved.value.text : kinds(approved),
    )
  })

  test("policy matrix matches the fixture", () => {
    const failures: string[] = []
    for (const row of matrix.matrix) {
      const verdict = decidePolicy(
        row.mode,
        tool(row.tool === "read"),
        {
          enabled: row.enabled,
          explicitCall: row.explicit,
          ...(row.approval === null ? {} : { approval: { granted: row.approval } }),
        },
      )
      if (verdict.kind !== row.expect) failures.push(`${row.mode}/${row.tool}/${row.enabled}/${row.explicit}/${row.approval}=${verdict.kind}`)
    }
    check("policy matrix", failures.length === 0, failures.join("; ") || `${matrix.matrix.length} rows`)
    check("skills have core web search", coreServersFor("skill").includes("web-search"), coreServersFor("skill").join(","))
  })

  test("lock-in denies an implicit call and allows an explicit one", async () => {
    const implicit = await host.call("notes", "read_note", { path: "a.md" }, { mode: "lockin" })
    const explicit = await host.call("notes", "read_note", { path: "a.md" }, { mode: "lockin", explicitCall: true })
    check(
      "lock-in explicit-only",
      !implicit.ok && implicit.error.kind === "denied" && explicit.ok,
      `${kinds(implicit)} / ${kinds(explicit)}`,
    )
  })

  test("cancellation and timeout are typed and prompt", async () => {
    const controller = new AbortController()
    const started = Date.now()
    setTimeout(() => controller.abort(), 100)
    const cancelled = await host.call("notes", "slow_tool", { ms: 5_000 }, { mode: "chill", signal: controller.signal })
    check(
      "cancel returns one cancelled error without waiting",
      !cancelled.ok && cancelled.error.kind === "cancelled" && Date.now() - started < 1_500,
      `${kinds(cancelled)} after ${Date.now() - started} ms`,
    )

    const timedOut = await host.call("notes", "slow_tool", { ms: 3_000 }, { mode: "chill", timeoutMs: 150 })
    check("timeout is typed", !timedOut.ok && timedOut.error.kind === "timeout", kinds(timedOut))
  })

  test("a crash is one typed error and the child is reaped", async () => {
    const connected = await host.connect("crasher")
    const pid = connected.ok ? connected.value.pid : null
    const call = await host.call(
      "crasher",
      "write_note",
      { path: "a.md", body: "boom" },
      { mode: "chill", approval: { granted: true } },
    )
    check(
      "crash produces one typed error, no hang",
      connected.ok && !call.ok && (call.error.kind === "plugin" || call.error.kind === "unavailable"),
      kinds(call),
    )
    await host.close("crasher")
    if (pid) check("crashed child is gone", !pidAlive(pid), `pid ${pid}`)
  })

  test("a missing command is a typed error, never an install prompt", async () => {
    const connected = await host.connect("missing")
    check(
      "missing command is unavailable with an actionable hint",
      !connected.ok &&
        connected.error.kind === "unavailable" &&
        connected.error.hint.includes("never installs plugin dependencies"),
      kinds(connected),
    )
    const copy = connected.ok ? null : mcpErrorCopy(connected.error)
    check("copy is actionable", !!copy && copy.next.length > 0, copy?.next ?? "")
  })

  test("stderr is captured in a bounded buffer and never inherited", async () => {
    const connected = await host.connect("noisy")
    if (connected.ok) await host.call("noisy", "read_note", { path: "b.md" }, { mode: "chill" })
    const lines = host.stderrOf("noisy")
    check(
      "stderr captured, bounded",
      connected.ok && lines.length > 0 && lines.length <= 200 && lines.some((l) => l.startsWith("CALL read_note")),
      `${lines.length} lines`,
    )
    // Nothing we produce contains a tool payload or a prompt.
    const messages = JSON.stringify(results)
    check("no payload leaks into diagnostics", !messages.includes("boom") && !messages.includes("secret"), "scan ok")
  })

  test("close leaves no child process behind", async () => {
    const pids = ["notes", "noisy"]
      .map((id) => host.pidOf(id))
      .filter((pid): pid is number => typeof pid === "number")
    await host.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const alive = pids.filter((pid) => pidAlive(pid))
    check("no process leak", pids.length > 0 && alive.length === 0, `checked ${pids.length}, alive ${alive.length}`)
  })
})

afterAll(async () => {
  await host.close()
  const failed = results.filter((r) => !r.ok)
  // The trace is the evidence required by the packet.
  console.log(JSON.stringify({ pass: failed.length === 0, checks: results.length, results }, null, 2))
  if (failed.length > 0) throw new Error(`${failed.length} plugin checks failed`)
})

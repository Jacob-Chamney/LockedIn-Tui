/** WP-603 — plugin settings, policy matrix and the permission gate. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const plugins = await import("../../src/ui/features/mcp")
type ServerRow = import("../../src/ui/features/mcp").ServerRow
const { crimson } = await import("../../src/ui/theme")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/plugins-ui/servers.json"), "utf8"))
const servers = (): ServerRow[] => FIXTURE.servers as ServerRow[]

async function mount(
  width: number,
  height: number,
  props: { servers?: ServerRow[]; cursor?: number; toolsOpen?: boolean } = {},
) {
  const setup = await testRender(
    () => (
      <plugins.McpPanel
        theme={crimson}
        width={width}
        height={height}
        focused
        servers={props.servers ?? servers()}
        cursor={props.cursor ?? 1}
        toolsOpen={props.toolsOpen ?? false}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("server list", () => {
  test("renders enabled state, transport, connection status and tool count", async () => {
    const setup = await mount(140, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("◉ web-search  stdio  ✓ connected  1 tool")
      expect(frame).toContain("◉ notes  stdio  ✓ connected  2 tools")
      expect(frame).toContain("2 of 3 enabled")
    } finally {
      await setup.dispose()
    }
  })

  test("a failed server shows its reason and the list still works", async () => {
    const setup = await mount(140, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("× failed: missing dependency")
      // other rows are still rendered after the failure
      expect(frame).toContain("web-search")
    } finally {
      await setup.dispose()
    }
  })

  test("tools open read-only, marking write-capable ones", async () => {
    const setup = await mount(140, 24, { cursor: 1, toolsOpen: true })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("read_note  read-only")
      expect(frame).toContain("write_note  write-capable")
    } finally {
      await setup.dispose()
    }
  })

  test("adding a server previews config and never installs anything", () => {
    const preview = plugins.addServerPreview("notes")
    expect(preview).toContain("[plugins.servers.notes]")
    expect(preview).toContain('enabled = false')
    expect(plugins.dependencyHint("notes")).toBe("install it yourself: npx -y @scope/notes")
  })
})

describe("policy matrix", () => {
  test("the flashcards row renders never and cannot be toggled", async () => {
    const setup = await mount(140, 24)
    try {
      const row = lines(setup).find((line) => line.includes("flashcards"))!
      expect(row).toContain("never")
      expect(row).toContain("built only from the session sources")
    } finally {
      await setup.dispose()
    }
    const refused = plugins.toggleCell("flashcards", servers()[0]!)
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("session sources")
  })

  test("lock-in cells read explicit only and persist when toggled", () => {
    const server = servers()[0]!
    expect(plugins.cellLabel("lockin", server)).toBe("explicit only")
    const toggled = plugins.toggleCell("lockin", server)
    expect(toggled.kind).toBe("write")
    if (toggled.kind !== "write") throw new Error("expected a write")
    expect(toggled.patch.plugins.servers[server.name]).toEqual({ enabled: true })
  })

  test("chill allows any enabled server and skill keeps web search core", () => {
    expect(plugins.cellFor("chill", servers()[0]!)).toBe("any")
    expect(plugins.cellFor("skill", servers()[0]!)).toBe("core")
    expect(plugins.cellFor("skill", servers()[1]!)).toBe("any")
  })

  test("the standing note is always shown", async () => {
    const setup = await mount(140, 24)
    try {
      expect(lines(setup).join("\n")).toContain("plugin output is still sent to the model")
    } finally {
      await setup.dispose()
    }
  })
})

describe("enablement", () => {
  test("toggling writes config once and survives a reload", () => {
    const server = servers()[2]!
    const first = plugins.toggleServer(server)
    expect(first.kind).toBe("write")
    if (first.kind !== "write") throw new Error("expected a write")
    expect(first.patch.plugins.servers[server.name]).toEqual({ enabled: true })

    // Reload: the patch is a plain object, so a second read sees the new state.
    const reloaded = { ...server, enabled: first.patch.plugins.servers[server.name]!.enabled }
    expect(plugins.serverLine(reloaded)).toContain("◉ broken")
    expect(plugins.toggleServer(reloaded)).toMatchObject({
      patch: { plugins: { servers: { broken: { enabled: false } } } },
    })
  })
})

describe("permission gate", () => {
  const writeCall = { server: "notes", tool: "write_note", input: { path: "a.md", body: "hello" }, write: true }
  const readCall = { server: "notes", tool: "read_note", input: { path: "a.md" }, write: false }

  test("a write-capable call opens the gate naming server, tool and summary", async () => {
    const view = plugins.gateFor(writeCall)
    expect(view.open).toBe(true)
    expect(view.call?.server).toBe("notes")
    expect(view.call?.tool).toBe("write_note")
    expect(view.summary).toContain("a.md")

    const setup = await testRender(
      () => <plugins.PermissionGate theme={crimson} width={120} height={24} view={view} />,
      { width: 120, height: 24 },
    )
    try {
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      const frame = setup.captureCharFrame()
      expect(frame).toContain("notes")
      expect(frame).toContain("write_note")
      expect(frame).toContain("the result is sent to the model")
      expect(frame).toContain("Y run once · N refuse")
    } finally {
      await setup.dispose()
    }
  })

  test("a read-only call never opens the gate", () => {
    expect(plugins.gateFor(readCall).open).toBe(false)
  })

  test("the summary is capped and hides secret-shaped fields", () => {
    const summary = plugins.summarize({ api_key: "sk-live-123", body: "x".repeat(400) })
    expect(summary).not.toContain("sk-live-123")
    expect(summary.length).toBeLessThanOrEqual(plugins.SUMMARY_LIMIT)
    expect(summary.endsWith("…")).toBe(true)
  })

  test("Y runs once; the same call twice asks twice", () => {
    expect(plugins.answerGate(true)).toEqual({ kind: "run", once: true })
    // no memory: the gate is derived from the call, so it opens again
    expect(plugins.gateFor(writeCall).open).toBe(true)
    expect(plugins.gateFor(writeCall).open).toBe(true)
  })

  test("N refuses with the transcript line and no call", () => {
    const refused = plugins.answerGate(false)
    expect(refused).toEqual({ kind: "refused", line: "plugin call refused" })
  })

  test("plugin output is labelled with the server and never a source", () => {
    const [label, body] = plugins.labelledOutput("notes", "the answer")
    expect(label).toBe("external explanation · notes")
    expect(body).toBe("the answer")
    expect(plugins.pluginLabel("notes")).not.toContain("source")
  })
})

describe("layout and keys", () => {
  test("80x24 and 200x60 snapshots", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mount(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("keys come from one table", () => {
    expect(plugins.intentFor("j")).toBe("down")
    expect(plugins.intentFor("return")).toBe("open")
    expect(plugins.intentFor("e")).toBe("toggle")
    expect(plugins.footerHints()).toContain("e enable")
  })

  test("the surface performs no IO and spawns nothing", () => {
    for (const name of ["mcp-panel.tsx", "mcp-model.ts"]) {
      const source = readFileSync(join(import.meta.dir, "../../src/ui/features/mcp", name), "utf8")
      expect(source).not.toMatch(/writeFile\(|spawn\(|exec\(|rename\(|unlink\(/)
      expect(source).not.toContain("src/mcp/stdio")
    }
  })
})

/** WP-808 — an unknown price renders `cost unknown`, never `$0.0000`. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const { StatusBar } = await import("../../src/ui/shell/status")
const chat = await import("../../src/ui/chat/model")
const { crimson } = await import("../../src/ui/theme")

async function mount(width: number, tokens: number, cost: number | null, durationMs?: number) {
  const setup = await testRender(
    () => (
      <StatusBar
        theme={crimson}
        width={width}
        pane="chat"
        mode="normal"
        overlay={null}
        context="chill"
        hints={[]}
        tokens={tokens}
        cost={cost}
        durationMs={durationMs}
      />
    ),
    { width, height: 3 },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function row(setup: Awaited<ReturnType<typeof mount>>): string {
  return setup.captureCharFrame().split("\n")[0]!
}

describe("the status bar never claims a session was free", () => {
  test("no usage at all renders cost unknown", async () => {
    const setup = await mount(120, 0, null)
    try {
      const line = row(setup)
      expect(line).toContain("0 tok")
      expect(line).toContain("cost unknown")
      expect(line).not.toContain("$0.0000")
    } finally {
      await setup.dispose()
    }
  })

  test("a priced zero still renders $0.0000", async () => {
    const setup = await mount(120, 0, 0)
    try {
      const line = row(setup)
      expect(line).toContain("$0.0000")
      expect(line).not.toContain("cost unknown")
    } finally {
      await setup.dispose()
    }
  })

  test("a known price renders its three-decimal form", async () => {
    const setup = await mount(120, 1200, 3000)
    try {
      expect(row(setup)).toContain("1200 tok · $0.003")
    } finally {
      await setup.dispose()
    }
  })

  test("the last response time shares the ribbon", async () => {
    const setup = await mount(140, 1200, 3000, 2200)
    try {
      expect(row(setup)).toContain("⏱ 2.2s · 1200 tok · $0.003")
    } finally {
      await setup.dispose()
    }
  })

  test("tokens are unaffected by an unknown price", async () => {
    const setup = await mount(80, 1234, null)
    try {
      const line = row(setup)
      expect(line).toContain("1234 tok")
      expect(line).toContain("cost unknown")
    } finally {
      await setup.dispose()
    }
  })
})

describe("one rule, one constant", () => {
  test("formatCost is the only cost renderer and returns the shared label", () => {
    expect(chat.COST_UNKNOWN).toBe("cost unknown")
    expect(chat.formatCost(null)).toBe(chat.COST_UNKNOWN)
    expect(chat.formatCost(undefined)).toBe(chat.COST_UNKNOWN)
    expect(chat.formatCost(0)).toBe("$0.0000")
    expect(chat.formatCost(3000)).toBe("$0.0030")
    // "free" is only claimed by an endpoint known to be free.
    expect(chat.formatCost(0, { free: true })).toBe("free")
  })

  test("both modules import the constant rather than repeating the string", () => {
    const status = readFileSync(join(import.meta.dir, "../../src/ui/shell/status.tsx"), "utf8")
    const model = readFileSync(join(import.meta.dir, "../../src/ui/chat/model.ts"), "utf8")
    expect(status).toContain("COST_UNKNOWN")
    expect(status).not.toContain('"cost unknown"')
    const pricing = readFileSync(join(import.meta.dir, "../../src/llm/pricing.ts"), "utf8")
    expect(pricing).toContain('export const COST_UNKNOWN = "cost unknown"')
    expect(model).toMatch(/from "\.\.\/\.\.\/llm\/pricing"/)
    expect(status).toMatch(/from "\.\.\/chat\/model"/)
  })

  test("no module invents a second unknown-cost string", () => {
    // The constant is declared once; the other module may only import it.
    const pricing = readFileSync(join(import.meta.dir, "../../src/llm/pricing.ts"), "utf8")
    const model = readFileSync(join(import.meta.dir, "../../src/ui/chat/model.ts"), "utf8")
    const status = readFileSync(join(import.meta.dir, "../../src/ui/shell/status.tsx"), "utf8")
    expect((pricing.match(/export const COST_UNKNOWN/g) ?? []).length).toBe(1)
    expect((model.match(/export const COST_UNKNOWN/g) ?? []).length).toBe(0)
    expect((status.match(/export const COST_UNKNOWN/g) ?? []).length).toBe(0)
  })
})

describe("layout", () => {
  test("80x24 keeps the whole status bar on one row with either label", async () => {
    for (const cost of [null, 0] as const) {
      const setup = await mount(80, 0, cost)
      try {
        const lines = setup.captureCharFrame().split("\n").filter((line) => line.length > 0)
        expect(lines.length).toBeGreaterThanOrEqual(1)
        expect(lines[0]!.length).toBe(80)
        expect(lines[0]).toContain("CHILL")
        expect(lines[0]).toContain("NORMAL")
      } finally {
        await setup.dispose()
      }
    }
  })
})

test("a plugin status chip appears beside the mode", async () => {
  const setup = await testRender(
    () => (
      <StatusBar
        theme={crimson}
        width={120}
        pane="chat"
        mode="normal"
        overlay={null}
        context="chill"
        hints={[]}
        tokens={0}
        cost={null}
        pluginStatus={{ text: "synced", tone: "warn" }}
      />
    ),
    { width: 120, height: 3 },
  )
  try {
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("synced")
  } finally {
    await setup.dispose()
  }
})

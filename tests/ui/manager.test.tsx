/** WP-305b — session manager overlay: confirm/cancel, sorting, broken rows. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const m = await import("../../src/ui/features/sessions")
type SessionsState = import("../../src/ui/features/sessions").SessionsState
type SessionRowT = import("../../src/ui/features/sessions").SessionRow
const { crimson } = await import("../../src/ui/theme")

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/manager/sessions.json"), "utf8"))
const rows = fixture.rows as SessionRowT[]
const state = () => m.initialSessions(rows)

async function mount(width: number, height: number, value = state()) {
  const setup = await testRender(
    () => (
      <SessionsPanelHarness width={width} height={height} value={value} />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function SessionsPanelHarness(props: { width: number; height: number; value: SessionsState }) {
  return (
    <m.SessionsPanel
      theme={crimson}
      width={props.width}
      height={props.height}
      state={props.value}
      footer="j/k move · Enter open · a archive · d delete · x export · Esc back"
    />
  )
}

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("rows", () => {
  test("name, date, source count, progress and archived flag", async () => {
    const setup = await mount(120, 20)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Physics — Unit 4")
      expect(frame).toContain("2026-11-01")
      expect(frame).toContain("4 src")
      expect(frame).toContain("3 of 8 steps")
      expect(frame).toContain("[archived]")
    } finally {
      await setup.dispose()
    }
  })

  test("a broken session renders with a reason instead of crashing", async () => {
    const setup = await mount(120, 20)
    try {
      expect(lines(setup).join("\n")).toContain("× sources folder missing")
    } finally {
      await setup.dispose()
    }
  })

  test("newest first by default; name and size sort differently", () => {
    const byDate = m.visibleRows(state()).map((r) => r.id)
    expect(byDate[0]).toBe("2026-11-01-1430-physics")
    expect(m.visibleRows({ ...state(), sort: "name" })[0]?.name).toBe("Chemistry — Bonding")
    expect(m.visibleRows({ ...state(), sort: "size" })[0]?.sources).toBe(4)
  })

  test("search filters and the empty result teaches the way out", async () => {
    const filtered = m.search(state(), "zzz")
    expect(m.visibleRows(filtered)).toHaveLength(0)
    const setup = await mount(100, 20, filtered)
    try {
      expect(lines(setup).join("\n")).toContain('no session matches “zzz”')
    } finally {
      await setup.dispose()
    }
  })

  test("an empty manager invites the first session", async () => {
    const setup = await mount(100, 20, m.initialSessions([]))
    try {
      expect(lines(setup).join("\n")).toContain("n creates one")
    } finally {
      await setup.dispose()
    }
  })
})

describe("destructive actions", () => {
  test("the first press only arms and names the object", () => {
    const armed = m.arm(state(), "delete")
    expect(armed.pending).toEqual({ kind: "delete", id: "2026-11-01-1430-physics", name: "Physics — Unit 4" })
    expect(m.confirm(armed, "delete")).toEqual({ kind: "call", action: "delete", id: "2026-11-01-1430-physics" })
  })

  test("a single press makes no service call", () => {
    const armed = m.arm(state(), "archive")
    expect(m.cancelPending(armed).pending).toBeUndefined()
    // nothing was called: the model only ever returns an intent
    expect(m.confirm(state(), "archive").kind).toBe("refused")
  })

  test("archive, delete and export each name their object and ask again", async () => {
    for (const kind of ["archive", "delete", "export"] as const) {
      const armed = m.arm(state(), kind)
      const warning = m.warningFor(armed, kind)
      expect(warning).toContain("Physics — Unit 4")
      expect(warning).toMatch(/again to confirm/)
      if (kind === "delete") expect(warning).toContain("2 notes link here")
      const setup = await mount(120, 20, armed)
      try {
        expect(lines(setup).join("\n")).toContain(`! ${warning}`)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("a second key of a different kind is refused, not retargeted", () => {
    const armed = m.arm(state(), "archive")
    const refused = m.confirm(armed, "delete")
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("waiting for archive")
  })

  test("moving the cursor after arming refuses instead of deleting the wrong row", () => {
    const armed = m.move(m.arm(state(), "delete"), 1)
    const refused = m.confirm(armed, "delete")
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("Esc cancels")
  })

  test("Esc cancels without a service call", () => {
    const armed = m.arm(state(), "delete")
    const cancelled = m.cancelPending(armed)
    expect(cancelled.pending).toBeUndefined()
    expect(m.confirm(cancelled, "delete").kind).toBe("refused")
  })
})

describe("keys and layout", () => {
  test("the footer names every destructive key the model implements", async () => {
    const footer = "j/k move · Enter open · a archive · d delete · x export · Esc back"
    const setup = await mount(80, 24)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      expect(out.join("\n")).toContain(footer)
    } finally {
      await setup.dispose()
    }
  })

  test("the component performs no filesystem writes", () => {
    const dir = join(import.meta.dir, "../../src/ui/features/sessions")
    for (const name of ["sessions-panel.tsx", "sessions-model.ts"]) {
      const text = readFileSync(join(dir, name), "utf8")
      expect(text).not.toMatch(/writeFile|rename|unlink|rmSync|copyFile/)
      expect(text).not.toContain("src/services")
    }
  })
})

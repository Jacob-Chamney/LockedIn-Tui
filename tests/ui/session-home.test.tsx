/** WP-306 — session home blocks and the coverage panel. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SessionHome } from "../../src/ui/session-home/home"

const { testRender } = await import("@opentui/solid")
const home = await import("../../src/ui/session-home/home")
const { crimson } = await import("../../src/ui/theme")

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/session-home/session.json"), "utf8"))
const session = (overrides: Partial<typeof fixture> = {}) => ({ ...fixture, ...overrides }) as SessionHome

async function mount(width: number, height: number, props: { coverage?: boolean; cursor?: number; session?: SessionHome } = {}) {
  const setup = await testRender(
    () => (
      <home.SessionHomePane
        theme={crimson}
        width={width}
        height={height}
        focused
        home={props.session ?? session()}
        cursor={props.cursor ?? 0}
        coverage={props.coverage ?? false}
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

describe("home blocks", () => {
  test("name, date, sources, steps and outputs in the documented order", async () => {
    const setup = await mount(110, 24)
    try {
      const out = lines(setup)
      const frame = out.join("\n")
      expect(frame).toContain("Physics — Unit 4")
      expect(frame).toContain("created 2026-11-01")
      expect(frame.indexOf("sources · 2")).toBeGreaterThan(frame.indexOf("created"))
      expect(frame.indexOf("steps · 3 of 8 done")).toBeGreaterThan(frame.indexOf("sources · 2"))
      expect(frame.indexOf("outputs ·")).toBeGreaterThan(frame.indexOf("steps · 3 of 8"))
      expect(frame.indexOf("from your history")).toBeGreaterThan(frame.indexOf("outputs ·"))
    } finally {
      await setup.dispose()
    }
  })

  test("sources shows five names then +n more", () => {
    const many = session({
      sources: Array.from({ length: 8 }, (_, i) => ({ name: `s${i}.md`, originalPath: `/s${i}.md`, hash: `h${i}` })),
    })
    expect(home.sourceSummary(many)).toBe("s0.md, s1.md, s2.md, s3.md, s4.md +3 more")
  })

  test("a missing steps file offers a build action", () => {
    const unbuilt = session({ steps: { exists: false, done: 0, total: 0 } })
    const rows = home.homeRows(unbuilt)
    expect(rows[1]!.label).toBe("steps · not built")
    expect(rows[1]!.action).toBe("regenerate-steps")
    expect(rows[1]!.offers).toBe(true)
  })

  test("a missing output offers to build it", () => {
    const rows = home.homeRows(session())
    const outputs = rows.find((row) => row.id === "outputs")!
    expect(outputs.detail).toContain("build the missing output")
    expect(outputs.offers).toBe(true)
  })

  test("history is labelled as history, never as a source", async () => {
    const setup = await mount(110, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("from your history")
      expect(frame).toContain("Energy balances")
    } finally {
      await setup.dispose()
    }
  })

  test("the home shows only while there is no chat", () => {
    expect(home.showHome(0)).toBe(true)
    expect(home.showHome(1)).toBe(false)
  })
})

describe("coverage panel", () => {
  test("one row per source, naming the documents that use it", () => {
    const report = home.coverageFor(session())
    const rows = report.sources.map(home.coverageRow)
    expect(rows).toContain("lecture-4.md · used in: steps, chat")
    expect(rows).toContain("formula-sheet.md · not referenced")
  })

  test("the summary counts referenced sources and flags full coverage", () => {
    const partial = home.coverageFor(session())
    expect(home.coverageSummary(partial)).toBe("1 of 2 sources referenced")
    const full = home.coverageFor(
      session({ documents: [{ kind: "steps", text: "lecture-4.md and formula-sheet.md" }] }),
    )
    expect(home.coverageSummary(full)).toContain("fully covered")
  })

  test("gaps are actionable", () => {
    const gaps = home.gapRows(home.coverageFor(session()))
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toContain("formula-sheet.md")
    expect(gaps[0]).toContain("add it to the steps")
  })

  test("the panel renders without a second counting path", async () => {
    const setup = await mount(120, 20, { coverage: true })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("COVERAGE · 1 of 2 sources referenced")
      expect(frame).toContain("✓ lecture-4.md · used in: steps, chat")
      expect(frame).toContain("! formula-sheet.md · not referenced")
    } finally {
      await setup.dispose()
    }
  })

  test("an empty source list says so instead of dividing by zero", () => {
    const empty = home.coverageFor(session({ sources: [], documents: [] }))
    expect(home.coverageSummary(empty)).toBe("no sources to cover")
    expect(home.gapRows(empty)).toEqual([])
  })
})

describe("keys and layout", () => {
  test("80x24 snapshot with no clipping", async () => {
    const setup = await mount(80, 24)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
    } finally {
      await setup.dispose()
    }
  })

  test("home keys come from one table", () => {
    expect(home.intentFor("j")).toBe("down")
    expect(home.intentFor("k")).toBe("up")
    expect(home.intentFor("return")).toBe("open")
    expect(home.intentFor("escape")).toBe("close")
    expect(home.footerHints()).toContain("Enter open")
  })

  test("the pane performs no IO and imports no service", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/session-home/home.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile|readFileSync|rename|unlink/)
    expect(source).not.toContain("src/services")
  })
})

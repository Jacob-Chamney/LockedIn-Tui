/** WP-602 — archive manager: two walls, honest header, gated actions. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const archive = await import("../../src/ui/features/archive")
type State = import("../../src/ui/features/archive").ArchiveState
const { crimson } = await import("../../src/ui/theme")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/archive-ui/index.json"), "utf8"))
const state = (overrides: Partial<State> = {}): State => ({
  ...archive.initialArchive(FIXTURE.rows),
  ...overrides,
})

async function mount(width: number, height: number, value = state()) {
  const setup = await testRender(
    () => <archive.ArchivePanel theme={crimson} width={width} height={height} focused state={value} />,
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

describe("two lists, never one", () => {
  test("wide layout shows both sides with name, date, size and destination", async () => {
    const setup = await mount(200, 60)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("LEARN · lock-in · 2")
      expect(frame).toContain("LEARN · skills · 1")
      expect(frame).toContain("Physics — Unit 4  2026-10-01  18 KB  archived to github")
      expect(frame).toContain("Assembly basics  2026-10-12  2.0 MB  archived to github")
    } finally {
      await setup.dispose()
    }
  })

  test("narrow layout shows one side with a way to switch", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("LEARN · lock-in")
      expect(frame).not.toContain("Assembly basics")
      expect(archive.intentFor("l")).toBe("side")
      expect(archive.switchSide(state()).side).toBe("skills")
    } finally {
      await setup.dispose()
    }
  })

  test("a side action can never touch the other side's item", () => {
    const school = state({ side: "school", cursor: { school: 0, skills: 2 } })
    const call = archive.actionFor(school, "restore")
    expect(call).toEqual({ kind: "call", action: "restore", side: "school", id: "s1" })
    const skills = archive.switchSide(school)
    expect(archive.actionFor(skills, "restore")).toEqual({ kind: "call", action: "restore", side: "skills", id: "k1" })
  })
})

describe("header", () => {
  test("names backend, privacy timestamp and consent", async () => {
    const setup = await mount(200, 60)
    try {
      const header = lines(setup)[1]!
      expect(header).toContain("folder")
      expect(header).toContain("last privacy check private at 2026-11-01T14:00:00Z")
      expect(header).toContain("consent: given")
    } finally {
      await setup.dispose()
    }
  })

  test("an offline index says so on its own line", async () => {
    const setup = await mount(80, 24, state({ offline: true }))
    try {
      expect(lines(setup).join("\n")).toContain("showing the local index")
    } finally {
      await setup.dispose()
    }
  })

  test("the privacy result is presented as the last push, never live", () => {
    const line = archive.headerLines(state())[0]!
    expect(line).toContain("last privacy check")
    expect(line).not.toContain("live")
  })
})

describe("states", () => {
  test("an empty index invites the first archive", async () => {
    const setup = await mount(120, 24, archive.initialArchive([]))
    try {
      expect(lines(setup).join("\n")).toContain("nothing archived yet")
    } finally {
      await setup.dispose()
    }
  })

  test("a failed row keeps its place and shows one reason line", async () => {
    const setup = await mount(200, 60)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Assembly basics")
      expect(frame).toContain("× failed")
      expect(frame).toContain("× push timed out")
    } finally {
      await setup.dispose()
    }
  })

  test("a long push shows a progress row with a cancel path", async () => {
    const setup = await mount(120, 24, state({ pendingPush: { name: "Assembly basics", cancelable: true } }))
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("… pushing Assembly basics")
      expect(frame).toContain("Esc cancel")
    } finally {
      await setup.dispose()
    }
  })
})

describe("blocked and destructive", () => {
  test("without consent every action is refused with the consent CTA", () => {
    const blocked = state({ consent: false })
    const outcome = archive.actionFor(blocked, "export")
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("expected a refusal")
    expect(outcome.reason).toContain("press c to grant consent")
  })

  test("github without a token names the missing token and the settings key", () => {
    const blocked = state({ backend: "github", configured: false })
    expect(archive.blockedReason(blocked)).toContain("link a github token in settings")
  })

  test("delete needs a second key and names the item and backend", () => {
    const first = archive.actionFor(state(), "delete")
    expect(first.kind).toBe("refused")
    if (first.kind !== "refused") throw new Error("expected a refusal")
    expect(first.reason).toContain("Physics — Unit 4")
    expect(first.reason).toContain("folder")

    const armed = archive.armDelete(state())
    expect(archive.actionFor(armed, "delete")).toEqual({
      kind: "call",
      action: "delete",
      side: "school",
      id: "s1",
    })
  })

  test("switching backend asks first because it changes future archives", () => {
    const armed = archive.armBackend(state(), "github")
    expect(armed.pending).toEqual({ kind: "backend", to: "github" })
    expect(armed.notice).toContain("future archives go there")
    expect(archive.cancelPending(armed).pending).toBeUndefined()
  })

  test("consent uses the exact copy and a Y/N choice", () => {
    const armed = archive.armConsent(state({ consent: false }))
    expect(armed.notice).toContain("archiving sends this item off this machine")
    expect(armed.notice).toContain("Y grant · N cancel")
  })
})

describe("layout and keys", () => {
  test("80x24 and 200x60 snapshots with no clipping", async () => {
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

  test("keys come from one table and the footer is generated", () => {
    expect(archive.intentFor("return")).toBe("restore")
    expect(archive.intentFor("x")).toBe("export")
    expect(archive.intentFor("d")).toBe("delete")
    expect(archive.intentFor("b")).toBe("backend")
    expect(archive.intentFor("c")).toBe("consent")
    expect(archive.footerHints()).toContain("b backend")
  })

  test("the screen performs no IO and no restore/delete itself", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/features/archive/archive-panel.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(|rmSync\(|copyFile\(/)
    expect(source).not.toContain("src/services")
  })

  test("layout splits at 120 columns", () => {
    expect(archive.layoutFor(200)).toEqual({ columns: 2, headerLines: 1 })
    expect(archive.layoutFor(80)).toEqual({ columns: 1, headerLines: 2 })
  })
})

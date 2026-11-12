/** WP-404b — skills manager: confirm/cancel, last-chat refusal, empty states. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const skills = await import("../../src/ui/features/skills")
type SkillsState = import("../../src/ui/features/skills").SkillsState
const { crimson } = await import("../../src/ui/theme")

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/skills-manager/goals.json"), "utf8"))
const state = (overrides: Partial<SkillsState> = {}): SkillsState => ({
  ...skills.initialSkills(FIXTURE.goals, FIXTURE.chats),
  ...overrides,
})

async function mount(width: number, height: number, value = state()) {
  const setup = await testRender(
    () => <skills.SkillsPanel theme={crimson} width={width} height={height} state={value} />,
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

describe("rows", () => {
  test("goal name, stage progress, chat count and last opened", async () => {
    const setup = await mount(140, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Assembly basics")
      expect(frame).toContain("3 of 6 stages")
      expect(frame).toContain("2 chats")
      expect(frame).toContain("2026-11-01")
      expect(frame).toContain("[archived]")
    } finally {
      await setup.dispose()
    }
  })

  test("a broken goal shows its reason instead of crashing", async () => {
    const setup = await mount(140, 24)
    try {
      expect(lines(setup).join("\n")).toContain("× curriculum.md missing")
    } finally {
      await setup.dispose()
    }
  })

  test("the chat column lists chats for the open goal", async () => {
    const setup = await mount(140, 24, state({ pane: "chats" }))
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("CHATS · 2")
      expect(frame).toContain("registers")
      expect(frame).toContain("stack frames")
    } finally {
      await setup.dispose()
    }
  })
})

describe("destructive actions", () => {
  test("the first press arms and names the goal; the second calls the service", () => {
    const armed = skills.arm(state(), "delete")
    expect(armed.pending).toEqual({ kind: "delete", id: "g1", name: "Assembly basics" })
    expect(skills.confirm(armed, "delete")).toEqual({ kind: "call", action: "delete", id: "g1" })
  })

  test("cancel makes zero service calls", () => {
    const armed = skills.arm(state(), "archive")
    const cancelled = skills.cancelPending(armed)
    expect(cancelled.pending).toBeUndefined()
    expect(skills.confirm(cancelled, "archive").kind).toBe("refused")
  })

  test("archive, delete and export each warn and name the goal", async () => {
    for (const kind of ["archive", "delete", "export"] as const) {
      const armed = skills.arm(state(), kind)
      const warning = skills.warningFor(armed, kind)
      expect(warning).toContain("Assembly basics")
      expect(warning).toMatch(/again to confirm/)
      const setup = await mount(140, 24, armed)
      try {
        expect(lines(setup).join("\n")).toContain(`! ${warning}`)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("a different second key is refused rather than retargeted", () => {
    const refused = skills.confirm(skills.arm(state(), "archive"), "delete")
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("waiting for archive")
  })
})

describe("chats", () => {
  test("the last chat cannot be deleted and says why", async () => {
    const single = state({ chats: [FIXTURE.chats[0]] })
    const outcome = skills.deleteChat(single)
    expect(outcome).toEqual({ kind: "refused", reason: skills.LAST_CHAT_COPY })
    const setup = await mount(140, 24, { ...single, notice: skills.LAST_CHAT_COPY })
    try {
      expect(lines(setup).join("\n")).toContain("a goal keeps one chat")
    } finally {
      await setup.dispose()
    }
  })

  test("deleting a chat when several exist is a call, not a write", () => {
    expect(skills.deleteChat(state())).toEqual({ kind: "call", action: "delete", id: "c1" })
  })
})

describe("empty states and layout", () => {
  test("no goals invites the first one", async () => {
    const setup = await mount(120, 24, skills.initialSkills([], []))
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("no skill sessions yet")
      expect(frame).toContain("n creates one")
    } finally {
      await setup.dispose()
    }
  })

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

  test("keys come from one table and the footer is generated", () => {
    expect(skills.intentFor("n")).toBe("new")
    expect(skills.intentFor("return")).toBe("open")
    expect(skills.intentFor("a")).toBe("archive")
    expect(skills.intentFor("d")).toBe("delete")
    expect(skills.intentFor("x")).toBe("export")
    expect(skills.footerHints()).toContain("d delete")
  })

  test("the component performs no filesystem writes", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/features/skills/skills-panel.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile|rename|unlink|rmSync|copyFile/)
    expect(source).not.toContain("src/services")
  })
})

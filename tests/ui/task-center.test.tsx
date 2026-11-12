/** WP-205 — task centre rendering, empty state and the no-literal-keys rule. */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const { TasksPanel, cancelNotice, emptyCopy, glyphFor, elapsedSeconds } = await import(
  "../../src/ui/features/tasks"
)
const keys = await import("../../src/ui/features/tasks/tasks-keys")
const { TaskRegistry } = await import("../../src/domain/tasks")
type Registry = InstanceType<typeof TaskRegistry>
const { crimson } = await import("../../src/ui/theme")

const NOW = 1_700_000_100_000

function build() {
  const reg = new TaskRegistry({ clock: () => NOW - 5_000, cancelPort: () => {} })
  reg.start({ id: "chat-1", kind: "chat", label: "answering · physics" })
  reg.start({ id: "gen-1", kind: "generation", label: "study guide" })
  reg.finish("gen-1", { type: "failed", error: "Provider rejected the key. Relink it in Settings." })
  return reg
}

async function mount(width: number, height: number, reg: Registry, cursor = 0, notice?: string) {
  const setup = await testRender(
    () => (
      <TasksPanel
        theme={crimson}
        width={width}
        height={height}
        registry={reg}
        cursor={cursor}
        now={NOW}
        notice={notice}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function rows(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

describe("rows", () => {
  test("running first, glyph plus label plus elapsed", async () => {
    const setup = await mount(100, 24, build())
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("1 running")
      expect(frame).toContain("▸ answering · physics")
      expect(frame).toContain("5s")
      // finished rows show the outcome word, not a timer
      expect(frame).toContain("× study guide  failed")
    } finally {
      await setup.dispose()
    }
  })

  test("a failed task shows its error inline, not in a modal", async () => {
    const setup = await mount(120, 24, build(), 1)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("× Provider rejected the key. Relink it in Settings.")
    } finally {
      await setup.dispose()
    }
  })

  test("the selected row carries a marker, not just colour", async () => {
    const setup = await mount(100, 24, build())
    try {
      const lines = rows(setup)
      const row = lines.find((line) => line.includes("answering · physics"))!
      // A bar, a fill and bold: the same three-signal selection as the manager.
      expect(row).toContain("▌")
    } finally {
      await setup.dispose()
    }
  })

  test("a cancel notice is shown once", async () => {
    const setup = await mount(120, 24, build(), 0, cancelNotice("already-finished", undefined))
    try {
      expect(rows(setup).join("\n")).toContain("! That task already finished")
    } finally {
      await setup.dispose()
    }
  })
})

describe("empty state", () => {
  test("says there is no work and how to make some, at 80x24 without clipping", async () => {
    const setup = await mount(80, 24, new TaskRegistry({ clock: () => NOW }))
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      const frame = lines.join("\n")
      expect(frame).toContain("no background work")
      expect(frame).toContain("start a chat or a generation")
      expect(frame).toContain("0 running")
    } finally {
      await setup.dispose()
    }
  })
})

describe("status shape", () => {
  test("glyphs cover every status", () => {
    const reg = build()
    const running = reg.get("chat-1")!
    const failed = reg.get("gen-1")!
    expect(glyphFor(running).glyph).toBe("▸")
    expect(glyphFor(failed)).toEqual({ glyph: "×", word: "failed" })
    expect(elapsedSeconds(running, NOW)).toBe(5)
  })

  test("empty copy names the next action", () => {
    expect(emptyCopy()).toContain("start a chat or a generation")
  })
})

describe("keys come from one table", () => {
  test("the documented keys resolve to their intents", () => {
    const expected: Array<[string, string]> = [
      ["j", "down"],
      ["k", "up"],
      ["return", "open"],
      ["c", "cancel"],
      ["escape", "close"],
    ]
    for (const [name, intent] of expected) {
      expect(`${name} -> ${keys.intentFor(name)}`).toBe(`${name} -> ${intent}`)
    }
    expect(keys.intentFor("z")).toBeUndefined()
  })

  test("the footer and the cancel hint are generated", () => {
    const footer = keys.footerHints()
    expect(footer).toContain("c cancel")
    expect(footer).toContain("Esc close")
    expect(keys.cancelKeyLabel()).toBe("c")
  })

  test("no component carries a hard-coded key list", () => {
    const dir = join(import.meta.dir, "../../src/ui/features/tasks")
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      if (!/\.tsx$/.test(name)) continue
      const text = readFileSync(join(dir, name), "utf8")
      if (/"[jkhc]"|"escape"|"return"/.test(text)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })

  test("a task record never stores a prompt, a body or a file path", () => {
    const reg = build()
    const json = JSON.stringify(reg.list())
    expect(json).not.toContain("prompt")
    expect(json).not.toContain("content")
    expect(json).not.toContain("/home")
  })
})

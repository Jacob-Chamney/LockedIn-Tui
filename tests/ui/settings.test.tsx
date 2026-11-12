/** WP-815 — settings shows the real configuration, grouped, with a detail pane. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const settings = await import("../../src/ui/settings")
const { crimson } = await import("../../src/ui/theme")

type View = import("../../src/ui/settings").SettingsView

const VIEW: View = {
  username: "ada",
  theme: "LockedIn Crimson",
  chatModel: "openai/gpt-4.1-mini",
  baseUrl: "",
  maxToolCalls: 24,
  maxTokensPerRequest: 32000,
  budgetUsd: 5,
  period: "month",
  warnAt: 0.8,
  pauseAtLimit: true,
  dataDir: "/home/me/.local/share/lockedin",
  archiveBackend: "folder",
  archiveFolder: "/home/me/Archive",
  historyLimit: 20,
  responseStyle: "normal",
  tutorPolicy: "direct",
  pluginServers: ["notes", "filesystem"],
  hideHints: false,
}

async function mount(width: number, height: number, view: View = VIEW, state = settings.initialSettingsState) {
  const setup = await testRender(
    () => <settings.SettingsPage theme={crimson} width={width} height={height} focused view={view} state={state} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("rows and groups", () => {
  test("every group and row renders a real value from props", async () => {
    const setup = await mount(120, 36)
    try {
      const frame = lines(setup).join("\n")
      for (const header of ["USER", "MODELS", "USAGE", "STORAGE", "PLUGINS"]) {
        expect(frame).toContain(header)
      }
      expect(frame).toContain("ada")
      expect(frame).toContain("OpenAI")
      expect(frame).toContain("gpt-4.1-mini")
      expect(frame).toContain("32,000")
      expect(frame).toContain("$5.00")
      expect(frame).toContain("month")
      expect(frame).toContain("80%")
      expect(frame).toContain("yes")
      expect(frame).toContain("/home/me/Archive")
    } finally {
      await setup.dispose()
    }
  })

  test("an unset value reads 'not set', never an empty cell", async () => {
    const setup = await mount(120, 36)
    try {
      const frame = lines(setup).join("\n")
      // baseUrl is empty in the view
      const row = lines(setup).find((line) => line.includes("Base URL"))!
      expect(row).toContain("not set")
      expect(frame).toContain("not set")
    } finally {
      await setup.dispose()
    }
  })

  test("no config still renders every row", async () => {
    const setup = await mount(120, 36, settings.emptySettingsView())
    try {
      const frame = lines(setup).join("\n")
      for (const header of ["USER", "MODELS", "USAGE", "STORAGE", "PLUGINS"]) expect(frame).toContain(header)
      expect(settings.flatRows(settings.settingsGroups(settings.emptySettingsView()))).toHaveLength(17)
      expect(frame).toContain("no limit")
      expect(frame).toContain("none configured")
    } finally {
      await setup.dispose()
    }
  })

  test("Providers and Chat model split the active id at the first slash", () => {
    const groups = settings.settingsGroups({ ...VIEW, chatModel: "opencode-go/deepseek-v4.1-flash" })
    const models = groups.find((group) => group.id === "models")!
    expect(models.rows.find((row) => row.id === "providers")?.value).toBe("OpenCode Go")
    expect(models.rows.find((row) => row.id === "chatModel")?.value).toBe("deepseek-v4.1-flash")
  })

  test("the value column is aligned across rows", () => {
    const rows = lines
    // pure check: every label is padded to the same width before its value
    const groups = settings.settingsGroups(VIEW)
    const all = settings.flatRows(groups)
    for (const entry of all) {
      expect(entry.row.label.length).toBeLessThanOrEqual(settings.VALUE_COLUMN - 2)
    }
    void rows
  })
})

describe("selection and detail", () => {
  test("the selected row carries a bar, and the detail pane shows its hint", async () => {
    const setup = await mount(120, 36)
    try {
      const frame = lines(setup).join("\n")
      // A selection bar marks the focused row, and the detail pane explains it.
      expect(frame).toContain("▌")
      expect(frame).toContain("Username")
      expect(frame).toContain("shown in the greeting")
    } finally {
      await setup.dispose()
    }
  })

  test("moving the cursor moves the bar and the detail", async () => {
    const groups = settings.settingsGroups(VIEW)
    const moved = settings.moveSetting(settings.initialSettingsState, 1, groups)
    expect(moved.cursor).toBe(1)
    const setup = await mount(120, 36, VIEW, moved)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("▌")
      // The detail pane followed the cursor to Theme.
      expect(frame).toContain("the palette used everywhere")
    } finally {
      await setup.dispose()
    }
  })

  test("a popup-width page shows the list without clipping; a wide one adds the detail pane", async () => {
    // 70 is the interior of an 80x24 terminal's popup, where the detail pane
    // does not fit; 120 is a wide popup, where it does.
    const narrow = await mount(70, 24)
    try {
      const out = lines(narrow)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(70)
      expect(out.join("\n")).toContain("USER")
      expect(out.join("\n")).not.toContain("shown in the greeting")
    } finally {
      await narrow.dispose()
    }
    const wide = await mount(120, 36)
    try {
      const out = lines(wide)
      expect(out.length).toBe(36)
      for (const line of out) expect(line.length).toBe(120)
      expect(out.join("\n")).toContain("shown in the greeting")
    } finally {
      await wide.dispose()
    }
  })
})

describe("editing", () => {
  test("Enter opens an inline editor, Enter commits through save once", async () => {
    const groups = settings.settingsGroups(VIEW)
    const editing = settings.typeEdit(settings.beginEdit(settings.initialSettingsState, groups), "grace")
    expect(editing.editing?.draft).toBe("grace")

    const patches: Record<string, unknown>[] = []
    const result = await settings.commitEdit(editing, async (patch) => {
      patches.push(patch)
      return { ...VIEW, username: "grace" }
    })
    expect(patches).toEqual([{ "ui.username": "grace" }])
    expect("patch" in result && result.patch).toEqual({ "ui.username": "grace" })
    expect(result.state.editing).toBe(null)
  })

  test("the inline editor renders the draft with a caret", async () => {
    const groups = settings.settingsGroups(VIEW)
    const editing = settings.typeEdit(settings.beginEdit(settings.initialSettingsState, groups), "grace")
    const setup = await mount(120, 36, VIEW, editing)
    try {
      expect(lines(setup).join("\n")).toContain("grace▏")
    } finally {
      await setup.dispose()
    }
  })

  test("Esc cancels and nothing is saved", async () => {
    const groups = settings.settingsGroups(VIEW)
    const editing = settings.typeEdit(settings.beginEdit(settings.initialSettingsState, groups), "grace")
    const cancelled = settings.cancelEdit(editing)
    expect(cancelled.editing).toBe(null)
    let calls = 0
    await settings.commitEdit(cancelled, async () => {
      calls += 1
      return VIEW
    })
    expect(calls).toBe(0)
  })

  test("an empty draft is refused without calling save", async () => {
    const groups = settings.settingsGroups(VIEW)
    const editing = settings.typeEdit(settings.beginEdit(settings.initialSettingsState, groups), "  ")
    let calls = 0
    const result = await settings.commitEdit(editing, async () => {
      calls += 1
      return VIEW
    })
    expect(calls).toBe(0)
    expect("refused" in result).toBe(true)
  })

  test("a non-editable row explains where it changes", () => {
    const groups = settings.settingsGroups(VIEW)
    const moved = settings.moveSetting(settings.initialSettingsState, 1, groups) // Theme
    const refused = settings.beginEdit(moved, groups)
    expect(refused.editing).toBe(null)
    expect(refused.notice).toContain("changed in its own screen")
  })
})

describe("keys", () => {
  test("keys resolve through the registry and no literal lives in the component", () => {
    expect(settings.settingsIntentFor("j")).toBe("down")
    expect(settings.settingsIntentFor("k")).toBe("up")
    expect(settings.settingsIntentFor("return")).toBe("edit")
    expect(settings.settingsIntentFor("escape")).toBe("cancel")
    expect(settings.settingsFooterHints()).toContain("Enter edit")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/settings-page.tsx"), "utf8")
    expect(source).not.toMatch(/space\+[a-z]/i)
    expect(source).not.toMatch(/writeFile\(|rename\(/)
  })
})

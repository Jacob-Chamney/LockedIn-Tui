/**
 * The Explorer as a menu (WP-818).
 *
 * Rows come from the workspace, headers are not cursor stops, the selected row
 * carries a bar, and the detail card describes whatever is selected. Enter opens
 * the destination through the registry, never a private key table.
 */
import { describe, expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const explore = await import("../../src/ui/shell/explorer")
const { crimson } = await import("../../src/ui/theme")

describe("the row model", () => {
  test("sections, items and a divider in the old sidebar's order", () => {
    const rows = explore.explorerRows({})
    const labels = rows.map((row) => (row.kind === "item" || row.kind === "section" ? row.label : "────"))
    expect(labels[0]).toBe("CHILL")
    expect(labels).toContain("LEARN")
    expect(labels).toContain("PRODUCTIVITY")
    expect(labels).toContain("Lock-in sessions")
    expect(labels).toContain("Skill sessions")
    expect(labels).toContain("Recent")
    expect(labels).toContain("Achievements")
    expect(labels).not.toContain("LOCK-IN SESSIONS · 2")
    expect(labels).not.toContain("Physics — Unit 4")
    expect(labels).not.toContain("SESSIONS")
    expect(labels.at(-1)).toBe("Settings")
    // Tools that live behind the Explorer are not destinations in it.
    expect(labels).not.toContain("Tasks")
    expect(labels).not.toContain("Theme")
    expect(labels).not.toContain("Keys")
    // Agents are a swarm's: no swarm in this input, so no Agents entry.
    expect(labels).not.toContain("Agents")
    expect(rows.some((row) => row.kind === "divider")).toBe(true)
  })

  test("the cursor only stops on items and skips headers", () => {
    const rows = explore.explorerRows({})
    let cursor = explore.firstItem(rows)
    const visited: string[] = []
    for (let step = 0; step < 20; step++) {
      const item = explore.selectedItem(rows, cursor)
      if (!item) throw new Error("cursor landed on a non-item")
      visited.push(item.label)
      cursor = explore.moveExplorer(rows, cursor, 1)
    }
    expect(visited[0]).toBe("Chill chat")
    expect(visited).not.toContain("LEARN")
    expect(visited.at(-1)).toBe("Settings")
    // Moving up from the first item stays put.
    expect(explore.selectedItem(rows, explore.moveExplorer(rows, explore.firstItem(rows), -1))?.label).toBe("Chill chat")
  })

  test("an open session names its buffer under LEARN", () => {
    const rows = explore.explorerRows({ session: { name: "Physics" } })
    expect(rows.some((row) => row.kind === "section" && row.label === "LOCK-IN · Physics")).toBe(true)
    const chat = rows.find((row) => row.kind === "item" && row.key === "lockin:chat")
    expect(chat && chat.kind === "item" ? chat.label : "").toBe("Chat")
    const settings = rows.find((row) => row.kind === "item" && row.key === "lockin:settings")
    expect(settings && settings.kind === "item" ? settings.label : "").toBe("Session settings")
    expect(settings && settings.kind === "item" ? settings.pane : "").toBe("session-settings")
    const settingsAt = rows.findIndex((row) => row.kind === "item" && row.key === "lockin:settings")
    const sessionsAt = rows.findIndex((row) => row.kind === "item" && row.key === "sessions")
    expect(rows.slice(settingsAt + 1, sessionsAt).some((row) => row.kind === "divider")).toBe(true)
    expect(rows.slice(settingsAt + 1, sessionsAt).some((row) => row.kind === "section" && row.label === "SESSIONS")).toBe(true)
    expect(rows.some((row) => row.kind === "section" && row.label.startsWith("SKILL SESSION"))).toBe(false)
  })

  test("an open skill session names its buffer under LEARN", () => {
    const rows = explore.explorerRows({ skill: { name: "Rust" } })
    expect(rows.some((row) => row.kind === "section" && row.label === "SKILL SESSION · Rust")).toBe(true)
    const chat = rows.find((row) => row.kind === "item" && row.key === "skill:chat")
    expect(chat && chat.kind === "item" ? chat.label : "").toBe("Chat")
  })

  test("agents are project context, not Explorer places", () => {
    const rows = explore.explorerRows({})
    expect(rows.some((row) => row.kind === "section" && row.label.startsWith("AGENTS"))).toBe(false)
    expect(rows.some((row) => row.kind === "item" && row.key.startsWith("agent:"))).toBe(false)
  })

  test("every item opens a real surface", async () => {
    const state = await import("../../src/ui/shell/state")
    for (const row of explore.explorerRows({})) {
      if (row.kind !== "item") continue
      const known = state.PANE_PRESENTATION[row.pane] !== undefined
      expect(`${row.key}:${known}`).toBe(`${row.key}:true`)
    }
  })
})

describe("rendering", () => {
  async function mount(rows: ReturnType<typeof explore.explorerRows>, cursor: number, width = 40, height = 30) {
    const setup = await testRender(
      () => <explore.Explorer theme={crimson} width={width} height={height} focused rows={rows} cursor={cursor} />,
      { width, height },
    )
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    return setup
  }

  function lines(setup: { captureCharFrame: () => string }): string[] {
    return setup.captureCharFrame().split("\n")
  }

  test("the selected row carries a bar, and the header a focus glyph", async () => {
    const rows = explore.explorerRows({})
    const setup = await mount(rows, explore.firstItem(rows))
    try {
      const frame = lines(setup)
      expect(frame[0]).toContain("▸ EXPLORER")
      const selected = frame.find((line) => line.includes("Chill chat"))!
      expect(selected).toContain("▌")
    } finally {
      await setup.dispose()
    }
  })

  test("an active session is visually separated from the library", async () => {
    const rows = explore.explorerRows({ session: { name: "Physics" } })
    const setup = await mount(rows, explore.firstItem(rows), 44, 40)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Session settings")
      expect(frame).toContain("SESSIONS")
      expect(frame).toContain("─")
    } finally {
      await setup.dispose()
    }
  })

  test("the Recent entry is a global menu item", async () => {
    const rows = explore.explorerRows({})
    const setup = await mount(rows, explore.firstItem(rows), 40, 40)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Recent")
    } finally {
      await setup.dispose()
    }
    const recent = rows.find((row) => row.kind === "item" && row.label === "Recent")
    expect(recent && recent.kind === "item" ? recent.pane : "").toBe("recent")
    const achievements = rows.find((row) => row.kind === "item" && row.label === "Achievements")
    expect(achievements && achievements.kind === "item" ? achievements.pane : "").toBe("achievements")
  })
})

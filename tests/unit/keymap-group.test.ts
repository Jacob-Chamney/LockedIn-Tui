/** Leader and help group the same rows the same way. */
import { describe, expect, test } from "bun:test"

const { groupKeyRows, leaderKeyRows, GROUP_TITLES } = await import("../../src/ui/keymap/group")
type GeneratedRow = import("../../src/ui/keymap/registry").GeneratedRow

const row = (id: string, group: "context" | "global" | "system", kind: "direct" | "leader"): GeneratedRow =>
  ({
    id,
    label: id,
    keys: id,
    group,
    binding: kind === "leader" ? { kind: "leader", key: id } : { kind: "direct", key: id },
  }) as never

describe("key grouping", () => {
  test("context first, then global, then system, and empty groups are dropped", () => {
    const sections = groupKeyRows([row("s", "system", "direct"), row("c", "context", "leader"), row("g", "global", "leader")])
    expect(sections.map((section) => section.group)).toEqual(["context", "global", "system"])
    expect(groupKeyRows([row("g", "global", "leader")]).map((section) => section.group)).toEqual(["global"])
  })

  test("the leader lists only leader chords; help lists every binding", () => {
    const rows = [row("c", "context", "leader"), row("i", "context", "direct"), row("g", "global", "leader")]
    expect(leaderKeyRows(rows).flatMap((section) => section.rows.map((entry) => entry.id))).toEqual(["c", "g"])
    expect(groupKeyRows(rows).flatMap((section) => section.rows.map((entry) => entry.id))).toEqual(["c", "i", "g"])
  })

  test("the group headings are the old ones", () => {
    expect(GROUP_TITLES).toEqual({
      context: "CONTEXT",
      global: "GLOBAL",
      system: "SYSTEM",
      plugin: "PLUGINS",
    })
  })
})

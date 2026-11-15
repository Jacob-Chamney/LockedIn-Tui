import { describe, expect, test } from "bun:test"
import { stringWidth } from "bun"

import { AgentsSidebar, rosterLines } from "../../src/ui/shell/agents-sidebar"
const { testRender } = await import("@opentui/solid")
const { crimson } = await import("../../src/ui/theme")

describe("agent roster layout", () => {
  test("wide and control-character names never exceed the sidebar width", () => {
    for (const name of ["漢字".repeat(20), "👩‍👩‍👧‍👦 planner", "line\nbreak", "plain"]) {
      const [line] = rosterLines(
        [{ id: "a1", name, task: "", model: "", permissions: "read-only" }],
        0,
        { width: 28, rows: 1 },
      )
      expect(line).toBeDefined()
      expect(stringWidth(line!)).toBeLessThanOrEqual(28)
      expect(line).not.toContain("\n")
    }
  })
})

test("the roster renders a monogram before each name", async () => {
  const agents = [
    { id: "a1", name: "Ada Lovelace", task: "", model: "", permissions: "read-only" as const },
    { id: "a2", name: "Builder", task: "", model: "", permissions: "write" as const },
  ]
  const setup = await testRender(
    () => (
      <AgentsSidebar
        theme={crimson}
        width={40}
        height={10}
        focused
        project="Atlas"
        agents={agents}
        cursor={0}
      />
    ),
    { width: 40, height: 10 },
  )
  try {
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("[AL]")
    expect(frame).toContain("[BU]")
    expect(frame).toContain("Ada Lovelace")
  } finally {
    await setup.dispose()
  }
})

test("the header stacks the project's monograms", async () => {
  const agents = [
    { id: "a1", name: "Ada Lovelace", task: "", model: "", permissions: "read-only" as const },
    { id: "a2", name: "Builder", task: "", model: "", permissions: "write" as const },
  ]
  const setup = await testRender(
    () => (
      <AgentsSidebar theme={crimson} width={28} height={10} focused project="Atlas" agents={agents} cursor={0} />
    ),
    { width: 28, height: 10 },
  )
  try {
    await setup.flush()
    const header = setup.captureCharFrame().split("\n")[1]!
    expect(header).toContain("[AL][BU]")
  } finally {
    await setup.dispose()
  }
})

test("a crowded header reports the agents that do not fit", async () => {
  const agents = Array.from({ length: 10 }, (_, index) => ({
    id: `a${index}`,
    name: `Agent ${index + 1}`,
    task: "",
    model: "",
    permissions: "read-only" as const,
  }))
  const setup = await testRender(
    () => (
      <AgentsSidebar theme={crimson} width={28} height={18} focused project="Atlas" agents={agents} cursor={0} />
    ),
    { width: 28, height: 18 },
  )
  try {
    await setup.flush()
    const header = setup.captureCharFrame().split("\n")[1]!
    expect(header).toContain("+5")
  } finally {
    await setup.dispose()
  }
})

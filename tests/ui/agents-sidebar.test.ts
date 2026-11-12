import { describe, expect, test } from "bun:test"
import { stringWidth } from "bun"

import { rosterLines } from "../../src/ui/shell/agents-sidebar"

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

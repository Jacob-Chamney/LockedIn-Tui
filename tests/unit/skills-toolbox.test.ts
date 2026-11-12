/** WP-406 — the skills toolbox contract: read-only specs, no path parameters. */

import { describe, expect, test } from "bun:test"

import {
  READ_CAP_BYTES,
  SEARCH_HIT_CAP,
  TRUNCATION_MARKER,
  skillsToolSpecs,
} from "../../src/services/skills/toolbox"

describe("specs", () => {
  test("exactly three tools, all read-only and skills-side", () => {
    const specs = skillsToolSpecs()
    expect(specs.map((spec) => spec.name).sort()).toEqual([
      "list_sources",
      "read_source",
      "search_sources",
    ])
    for (const spec of specs) {
      expect(spec.side).toBe("skills")
      expect(spec.write).toBe(false)
      expect(spec.command).toBe(false)
      expect(spec.inputSchema.additionalProperties).toBe(false)
    }
  })

  test("there is no write, command or plugin tool", () => {
    const names = skillsToolSpecs().map((spec) => spec.name)
    for (const forbidden of ["write", "write_file", "run", "command", "exec", "plugin"]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false)
    }
  })

  test("no schema parameter accepts a path, root or directory", () => {
    for (const spec of skillsToolSpecs()) {
      const properties = Object.keys(spec.inputSchema.properties)
      for (const name of properties) expect(["name", "term"]).toContain(name)
      expect(properties).not.toContain("path")
      expect(properties).not.toContain("root")
      expect(properties).not.toContain("dir")
    }
  })

  test("the spec list is a copy and the caps are the documented ones", () => {
    const first = skillsToolSpecs()
    first[0]!.name = "mutated"
    expect(skillsToolSpecs()[0]?.name).toBe("list_sources")
    expect(READ_CAP_BYTES).toBe(65536)
    expect(SEARCH_HIT_CAP).toBe(50)
    expect(TRUNCATION_MARKER).toContain("truncated")
  })
})

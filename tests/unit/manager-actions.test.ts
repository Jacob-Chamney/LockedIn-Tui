/** One key table for every session manager. */
import { describe, expect, test } from "bun:test"

const { MANAGER_KEYS, managerHints, managerIntent } = await import("../../src/ui/managers/manager-actions")

describe("manager actions", () => {
  test("the standard key set is n, Enter, a, d, x and Esc", () => {
    expect(MANAGER_KEYS.map((entry) => entry.key)).toEqual([
      "n",
      "return",
      "a",
      "d",
      "x",
      "escape",
    ])
    expect(managerIntent("enter")).toBe("open")
    expect(managerIntent("A")).toBe("archive")
    expect(managerIntent("j")).toBeUndefined()
  })

  test("hints are generated in the same order, with export optional", () => {
    expect(managerHints()).toEqual([
      "n new",
      "Enter open",
      "a archive",
      "d delete",
      "x export",
      "Esc back",
    ])
    expect(managerHints({ export: false })).toEqual([
      "n new",
      "Enter open",
      "a archive",
      "d delete",
      "Esc back",
    ])
  })
})

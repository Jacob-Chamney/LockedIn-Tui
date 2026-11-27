/**
 * The core-server rule: a server bypasses “plugins are off in Settings” only
 * when it is the core server for that mode (web search in a skill session),
 * never merely because some core server exists.
 */
import { describe, expect, test } from "bun:test"

const { decidePolicy } = await import("../../src/mcp/policy")

const readOnly = { readOnly: true }

describe("core plugin policy", () => {
  test("web search is allowed in a skill session even when plugins are off", () => {
    expect(
      decidePolicy("skill", readOnly, { enabled: false, core: true, serverId: "web-search" }).kind,
    ).toBe("allow")
  })

  test("another server marked core is still denied", () => {
    expect(
      decidePolicy("skill", readOnly, { enabled: false, core: true, serverId: "filesystem" }).kind,
    ).toBe("deny")
    expect(decidePolicy("skill", readOnly, { enabled: false, core: true }).kind).toBe("deny")
  })

  test("an enabled server is allowed regardless of core", () => {
    expect(decidePolicy("skill", readOnly, { enabled: true, serverId: "filesystem" }).kind).toBe(
      "allow",
    )
  })
})

/**
 * The stored matrix is a setting, so it decides before the mode defaults do.
 * Without a cell the mode rules stand alone (the cases above).
 */
describe("stored policy cells", () => {
  test("off denies, even for the core web-search server", () => {
    expect(
      decidePolicy("skill", readOnly, {
        enabled: true,
        core: true,
        serverId: "web-search",
        cell: "off",
      }).kind,
    ).toBe("deny")
    expect(decidePolicy("chill", readOnly, { enabled: true, serverId: "notes", cell: "off" }).kind).toBe(
      "deny",
    )
  })

  test("explicit needs an explicit call, and allows one", () => {
    expect(
      decidePolicy("chill", readOnly, { enabled: true, serverId: "notes", cell: "explicit" }).kind,
    ).toBe("deny")
    expect(
      decidePolicy("chill", readOnly, {
        enabled: true,
        serverId: "notes",
        cell: "explicit",
        explicitCall: true,
      }).kind,
    ).toBe("allow")
  })

  test("on allows a server that Settings has enabled", () => {
    expect(decidePolicy("work", readOnly, { enabled: true, serverId: "notes", cell: "on" }).kind).toBe(
      "allow",
    )
    // …and a disabled server is still denied: the cell never overrides the
    // master switch.
    expect(decidePolicy("work", readOnly, { enabled: false, serverId: "notes", cell: "on" }).kind).toBe(
      "deny",
    )
  })

  test("a core server ignores the explicit requirement, not the off switch", () => {
    expect(
      decidePolicy("work", readOnly, {
        enabled: false,
        core: true,
        serverId: "web-search",
        cell: "explicit",
      }).kind,
    ).toBe("allow")
    expect(
      decidePolicy("work", readOnly, {
        enabled: false,
        core: true,
        serverId: "web-search",
        cell: "off",
      }).kind,
    ).toBe("deny")
  })
})

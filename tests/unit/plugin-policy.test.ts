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

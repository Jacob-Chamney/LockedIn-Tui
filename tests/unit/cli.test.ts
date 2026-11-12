import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import { parseCli, USAGE } from "../../src/cli"

describe("the binary command line", () => {
  test("no arguments runs the app", () => {
    expect(parseCli([])).toEqual({ kind: "run" })
  })

  test("--workspace accepts both forms and resolves the path", () => {
    expect(parseCli(["--workspace=/tmp/lockedin"])).toEqual({
      kind: "run",
      workspace: "/tmp/lockedin",
    })
    expect(parseCli(["--workspace", "/tmp/lockedin"])).toEqual({
      kind: "run",
      workspace: "/tmp/lockedin",
    })
    expect(parseCli(["-w", "relative"])).toEqual({
      kind: "run",
      workspace: resolve("relative"),
    })
  })

  test("--version and --help are terminal commands", () => {
    expect(parseCli(["--version"])).toEqual({ kind: "version" })
    expect(parseCli(["-v"])).toEqual({ kind: "version" })
    expect(parseCli(["--help"])).toEqual({ kind: "help" })
    expect(parseCli(["-h"])).toEqual({ kind: "help" })
    expect(USAGE).toContain("--workspace")
    expect(USAGE).toContain("--version")
  })

  test("bad input names the problem", () => {
    expect(parseCli(["--bogus"])).toEqual({ kind: "error", message: "unknown argument: --bogus" })
    expect(parseCli(["--workspace"])).toEqual({ kind: "error", message: "--workspace needs a path" })
    expect(parseCli(["--workspace="])).toEqual({ kind: "error", message: "--workspace needs a path" })
  })
})

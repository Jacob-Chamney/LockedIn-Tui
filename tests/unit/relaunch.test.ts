import { describe, expect, test } from "bun:test"

import { relaunch } from "../../src/services/relaunch"

describe("relaunch after update", () => {
  test("a source run does not replace its process", () => {
    const result = relaunch({ release: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("restart LockedIn")
  })

  test("POSIX execs the installed binary with the same arguments", () => {
    const calls: string[] = []
    const result = relaunch({
      release: true,
      platform: "linux",
      execPath: "/home/me/.local/bin/lockedin",
      argv: ["--workspace", "/home/me/LockedIn"],
      env: { HOME: "/home/me" },
      prepare: () => calls.push("prepare"),
      execve: (file, args) => {
        calls.push(`execve ${file} ${args?.join(" ")}`)
        return undefined as never
      },
      exit: () => calls.push("exit"),
    })
    expect(result.ok).toBe(false) // execve returning is a failure, not a fallback exit
    expect(calls).toEqual([
      "prepare",
      "execve /home/me/.local/bin/lockedin /home/me/.local/bin/lockedin --workspace /home/me/LockedIn",
    ])
  })

  test("Windows spawns the new binary and exits", () => {
    const calls: string[] = []
    const result = relaunch({
      release: true,
      platform: "win32",
      execPath: "C:\\LockedIn\\lockedin.exe",
      argv: [],
      spawn: (cmd) => calls.push(`spawn ${cmd.join(" ")}`),
      exit: (code) => calls.push(`exit ${code}`),
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(["spawn C:\\LockedIn\\lockedin.exe", "exit 0"])
  })

  test("without execve the binary is spawned and the old process exits", () => {
    const calls: string[] = []
    const result = relaunch({
      release: true,
      platform: "darwin",
      execPath: "/usr/local/bin/lockedin",
      argv: ["--version"],
      execve: null,
      spawn: (cmd) => calls.push(`spawn ${cmd.join(" ")}`),
      exit: (code) => calls.push(`exit ${code}`),
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(["spawn /usr/local/bin/lockedin --version", "exit 0"])
  })

  test("a terminal that cannot be restored reports the failure", () => {
    const result = relaunch({
      release: true,
      platform: "linux",
      prepare: () => {
        throw new Error("no tty")
      },
      exit: () => {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("no tty")
  })
})

/**
 * The release must carry the notices for everything embedded in the binary.
 *
 * The committed `THIRD-PARTY-NOTICES.md` is verified against `bun.lock`
 * (environment-free), so CI catches a dependency bump that was not followed by
 * `bun run scripts/licenses.ts`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { lockClosure, NOTICES_FILE, noticesProblems, parseLock } from "../../scripts/licenses"

const ROOT = join(import.meta.dir, "..", "..")
const notices = readFileSync(join(ROOT, NOTICES_FILE), "utf8")
const lock = parseLock(readFileSync(join(ROOT, "bun.lock"), "utf8"))
const closure = lockClosure(lock)

describe("third-party notices", () => {
  test("cover every package the lockfile ships", () => {
    expect(closure.size).toBeGreaterThan(50)
    const missing = [...closure.entries()]
      .sort()
      .filter(([name, version]) => !notices.includes(`${name}@${version}`))
    expect(missing).toEqual([])
  })

  test("cover every direct dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    for (const name of Object.keys(pkg.dependencies)) {
      const version = closure.get(name)
      expect(version, `${name} is not in the lockfile closure`).toBeDefined()
      expect(notices).toContain(`${name}@${version}`)
    }
  })

  test("include the runtime, the native packages and the project licence", () => {
    expect(notices).toContain("## Bun runtime")
    expect(notices).toContain("JavaScriptCore")
    expect(notices).toContain("LGPL")
    expect(notices).toContain("@opentui/core-linux-x64@0.8.4")
    expect(notices).toContain("@napi-rs/keyring@2.1.2")
    expect(notices).toContain("LockedIn-Tui is released under the GNU Affero General Public License v3.0")
    expect(notices).not.toContain("/home/")
  })

  test("pass the release script's freshness check", async () => {
    expect(await noticesProblems()).toEqual([])
  })

})

import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { UNLOCK_ALL_ACHIEVEMENTS, RELEASE_BUILD } from "../../src/domain/achievements"
import { APP_VERSION } from "../../src/version"

describe("the release version", () => {
  test("source runs report the package version", async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dir, "../../package.json"), "utf8")) as {
      version: string
    }
    expect(APP_VERSION).toBe(pkg.version)
  })

  test("source runs are development builds", () => {
    expect(RELEASE_BUILD).toBe(false)
    expect(UNLOCK_ALL_ACHIEVEMENTS).toBe(true)
  })
})

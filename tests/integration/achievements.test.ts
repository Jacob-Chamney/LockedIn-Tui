/** Awarded dates persist in the data directory and do not move on reopen. */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace } from "../../src/storage/workspace"
import { AWARDS_FILE, loadAchievementSnapshot } from "../../src/app/actions/achievements"
import { ACHIEVEMENTS } from "../../src/domain/achievements"

const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

test("dev awards are stored once and keep their original date", async () => {
  const base = await mkdtemp(join(tmpdir(), "achievements-store-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")

  const first = await loadAchievementSnapshot({
    dataDir: made.value.paths.dataDir,
    workspace: made.value,
    now: new Date("2026-11-05T12:00:00Z"),
  })
  expect(Object.keys(first.awards)).toHaveLength(ACHIEVEMENTS.length)
  expect(first.awards["first-light"]).toBe("2026-11-05")

  const stored = JSON.parse(
    await readFile(join(made.value.paths.dataDir, AWARDS_FILE), "utf8"),
  ) as Record<string, string>
  expect(stored["first-light"]).toBe("2026-11-05")

  const second = await loadAchievementSnapshot({
    dataDir: made.value.paths.dataDir,
    workspace: made.value,
    now: new Date("2026-11-06T12:00:00Z"),
  })
  expect(second.awards["first-light"]).toBe("2026-11-05")
})

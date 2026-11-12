/** Lifetime counters and awarded dates for the achievement inventory. */
import { mkdir, readFile, rename } from "node:fs/promises"
import { join } from "node:path"

import {
  ACHIEVEMENTS,
  achievementUnlocked,
  type AchievementMetrics,
} from "../../domain/achievements"
import type { Workspace } from "../../storage/workspace"
import { loadGoalRows } from "./skills"
import { loadProjects } from "./projects"
import { loadSessionRows } from "./sessions"

export type AchievementSnapshot = {
  metrics: AchievementMetrics
  /** ISO date (`YYYY-MM-DD`) for each awarded achievement. */
  awards: Record<string, string>
  /** Set when the awards file existed but could not be trusted. */
  warning: string | null
}

export const AWARDS_FILE = "achievements.json"

async function readAwards(
  path: string,
): Promise<{ awards: Record<string, string>; warning: string | null }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { awards: {}, warning: "award dates are not valid JSON" }
    }
    const awards: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) awards[id] = value
    }
    return { awards, warning: null }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { awards: {}, warning: null }
    return { awards: {}, warning: "award dates could not be read" }
  }
}

async function writeAwards(path: string, awards: Record<string, string>): Promise<void> {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {})
  await Bun.write(temporary, `${JSON.stringify(awards, null, 2)}\n`)
  await rename(temporary, path)
}

export async function loadAchievementSnapshot(input: {
  dataDir?: string
  workspace?: Workspace
  now?: Date
}): Promise<AchievementSnapshot> {
  const [summary, sessions, goals, projects] = await Promise.all([
    input.dataDir
      ? import("../../stats/summary")
          .then(({ createStatsService }) =>
            createStatsService({ dir: input.dataDir! }).summary("all", "all"),
          )
          .catch(() => null)
      : Promise.resolve(null),
    input.workspace ? loadSessionRows(input.workspace).catch(() => []) : Promise.resolve([]),
    input.workspace ? loadGoalRows(input.workspace).catch(() => []) : Promise.resolve([]),
    input.workspace ? loadProjects(input.workspace).catch(() => []) : Promise.resolve([]),
  ])

  const metrics: AchievementMetrics = {
    messages: summary?.overview.runs ?? 0,
    toolCalls: summary?.tools.reduce((total, tool) => total + tool.calls, 0) ?? 0,
    steps: summary?.learning.steps ?? 0,
    cardsKnown: summary?.learning.cardsKnown ?? 0,
    lessons: summary?.learning.lessons ?? 0,
    sessions: sessions.filter((row) => !row.broken).length,
    skills: goals.filter((row) => !row.broken).length,
    projects: projects.length,
    sources: sessions.reduce((total, row) => total + row.sources, 0),
    agents: projects.reduce((total, project) => total + project.agents.length, 0),
    stages: goals.reduce((total, row) => total + row.stage.done, 0),
    chapters: goals.reduce((total, row) => total + (row.chapters?.done ?? 0), 0),
  }

  const stored = input.dataDir
    ? await readAwards(join(input.dataDir, AWARDS_FILE))
    : { awards: {}, warning: null }
  const awards = stored.awards
  let changed = false
  const today = (input.now ?? new Date()).toISOString().slice(0, 10)
  for (const achievement of ACHIEVEMENTS) {
    if (!achievementUnlocked(achievement, metrics)) continue
    if (awards[achievement.id] !== undefined) continue
    awards[achievement.id] = today
    changed = true
  }
  if (changed && input.dataDir) {
    await writeAwards(join(input.dataDir, AWARDS_FILE), awards).catch(() => {})
  }
  return { metrics, awards, warning: stored.warning }
}

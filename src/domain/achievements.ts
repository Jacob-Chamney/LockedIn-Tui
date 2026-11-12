/**
 * Achievement catalogue and unlock rules.
 *
 * The catalogue is intentionally data, not UI: an achievement owns its task,
 * one numeric milestone and the shelf it belongs on. The picture is looked up
 * by id from the art module, so no drawing data lives here.
 */

export type AchievementMetric =
  | "messages"
  | "toolCalls"
  | "steps"
  | "cardsKnown"
  | "lessons"
  | "sessions"
  | "skills"
  | "projects"
  | "sources"
  | "agents"
  | "stages"
  | "chapters"

export type AchievementCategory = "starter" | "learning" | "work" | "collection"

export type Achievement = {
  id: string
  name: string
  /** One sentence shown on the detail card. */
  task: string
  category: AchievementCategory
  metric: AchievementMetric
  target: number
}

export type AchievementMetrics = Record<AchievementMetric, number>

export const EMPTY_METRICS: AchievementMetrics = {
  messages: 0,
  toolCalls: 0,
  steps: 0,
  cardsKnown: 0,
  lessons: 0,
  sessions: 0,
  skills: 0,
  projects: 0,
  sources: 0,
  agents: 0,
  stages: 0,
  chapters: 0,
}

import { RELEASE_BUILD } from "../version"

/**
 * Dev and test sources show the finished inventory with every slot open.
 * `scripts/build.ts` defines `LOCKEDIN_RELEASE=1` in a compiled artifact, which
 * locks achievements and lets the real counters decide when each one opens.
 */
export { RELEASE_BUILD }
export const UNLOCK_ALL_ACHIEVEMENTS = !RELEASE_BUILD

export const ACHIEVEMENTS: readonly Achievement[] = [
  // Starter: the first use of each side of the app.
  { id: "first-light", name: "First Light", task: "Send your first message.", category: "starter", metric: "messages", target: 1 },
  { id: "open-book", name: "Open Book", task: "Create your first lock-in session.", category: "starter", metric: "sessions", target: 1 },
  { id: "blank-canvas", name: "Blank Canvas", task: "Create your first skill session.", category: "starter", metric: "skills", target: 1 },
  { id: "groundwork", name: "Groundwork", task: "Register your first project.", category: "starter", metric: "projects", target: 1 },
  { id: "well-read", name: "Well Read", task: "Gather five lock-in sources.", category: "starter", metric: "sources", target: 5 },
  { id: "first-tool", name: "First Tool", task: "Make your first tool call.", category: "starter", metric: "toolCalls", target: 1 },
  { id: "first-lesson", name: "First Lesson", task: "Complete your first lesson.", category: "starter", metric: "lessons", target: 1 },
  { id: "first-hire", name: "First Hire", task: "Add your first agent.", category: "starter", metric: "agents", target: 1 },

  // Learning: study progress, from first steps to a full curriculum.
  { id: "first-steps", name: "First Steps", task: "Tick off ten assignment steps.", category: "learning", metric: "steps", target: 10 },
  { id: "long-march", name: "Long March", task: "Tick off one hundred assignment steps.", category: "learning", metric: "steps", target: 100 },
  { id: "long-walk", name: "The Long Walk", task: "Tick off five hundred assignment steps.", category: "learning", metric: "steps", target: 500 },
  { id: "memory-palace", name: "Memory Palace", task: "Know twenty-five flashcards.", category: "learning", metric: "cardsKnown", target: 25 },
  { id: "grandmaster", name: "Grandmaster", task: "Know one hundred flashcards.", category: "learning", metric: "cardsKnown", target: 100 },
  { id: "eidetic", name: "Eidetic", task: "Know five hundred flashcards.", category: "learning", metric: "cardsKnown", target: 500 },
  { id: "course-correction", name: "Course Correction", task: "Complete five lessons.", category: "learning", metric: "lessons", target: 5 },
  { id: "lesson-master", name: "Lesson Master", task: "Complete twenty-five lessons.", category: "learning", metric: "lessons", target: 25 },
  { id: "curriculum-complete", name: "Curriculum Complete", task: "Finish ten curriculum stages.", category: "learning", metric: "stages", target: 10 },
  { id: "lifelong-curriculum", name: "Lifelong Curriculum", task: "Finish fifty curriculum stages.", category: "learning", metric: "stages", target: 50 },
  { id: "chapter-and-verse", name: "Chapter and Verse", task: "Complete ten skill chapters.", category: "learning", metric: "chapters", target: 10 },
  { id: "shelf-life", name: "Shelf Life", task: "Complete fifty skill chapters.", category: "learning", metric: "chapters", target: 50 },

  // Work: volume, tools, projects and teams.
  { id: "ten-runs", name: "Ten Thousand Miles", task: "Finish ten model replies.", category: "work", metric: "messages", target: 10 },
  { id: "centurion", name: "Centurion", task: "Finish one hundred model replies.", category: "work", metric: "messages", target: 100 },
  { id: "thousand-voices", name: "Thousand Voices", task: "Finish five hundred model replies.", category: "work", metric: "messages", target: 500 },
  { id: "toolsmith", name: "Toolsmith", task: "Make twenty-five tool calls.", category: "work", metric: "toolCalls", target: 25 },
  { id: "machinist", name: "Machinist", task: "Make one hundred tool calls.", category: "work", metric: "toolCalls", target: 100 },
  { id: "workshop", name: "Workshop", task: "Make five hundred tool calls.", category: "work", metric: "toolCalls", target: 500 },
  { id: "architect", name: "Architect", task: "Register three projects.", category: "work", metric: "projects", target: 3 },
  { id: "metropolis", name: "Metropolis", task: "Register ten projects.", category: "work", metric: "projects", target: 10 },
  { id: "swarmkeeper", name: "Swarmkeeper", task: "Staff five agents across your projects.", category: "work", metric: "agents", target: 5 },
  { id: "hive-mind", name: "Hive Mind", task: "Staff twenty agents across your projects.", category: "work", metric: "agents", target: 20 },
  { id: "research-desk", name: "Research Desk", task: "Gather twenty-five lock-in sources.", category: "work", metric: "sources", target: 25 },
  { id: "library", name: "Library", task: "Gather one hundred lock-in sources.", category: "work", metric: "sources", target: 100 },

  // Collection: breadth of the library itself.
  { id: "locked-in", name: "Locked In", task: "Create ten lock-in sessions.", category: "collection", metric: "sessions", target: 10 },
  { id: "semester", name: "Semester", task: "Create fifty lock-in sessions.", category: "collection", metric: "sessions", target: 50 },
  { id: "curriculum-collector", name: "Curriculum Collector", task: "Create five skill sessions.", category: "collection", metric: "skills", target: 5 },
  { id: "lifelong-learner", name: "Lifelong Learner", task: "Create twenty-five skill sessions.", category: "collection", metric: "skills", target: 25 },
]

export function achievementValue(achievement: Achievement, metrics: AchievementMetrics): number {
  return Math.max(0, metrics[achievement.metric])
}

export function achievementUnlocked(
  achievement: Achievement,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): boolean {
  if (unlockAll) return true
  return achievementValue(achievement, metrics) >= achievement.target
}

export function unlockedCount(
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): number {
  return ACHIEVEMENTS.filter((achievement) => achievementUnlocked(achievement, metrics, unlockAll)).length
}

/** `3 / 10` progress plus a completed marker for the detail card. */
export function progressLine(
  achievement: Achievement,
  metrics: AchievementMetrics,
  unlockAll = UNLOCK_ALL_ACHIEVEMENTS,
): string {
  const unlocked = achievementUnlocked(achievement, metrics, unlockAll)
  const value = unlocked
    ? achievement.target
    : Math.min(achievement.target, achievementValue(achievement, metrics))
  return unlocked
    ? `progress ${value} / ${achievement.target} · complete`
    : `progress ${value} / ${achievement.target}`
}

/** The share card is text only; the picture stays in the app. */
export function shareText(achievement: Achievement): string {
  return [
    "ACHIEVEMENT UNLOCKED",
    "",
    achievement.name,
    achievement.task,
    "",
    "— LockedIn",
  ].join("\n")
}

/** Difficulty bands derived from the target value alone. */
export const DIFFICULTY_BANDS = [10, 25, 50, 100, 250, 500, 1000] as const
export const DIFFICULTY_LABELS = [
  "easiest",
  "easy",
  "medium",
  "hard",
  "very hard",
  "severe",
  "extreme",
  "legendary",
] as const

/** 1-based tier: <=10 easiest, <=25 easy, … <=1000 extreme, above legendary. */
export function difficultyTier(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1
  for (let index = 0; index < DIFFICULTY_BANDS.length; index++) {
    if (target <= DIFFICULTY_BANDS[index]!) return index + 1
  }
  return DIFFICULTY_LABELS.length
}

export function difficultyLabel(target: number): string {
  return DIFFICULTY_LABELS[difficultyTier(target) - 1] ?? DIFFICULTY_LABELS[0]
}

/**
 * Review queue from a real workspace.
 *
 * `src/domain/review.ts` computes the ordering, the exclusions and the nudge
 * signal from snapshots; nothing produced those snapshots, so the module had no
 * production consumer. This service reads the workspace and hands the domain the
 * snapshots — it re-derives none of the rules.
 *
 * Read-only: every file is opened for reading and nothing is written. A session
 * or goal that cannot be read becomes a diagnostic and is skipped, so one broken
 * folder never hides the rest of the queue.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseProgress } from "../../domain/progress";
import { DEFAULT_INTENSITY, NUDGE_THRESHOLDS, buildReviewQueue, type CardEntry, type FlashcardState, type LockInStepSnapshot, type MemoryHit, type NudgeIntensity, type ReviewItem, type ReviewQueue, type SkillStageState, type StageEntry } from "../../domain/review";
import type { SourceCoverage } from "../../domain/coverage";
import { SESSION_FILES } from "../../domain/session";
import { readConfig } from "../../storage/config";
import type { Workspace } from "../../storage/workspace";
import { readMemory } from "../lockin/memory";
import { readSteps } from "../lockin/steps";
import { openSession } from "../lockin/manager";
import { readMeta } from "../skills/progress";
import { parseDeck } from "../skills/outputs";
export type ReviewDiagnostic = {
  kind: "review"
  path: string
  message: string
  /** One actionable sentence; the queue is usable without it. */
  next: string
}

export type ReviewQueueResult = ReviewQueue & {
  diagnostics: ReviewDiagnostic[]
  intensity: NudgeIntensity
}

export type ReviewQueueOptions = {
  /** Overrides config; used by tests and by the Settings preview. */
  intensity?: NudgeIntensity
}


const INTENSITIES: readonly NudgeIntensity[] = ["gentle", "balanced", "intensive"]

/** Folders worth reading: real directories, never a temp or hidden one. */
async function folders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(root, entry.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * Recorded misses per step, from `progress.jsonl`.
 *
 * Only `review` events with `result: "missed"` count: a toggle is progress, not a
 * miss, and the file is telemetry the Markdown can live without.
 */
async function missedSteps(folder: string): Promise<Map<number, number>> {
  const counts = new Map<number, number>()
  let text: string
  try {
    text = await readFile(join(folder, SESSION_FILES.progress), "utf8")
  } catch {
    return counts
  }

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const event = JSON.parse(line) as { event?: string; index?: number; result?: string }
      if (event.event !== "review" || event.result !== "missed") continue
      if (typeof event.index !== "number") continue
      counts.set(event.index, (counts.get(event.index) ?? 0) + 1)
    } catch {
      continue
    }
  }
  return counts
}

/** The intensity the user configured, or the documented default. */
export async function configuredIntensity(workspace: Workspace): Promise<NudgeIntensity> {
  const loaded = await readConfig(workspace.paths)
  if (!loaded.ok) return DEFAULT_INTENSITY
  const value = loaded.value.config.ui.nudge_intensity as NudgeIntensity
  return INTENSITIES.includes(value) ? value : DEFAULT_INTENSITY
}

/**
 * Read every session and goal and return the queue the UI renders.
 *
 * Nothing below writes: the tree is byte-identical after the call, which the
 * test asserts with a hash.
 */
export async function reviewQueue(
  workspace: Workspace,
  options: ReviewQueueOptions = {},
): Promise<ReviewQueueResult> {
  const intensity = options.intensity ?? (await configuredIntensity(workspace))
  const diagnostics: ReviewDiagnostic[] = []

  const stepSnapshots: LockInStepSnapshot[] = []
  const deckStates: FlashcardState[] = []
  const memoryHits: MemoryHit[] = []
  const goalStates: SkillStageState[] = []

  for (const folder of await folders(workspace.paths.schoolSessions)) {
    const id = basename(folder)
    const opened = await openSession({ workspace, id })
    if (!opened.ok) {
      diagnostics.push({
        kind: "review",
        path: folder,
        message: `session "${id}" could not be read: ${opened.error.message}`,
        next: "Open the session from the manager to repair it, or archive it.",
      })
      continue
    }

    const session = opened.value.session
    const misses = await missedSteps(folder)

    const steps = await readSteps(folder)
    if (steps !== null) {
      const parsed = parseProgress(steps)
      if (!parsed.ok) {
        diagnostics.push({
          kind: "review",
          path: join(folder, SESSION_FILES.steps),
          message: `steps for "${session.name}" could not be parsed: ${parsed.error.message}`,
          next: "Regenerate the steps for this session.",
        })
      } else {
        stepSnapshots.push({
          sessionId: session.id,
          sessionName: session.name,
          steps: parsed.value.items.map((item) => ({
            index: item.index,
            text: item.text,
            checked: item.checked,
            misses: misses.get(item.index) ?? 0,
          })),
        })
      }
    }

    // Memory is history, never a source: it enters as its own kind.
    const memory = await readMemory(folder, session.id)
    if (memory.ok && memory.value !== null) {
      for (const [index, point] of memory.value.points.entries()) {
        memoryHits.push({
          sessionId: session.id,
          sessionName: session.name,
          noteId: `${session.id}-${index}`,
          excerpt: point,
        })
      }
    }

    // Missed cards come from the session's deck, if it has one.
    const deckPath = join(workspace.paths.root, "school", "outputs", session.id, "flashcards.md")
    let deckText: string
    try {
      deckText = await readFile(deckPath, "utf8")
    } catch {
      deckText = ""
    }
    if (deckText !== "") {
      const cards: CardEntry[] = parseDeck(deckText)
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => card.missed && !card.known)
        .map(({ card, index }) => ({
          id: `card-${index + 1}`,
          question: card.question,
          missed: card.missed,
          known: card.known,
          misses: 0,
        }))
      if (cards.length > 0) {
        deckStates.push({ deckId: session.id, deckName: session.name, cards })
      }
    }
  }

  for (const folder of await folders(workspace.paths.goals)) {
    const id = basename(folder)
    const meta = await readMeta(folder)
    if (!meta.ok) {
      diagnostics.push({
        kind: "review",
        path: folder,
        message: `goal "${id}" could not be read: ${meta.error.message}`,
        next: "Open the goal from the manager to repair it, or archive it.",
      })
      continue
    }

    const goal = meta.value.goal
    const stages: StageEntry[] = goal.stages
      .filter((stage) => stage.status !== "done")
      .map((stage) => ({ id: stage.id, title: stage.title, status: stage.status, misses: 0 }))
    if (stages.length > 0) {
      goalStates.push({ goalId: goal.id, goalName: goal.name, stages })
    }
  }

  const queue = buildReviewQueue({
    steps: stepSnapshots,
    decks: deckStates,
    goals: goalStates,
    memory: memoryHits,
    intensity,
  })

  return { ...queue, diagnostics, intensity }
}

/** Convenience for the review screen: only the items, unchanged order. */
export function queueItems(result: ReviewQueueResult): ReviewItem[] {
  return result.items
}

/** Threshold the current intensity uses, for the status line. */
export function intensityThreshold(intensity: NudgeIntensity): number {
  return NUDGE_THRESHOLDS[intensity]
}

export type { SourceCoverage }

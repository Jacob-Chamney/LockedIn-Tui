/**
 * Review queue aggregation.
 *
 * Combines recorded state into one deterministic list: unchecked steps, missed
 * cards, unfinished skill stages and session memory. Nothing here calls a model,
 * reads a file or schedules anything — it is a pure projection of what is
 * already recorded (`docs/product.md` §6.1–6.2).
 *
 * Two rules the shape of this module enforces:
 * - **memory is labelled, never a source.** Memory items carry
 *   `origin: "session-memory"`, and source coverage is returned in its own
 *   field. There is no code path that can place a memory hit among coverage.
 * - **a nudge is a suggestion.** Crossing a threshold produces an entry in
 *   `nudge.suggestions`; it never mutates an item, reorders the queue or marks
 *   anything.
 */

import { coverageGaps, type CoverageReport, type SourceCoverage } from "./coverage"

export type ReviewItemKind = "step" | "card" | "stage" | "memory"

/** Why the item is in the queue, in the words of `docs/product.md` §6.1. */
export type ReviewReason = "unchecked" | "missed" | "unfinished" | "memory"

/** Where the item came from; `session-memory` is never a source. */
export type ReviewOrigin = "steps" | "flashcards" | "curriculum" | "session-memory"

export type NudgeIntensity = "gentle" | "balanced" | "intensive"

/** `docs/product.md` §6.2: gentle 5, balanced 3, intensive 2. */
export const NUDGE_THRESHOLDS: Readonly<Record<NudgeIntensity, number>> = {
  gentle: 5,
  balanced: 3,
  intensive: 2,
}

export const DEFAULT_INTENSITY: NudgeIntensity = "balanced"

/** Label the UI must use for memory so it is never mistaken for a source. */
export const MEMORY_LABEL = "session memory"

// ------------------------------------------------------------------ inputs

export type StepEntry = {
  /** Position in `assignment-steps.md`; part of the item id. */
  index: number
  text: string
  checked: boolean
  /** Recorded misses for this step; absent means zero. */
  misses?: number
}

export type LockInStepSnapshot = {
  sessionId: string
  sessionName: string
  steps: readonly StepEntry[]
}

export type CardEntry = {
  id: string
  question: string
  missed: boolean
  known: boolean
  misses?: number
}

export type FlashcardState = {
  deckId: string
  deckName: string
  cards: readonly CardEntry[]
}

export type StageEntry = {
  id: string
  title: string
  status: "pending" | "active" | "done"
  misses?: number
}

export type SkillStageState = {
  goalId: string
  goalName: string
  stages: readonly StageEntry[]
}

export type MemoryHit = {
  sessionId: string
  sessionName: string
  noteId: string
  /** One line of the memory note, as stored. */
  excerpt: string
}

export type ReviewInput = {
  steps?: readonly LockInStepSnapshot[]
  decks?: readonly FlashcardState[]
  goals?: readonly SkillStageState[]
  memory?: readonly MemoryHit[]
  coverage?: CoverageReport | null
  intensity?: NudgeIntensity
}

// ------------------------------------------------------------------ items

export type ReviewItem = {
  /** Stable across runs: kind + context id + local id. */
  id: string
  kind: ReviewItemKind
  label: string
  /** Context name shown beside the item (session, deck or goal name). */
  context: string
  contextId: string
  reason: ReviewReason
  /** Lower sorts first. */
  priority: number
  /** Recorded misses; drives the nudge signal. */
  count: number
  origin: ReviewOrigin
}

/** Missed cards first, then unchecked steps, unfinished stages, memory. */
export const KIND_PRIORITY: Readonly<Record<ReviewItemKind, number>> = {
  card: 0,
  step: 1,
  stage: 2,
  memory: 3,
}

export const MAX_LABEL_CHARS = 120

function clampLabel(text: string): string {
  const line = text.split("\n").find((item) => item.trim() !== "") ?? ""
  const trimmed = line.trim()
  return trimmed.length > MAX_LABEL_CHARS ? `${trimmed.slice(0, MAX_LABEL_CHARS)}…` : trimmed
}

function missesOf(entry: { misses?: number }): number {
  const value = entry.misses ?? 0
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// ------------------------------------------------------------------ nudge

export type ReviewSuggestion = {
  itemId: string
  label: string
  context: string
  count: number
  threshold: number
  /** Copy the UI shows; a suggestion, never an action. */
  message: string
}

export type NudgeState = {
  intensity: NudgeIntensity
  threshold: number
  due: string[]
  suggestions: ReviewSuggestion[]
}

// ------------------------------------------------------------------ queue

export type ReviewQueue = {
  items: ReviewItem[]
  nudge: NudgeState
  /** Unreferenced sources, deliberately outside `items`. */
  coverage: SourceCoverage[]
  counts: { total: number; byKind: Record<ReviewItemKind, number> }
}

function compareItems(a: ReviewItem, b: ReviewItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  const left = a.context.toLowerCase()
  const right = b.context.toLowerCase()
  if (left !== right) return left < right ? -1 : 1
  if (a.contextId !== b.contextId) return a.contextId < b.contextId ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Build the queue.
 *
 * Completed work is excluded rather than filtered later: checked steps, known
 * cards and done stages never enter. Order is fully determined by kind
 * priority, then context name, then context id, then item id — no input order
 * leaks into the result.
 */
export function buildReviewQueue(input: ReviewInput): ReviewQueue {
  const collected: ReviewItem[] = []

  for (const snapshot of input.steps ?? []) {
    for (const step of snapshot.steps) {
      if (step.checked) continue
      collected.push({
        id: `step:${snapshot.sessionId}:${step.index}`,
        kind: "step",
        label: clampLabel(step.text),
        context: snapshot.sessionName,
        contextId: snapshot.sessionId,
        reason: "unchecked",
        priority: KIND_PRIORITY.step,
        count: missesOf(step),
        origin: "steps",
      })
    }
  }

  for (const deck of input.decks ?? []) {
    for (const card of deck.cards) {
      // Known cards leave the queue; a card that was never marked is not review.
      if (card.known || !card.missed) continue
      collected.push({
        id: `card:${deck.deckId}:${card.id}`,
        kind: "card",
        label: clampLabel(card.question),
        context: deck.deckName,
        contextId: deck.deckId,
        reason: "missed",
        priority: KIND_PRIORITY.card,
        count: missesOf(card),
        origin: "flashcards",
      })
    }
  }

  for (const goal of input.goals ?? []) {
    for (const stage of goal.stages) {
      if (stage.status === "done") continue
      collected.push({
        id: `stage:${goal.goalId}:${stage.id}`,
        kind: "stage",
        label: clampLabel(stage.title),
        context: goal.goalName,
        contextId: goal.goalId,
        reason: "unfinished",
        priority: KIND_PRIORITY.stage,
        count: missesOf(stage),
        origin: "curriculum",
      })
    }
  }

  for (const hit of input.memory ?? []) {
    collected.push({
      id: `memory:${hit.sessionId}:${hit.noteId}`,
      kind: "memory",
      label: clampLabel(hit.excerpt),
      context: hit.sessionName,
      contextId: hit.sessionId,
      reason: "memory",
      priority: KIND_PRIORITY.memory,
      count: 0,
      origin: "session-memory",
    })
  }

  // De-duplicate by id, keeping the first occurrence, then impose the order.
  const seen = new Set<string>()
  const items: ReviewItem[] = []
  for (const item of collected) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  items.sort(compareItems)

  const intensity = input.intensity ?? DEFAULT_INTENSITY
  const threshold = NUDGE_THRESHOLDS[intensity]
  const dueItems = items.filter((item) => item.count >= threshold)

  const byKind: Record<ReviewItemKind, number> = { step: 0, card: 0, stage: 0, memory: 0 }
  for (const item of items) byKind[item.kind]++

  return {
    items,
    nudge: {
      intensity,
      threshold,
      due: dueItems.map((item) => item.id),
      suggestions: dueItems.map((item) => ({
        itemId: item.id,
        label: item.label,
        context: item.context,
        count: item.count,
        threshold,
        message:
          `"${item.label}" has been missed ${item.count} times ` +
          `(threshold ${threshold}). Review it next?`,
      })),
    },
    coverage: input.coverage ? coverageGaps(input.coverage) : [],
    counts: { total: items.length, byKind },
  }
}

/** An item is "due" when its recorded misses reach the intensity threshold. */
export function isDue(item: ReviewItem, intensity: NudgeIntensity = DEFAULT_INTENSITY): boolean {
  return item.count >= NUDGE_THRESHOLDS[intensity]
}

/** Recorded misses for an item, for the UI that increments it. */
export function withMisses(item: ReviewItem, misses: number): ReviewItem {
  return { ...item, count: missesOf({ misses }) }
}

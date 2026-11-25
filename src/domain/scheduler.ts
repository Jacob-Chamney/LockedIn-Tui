/**
 * Spaced repetition for flashcards.
 *
 * This is our own scheduler, not a port of anyone else's: four grades, one
 * ease per card, and a due instant. The rules are deliberately small enough to
 * explain in a sentence and test exactly:
 *
 * - `again` is a miss: the card comes back in ten minutes, its ease drops, and
 *   the lapse is counted.
 * - `hard` and `easy` bend the next interval down or up; `good` is the neutral
 *   path.
 * - A new card (interval < 1 day) graduates to 12 hours, 1 day or 3 days.
 * - A learned card multiplies its interval by its ease (`easy` also gets a
 *   1.3× bonus), floored at one day and capped at a year.
 * - Ease stays inside 1.3–3.0, so one bad day cannot make a card impossible.
 *
 * The scheduler is pure: `now` is a parameter, never the wall clock, so the
 * same sequence of grades produces the same schedule everywhere.
 */

export const REVIEW_GRADES = ["again", "hard", "good", "easy"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export const EASE_MIN = 1.3;
export const EASE_MAX = 3.0;
export const EASE_START = 2.5;
/** A card is never scheduled further away than this. */
export const MAX_INTERVAL_DAYS = 365;
/** The learning step for a miss, in days. */
export const AGAIN_STEP_DAYS = 10 / (24 * 60);

export type CardSchedule = {
  /** A stable key for the card, derived from its question. */
  key: string;
  /** The next instant the card is due, ISO-8601. */
  due: string;
  /** Days until the next review. Fractional for a learning step. */
  intervalDays: number;
  /** The multiplier applied to the interval when the card is learned. */
  ease: number;
  /** How many times the card has been graded. */
  reps: number;
  /** How many times `again` was chosen. */
  lapses: number;
  lastGrade?: ReviewGrade;
  lastAt?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stable identity of a card: its question, normalised. */
export function cardKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function newSchedule(key: string, now: Date): CardSchedule {
  return {
    key,
    due: now.toISOString(),
    intervalDays: 0,
    ease: EASE_START,
    reps: 0,
    lapses: 0,
  };
}

function clampEase(value: number): number {
  return Math.min(EASE_MAX, Math.max(EASE_MIN, Math.round(value * 100) / 100));
}

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * Apply one grade.
 *
 * The input is never mutated: a caller can keep the previous schedule for an
 * undo or a comparison.
 */
export function reviewCard(
  schedule: CardSchedule,
  grade: ReviewGrade,
  now: Date,
): CardSchedule {
  const easeDelta =
    grade === "again" ? -0.2 : grade === "hard" ? -0.15 : grade === "easy" ? 0.15 : 0;
  const ease = clampEase(schedule.ease + easeDelta);
  const learned = schedule.intervalDays >= 1;

  let intervalDays: number;
  if (grade === "again") {
    intervalDays = AGAIN_STEP_DAYS;
  } else if (!learned) {
    intervalDays = grade === "hard" ? 0.5 : grade === "good" ? 1 : 3;
  } else if (grade === "hard") {
    intervalDays = Math.max(1, schedule.intervalDays * 1.2);
  } else if (grade === "good") {
    intervalDays = Math.max(1, schedule.intervalDays * ease);
  } else {
    intervalDays = Math.max(1, schedule.intervalDays * ease * 1.3);
  }
  intervalDays = Math.min(MAX_INTERVAL_DAYS, intervalDays);

  return {
    key: schedule.key,
    due: addDays(now, intervalDays),
    intervalDays,
    ease,
    reps: schedule.reps + 1,
    lapses: schedule.lapses + (grade === "again" ? 1 : 0),
    lastGrade: grade,
    lastAt: now.toISOString(),
  };
}

/** True when the card is due at [now]. */
export function isDue(schedule: CardSchedule, now: Date): boolean {
  const due = Date.parse(schedule.due);
  return Number.isFinite(due) && due <= now.getTime();
}

/** How many of [schedules] are due at [now]. */
export function dueCount(schedules: readonly CardSchedule[], now: Date): number {
  return schedules.reduce((count, schedule) => count + (isDue(schedule, now) ? 1 : 0), 0);
}

/**
 * Pair a deck's questions with stored schedules, in deck order.
 *
 * The deck is the truth; the schedule is state beside it. A question that is
 * still in the deck keeps its schedule (and therefore its progress) even when
 * the deck is regenerated; a new question starts due now. A repeated question
 * gets an occurrence suffix so two identical prompts do not share one history.
 */
export function mergeSchedules(
  questions: readonly string[],
  stored: readonly CardSchedule[],
  now: Date,
): CardSchedule[] {
  const byKey = new Map(stored.map((schedule) => [schedule.key, schedule]));
  const used = new Set<string>();
  return questions.map((question) => {
    const base = cardKey(question);
    let key = base;
    let occurrence = 2;
    while (used.has(key)) key = `${base}#${occurrence++}`;
    used.add(key);
    return byKey.get(key) ?? newSchedule(key, now);
  });
}

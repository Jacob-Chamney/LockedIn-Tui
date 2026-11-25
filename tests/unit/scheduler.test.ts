/**
 * The flashcard scheduler: four grades, one ease, one due instant.
 *
 * The rules are small on purpose, so the tests can pin them exactly instead of
 * asserting "some time later". `now` is injected everywhere, so this file has no
 * clock and cannot flake.
 */
import { describe, expect, test } from "bun:test";

import {
  AGAIN_STEP_DAYS,
  EASE_MAX,
  EASE_MIN,
  EASE_START,
  cardKey,
  dueCount,
  isDue,
  mergeSchedules,
  newSchedule,
  reviewCard,
} from "../../src/domain/scheduler";

const NOW = new Date("2026-11-24T10:00:00.000Z");
const KEY = "what does a register hold";

describe("reviewCard", () => {
  test("a new card graduates by grade", () => {
    const start = newSchedule(KEY, NOW);
    expect(reviewCard(start, "hard", NOW).intervalDays).toBe(0.5);
    expect(reviewCard(start, "good", NOW).intervalDays).toBe(1);
    expect(reviewCard(start, "easy", NOW).intervalDays).toBe(3);
    expect(start.reps).toBe(0); // never mutated
  });

  test("again is a ten-minute learning step with a lapse and a lower ease", () => {
    const next = reviewCard(newSchedule(KEY, NOW), "again", NOW);
    expect(next.intervalDays).toBeCloseTo(AGAIN_STEP_DAYS, 2);
    expect(next.lapses).toBe(1);
    expect(next.ease).toBeCloseTo(EASE_START - 0.2, 2);
    expect(Date.parse(next.due) - NOW.getTime()).toBeCloseTo(10 * 60 * 1000, -2);
  });

  test("a learned card multiplies its interval by the new ease", () => {
    const learned = { ...newSchedule(KEY, NOW), intervalDays: 10, ease: 2.5, reps: 3 };
    const good = reviewCard(learned, "good", NOW);
    expect(good.intervalDays).toBe(25);
    const hard = reviewCard(learned, "hard", NOW);
    expect(hard.intervalDays).toBe(12);
    const easy = reviewCard(learned, "easy", NOW);
    expect(easy.intervalDays).toBeCloseTo(10 * 2.65 * 1.3, 2);
  });

  test("ease is clamped at both ends", () => {
    let schedule = { ...newSchedule(KEY, NOW), intervalDays: 10, ease: EASE_MIN };
    schedule = reviewCard(schedule, "again", NOW);
    expect(schedule.ease).toBe(EASE_MIN);
    let high = { ...newSchedule(KEY, NOW), intervalDays: 10, ease: EASE_MAX };
    high = reviewCard(high, "easy", NOW);
    expect(high.ease).toBe(EASE_MAX);
  });

  test("the interval never exceeds a year", () => {
    const old = { ...newSchedule(KEY, NOW), intervalDays: 300, ease: 3, reps: 8 };
    expect(reviewCard(old, "easy", NOW).intervalDays).toBe(365);
  });

  test("the due instant is the interval from now", () => {
    const next = reviewCard({ ...newSchedule(KEY, NOW), intervalDays: 4, ease: 2.5 }, "good", NOW);
    expect(next.due).toBe(new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("due", () => {
  test("a new card is due now; a future card is not", () => {
    expect(isDue(newSchedule(KEY, NOW), NOW)).toBe(true);
    const later = reviewCard(newSchedule(KEY, NOW), "good", NOW);
    expect(isDue(later, NOW)).toBe(false);
    expect(isDue(later, new Date(Date.parse(later.due) + 1))).toBe(true);
  });

  test("dueCount counts only what is due", () => {
    const cards = [
      newSchedule("a", NOW),
      reviewCard(newSchedule("b", NOW), "good", NOW),
      newSchedule("c", NOW),
    ];
    expect(dueCount(cards, NOW)).toBe(2);
  });
});

describe("mergeSchedules", () => {
  test("a surviving question keeps its schedule; a new one starts due now", () => {
    const old = reviewCard(newSchedule(cardKey("What is a register?"), NOW), "good", NOW);
    const merged = mergeSchedules(
      ["What is a register?", "What is a stack frame?"],
      [old],
      NOW,
    );
    expect(merged[0]!.due).toBe(old.due);
    expect(merged[0]!.reps).toBe(1);
    expect(merged[1]!.reps).toBe(0);
    expect(merged[1]!.due).toBe(NOW.toISOString());
  });

  test("a removed question takes its schedule with it", () => {
    const old = reviewCard(newSchedule(cardKey("old"), NOW), "good", NOW);
    const merged = mergeSchedules(["new"], [old], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.key).toBe("new");
  });

  test("two identical questions do not share one history", () => {
    const merged = mergeSchedules(["same", "same"], [], NOW);
    expect(merged[0]!.key).toBe("same");
    expect(merged[1]!.key).toBe("same#2");
  });

  test("a regenerated deck keeps the order it was given", () => {
    const merged = mergeSchedules(["b", "a"], [], NOW);
    expect(merged.map((card) => card.key)).toEqual(["b", "a"]);
  });
});

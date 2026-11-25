/**
 * The teaching plan is a dependency map, so "next" is not "the next row".
 *
 * `nextStepIndex` is the one place that decides which step a learner is offered.
 * These cases pin the two behaviours the surface depends on: a branch becomes
 * available as soon as its own prerequisite is held, and a legacy record with no
 * `requires` keeps the linear order it was written with.
 */
import { describe, expect, test } from "bun:test";

import type { TeachingStep } from "../../src/domain/teaching";
import { nextStepIndex, type TeachingRecord } from "../../src/services/teaching/store";

function record(
  plan: TeachingStep[],
  passed: string[] = [],
): TeachingRecord {
  return {
    schema: 1,
    state: {
      schema: 1,
      goal: "goal",
      prior: "",
      measuredAt: "2026-11-24T10:00:00.000Z",
      held: ["held"],
      gaps: [],
      plan,
    },
    checks: passed.map((stepId) => ({
      stepId,
      verdict: "correct" as const,
      correction: "ok",
      at: "2026-11-24T10:01:00.000Z",
    })),
  };
}

const CHAIN: TeachingStep[] = [
  { id: "step-1", title: "one", requires: [] },
  { id: "step-2", title: "two", requires: ["step-1"] },
  { id: "step-3", title: "three", requires: ["step-2"] },
];

describe("nextStepIndex", () => {
  test("a chain is walked in order", () => {
    expect(nextStepIndex(record(CHAIN))).toBe(0);
    expect(nextStepIndex(record(CHAIN, ["step-1"]))).toBe(1);
    expect(nextStepIndex(record(CHAIN, ["step-1", "step-2"]))).toBe(2);
    expect(nextStepIndex(record(CHAIN, ["step-1", "step-2", "step-3"]))).toBe(3);
  });

  test("a branch is available as soon as its own prerequisite is held", () => {
    const branch: TeachingStep[] = [
      { id: "step-1", title: "root", requires: [] },
      { id: "step-2", title: "left", requires: ["step-1"] },
      { id: "step-3", title: "right", requires: ["step-1"] },
      { id: "step-4", title: "join", requires: ["step-2", "step-3"] },
    ];
    expect(nextStepIndex(record(branch, ["step-1"]))).toBe(1);
    // Passing the left branch does not unlock the join; the right branch does.
    expect(nextStepIndex(record(branch, ["step-1", "step-2"]))).toBe(2);
    expect(nextStepIndex(record(branch, ["step-1", "step-2", "step-3"]))).toBe(3);
  });

  test("a step whose prerequisite is open waits even when it is earlier", () => {
    const plan: TeachingStep[] = [
      { id: "step-1", title: "root", requires: [] },
      { id: "step-2", title: "dependent", requires: ["step-3"] },
      { id: "step-3", title: "other root", requires: [] },
    ];
    // step-2 is second but cannot run before step-3.
    expect(nextStepIndex(record(plan, ["step-1"]))).toBe(2);
  });

  test("a record written before requires existed is read as a chain", () => {
    const legacy = [
      { id: "step-1", title: "one" },
      { id: "step-2", title: "two" },
      { id: "step-3", title: "three" },
    ] as unknown as TeachingStep[];
    expect(nextStepIndex(record(legacy))).toBe(0);
    expect(nextStepIndex(record(legacy, ["step-1"]))).toBe(1);
  });
});

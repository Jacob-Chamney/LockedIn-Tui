import { resolve, sep } from "node:path";

import type { ReviewItemKind, ReviewOrigin } from "../domain/review";
import type { ReviewQueueResult } from "../services/review/queue";
import type { Workspace } from "../storage/workspace";

/** The review screen's side filter (`docs/product.md` §6.1). */
export const REVIEW_SIDES = ["all", "school", "skills", "work"] as const;

export type ReviewSide = (typeof REVIEW_SIDES)[number];

export function isReviewSide(value: unknown): value is ReviewSide {
  return typeof value === "string" && (REVIEW_SIDES as readonly string[]).includes(value);
}

/**
 * Which side one review item came from.
 *
 * The queue's origins are the school records (steps, flashcards and session
 * memory) and the skills curriculum; `curriculum` is the only skills-side origin,
 * so it is the only one that must be named explicitly.
 */
export function reviewSideOfOrigin(origin: ReviewOrigin): Exclude<ReviewSide, "all"> {
  if (origin === "curriculum") return "skills";
  if (origin === "swarm") return "work";
  return "school";
}

function within(root: string, path: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(base + sep);
}

/**
 * Project the queue onto one side.
 *
 * `reviewQueue` reads both sides in one pass and returns them together, so the
 * side filter is a projection here rather than a second read: items are grouped
 * by origin, diagnostics by the root their path sits under, and the counts and
 * nudge ids are recomputed from what survives so the two views cannot disagree.
 * `side: "all"` returns the service result untouched.
 */
export function projectReviewSide(
  queue: ReviewQueueResult,
  workspace: Workspace,
  side: Exclude<ReviewSide, "all">,
): ReviewQueueResult {
  const items = queue.items.filter((item) => reviewSideOfOrigin(item.origin) === side);
  const kept = new Set(items.map((item) => item.id));
  const byKind: Record<ReviewItemKind, number> = {
    step: 0,
    card: 0,
    stage: 0,
    mistake: 0,
    memory: 0,
    task: 0,
  };
  for (const item of items) byKind[item.kind] += 1;

  return {
    ...queue,
    items,
    diagnostics: queue.diagnostics.filter((diagnostic) => {
      const school = within(workspace.paths.schoolSessions, diagnostic.path);
      const skills = within(workspace.paths.goals, diagnostic.path);
      // A path outside both roots belongs to neither side, and a diagnostic is a
      // problem report: keep it on both rather than hide it.
      if (!school && !skills) return true;
      return side === "school" ? school : skills;
    }),
    nudge: {
      ...queue.nudge,
      due: queue.nudge.due.filter((itemId) => kept.has(itemId)),
      suggestions: queue.nudge.suggestions.filter((suggestion) => kept.has(suggestion.itemId)),
    },
    counts: { total: items.length, byKind },
  };
}

export type ReviewMarkTarget =
  | { kind: "step"; itemId: string; sessionId: string; index: number }
  | { kind: "card"; itemId: string; sessionId: string; card: number }
  | { kind: "stage"; itemId: string; goalId: string; stageId: string }
  | { kind: "mistake"; itemId: string; sessionId: string; index: number }
  | { kind: "task"; itemId: string; projectId: string; runId: string; taskId: string }
  | { kind: "memory"; itemId: string };

export type ReviewMarkParse = { ok: true; target: ReviewMarkTarget } | { ok: false; message: string };

/** The two outcomes the Review surface records (`docs/product.md` §6.1). */
export const REVIEW_MARK_RESULTS = ["known", "missed"] as const;

export type ReviewMarkResult = (typeof REVIEW_MARK_RESULTS)[number];

export function isReviewMarkResult(value: unknown): value is ReviewMarkResult {
  return typeof value === "string" && (REVIEW_MARK_RESULTS as readonly string[]).includes(value);
}

export function parseReviewItemId(raw: string): ReviewMarkParse {
  const parts = raw.split(":");
  if (parts.length < 3) {
    return {
      ok: false,
      message: `"${raw}" is not a review item id; expected <kind>:<context>:<local>`,
    };
  }
  const kind = parts[0]!;
  const local = parts[parts.length - 1]!;
  const contextId = parts.slice(1, -1).join(":");
  if (contextId === "" || local === "") {
    return { ok: false, message: `"${raw}" is missing a context or local id` };
  }

  if (kind === "memory") {
    return { ok: true, target: { kind: "memory", itemId: raw } };
  }
  if (kind === "step") {
    if (!/^\d+$/.test(local)) {
      return { ok: false, message: `step id "${raw}" does not end in a step index` };
    }
    return {
      ok: true,
      target: { kind: "step", itemId: raw, sessionId: contextId, index: Number(local) },
    };
  }
  if (kind === "card") {
    const match = /^card-(\d+)$/.exec(local);
    if (match === null || Number(match[1]) < 1) {
      return { ok: false, message: `card id "${raw}" does not end in card-<n>` };
    }
    return {
      ok: true,
      target: { kind: "card", itemId: raw, sessionId: contextId, card: Number(match[1]) },
    };
  }
  if (kind === "stage") {
    return { ok: true, target: { kind: "stage", itemId: raw, goalId: contextId, stageId: local } };
  }
  if (kind === "mistake") {
    if (parts.length !== 3 || !/^\d+$/.test(local)) {
      return { ok: false, message: `mistake id "${raw}" does not end in a mistake index` };
    }
    return {
      ok: true,
      target: { kind: "mistake", itemId: raw, sessionId: contextId, index: Number(local) },
    };
  }
  if (kind === "task") {
    const [projectId, runId, taskId] = parts.slice(1);
    if (parts.length !== 4 || projectId === "" || runId === "" || taskId === "") {
      return {
        ok: false,
        message: `task id "${raw}" must be task:<projectId>:<runId>:<taskId>`,
      };
    }
    return {
      ok: true,
      target: { kind: "task", itemId: raw, projectId: projectId!, runId: runId!, taskId: taskId! },
    };
  }
  return {
    ok: false,
    message: `unknown review item kind "${kind}"; expected step, card, stage, mistake, task or memory`,
  };
}

/**
 * Mark one lock-in step.
 *
 * `known` means checked, so it reuses the same service as the steps reader and
 * rewrites exactly the bracket and the progress line. `missed` is a review
 * signal, not progress: it appends one telemetry line and leaves the Markdown
 * untouched (`docs/data-model.md` §4.3).
 */

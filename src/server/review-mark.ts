import { randomUUID } from "node:crypto";
import { appendFile, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { parseProgress } from "../domain/progress";
import type { Workspace } from "../storage/workspace";
import { loadSessionSteps, toggleSessionStep } from "../app/actions/lockin";
import { SESSION_FILES } from "../domain/session";
import { openSession } from "../services/lockin/manager";
import { markMistake as markMistakeNote } from "../services/lockin/mistakes";
import {
  applyTransition,
  goalFolderFor,
  readMeta as readGoalMeta,
} from "../services/skills/progress";
import { parseDeck, renderDeck } from "../services/skills/outputs";
import { messageOf, oneLine } from "./rpc";
import type { ReviewMarkResult, ReviewMarkTarget } from "./review";

/**
 * One `review.mark` target, parsed from a `review.queue` item id.
 *
 * The ids are the ones `src/domain/review.ts` builds — `step:<session>:<index>`,
 * `card:<session>:<card-N>`, `stage:<goal>:<stageId>` and
 * `memory:<session>:<note>` — so the shell only echoes an id it was given. The
 * local segment is last because a session or goal id may contain dashes but
 * never a colon.
 */
export type MarkOutcome = { ok: true } | { ok: false; message: string };

/**
 * Append one recorded miss to `progress.jsonl`.
 *
 * Append-only: the file is telemetry the Markdown can live without, so it is
 * never rewritten or repaired. A file that does not end in a newline gets one
 * first, so the record is its own JSON line rather than a continuation.
 */
export async function appendReviewMiss(path: string, index: number, at: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = "";
  }
  const prefix = existing !== "" && !existing.endsWith("\n") ? "\n" : "";
  const record = JSON.stringify({ event: "review", index, result: "missed", at });
  await appendFile(path, `${prefix}${record}\n`);
}

/** Replace one file atomically: temp in the same folder, fsync, rename. */
export async function replaceAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await Bun.write(temporary, text);
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function markStep(
  workspace: Workspace,
  target: Extract<ReviewMarkTarget, { kind: "step" }>,
  result: ReviewMarkResult,
): Promise<MarkOutcome> {
  const opened = await openSession({ workspace, id: target.sessionId });
  if (!opened.ok) return { ok: false, message: oneLine(opened.error.message) };

  const markdown = await loadSessionSteps(workspace, target.sessionId);
  if (markdown === null) {
    return { ok: false, message: "this session has no assignment steps to mark" };
  }
  const parsed = parseProgress(markdown);
  if (!parsed.ok) {
    return { ok: false, message: `the steps could not be parsed: ${parsed.error.message}` };
  }
  const step = parsed.value.items[target.index];
  if (step === undefined) {
    return {
      ok: false,
      message: `there is no step ${target.index} in this session (it has ${parsed.value.total})`,
    };
  }

  if (result === "missed") {
    try {
      await appendReviewMiss(
        join(opened.value.folder, SESSION_FILES.progress),
        target.index,
        new Date().toISOString(),
      );
    } catch (error) {
      return {
        ok: false,
        message: `the miss could not be recorded: ${oneLine(messageOf(error))}`,
      };
    }
    return { ok: true };
  }

  // Known means checked; an already-checked step is a no-op success.
  if (step.checked) return { ok: true };
  const toggled = await toggleSessionStep(workspace, target.sessionId, target.index);
  if (!toggled.ok) return { ok: false, message: oneLine(toggled.error.message) };
  return { ok: true };
}

/**
 * Mark one flashcard.
 *
 * The deck Markdown is the truth (`docs/data-model.md` §7.2): the whole deck is
 * re-rendered with the one card's `M`/`K` state and atomically replaced, so the
 * file and the reply never disagree.
 */
export async function markCard(
  workspace: Workspace,
  target: Extract<ReviewMarkTarget, { kind: "card" }>,
  result: ReviewMarkResult,
): Promise<MarkOutcome> {
  const opened = await openSession({ workspace, id: target.sessionId });
  if (!opened.ok) return { ok: false, message: oneLine(opened.error.message) };

  const path = join(workspace.paths.root, "school", "outputs", target.sessionId, "flashcards.md");
  let markdown: string;
  try {
    markdown = await readFile(path, "utf8");
  } catch {
    return { ok: false, message: "this session has no flashcard deck; build one first" };
  }

  const cards = parseDeck(markdown);
  const at = target.card - 1;
  if (cards[at] === undefined) {
    return {
      ok: false,
      message: `there is no card-${target.card} in this deck (it has ${cards.length})`,
    };
  }

  const next = cards.map((card, index) => {
    if (index !== at) return card;
    return result === "known"
      ? { ...card, known: true, missed: false }
      : { ...card, known: false, missed: true };
  });

  try {
    await replaceAtomic(path, renderDeck(opened.value.session.name, next));
  } catch (error) {
    return { ok: false, message: `the deck could not be written: ${oneLine(messageOf(error))}` };
  }
  return { ok: true };
}

/**
 * Mark one promoted mistake.
 *
 * The note's frontmatter is the durable record: `known` sets `status:
 * reviewed` and removes it from the queue, `missed` increments `misses`. The
 * note is never a source, so this writes nothing the learning queue cites.
 */
export async function markMistakeTarget(
  workspace: Workspace,
  target: Extract<ReviewMarkTarget, { kind: "mistake" }>,
  result: ReviewMarkResult,
): Promise<MarkOutcome> {
  const marked = await markMistakeNote({
    workspace,
    sessionId: target.sessionId,
    index: target.index,
    result,
  });
  if (!marked.ok) return { ok: false, message: oneLine(marked.error.message) };
  return { ok: true };
}

/**
 * Mark one skill curriculum stage.
 *
 * `known` completes the stage through the one transition the curriculum owns
 * (`applyTransition`), which also promotes the next pending stage. `missed` is
 * a no-op success: there is no stage miss store yet, so a miss cannot be
 * persisted and the stage nudge stays unrecorded. The protocol documents this.
 */
export async function markStage(
  workspace: Workspace,
  target: Extract<ReviewMarkTarget, { kind: "stage" }>,
  result: ReviewMarkResult,
): Promise<MarkOutcome> {
  const loaded = await readGoalMeta(goalFolderFor(workspace, target.goalId));
  if (!loaded.ok) return { ok: false, message: oneLine(loaded.error.message) };
  if (!loaded.value.goal.stages.some((stage) => stage.id === target.stageId)) {
    return { ok: false, message: `no stage "${target.stageId}" in this goal` };
  }

  if (result === "missed") return { ok: true };

  const applied = await applyTransition({
    workspace,
    goalId: target.goalId,
    stageId: target.stageId,
    action: "done",
  });
  if (!applied.ok) return { ok: false, message: oneLine(applied.error.message) };
  return { ok: true };
}


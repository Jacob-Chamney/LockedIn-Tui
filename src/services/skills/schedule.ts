/**
 * Spaced-repetition state for one session's flashcard deck.
 *
 * `school/outputs/<session-id>/flashcards-schedule.json`, beside the deck. The
 * Markdown stays the truth for a card's content and its `M`/`K` lines; this
 * file is the schedule that says *when* to ask it again. Deleting it is safe:
 * every card starts due now.
 *
 * A card is keyed by its question, not its position, so regenerating the deck
 * keeps the progress of a question that survived and only new questions start
 * fresh. The write is atomic: a crash leaves the old schedule or the new one.
 */
import { rename, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "../../domain/markdown";
import type { CardSchedule } from "../../domain/scheduler";

export const SCHEDULE_FILE = "flashcards-schedule.json";

export type ScheduleStoreError = { kind: "storage"; path: string; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function schedulePath(directory: string): string {
  return join(directory, SCHEDULE_FILE);
}

export async function readSchedule(
  directory: string,
): Promise<Result<CardSchedule[], ScheduleStoreError>> {
  const path = schedulePath(directory);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { ok: true, value: [] };
    return {
      ok: false,
      error: {
        kind: "storage",
        path,
        message: `the flashcard schedule cannot be read (${messageOf(error)})`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: { kind: "storage", path, message: `the schedule is not valid JSON (${messageOf(error)})` },
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schema?: unknown }).schema !== 1 ||
    !Array.isArray((parsed as { cards?: unknown }).cards)
  ) {
    return {
      ok: false,
      error: { kind: "storage", path, message: "the schedule does not have the flashcard schedule shape" },
    };
  }
  const cards: CardSchedule[] = [];
  for (const row of (parsed as { cards: unknown[] }).cards) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as Partial<CardSchedule>;
    if (typeof entry.key !== "string" || entry.key === "") continue;
    if (typeof entry.due !== "string" || !Number.isFinite(Date.parse(entry.due))) continue;
    cards.push({
      key: entry.key,
      due: entry.due,
      intervalDays: typeof entry.intervalDays === "number" && entry.intervalDays >= 0 ? entry.intervalDays : 0,
      ease: typeof entry.ease === "number" ? entry.ease : 2.5,
      reps: typeof entry.reps === "number" && entry.reps >= 0 ? Math.floor(entry.reps) : 0,
      lapses: typeof entry.lapses === "number" && entry.lapses >= 0 ? Math.floor(entry.lapses) : 0,
      ...(entry.lastGrade === undefined ? {} : { lastGrade: entry.lastGrade }),
      ...(entry.lastAt === undefined ? {} : { lastAt: entry.lastAt }),
    });
  }
  return { ok: true, value: cards };
}

export async function writeSchedule(
  directory: string,
  cards: readonly CardSchedule[],
): Promise<Result<CardSchedule[], ScheduleStoreError>> {
  const path = schedulePath(directory);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  const body = `${JSON.stringify({ schema: 1, cards }, null, 2)}\n`;
  try {
    await writeFile(temporary, body, "utf8");
    const handle = await import("node:fs/promises").then((fs) => fs.open(temporary, "r+"));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    return { ok: false, error: { kind: "storage", path, message: messageOf(error) } };
  }
  return { ok: true, value: [...cards] };
}

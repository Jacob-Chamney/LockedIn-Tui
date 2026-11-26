import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Workspace } from "../storage/workspace";
import { parseDeck } from "../services/skills/outputs";
import { readSchedule } from "../services/skills/schedule";
import { dueCount, isDue, mergeSchedules } from "../domain/scheduler";
import { BOOT_FAILED, failure, messageOf, oneLine, success, type JsonRpcResponse, type RpcId } from "./rpc";

  /** Read the deck and answer with its cards paired to schedules. */
  export const deckStateReply = async (
    id: RpcId,
    workspace: Workspace,
    sessionId: string,
    now: Date,
  ): Promise<JsonRpcResponse> => {
    const folder = join(workspace.root, "school", "outputs", sessionId);
    const deck = await readDeckFile(folder);
    if (!deck.ok) return deckFailure(id, sessionId, deck.message);
    const stored = await readSchedule(folder);
    if (!stored.ok) return deckFailure(id, sessionId, stored.error.message);
    const merged = mergeSchedules(
      deck.value.map((card) => card.question),
      stored.value,
      now,
    );
    return success(id, {
      due: dueCount(merged, now),
      total: deck.value.length,
      cards: deck.value.map((card, index) => {
        const schedule = merged[index]!;
        return {
          index,
          question: card.question,
          due: isDue(schedule, now),
          dueAt: schedule.due,
          intervalDays: schedule.intervalDays,
          ease: schedule.ease,
          reps: schedule.reps,
          lapses: schedule.lapses,
          ...(schedule.lastGrade === undefined ? {} : { lastGrade: schedule.lastGrade }),
        };
      }),
    });
  };

  export const readDeckFile = async (
    folder: string,
  ): Promise<{ ok: true; value: ReturnType<typeof parseDeck> } | { ok: false; message: string }> => {
    try {
      return { ok: true, value: parseDeck(await readFile(join(folder, "flashcards.md"), "utf8")) };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return { ok: false, message: "this session has no flashcard deck; build one first" };
      }
      return {
        ok: false,
        message: `the flashcard deck cannot be read (${oneLine(messageOf(error))})`,
      };
    }
  };

  export const deckFailure = (id: RpcId, sessionId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "deck", id: sessionId, message }, false);


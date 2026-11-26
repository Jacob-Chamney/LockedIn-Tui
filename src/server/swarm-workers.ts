import type { HistoryPort, SendOutcome } from "../app/chat-controller";
import { sanitizeSummary, type WorkerRequest, type WorkerResult } from "../services/work/swarm";
import type { ChatState } from "./chat-wire";

/** The one actionable line every surface uses when no model is linked. */
export const LINK_MODEL_COPY = "link a model in Settings → Providers";

/**
 * The prompt one swarm worker receives: the coordinator's objective plus its
 * own assignment.
 *
 * It is a value handed to one controller and never persisted — a worker's
 * transcript is in-memory only, so the report is the only artefact a run
 * leaves behind.
 */
export function swarmWorkerPrompt(request: WorkerRequest): string {
  return [
    "You are one worker in a read-only swarm.",
    "Report what you find. You cannot change a file or run a command.",
    "",
    `Objective: ${request.objective}`,
    "",
    `Your task: ${request.assignment}`,
  ].join("\n");
}

/**
 * The virtual chat id one worker's transcript would use.
 *
 * A worker never persists a transcript, so the id names the controller's history
 * rather than a file: `swarm:<runId>:<taskId>` is what a `chat.jsonl` would be
 * called if a worker ever kept one. It is stable for the life of a task, so two
 * tasks of one run cannot be confused.
 */
export function swarmChatId(request: WorkerRequest): string {
  return `swarm:${request.runId}:${request.taskId}`;
}

/** An in-memory transcript: a worker writes no chat file, ever. */
export function swarmHistory(id: string): HistoryPort & { id: string } {
  return {
    id,
    load: async () => [],
    save: async () => {},
  };
}

/**
 * Map one controller turn to the service's worker result.
 *
 * `blocked` is the controller's own no-model state, `failed` is a provider
 * failure, and a delivered answer becomes the summary — always through
 * `sanitizeSummary`, because the report is an index, not a transcript.
 */
export function swarmWorkerResult(outcome: SendOutcome, state: ChatState): WorkerResult {
  if (outcome.kind === "blocked" || outcome.kind === "no-model") {
    return {
      status: "blocked",
      summary: sanitizeSummary(`${outcome.reason} — ${outcome.fix}`),
    };
  }
  if (outcome.kind === "ignored") {
    return { status: "failed", summary: sanitizeSummary(outcome.reason) };
  }
  if (outcome.outcome === "done") {
    const answer = [...state.messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.outcome === "done" &&
          message.text.trim() !== "",
      );
    return answer ? { status: "done", summary: sanitizeSummary(answer.text) } : { status: "done" };
  }
  if (outcome.outcome === "cancelled") {
    return { status: "failed", summary: "the worker stopped before answering" };
  }
  return {
    status: "failed",
    summary: sanitizeSummary(state.error?.failed ?? "the worker failed"),
  };
}


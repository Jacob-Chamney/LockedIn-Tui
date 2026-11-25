/**
 * Context accounting and compaction.
 *
 * A long chat eventually fills the model's window. This app does not silently
 * trim history and does not summarise behind the user's back: it shows how much
 * of the window the conversation uses, and `session.chat.compact` is an explicit
 * action that asks the model to compress the *older* messages once, stores that
 * summary beside the transcript, and leaves the recent messages intact.
 *
 * The transcript on disk is never rewritten. Compaction is a view used to build
 * the next request: a summary, plus the messages after the point it covers.
 * Deleting the summary is safe — the next request simply sends the full history
 * again.
 */

/** A conservative default window, used only when a build cannot know better. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;
/** How many recent messages are never summarised. */
export const COMPACT_KEEP = 8;
/** A summary is a paragraph, not a second transcript. */
export const SUMMARY_MAX_CHARS = 4_000;

export type ContextMessage = { role: "user" | "assistant"; content: string };

export type ContextPlan = {
  summary: string;
  /** How many transcript records the summary covers. */
  through: number;
  updatedAt: string;
};

export type ContextView = {
  /** Messages stored in the transcript. */
  messages: number;
  /** Messages sent after the summary. */
  kept: number;
  /** The summary's length in characters (0 = no compaction). */
  summaryChars: number;
  /** The record count the summary covers. */
  through: number;
  /** Estimated tokens for the conversation part of the next request. */
  tokens: number;
  /** The model window this estimate is measured against. */
  window: number;
  /** `tokens / window`, capped at 1 for a meter. */
  fraction: number;
  /** True when there is something older than the keep window to compact. */
  compactable: boolean;
};

/**
 * A rough token estimate: four characters per token.
 *
 * It is not a tokenizer. It is deliberately conservative, stable and free, so
 * the meter never costs a provider call and never disagrees with itself between
 * two frames.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contextView(input: {
  records: readonly ContextMessage[];
  plan: ContextPlan | null;
  window?: number;
}): ContextView {
  const window = input.window && input.window > 0 ? input.window : DEFAULT_CONTEXT_WINDOW;
  const through = input.plan
    ? Math.min(Math.max(0, Math.floor(input.plan.through)), input.records.length)
    : 0;
  const kept = input.records.slice(through);
  const summary = input.plan?.summary ?? "";
  const tokens = estimateTokens(summary) + kept.reduce(
    (total, record) => total + estimateTokens(record.content) + 4,
    0,
  );
  return {
    messages: input.records.length,
    kept: kept.length,
    summaryChars: summary.length,
    through,
    tokens,
    window,
    fraction: Math.min(1, tokens / window),
    compactable: input.records.length - through > COMPACT_KEEP,
  };
}

/**
 * The prompt that asks for the summary.
 *
 * It gets the messages being compressed and nothing else. The reply is free
 * text (a paragraph), because a summary of a conversation is not a JSON shape we
 * need to render; the caller caps it.
 */
export function compactPrompt(records: readonly ContextMessage[]): string {
  const transcript = records
    .map((record) => `${record.role === "user" ? "Learner" : "Tutor"}: ${record.content.trim()}`)
    .join("\n\n");
  return [
    "Compress the earlier part of a learning conversation into one short paragraph.",
    "Keep: what the learner was working on, what they now hold, what is still open, and any decision that changes later answers.",
    "Drop: greetings, repetition, tool narration, and anything the recent messages already say.",
    "Do not add advice, headings, bullet lists or a new lesson. At most 200 words.",
    "",
    "The conversation so far:",
    transcript,
  ].join("\n");
}

/** A summary is one trimmed, capped paragraph; an empty reply is a refusal. */
export function normaliseSummary(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length <= SUMMARY_MAX_CHARS
    ? text
    : `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}

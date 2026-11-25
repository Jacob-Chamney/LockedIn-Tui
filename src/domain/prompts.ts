/**
 * Prompt notes: a learner's standing guidance, appended to one generator.
 *
 * The structured shape and the limits stay ours. A note can ask for a voice, a
 * level of detail or a kind of example; it cannot change a reply's JSON shape,
 * its budgets or the safety rules, because the parser and the prompt header are
 * unchanged. That is the difference between "editable prompts" and "the user can
 * talk the harness out of its contract".
 *
 * Stored under `[prompts]` in `config.toml` (empty string = no note).
 */

export const PROMPT_IDS = [
  "measure",
  "step",
  "check",
  "practice",
  "side",
  "research",
  "compact",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export type PromptDefinition = {
  id: PromptId;
  label: string;
  description: string;
};

export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [
  {
    id: "measure",
    label: "measure and plan",
    description: "What the harness asks before it plans a route.",
  },
  {
    id: "step",
    label: "teach one step",
    description: "The prose and check for one reasoning step.",
  },
  {
    id: "check",
    label: "mark one answer",
    description: "The verdict and correction for one answer.",
  },
  {
    id: "practice",
    label: "build a practice set",
    description: "Problems that retrieve an idea without naming it.",
  },
  {
    id: "side",
    label: "answer a side question",
    description: "The one- or two-sentence companion reply.",
  },
  {
    id: "research",
    label: "write a research brief",
    description: "The cited brief built from the learner's sources.",
  },
  {
    id: "compact",
    label: "summarise older messages",
    description: "The paragraph that replaces older context.",
  },
] as const;

/** A note is a paragraph, not a second prompt. */
export const PROMPT_NOTE_MAX = 2000;

export function isPromptId(value: unknown): value is PromptId {
  return typeof value === "string" && (PROMPT_IDS as readonly string[]).includes(value);
}

export function promptLabel(id: PromptId): string {
  return PROMPT_DEFINITIONS.find((entry) => entry.id === id)?.label ?? id;
}

/**
 * Clean and bound one note. Empty clears it; too long is refused rather than
 * truncated, because a cut instruction is worse than no instruction.
 */
export function normalisePromptNote(
  value: unknown,
): { ok: true; note: string } | { ok: false; message: string } {
  if (value === null || value === undefined) return { ok: true, note: "" };
  if (typeof value !== "string") return { ok: false, message: "a prompt note must be text" };
  const note = value.trim();
  if (note.length > PROMPT_NOTE_MAX) {
    return { ok: false, message: `a prompt note is at most ${PROMPT_NOTE_MAX} characters` };
  }
  return { ok: true, note };
}

/**
 * Append the note to a prompt.
 *
 * The header is deliberately explicit: the note is guidance, not a replacement
 * for the shape, the budgets or the safety rules. A model that follows it still
 * has to produce the JSON the parser accepts.
 */
export function withPromptNote(prompt: string, note: string | undefined): string {
  const clean = (note ?? "").trim();
  if (clean === "") return prompt;
  return (
    `${prompt}\n\n` +
    "Standing note from the learner. Follow it where it does not conflict with the shape, " +
    "the length limits or the safety rules above; those always win.\n" +
    clean
  );
}

/**
 * Prompt notes are guidance, not a new contract.
 *
 * The shape and limits stay in the prompt header; a note is appended after it
 * and the parser still refuses a malformed reply.
 */
import { describe, expect, test } from "bun:test";

import {
  PROMPT_DEFINITIONS,
  PROMPT_IDS,
  PROMPT_NOTE_MAX,
  isPromptId,
  normalisePromptNote,
  promptLabel,
  withPromptNote,
} from "../../src/domain/prompts";

describe("prompt catalogue", () => {
  test("every id is unique and labelled", () => {
    expect(new Set(PROMPT_IDS).size).toBe(PROMPT_IDS.length);
    expect(PROMPT_DEFINITIONS.map((entry) => entry.id)).toEqual([...PROMPT_IDS]);
    for (const id of PROMPT_IDS) {
      expect(promptLabel(id).length).toBeGreaterThan(0);
      expect(isPromptId(id)).toBe(true);
    }
    expect(isPromptId("nope")).toBe(false);
  });
});

describe("normalisePromptNote", () => {
  test("trims and clears", () => {
    expect(normalisePromptNote("  use small words  ")).toEqual({
      ok: true,
      note: "use small words",
    });
    expect(normalisePromptNote("   ")).toEqual({ ok: true, note: "" });
    expect(normalisePromptNote(undefined)).toEqual({ ok: true, note: "" });
  });

  test("refuses a non-string and an over-long note", () => {
    expect(normalisePromptNote(4).ok).toBe(false);
    expect(normalisePromptNote("x".repeat(PROMPT_NOTE_MAX + 1)).ok).toBe(false);
  });
});

describe("withPromptNote", () => {
  test("an empty note leaves the prompt byte-identical", () => {
    const prompt = "Reply with JSON only.";
    expect(withPromptNote(prompt, "")).toBe(prompt);
    expect(withPromptNote(prompt, "   ")).toBe(prompt);
    expect(withPromptNote(prompt, undefined)).toBe(prompt);
  });

  test("a note is appended below the standing header, not replacing it", () => {
    const prompt = "Reply with JSON only.\nLimits: 3 steps.";
    const result = withPromptNote(prompt, "prefer small words");
    expect(result.startsWith(prompt)).toBe(true);
    expect(result).toContain("Standing note from the learner");
    expect(result).toContain("those always win");
    expect(result).toContain("prefer small words");
  });
});

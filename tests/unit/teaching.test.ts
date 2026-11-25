/**
 * Teaching domain: the shapes, the limits, the prompts.
 *
 * `desktop/docs/redesign.md` §2.2 — a reply is structured data we render, its
 * length is bounded, and the prompt forbids meta-narration. These tests pin the
 * three things that make that true without a provider.
 */
import { describe, expect, test } from "bun:test";

import {
  TEACHING_LIMITS,
  checkPrompt,
  measurePrompt,
  parseCheck,
  practicePrompt,
  parseMeasure,
  parsePractice,
  parseStep,
  stepPrompt,
  wordCount,
} from "../../src/domain/teaching";

const NOW = "2026-11-23T10:00:00.000Z";

function measure(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    goal: "Read x86 disassembly well enough to follow a function",
    held: ["registers hold working state", "the stack grows down"],
    gaps: ["calling conventions"],
    plan: [
      { title: "A register is a named slot" },
      { title: "A call pushes a return address" },
      { title: "Arguments arrive in registers" },
      { title: "The epilogue restores the frame" },
    ],
    ...overrides,
  });
}

describe("parseMeasure", () => {
  test("accepts a well-formed reply and numbers the steps", () => {
    const result = parseMeasure(measure(), "I know C", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.goal).toContain("Read x86 disassembly");
    expect(result.state.held).toHaveLength(2);
    expect(result.state.gaps).toEqual(["calling conventions"]);
    expect(result.state.plan.map((step) => step.id)).toEqual([
      "step-1",
      "step-2",
      "step-3",
      "step-4",
    ]);
    expect(result.state.measuredAt).toBe(NOW);
    expect(result.state.schema).toBe(1);
  });

  test("an omitted requires is read as a chain", () => {
    const result = parseMeasure(measure(), "", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.plan.map((step) => step.requires)).toEqual([
      [],
      ["step-1"],
      ["step-2"],
      ["step-3"],
    ]);
  });

  test("accepts a branch and keeps each prerequisite by id", () => {
    const result = parseMeasure(
      measure({
        plan: [
          { title: "root" },
          { title: "left", requires: [1] },
          { title: "right", requires: [1] },
          { title: "join", requires: [2, 3] },
        ],
      }),
      "",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.plan.map((step) => step.requires)).toEqual([
      [],
      ["step-1"],
      ["step-1"],
      ["step-2", "step-3"],
    ]);
  });

  test("a forward or self reference is a malformed plan, not a silent drop", () => {
    const forward = parseMeasure(
      measure({
        plan: [
          { title: "one", requires: [2] },
          { title: "two" },
          { title: "three" },
        ],
      }),
      "",
      NOW,
    );
    expect(forward.ok).toBe(false);
    if (forward.ok) return;
    expect(forward.error.message).toContain("step 1");
    expect(forward.error.message).toContain("requires");

    const self = parseMeasure(
      measure({
        plan: [
          { title: "one" },
          { title: "two", requires: [2] },
          { title: "three" },
        ],
      }),
      "",
      NOW,
    );
    expect(self.ok).toBe(false);
  });

  test("duplicate prerequisites collapse to one edge", () => {
    const result = parseMeasure(
      measure({
        plan: [
          { title: "one" },
          { title: "two", requires: [1, 1] },
          { title: "three", requires: [1, 2] },
        ],
      }),
      "",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.plan[1]!.requires).toEqual(["step-1"]);
  });

  test("finds the object inside prose and trailing braces", () => {
    const raw = `Here is the plan:\n${measure()}\nNote the {curly} braces. }`;
    const result = parseMeasure(raw, "", NOW);
    expect(result.ok).toBe(true);
  });

  test("refuses a reply with no held propositions", () => {
    const result = parseMeasure(measure({ held: [] }), "", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("held");
  });

  test("refuses a route shorter than three steps, naming the count", () => {
    const result = parseMeasure(measure({ plan: [{ title: "one" }, { title: "two" }] }), "", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("2");
    expect(result.error.message).toContain(String(TEACHING_LIMITS.minPlanSteps));
  });

  test("caps long lists and long items rather than failing the plan", () => {
    const held = Array.from({ length: 20 }, (_, index) => `held ${index} `.repeat(20));
    const result = parseMeasure(measure({ held }), "", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.held).toHaveLength(TEACHING_LIMITS.heldItems);
    for (const item of result.state.held) {
      expect(item.length).toBeLessThanOrEqual(TEACHING_LIMITS.itemChars);
    }
  });

  test("a non-JSON reply is one readable sentence", () => {
    const result = parseMeasure("sorry, I cannot help", "", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("malformed");
    expect(result.error.message).toBe("the model did not return a JSON object");
  });
});

describe("parseStep", () => {
  const ok = JSON.stringify({
    prose: "A register is a named slot inside the processor. A call writes the return address onto the stack, so a return can find its way back.",
    question: "Where does a call keep the address it must come back to?",
  });

  test("accepts a step and keeps its prose", () => {
    const result = parseStep(ok, "step-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.stepId).toBe("step-2");
    expect(result.step.question).toContain("come back to");
  });

  test("refuses a lecture, naming the word count and the budget", () => {
    const long = JSON.stringify({
      prose: "word ".repeat(TEACHING_LIMITS.proseWords + 20),
      question: "which?",
    });
    const result = parseStep(long, "step-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(String(TEACHING_LIMITS.proseWords + 20));
    expect(result.error.message).toContain(String(TEACHING_LIMITS.proseWords));
  });

  test("refuses a step with no check", () => {
    const result = parseStep(JSON.stringify({ prose: "Two sentences. That is enough." }), "step-1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("check");
  });
});

describe("step citations", () => {
  const cited = JSON.stringify({
    prose: "A register is a named slot inside the processor. A call writes its return address to the stack.",
    question: "Where does the call keep its return address?",
    citations: [{ name: "intel.md", quote: "registers hold working state across calls" }],
  });

  test("a citation names a source and keeps its quote", () => {
    const result = parseStep(cited, "step-1", ["intel.md", "notes.pdf"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step.citations).toEqual([
      { name: "intel.md", quote: "registers hold working state across calls" },
    ]);
  });

  test("a citation outside the goal's sources is refused", () => {
    const result = parseStep(cited, "step-1", ["notes.pdf"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("intel.md");
    expect(result.error.message).toContain("not a source");
  });

  test("a citation with no sources at all is refused", () => {
    const result = parseStep(cited, "step-1", []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("no sources");
  });

  test("no citations is the agent-explanation case, not an error", () => {
    const result = parseStep(JSON.stringify({ prose: "A register is a slot. It holds work.", question: "what?" }), "step-1", ["intel.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.step.citations).toEqual([]);
  });

  test("the prompt lists the sources and asks for the citation shape", () => {
    const prompt = stepPrompt({
      goal: "read disassembly",
      held: ["registers hold state"],
      plan: [{ id: "step-1", title: "A register is a slot", requires: [] }],
      stepIndex: 0,
      sources: [{ name: "intel.md", excerpt: "registers hold working state" }],
    });
    expect(prompt).toContain("intel.md");
    expect(prompt).toContain("citations");
    expect(prompt).toContain("never invent a source");
  });
});

describe("parseCheck", () => {
  test("accepts the three verdicts", () => {
    for (const verdict of ["correct", "partial", "incorrect"] as const) {
      const result = parseCheck(JSON.stringify({ verdict, correction: "the stack pointer moves first" }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.check.verdict).toBe(verdict);
    }
  });

  test("refuses an unknown verdict and names the accepted set", () => {
    const result = parseCheck(JSON.stringify({ verdict: "great", correction: "x" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("correct");
    expect(result.error.message).toContain("incorrect");
  });
});

describe("prompt shaping", () => {
  test("the measure prompt states every budget and forbids meta-narration", () => {
    const prompt = measurePrompt({ goal: "read disassembly", prior: "I know C", sources: [] });
    expect(prompt).toContain('"held"');
    expect(prompt).toContain('"plan"');
    expect(prompt).toContain(String(TEACHING_LIMITS.heldItems));
    expect(prompt).toContain(String(TEACHING_LIMITS.planSteps));
    expect(prompt).toContain(String(TEACHING_LIMITS.goalChars));
    expect(prompt).toContain("JSON only");
    expect(prompt).toContain("in this step");
  });

  test("the step prompt names the one idea and the word budget", () => {
    const prompt = stepPrompt({
      goal: "read disassembly",
      held: ["registers hold state"],
      plan: [
        { id: "step-1", title: "A register is a named slot", requires: [] },
        { id: "step-2", title: "A call pushes a return address", requires: ["step-1"] },
      ],
      stepIndex: 1,
    });
    expect(prompt).toContain("A call pushes a return address");
    expect(prompt).toContain("A register is a named slot"); // already taught
    expect(prompt).toContain(String(TEACHING_LIMITS.proseWords));
    expect(prompt).not.toContain("Goal: read disassembly\nGoal:");
  });

  test("the check prompt carries the answer and the correction budget", () => {
    const prompt = checkPrompt({
      step: { stepId: "step-1", prose: "x", question: "which register holds the return value?", citations: [] },
      answer: "the stack pointer",
    });
    expect(prompt).toContain("the stack pointer");
    expect(prompt).toContain(String(TEACHING_LIMITS.correctionChars));
  });

  test("the check prompt carries the reasoning and the confidence without treating them as evidence", () => {
    const prompt = checkPrompt({
      step: { stepId: "step-1", prose: "x", question: "which register?", citations: [] },
      answer: "eax",
      thinking: "the return value has to survive the call",
      confidence: 4,
    });
    expect(prompt).toContain("the return value has to survive the call");
    expect(prompt).toContain("4/5");
    expect(prompt).toContain("not evidence");
  });

  test("an empty thinking field is absent, not an empty line", () => {
    const prompt = checkPrompt({
      step: { stepId: "step-1", prose: "x", question: "which register?", citations: [] },
      answer: "eax",
      thinking: "   ",
    });
    expect(prompt).not.toContain("Their reasoning");
  });

  test("wordCount counts whitespace, not characters", () => {
    expect(wordCount("  one two   three ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});

describe("parsePractice", () => {
  const ok = JSON.stringify({
    problems: [
      { prompt: "A value is written then read back. What must the writer have kept?", answer: "Its address." },
      { prompt: "Two orders of the same writes disagree. Which one is the program relying on?", answer: "The earlier one." },
    ],
  });

  test("accepts a set and numbers the problems", () => {
    const result = parsePractice(ok);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems.map((problem) => problem.id)).toEqual(["practice-1", "practice-2"]);
    expect(result.problems[0]!.answer).toBe("Its address.");
  });

  test("caps the set and the length of each field", () => {
    const many = JSON.stringify({
      problems: Array.from({ length: 12 }, () => ({ prompt: "p ".repeat(200), answer: "a" })),
    });
    const result = parsePractice(many);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems).toHaveLength(TEACHING_LIMITS.problems);
    for (const problem of result.problems) {
      expect(problem.prompt.length).toBeLessThanOrEqual(TEACHING_LIMITS.problemChars);
      expect(problem.answer.length).toBeLessThanOrEqual(TEACHING_LIMITS.answerChars);
    }
  });

  test("an empty or unparseable set is one refusal", () => {
    for (const raw of ['{"problems":[]}', '{"problems":[{"prompt":"x"}]}', "no json here"]) {
      const result = parsePractice(raw);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe("malformed");
    }
  });

  test("the practice prompt forbids naming the idea", () => {
    const prompt = practicePrompt({
      goal: "read disassembly",
      held: ["registers hold state"],
      taught: ["A call pushes a return address"],
    });
    expect(prompt).toContain("A call pushes a return address");
    expect(prompt).toContain("Do not name the idea");
    expect(prompt).toContain(String(TEACHING_LIMITS.problems));
    expect(prompt).toContain("JSON only");
  });
});

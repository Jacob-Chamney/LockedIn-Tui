/** The misconception ledger's pure half: parse, name and label a promotion. */
import { describe, expect, test } from "bun:test";

import {
  MAX_MISTAKE_CHARS,
  MISTAKE_ORIGIN,
  MISTAKE_TAG,
  MISTAKE_TOPIC,
  mistakeBody,
  mistakeTitle,
  normaliseMistake,
  parseMistakes,
  replaceCorrection,
} from "../../src/domain/mistakes";

describe("parseMistakes", () => {
  test("reads bullets in order and attaches a step line", () => {
    const markdown = [
      "# Misconceptions",
      "",
      "- Energy is always conserved per object.",
      "  step: Derive the energy balance",
      "",
      "- A derivative is a fraction.",
      "",
    ].join("\n");
    expect(parseMistakes(markdown)).toEqual([
      { index: 0, text: "Energy is always conserved per object.", step: "Derive the energy balance" },
      { index: 1, text: "A derivative is a fraction.", step: null },
    ]);
  });

  test("ignores headings, blank lines, prose and empty bullets", () => {
    const markdown = "# Misconceptions\n\nSome prose.\n\n- \n- real mistake\n";
    expect(parseMistakes(markdown)).toEqual([{ index: 0, text: "real mistake", step: null }]);
  });

  test("a step line with no entry above it is ignored", () => {
    expect(parseMistakes("step: orphan\n")).toEqual([]);
  });

  test("an empty ledger is an empty list, not an error", () => {
    expect(parseMistakes("")).toEqual([]);
    expect(parseMistakes("# Misconceptions\n\n")).toEqual([]);
  });
});

describe("normaliseMistake", () => {
  test("collapses whitespace and drops a pasted bullet", () => {
    expect(normaliseMistake("  -   a   mistake\n on two lines ")).toBe("a mistake on two lines");
  });

  test("blank text normalises to the empty string", () => {
    expect(normaliseMistake(" \n\t ")).toBe("");
    expect(normaliseMistake("-   ")).toBe("");
  });
});

describe("mistakeTitle", () => {
  test("keeps a short mistake whole", () => {
    expect(mistakeTitle("A derivative is a fraction")).toBe("A derivative is a fraction");
  });

  test("cuts a long one on a word boundary with an ellipsis", () => {
    const title = mistakeTitle("word ".repeat(40));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("  ");
  });
});

describe("mistakeBody", () => {
  const input = {
    sessionName: "Physics — Unit 4",
    sessionId: "2026-11-01-0900-physics-unit-4",
    index: 1,
    text: "Energy is conserved per object.",
    step: "Derive the energy balance",
  };

  test("is labelled as the learner's own record, never a source", () => {
    const body = mistakeBody(input);
    expect(body).toContain("# Energy is conserved per object.");
    expect(body).toContain("not one of the session's sources");
    expect(body).toContain("## Mistake");
    expect(body).toContain("## Corrected understanding");
    expect(body).toContain("Physics — Unit 4");
    expect(body).toContain("`misconceptions.md`");
    expect(body).toContain("entry 2");
    expect(body).toContain("Step: Derive the energy balance");
  });

  test("an uncorrected mistake says so instead of pretending to be settled", () => {
    const body = mistakeBody({ ...input, correction: "  " });
    expect(body).toContain("Not written yet.");
  });

  test("a correction replaces the placeholder", () => {
    const body = mistakeBody({ ...input, correction: "Energy is conserved for a closed system." });
    expect(body).toContain("Energy is conserved for a closed system.");
    expect(body).not.toContain("Not written yet.");
  });
});

describe("the ledger's published limits", () => {
  test("names its constants so the service and the UI cannot drift", () => {
    expect(MAX_MISTAKE_CHARS).toBe(500);
    expect(MISTAKE_ORIGIN).toBe("session-mistake");
    expect(MISTAKE_TAG).toBe("mistake");
    expect(MISTAKE_TOPIC).toBe("Session mistakes");
  });
});

describe("replaceCorrection", () => {
  const body = mistakeBody({
    sessionName: "Physics — Unit 4",
    sessionId: "2026-11-01-0900-physics-unit-4",
    index: 0,
    text: "Energy is conserved per object.",
    step: "Derive the energy balance",
  })

  test("replaces only the correction section and keeps provenance", () => {
    const next = replaceCorrection(body, "  Energy is conserved for a closed system. ")
    expect(next).toContain("## Corrected understanding")
    expect(next).toContain("Energy is conserved for a closed system.")
    expect(next).not.toContain("Not written yet.")
    expect(next).toContain("## Mistake")
    expect(next).toContain("not one of the session's sources")
    expect(next).toContain("Promoted from `misconceptions.md`")
    expect(next).toContain("Step: Derive the energy balance.")
    expect(next.match(/## Corrected understanding/g)).toHaveLength(1)
  })

  test("a second correction replaces the first, not stacks it", () => {
    const first = replaceCorrection(body, "First answer.")
    const second = replaceCorrection(first, "Second answer.")
    expect(second).not.toContain("First answer.")
    expect(second).toContain("Second answer.")
  })

  test("a body whose heading was deleted gets one before the provenance", () => {
    const edited = body.replace("## Corrected understanding\n", "## Notes\n")
    const next = replaceCorrection(edited, "A later answer.")
    expect(next).toContain("## Notes")
    expect(next).toContain("## Corrected understanding")
    expect(next).toContain("A later answer.")
    const provenance = next.indexOf("Promoted from `misconceptions.md`")
    const heading = next.indexOf("## Corrected understanding")
    expect(heading).toBeLessThan(provenance)
  })
})

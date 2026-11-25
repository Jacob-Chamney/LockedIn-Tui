/**
 * The learning graph is a projection of real files.
 *
 * These fixtures are a goal with two steps (one cited, one agent), a session
 * with two steps, a card and a figure cropped from its source, and one research
 * brief. The test asserts the relations we can prove, and that a broken folder
 * is a diagnostic rather than a failed read.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Workspace } from "../../src/storage/workspace";
import { loadLearningGraph } from "../../src/services/knowledge/learning-graph";
import { removeTemp } from "../helpers/cleanup";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const GOAL = "read-disassembly";
const SESSION = "2026-11-01-0900-physics";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(TEMP_BASE, "learning-graph-"));
  const goals = join(root, "skills", "goals");
  const sessions = join(root, "school", "sessions");
  const outputs = join(root, "school", "outputs", SESSION);
  await mkdir(join(goals, GOAL, "sources"), { recursive: true });
  await mkdir(join(goals, GOAL, "research"), { recursive: true });
  await mkdir(join(sessions, SESSION, "sources"), { recursive: true });
  await mkdir(join(sessions, SESSION, "figures"), { recursive: true });
  await mkdir(outputs, { recursive: true });

  await writeFile(
    join(goals, GOAL, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: GOAL,
      name: "Read disassembly",
      statement: "Read disassembly",
      level: "beginner",
      time_budget: "6 weeks",
      created: "2026-11-01T09:00:00Z",
      pinned: false,
      archived: false,
      stages: [],
      sources: [
        {
          name: "intel.md",
          storedPath: "sources/intel.md",
          hash: `sha256:${"a".repeat(64)}`,
          kind: "markdown",
          excerpt: { text: "Registers hold working state across calls." },
        },
      ],
      chats: [],
    }),
  );
  await writeFile(
    join(goals, GOAL, "teaching.json"),
    JSON.stringify({
      schema: 1,
      state: {
        schema: 1,
        goal: "Read disassembly",
        prior: "C",
        measuredAt: "2026-11-01T10:00:00.000Z",
        held: ["registers hold state"],
        gaps: [],
        plan: [
          { id: "step-1", title: "A register holds state", requires: [] },
          { id: "step-2", title: "A call saves its return", requires: ["step-1"] },
        ],
      },
      current: {
        stepId: "step-2",
        prose: "A call writes its return address to the stack.",
        question: "where?",
        citations: [{ name: "intel.md", quote: "Registers hold working state across calls." }],
      },
      checks: [
        {
          stepId: "step-1",
          verdict: "correct",
          correction: "ok",
          citations: [],
          at: "2026-11-01T10:01:00.000Z",
        },
      ],
    }),
  );
  await writeFile(
    join(goals, GOAL, "research", "202611011100-registers.json"),
    JSON.stringify({
      schema: 1,
      id: "202611011100-registers",
      question: "why do registers survive a call?",
      created: "2026-11-01T11:00:00.000Z",
      sources: [{ url: "https://example.org/a", title: "A" }],
    }),
  );

  await writeFile(
    join(sessions, SESSION, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: SESSION,
      name: "Physics",
      created: "2026-11-01T09:00:00Z",
      prompt: "",
      sources: [
        {
          original_path: "/input/lecture.pdf",
          stored_path: "sources/lecture.pdf",
          name: "lecture.pdf",
          hash: `sha256:${"b".repeat(64)}`,
          kind: "pdf",
        },
      ],
      archived: false,
    }),
  );
  await writeFile(
    join(sessions, SESSION, "assignment-steps.md"),
    "# Assignment steps\n\n> 1 of 2 steps done\n\n- [x] Read the chapter\n- [ ] Derive the balance\n",
  );
  await writeFile(
    join(outputs, "flashcards.md"),
    "# Flashcards — Physics\n\n## Card 1\n\nQ: What is a register?\nA: A slot.\nM: no\nK: no\n",
  );
  await writeFile(
    join(sessions, SESSION, "figures", "index.json"),
    JSON.stringify({
      schema: 1,
      figures: [
        {
          id: "figure-1",
          source: "sources/lecture.pdf",
          page: 2,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          caption: "The complex plane",
          note: "",
          file: "figure-1.png",
          createdAt: "2026-11-01T10:00:00.000Z",
        },
      ],
    }),
  );
});

afterEach(async () => {
  await removeTemp(root);
});

function workspace(): Workspace {
  return {
    root,
    paths: {
      root,
      goals: join(root, "skills", "goals"),
      schoolSessions: join(root, "school", "sessions"),
    },
  } as unknown as Workspace;
}

describe("learning graph", () => {
  test("projects goals, steps, sources, sessions, tasks, cards, research and figures", async () => {
    const graph = await loadLearningGraph(workspace());
    expect(graph.counts).toEqual({
      goal: 1,
      step: 2,
      source: 2,
      session: 1,
      task: 2,
      card: 1,
      research: 1,
      figure: 1,
    });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.truncated).toBe(false);

    const step = graph.nodes.find((node) => node.kind === "step" && node.label.includes("call saves"));
    expect(step?.grounded).toBe("source");
    const agentStep = graph.nodes.find((node) => node.kind === "step" && node.label.includes("register holds"));
    expect(agentStep?.grounded).toBe("agent");

    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(ids.has(`goal:${GOAL}`)).toBe(true);
    expect(ids.has(`session:${SESSION}`)).toBe(true);
    expect(ids.has(`card:${SESSION}:card-1`)).toBe(true);
    expect(ids.has(`figure:${SESSION}:figure-1`)).toBe(true);

    const edges = graph.edges.map((edge) => `${edge.from} -${edge.kind}-> ${edge.to}`);
    expect(edges.some((edge) => edge.includes("-cites->"))).toBe(true);
    expect(edges.some((edge) => edge.includes("-cropped-from->"))).toBe(true);
    expect(edges.some((edge) => edge.includes("-answers->"))).toBe(true);
    expect(edges.some((edge) => edge.includes("-tests->"))).toBe(true);
  });

  test("two reads of an unchanged workspace are identical", async () => {
    const first = await loadLearningGraph(workspace());
    const second = await loadLearningGraph(workspace());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a broken goal is a diagnostic, not a failed graph", async () => {
    await writeFile(join(root, "skills", "goals", GOAL, "meta.json"), "{oops");
    const graph = await loadLearningGraph(workspace());
    expect(graph.diagnostics.some((line) => line.includes(GOAL))).toBe(true);
    // The session side still came through.
    expect(graph.counts.session).toBe(1);
    expect(graph.counts.card).toBe(1);
  });

  test("the graph is read-only: no file is created or changed", async () => {
    const before = (await import("node:fs")).readdirSync(root, { recursive: true }).sort();
    await loadLearningGraph(workspace());
    const after = (await import("node:fs")).readdirSync(root, { recursive: true }).sort();
    expect(after).toEqual(before);
  });
});

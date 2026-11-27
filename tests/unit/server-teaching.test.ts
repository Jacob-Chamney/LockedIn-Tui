/**
 * `teach.state` / `teach.measure` / `teach.step` / `teach.check`.
 *
 * Phase D of `desktop/docs/redesign.md`: the harness measures what the learner
 * holds, plans the shortest route, teaches one idea with a check, and repairs
 * what did not land. These cases drive the four methods over the injected boot
 * seam — a throwaway goal folder and a plain completion function, no provider,
 * no network, no user directory.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import { removeTemp } from "../helpers/cleanup";
import {
  BOOT_FAILED,
  CAPABILITIES,
  createCoreServer,
  parseRequest,
  type CoreServices,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../../src/server/protocol";

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
const GOAL_ID = "read-disassembly-3f9a1c";

let base: string;
let goalsDir: string;

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "server-teach-"));
  goalsDir = join(base, "skills", "goals");
  await mkdir(join(goalsDir, GOAL_ID), { recursive: true });
  await writeFile(
    join(goalsDir, GOAL_ID, "meta.json"),
    JSON.stringify({
      schema: 1,
      id: GOAL_ID,
      name: "Read disassembly output confidently",
      statement: "Read disassembly output confidently",
      level: "beginner",
      time_budget: "6 weeks",
      created: "2026-11-01T09:00:00Z",
      pinned: false,
      archived: false,
      stages: [],
      sources: [
        {
          name: "intel.md",
          storedPath: "sources/sha256-intel.md",
          excerpt: { text: "Registers hold working state across calls." },
        },
      ],
      chats: [],
    }),
  );
});

afterEach(async () => {
  await removeTemp(base);
});

function fakeServices(generate?: (prompt: string) => Promise<string>): CoreServices {
  return {
    workspace: {
      root: join(base, "workspace"),
      paths: { goals: goalsDir },
    },
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: join(base, "data"),
      archiveBackend: "folder",
      archiveFolder: "",
      archiveGithubRepo: "",
      archiveGithubBranch: "main",
      archiveGithubConsent: false,
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    },
    ...(generate === undefined ? {} : { generate }),
  } as unknown as CoreServices;
}

function fakeCore(generate?: (prompt: string) => Promise<string>) {
  const server = createCoreServer({
    boot: async () => ({ ok: true, value: fakeServices(generate) }) as Result<CoreServices, BootFailure>,
  });
  return { server };
}

function request(line: string): JsonRpcRequest {
  const parsed = parseRequest(line);
  if ("error" in parsed) throw new Error(`parse failed: ${parsed.error.message}`);
  return parsed;
}

async function ask(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const line = JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) });
  const response = await server.handle(request(line));
  if (response === null) throw new Error("expected a response");
  return response;
}

async function resultOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await ask(server, method, params);
  if ("error" in response) throw new Error(`${method} failed: ${response.error.message}`);
  return response.result as Record<string, unknown>;
}

async function errorOf(
  server: ReturnType<typeof createCoreServer>,
  method: string,
  params?: Record<string, unknown>,
): Promise<{ code: number; message: string; data?: unknown; retryable?: boolean }> {
  const response = await ask(server, method, params);
  if (!("error" in response)) throw new Error(`${method} should have failed`);
  return response.error;
}

const MEASURE = JSON.stringify({
  goal: "Read a function's disassembly and say what it does",
  held: ["registers hold working state", "the stack grows down"],
  gaps: ["argument passing"],
  plan: [
    { title: "A register is a named slot" },
    { title: "A call pushes a return address" },
    { title: "Arguments arrive in registers" },
    { title: "The epilogue restores the frame" },
  ],
});

const BRANCHED = JSON.stringify({
  goal: "Read a function's disassembly and say what it does",
  held: ["registers hold working state"],
  gaps: [],
  plan: [
    { title: "root" },
    { title: "left", requires: [1] },
    { title: "right", requires: [1] },
    { title: "join", requires: [2, 3] },
  ],
});

const STEP = JSON.stringify({
  prose:
    "A call writes the address of the next instruction onto the stack. A return reads it back, so the processor knows where to continue.",
  question: "Where does a call keep the address it must come back to?",
});

const CORRECT = JSON.stringify({ verdict: "correct", correction: "On the stack, pushed by the call." });
const PARTIAL = JSON.stringify({ verdict: "partial", correction: "Half right: the address, not the arguments." });

describe("teach", () => {
  test("the four methods are advertised and shape errors never boot", async () => {
    const methods = ["teach.state", "teach.measure", "teach.step", "teach.check"] as const;
    for (const method of methods) {
      // `CAPABILITIES` is a literal union, so membership is a compile-time
      // check as well as a runtime one.
      expect(CAPABILITIES).toContain(method);
      const error = await errorOf(fakeCore().server, method, {});
      expect(error.code).toBe(-32602);
    }
  });

  test("an unmeasured session reads as null, not an error", async () => {
    const { server } = fakeCore(async () => MEASURE);
    expect(await resultOf(server, "teach.state", { goalId: GOAL_ID })).toEqual({ record: null });
  });

  test("measure writes the plan to the goal folder and returns it", async () => {
    const prompts: string[] = [];
    const { server } = fakeCore(async (prompt) => {
      prompts.push(prompt);
      return MEASURE;
    });

    const result = await resultOf(server, "teach.measure", {
      goalId: GOAL_ID,
      prior: "I know C",
    });
    const record = result.record as Record<string, unknown>;
    const state = record.state as Record<string, unknown>;
    expect(state.goal).toBe("Read a function's disassembly and say what it does");
    expect(state.held).toHaveLength(2);
    expect((state.plan as unknown[]).length).toBe(4);
    expect(record.checks).toEqual([]);

    // The prompt carries the goal, the prior and the source excerpt.
    expect(prompts[0]).toContain("I know C");
    expect(prompts[0]).toContain("Registers hold working state");
    expect(prompts[0]).toContain("JSON only");

    // Durable: the file is there, and `teach.state` reads it back.
    const onDisk = JSON.parse(await readFile(join(goalsDir, GOAL_ID, "teaching.json"), "utf8"));
    expect(onDisk.state.goal).toBe(state.goal);
    const again = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    expect((again.record as Record<string, unknown>).state).toEqual(state);
  });

  test("a malformed measure reply is one refusal and writes nothing", async () => {
    const { server } = fakeCore(async () => '{"goal":"x","held":[],"plan":[]}');
    const error = await errorOf(server, "teach.measure", { goalId: GOAL_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "teaching", goalId: GOAL_ID });
    expect(error.message).toContain("held");
    expect(existsSync(join(goalsDir, GOAL_ID, "teaching.json"))).toBe(false);
  });

  test("no model configured is the documented sentence", async () => {
    const { server } = fakeCore();
    const error = await errorOf(server, "teach.measure", { goalId: GOAL_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("link a model in Settings → Providers");
  });

  test("teach.step opens the first step and re-asks cheaply", async () => {
    let calls = 0;
    const { server } = fakeCore(async (prompt) => {
      calls += 1;
      return prompt.includes('"question"') && prompt.includes("teaching one step") ? STEP : MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    expect(calls).toBe(1);

    const first = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect(first.index).toBe(0);
    expect(first.total).toBe(4);
    expect((first.step as Record<string, unknown>).question).toContain("come back to");
    expect(calls).toBe(2);

    // A second ask while the step is open is the same record, not a new call.
    const again = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect((again.step as Record<string, unknown>).question).toBe(
      (first.step as Record<string, unknown>).question,
    );
    expect(calls).toBe(2);
  });

  test("a correct check passes the step and moves to the next", async () => {
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });

    const checked = await resultOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "on the stack",
    });
    expect(checked.verdict).toBe("correct");
    expect(checked.passed).toBe(true);
    expect(checked.nextIndex).toBe(1);

    // The next ask teaches step 2, and the record carries the check.
    const next = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect(next.index).toBe(1);
    const state = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    const record = state.record as Record<string, unknown>;
    expect((record.checks as unknown[]).length).toBe(1);
    // Step 2 is now the open one: the passed step was cleared before it opened.
    expect((record.current as Record<string, unknown>).stepId).toBe("step-2");
  });

  test("stepId chooses an unlocked branch and refuses a locked one", async () => {
    let calls = 0;
    const { server } = fakeCore(async (prompt) => {
      calls += 1;
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) return STEP;
      return BRANCHED;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });
    await resultOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "on the stack",
    });
    expect(calls).toBe(3);

    // Both branches are available; the learner picks the right one.
    const right = await resultOf(server, "teach.step", {
      goalId: GOAL_ID,
      stepId: "step-3",
    });
    expect(right.index).toBe(2);
    expect((right.step as Record<string, unknown>).stepId).toBe("step-3");
    expect(calls).toBe(4);

    // The join still needs both branches, so it is refused by name and no
    // model call is spent on it.
    const locked = await errorOf(server, "teach.step", {
      goalId: GOAL_ID,
      stepId: "step-4",
    });
    expect(locked.code).toBe(BOOT_FAILED);
    expect(locked.message).toContain("locked");
    expect(calls).toBe(4);

    // A held step has no body to re-teach; its check is already on the record.
    const held = await resultOf(server, "teach.step", {
      goalId: GOAL_ID,
      stepId: "step-1",
    });
    expect(held.step).toBeNull();
    expect(calls).toBe(4);
  });

  test("thinking and confidence ride with the check and are kept on the record", async () => {
    let checkPrompt = "";
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("marking one answer")) {
        checkPrompt = prompt;
        return CORRECT;
      }
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });

    await resultOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "on the stack",
      thinking: "the return address has to survive the call",
      confidence: 4,
    });

    expect(checkPrompt).toContain("the return address has to survive the call");
    expect(checkPrompt).toContain("4/5");
    const state = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    const record = state.record as Record<string, unknown>;
    const check = (record.checks as Record<string, unknown>[])[0]!;
    expect(check.thinking).toBe("the return address has to survive the call");
    expect(check.confidence).toBe(4);
  });

  test("a bad confidence or a non-string thinking is a shape error, not a silent drop", async () => {
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });

    for (const confidence of [0, 6, 2.5, "4"]) {
      const error = await errorOf(server, "teach.check", {
        goalId: GOAL_ID,
        answer: "x",
        confidence,
      });
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("confidence");
    }
    const wrongType = await errorOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "x",
      thinking: 4,
    });
    expect(wrongType.code).toBe(-32602);
    const tooLong = await errorOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "x",
      thinking: "x".repeat(2001),
    });
    expect(tooLong.code).toBe(-32602);
    expect(tooLong.message).toContain("2000");
  });

  test("a step cites its source and the citation survives the check", async () => {
    let stepPrompt = "";
    const cited = JSON.stringify({
      prose:
        "A register is a named slot inside the processor. A call writes the return address onto the stack.",
      question: "Where does a call keep the return address?",
      citations: [{ name: "intel.md", quote: "Registers hold working state across calls." }],
    });
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) {
        stepPrompt = prompt;
        return cited;
      }
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    const opened = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect(stepPrompt).toContain("intel.md");
    expect((opened.step as Record<string, unknown>).citations).toEqual([
      { name: "intel.md", quote: "Registers hold working state across calls." },
    ]);

    await resultOf(server, "teach.check", { goalId: GOAL_ID, answer: "on the stack" });
    const state = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    const record = state.record as Record<string, unknown>;
    const check = (record.checks as Record<string, unknown>[])[0]!;
    expect(check.citations).toEqual([
      { name: "intel.md", quote: "Registers hold working state across calls." },
    ]);
  });

  test("a step that cites a file the goal does not have is refused", async () => {
    const bad = JSON.stringify({
      prose: "A register is a slot inside the processor. It holds work.",
      question: "what holds work?",
      citations: [{ name: "secret.md", quote: "invented" }],
    });
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("teaching one step")) return bad;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    const error = await errorOf(server, "teach.step", { goalId: GOAL_ID });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("secret.md");
    expect(error.retryable).toBe(false);
  });

  test("a partial check keeps the step open for a repair", async () => {
    let stepCalls = 0;
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("marking one answer")) return PARTIAL;
      if (prompt.includes("teaching one step")) {
        stepCalls += 1;
        return STEP;
      }
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });

    const checked = await resultOf(server, "teach.check", {
      goalId: GOAL_ID,
      answer: "the arguments are on the stack",
    });
    expect(checked.verdict).toBe("partial");
    expect(checked.passed).toBe(false);
    expect(checked.nextIndex).toBe(0);

    // Asking again returns the same open step, so a repair is one answer away.
    const again = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect(again.index).toBe(0);
    expect(stepCalls).toBe(1);
  });

  test("a check with no open step is a refusal that names the fix", async () => {
    const { server } = fakeCore(async () => MEASURE);
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    const error = await errorOf(server, "teach.check", { goalId: GOAL_ID, answer: "x" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("no step open");
  });

  test("a complete plan says so instead of inventing a step", async () => {
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    for (let index = 0; index < 4; index++) {
      await resultOf(server, "teach.step", { goalId: GOAL_ID });
      await resultOf(server, "teach.check", { goalId: GOAL_ID, answer: "on the stack" });
    }
    const done = await resultOf(server, "teach.step", { goalId: GOAL_ID });
    expect(done.step).toBeNull();
    expect(done.index).toBe(4);
  });

  test("a side question is answered without touching the lesson or the plan", async () => {
    let sidePrompt = "";
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("companion answering one side question")) {
        sidePrompt = prompt;
        return "The return address is what a call saves so it can come back.";
      }
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });

    const before = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    const empty = await resultOf(server, "teach.side.snapshot", {
      goalId: GOAL_ID,
      stepId: "step-1",
    });
    expect(empty.messages).toEqual([]);

    const asked = await resultOf(server, "teach.side.send", {
      goalId: GOAL_ID,
      stepId: "step-1",
      text: "why does it need the address?",
    });
    expect(asked.reply).toContain("return address");
    const messages = asked.messages as Record<string, unknown>[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]!.text).toBe("why does it need the address?");
    expect(sidePrompt).toContain("A call writes the address");
    expect(sidePrompt).toContain("why does it need the address?");

    // The lesson record is byte-for-byte what it was: a side answer is not a
    // check, a step or a plan edit.
    const after = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    expect(JSON.stringify(after.record)).toBe(JSON.stringify(before.record));

    // A second question carries the first exchange into the prompt.
    await resultOf(server, "teach.side.send", {
      goalId: GOAL_ID,
      stepId: "step-1",
      text: "and where is it stored?",
    });
    expect(sidePrompt).toContain("why does it need the address?");
  });

  test("a failed side answer writes nothing", async () => {
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("companion answering one side question")) {
        throw new Error("provider refused");
      }
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });

    const error = await errorOf(server, "teach.side.send", {
      goalId: GOAL_ID,
      stepId: "step-2",
      text: "why?",
    });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.message).toContain("provider refused");
    const thread = await resultOf(server, "teach.side.snapshot", {
      goalId: GOAL_ID,
      stepId: "step-2",
    });
    expect(thread.messages).toEqual([]);
  });

  test("a side thread names one step and can be cleared", async () => {
    const { server } = fakeCore(async (prompt) => {
      if (prompt.includes("companion answering one side question")) return "a short answer";
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.side.send", {
      goalId: GOAL_ID,
      stepId: "step-3",
      text: "one",
    });

    const unknown = await errorOf(server, "teach.side.snapshot", {
      goalId: GOAL_ID,
      stepId: "step-99",
    });
    expect(unknown.code).toBe(BOOT_FAILED);
    expect(unknown.message).toContain("step-99");

    const cleared = await resultOf(server, "teach.side.clear", {
      goalId: GOAL_ID,
      stepId: "step-3",
    });
    expect(cleared.messages).toEqual([]);
    const after = await resultOf(server, "teach.side.snapshot", {
      goalId: GOAL_ID,
      stepId: "step-3",
    });
    expect(after.messages).toEqual([]);
  });

  test("a blank question or a bad step id is a shape error", async () => {
    const { server } = fakeCore(async () => MEASURE);
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    for (const params of [
      { goalId: GOAL_ID, stepId: "step-1", text: "  " },
      { goalId: GOAL_ID, stepId: "nope", text: "why?" },
      { goalId: GOAL_ID, stepId: "", text: "why?" },
    ]) {
      const error = await errorOf(server, "teach.side.send", params);
      expect(error.code).toBe(-32602);
    }
  });

  test("an unknown goal is the skill error shape", async () => {
    const { server } = fakeCore(async () => MEASURE);
    const error = await errorOf(server, "teach.state", { goalId: "missing-000000" });
    expect(error.code).toBe(BOOT_FAILED);
    expect(error.retryable).toBe(false);
    expect(error.data).toMatchObject({ kind: "skill" });
  });
});

const PRACTICE = JSON.stringify({
  problems: [
    {
      prompt: "A tool prints a value and then another value changes it. Which one did the call leave behind?",
      answer: "The return address: the call wrote it before the other value moved.",
    },
    {
      prompt: "Two functions read the same slot in different orders. What decides which one sees the older value?",
      answer: "The order of the writes.",
    },
  ],
});

describe("teach.practice", () => {
  const core = () =>
    fakeCore(async (prompt) => {
      if (prompt.includes("practice set")) return PRACTICE;
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });

  test("requires a plan and at least one held step", async () => {
    const { server } = core();
    const unmeasured = await errorOf(server, "teach.practice", { goalId: GOAL_ID });
    expect(unmeasured.message).toContain("not been measured");

    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    const nothingHeld = await errorOf(server, "teach.practice", { goalId: GOAL_ID });
    expect(nothingHeld.message).toContain("nothing is held yet");
    expect(nothingHeld.retryable).toBe(false);
  });

  test("builds a set from the taught steps and persists it", async () => {
    const prompts: string[] = [];
    const { server } = fakeCore(async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes("practice set")) return PRACTICE;
      if (prompt.includes("marking one answer")) return CORRECT;
      if (prompt.includes("teaching one step")) return STEP;
      return MEASURE;
    });
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });
    await resultOf(server, "teach.check", { goalId: GOAL_ID, answer: "on the stack" });

    const result = await resultOf(server, "teach.practice", { goalId: GOAL_ID });
    const problems = result.problems as { id: string; prompt: string }[];
    expect(problems).toHaveLength(2);
    expect(problems[0]!.id).toBe("practice-1");
    // The prompt carries the established step and forbids naming the idea.
    expect(prompts.at(-1)).toContain("A register is a named slot");
    expect(prompts.at(-1)).toContain("Do not name the idea");

    const state = await resultOf(server, "teach.state", { goalId: GOAL_ID });
    const record = state.record as Record<string, unknown>;
    expect((record.practice as Record<string, unknown>).problems).toHaveLength(2);
  });

  test("marks solved and missed, and keeps one attempt per problem", async () => {
    const { server } = core();
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    await resultOf(server, "teach.step", { goalId: GOAL_ID });
    await resultOf(server, "teach.check", { goalId: GOAL_ID, answer: "on the stack" });
    await resultOf(server, "teach.practice", { goalId: GOAL_ID });

    const missed = await resultOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-1",
      verdict: "missed",
    });
    expect(missed).toMatchObject({ missed: 1, solved: 0, total: 2 });

    const solved = await resultOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-2",
      verdict: "solved",
    });
    expect(solved).toMatchObject({ solved: 1, missed: 1 });

    // The same problem answered again replaces its attempt rather than adding one.
    const replaced = await resultOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-1",
      verdict: "solved",
    });
    expect(replaced).toMatchObject({ solved: 2, missed: 0 });
  });

  test("refusals name the fix", async () => {
    const { server } = core();
    await resultOf(server, "teach.measure", { goalId: GOAL_ID });
    const noSet = await errorOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-1",
      verdict: "solved",
    });
    expect(noSet.message).toContain("no practice set yet");

    await resultOf(server, "teach.step", { goalId: GOAL_ID });
    await resultOf(server, "teach.check", { goalId: GOAL_ID, answer: "on the stack" });
    await resultOf(server, "teach.practice", { goalId: GOAL_ID });
    const unknown = await errorOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-9",
      verdict: "solved",
    });
    expect(unknown.message).toContain("practice-9");
    const bad = await errorOf(server, "teach.practice.result", {
      goalId: GOAL_ID,
      problemId: "practice-1",
      verdict: "great",
    });
    expect(bad.code).toBe(-32602);
  });
});

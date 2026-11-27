import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SessionServices } from "./session-context";
import { goalFolderFor, readMeta as readGoalMeta } from "../services/skills/progress";
import {
  nextStepIndex,
  readTeaching,
  writeTeaching,
  type TeachingRecord,
} from "../services/teaching/store";
import { withPromptNote } from "../domain/prompts";
import {
  TEACHING_LIMITS,
  checkPrompt,
  measurePrompt,
  parseCheck,
  parseMeasure,
  parsePractice,
  parseStep,
  practicePrompt,
  stepPrompt,
} from "../domain/teaching";
import {
  MAX_SOURCES,
  checkSourceUrl,
  fetchSource,
  listResearch,
  newResearchId,
  normaliseBrief,
  readResearch,
  researchPrompt,
  writeResearch,
  type ResearchItem,
} from "../services/teaching/research";
import { lessonSourceLines } from "./skills";
import {
  appendSideExchange,
  clearSideThread,
  isSideStepId,
  readSideThread,
  sidePrompt,
  withSideLock,
} from "../services/teaching/side";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  messageOf,
  oneLine,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What a teaching or research handler needs from the core. */
export type TeachContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
};

/**
 * The teaching harness and background research briefs
 * (`docs/product.md` §7.2–§7.3, `desktop/docs/redesign.md` §2.1).
 *
 * A session moves measure → plan → teach → check → repair, and every reply is
 * structured data the shell renders — no prose is parsed to guess a verdict.
 * Research is grounded in pages the learner names, every source is fetched under
 * the service's guards, and a brief with no citation is refused.
 */
export function createTeachHandlers<C extends SessionServices>(
  ctx: TeachContext<C>,
): {
  handlers: {
    teachState: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachMeasure: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachStep: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachCheck: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachPractice: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachPracticeResult: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachSideSnapshot: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachSideSend: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    teachSideClear: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    researchStart: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    researchList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    researchRead: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    researchCancel: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
} {
  const { services, notify } = ctx;

  /** In-memory research jobs; a restart forgets a running brief, not a saved one. */
  const researchJobs = new Map<string, { cancelled: boolean }>();

  /** One teaching refusal: no retry, the core's own sentence. */
  const teachFailure = (id: RpcId, goalId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "teaching", goalId, message }, false);

  const teachGoalFailure = (id: RpcId, goalId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, oneLine(message), { kind: "skill", id: goalId, message: oneLine(message) }, false);

  const teachNoModel = (id: RpcId, goalId: string): JsonRpcResponse =>
    teachFailure(id, goalId, "link a model in Settings → Providers");

  const teachState = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.state requires a goal id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);

    const record = await readTeaching(folder);
    if (!record.ok) return teachFailure(id, goalId, record.error.message);
    return success(id, { record: record.value });
  };

  /**
   * Measure the learner and plan the route (`desktop/docs/redesign.md` §2.1).
   *
   * One model call, no retry. The reply is validated against the contract in
   * `src/domain/teaching.ts` — a reply with no held propositions or fewer than
   * three steps is refused with the reason, because a plan built on a guess is
   * worse than no plan. The result is written atomically to the goal folder.
   */
  const teachMeasure = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.measure requires a goal id");
    if (params.prior !== undefined && typeof params.prior !== "string") {
      return invalid(id, "teach.measure: prior must be a string");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return teachNoModel(id, goalId);

    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);

    const { meta: goalMeta, goal: goalRecord } = meta.value;
    const name =
      typeof goalMeta.name === "string" && goalMeta.name.trim() !== "" ? goalMeta.name : goalId;
    const priorParam = typeof params.prior === "string" ? params.prior : "";
    const prior =
      priorParam.trim() !== ""
        ? priorParam.trim()
        : [goalRecord.statement, goalRecord.level].filter((part) => part.trim() !== "").join(" · ");
    // Only a source with a saved excerpt is material; anything else would be a
    // summary the model wrote for itself.
    const sources = (lessonSourceLines(goalMeta) ?? []).map((source) => ({
      name: source.name,
      text: source.excerpt,
    }));
    let raw: string;
    try {
      raw = await generate(
        withPromptNote(measurePrompt({ goal: name, prior, sources }), current.value.promptNote?.("measure")),
      );
    } catch (error) {
      return teachFailure(id, goalId, oneLine(messageOf(error)));
    }

    const parsed = parseMeasure(raw, prior, new Date().toISOString());
    if (!parsed.ok) return teachFailure(id, goalId, parsed.error.message);

    const record: TeachingRecord = {
      schema: 1,
      state: parsed.state,
      checks: [],
    };
    const written = await writeTeaching(folder, record);
    if (!written.ok) return teachFailure(id, goalId, written.error.message);
    return success(id, { record });
  };

  /**
   * Teach the next step: one idea, then one check.
   *
   * `teach.step` is idempotent while a step is open — the same record is
   * returned until a check passes it — so a UI that re-asks on every render
   * does not spend a call per frame. Pass `again: true` to ask for a different
   * wording of the same step.
   */
  const teachStep = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.step requires a goal id");
    if (params.again !== undefined && typeof params.again !== "boolean") {
      return invalid(id, "teach.step: again must be a boolean");
    }
    const rawStepId = params.stepId;
    if (
      rawStepId !== undefined &&
      (typeof rawStepId !== "string" || rawStepId.trim() === "")
    ) {
      return invalid(id, "teach.step: stepId must be a non-empty string");
    }
    const wantedStepId =
      typeof rawStepId === "string" ? rawStepId.trim() : null;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return teachNoModel(id, goalId);

    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);
    const sourceLines = lessonSourceLines(meta.value.meta) ?? [];
    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null) {
      return teachFailure(id, goalId, "this session has not been measured yet; measure it first");
    }

    // A named step lets the learner pick an available branch instead of the
    // first one in plan order. A locked step is refused by name, so the tree's
    // lock and the core's answer cannot disagree.
    let index: number;
    if (wantedStepId === null) {
      index = nextStepIndex(record);
    } else {
      index = record.state.plan.findIndex((step) => step.id === wantedStepId);
      if (index === -1) {
        return teachFailure(
          id,
          goalId,
          `this session has no step ${JSON.stringify(wantedStepId)}`,
        );
      }
      const passed = new Set(
        record.checks
          .filter((check) => check.verdict === "correct")
          .map((check) => check.stepId),
      );
      if (passed.has(wantedStepId)) {
        // A held step has no body to re-teach: its check and correction are on
        // the record, and regenerating it would spend a model call to replace
        // an explanation the learner already passed.
        return success(id, {
          record,
          step: null,
          index,
          total: record.state.plan.length,
        });
      }
      const blockers = record.state.plan[index]!.requires.filter(
        (required) => !passed.has(required),
      );
      if (blockers.length > 0) {
        const titles = blockers.map((required) => {
          const step = record.state.plan.find((entry) => entry.id === required);
          return step?.title ?? required;
        });
        return teachFailure(
          id,
          goalId,
          `${JSON.stringify(wantedStepId)} is locked until ${titles.join(", ")} ${
            titles.length === 1 ? "is" : "are"
          } held`,
        );
      }
    }
    if (index >= record.state.plan.length) {
      return success(id, { record, step: null, index, total: record.state.plan.length });
    }
    const plan = record.state.plan[index]!;
    const open = record.current;
    if (open !== undefined && open.stepId === plan.id && params.again !== true) {
      return success(id, { record, step: open, index, total: record.state.plan.length });
    }

    let raw: string;
    try {
      raw = await generate(
        withPromptNote(stepPrompt({
          goal: record.state.goal,
          held: record.state.held,
          plan: record.state.plan,
          stepIndex: index,
          sources: sourceLines.map((source) => ({ name: source.name, excerpt: source.excerpt })),
        }), current.value.promptNote?.("step")),
      );
    } catch (error) {
      return teachFailure(id, goalId, oneLine(messageOf(error)));
    }
    const parsed = parseStep(raw, plan.id, sourceLines.map((source) => source.name));
    if (!parsed.ok) return teachFailure(id, goalId, parsed.error.message);

    const next: TeachingRecord = { ...record, current: parsed.step };
    const written = await writeTeaching(folder, next);
    if (!written.ok) return teachFailure(id, goalId, written.error.message);
    return success(id, { record: next, step: parsed.step, index, total: next.state.plan.length });
  };

  /**
   * Mark the open step's answer (`desktop/docs/redesign.md` §2.2, §5).
   *
   * One verdict, one correction. A `correct` verdict passes the step and clears
   * the open one, so `teach.step` moves on; anything else keeps the step open
   * for a repair, which is the loop the method asks for — "a step that did not
   * land is found the moment it is stepped on".
   */
  const teachCheck = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.check requires a goal id");
    if (typeof params.answer !== "string" || params.answer.trim() === "") {
      return invalid(id, "teach.check requires an answer");
    }
    if (params.thinking !== undefined && typeof params.thinking !== "string") {
      return invalid(id, "teach.check: thinking must be a string");
    }
    const thinking = typeof params.thinking === "string" ? params.thinking.trim() : "";
    if (thinking.length > TEACHING_LIMITS.thinkingChars) {
      return invalid(
        id,
        `teach.check: thinking is at most ${TEACHING_LIMITS.thinkingChars} characters`,
      );
    }
    if (params.confidence !== undefined) {
      if (
        typeof params.confidence !== "number" ||
        !Number.isInteger(params.confidence) ||
        params.confidence < TEACHING_LIMITS.confidenceMin ||
        params.confidence > TEACHING_LIMITS.confidenceMax
      ) {
        return invalid(
          id,
          `teach.check: confidence must be a whole number from ${TEACHING_LIMITS.confidenceMin} to ${TEACHING_LIMITS.confidenceMax}`,
        );
      }
    }
    const confidence = typeof params.confidence === "number" ? params.confidence : undefined;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return teachNoModel(id, goalId);

    const folder = goalFolderFor(current.value.workspace, goalId);
    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null || record.current === undefined) {
      return teachFailure(id, goalId, "there is no step open to check; ask for the next step first");
    }

    let raw: string;
    try {
      raw = await generate(
        withPromptNote(checkPrompt({
          step: record.current,
          answer: params.answer,
          ...(thinking === "" ? {} : { thinking }),
          ...(confidence === undefined ? {} : { confidence }),
        }), current.value.promptNote?.("check")),
      );
    } catch (error) {
      return teachFailure(id, goalId, oneLine(messageOf(error)));
    }
    const parsed = parseCheck(raw);
    if (!parsed.ok) return teachFailure(id, goalId, parsed.error.message);

    const verdict = parsed.check;
    const passed = verdict.verdict === "correct";
    const next: TeachingRecord = {
      ...record,
      ...(passed ? { current: undefined } : {}),
      checks: [
        ...record.checks,
        {
          stepId: record.current.stepId,
          verdict: verdict.verdict,
          correction: verdict.correction,
          ...(thinking === "" ? {} : { thinking }),
          ...(confidence === undefined ? {} : { confidence }),
          citations: record.current.citations,
          at: new Date().toISOString(),
        },
      ],
    };
    const written = await writeTeaching(folder, next);
    if (!written.ok) return teachFailure(id, goalId, written.error.message);
    return success(id, {
      record: next,
      verdict: verdict.verdict,
      correction: verdict.correction,
      passed,
      nextIndex: nextStepIndex(next),
      total: next.state.plan.length,
    });
  };

  /**
   * Build a practice set from what the lesson has established
   * (`desktop/docs/redesign.md` §2.1, the fourth phase).
   *
   * One model call, no retry. Only steps with a passing check are *taught*, so
   * a session cannot practise what it never landed. A prompt that names the
   * idea is a quiz, not practice; the prompt in `src/domain/teaching.ts` says so
   * and the reply is validated for shape, not for wording.
   */
  const teachPractice = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.practice requires a goal id");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return teachNoModel(id, goalId);

    const folder = goalFolderFor(current.value.workspace, goalId);
    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null) {
      return teachFailure(id, goalId, "this session has not been measured yet; measure it first");
    }
    const passed = new Set(
      record.checks.filter((check) => check.verdict === "correct").map((check) => check.stepId),
    );
    const taught = record.state.plan.filter((step) => passed.has(step.id)).map((step) => step.title);
    if (taught.length === 0) {
      return teachFailure(
        id,
        goalId,
        "nothing is held yet: teach a step and pass its check before practising",
      );
    }

    let raw: string;
    try {
      raw = await generate(
        withPromptNote(
          practicePrompt({ goal: record.state.goal, held: record.state.held, taught }),
          current.value.promptNote?.("practice"),
        ),
      );
    } catch (error) {
      return teachFailure(id, goalId, oneLine(messageOf(error)));
    }
    const parsed = parsePractice(raw);
    if (!parsed.ok) return teachFailure(id, goalId, parsed.error.message);

    // A new set keeps the attempts that still name a problem in it, so a
    // regenerated set does not silently reset what was already solved.
    const next: TeachingRecord = {
      ...record,
      practice: {
        problems: parsed.problems,
        attempts: (record.practice?.attempts ?? []).filter((attempt) =>
          parsed.problems.some((problem) => problem.id === attempt.problemId),
        ),
        generatedAt: new Date().toISOString(),
      },
    };
    const written = await writeTeaching(folder, next);
    if (!written.ok) return teachFailure(id, goalId, written.error.message);
    return success(id, { record: next, problems: parsed.problems });
  };

  /**
   * Record one practice verdict (`solved` or `missed`).
   *
   * A miss is kept on the record and counted in the reply, so the surface can
   * say how many still need work; it is deliberately not retried and does not
   * touch the step checks — practice is a different claim from "the step
   * landed".
   */
  const teachPracticeResult = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "teach.practice.result requires a goal id");
    const problemId = typeof params.problemId === "string" ? params.problemId.trim() : "";
    if (problemId === "") return invalid(id, "teach.practice.result requires a problem id");
    const verdict = params.verdict;
    if (verdict !== "solved" && verdict !== "missed") {
      return invalid(id, 'teach.practice.result requires verdict "solved" or "missed"');
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null || record.practice === undefined) {
      return teachFailure(id, goalId, "there is no practice set yet; generate one first");
    }
    if (!record.practice.problems.some((problem) => problem.id === problemId)) {
      return teachFailure(id, goalId, `there is no practice problem "${problemId}" in this set`);
    }

    const attempt = { problemId, verdict, at: new Date().toISOString() } as const;
    const attempts = [
      ...record.practice.attempts.filter((entry) => entry.problemId !== problemId),
      attempt,
    ];
    const next: TeachingRecord = { ...record, practice: { ...record.practice, attempts } };
    const written = await writeTeaching(folder, next);
    if (!written.ok) return teachFailure(id, goalId, written.error.message);
    return success(id, {
      record: next,
      verdict,
      solved: attempts.filter((entry) => entry.verdict === "solved").length,
      missed: attempts.filter((entry) => entry.verdict === "missed").length,
      total: record.practice.problems.length,
    });
  };

  /**
   * The side thread for one step, or `[]`.
   *
   * Read-only. A step that is not in the plan is refused rather than opening a
   * thread for a step that cannot exist.
   */
  const teachSideSnapshot = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const stepId = typeof params.stepId === "string" ? params.stepId.trim() : "";
    if (goalId === "") return invalid(id, "teach.side.snapshot requires a goal id");
    if (stepId === "") return invalid(id, "teach.side.snapshot requires a step id");
    if (!isSideStepId(stepId)) return invalid(id, "teach.side.snapshot: stepId must look like step-1");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);

    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null) {
      return teachFailure(id, goalId, "this session has not been measured yet; measure it first");
    }
    if (!record.state.plan.some((step) => step.id === stepId)) {
      return teachFailure(id, goalId, `there is no step "${stepId}" in this plan`);
    }

    const thread = await readSideThread(folder, stepId);
    if (!thread.ok) return teachFailure(id, goalId, thread.error.message);
    return success(id, { messages: thread.value });
  };

  /**
   * Ask one side question about a step.
   *
   * One tool-less model call, no retry. The exchange is written only after the
   * reply exists, so a failure leaves the thread exactly as it was. The thread
   * is the step's own; it never enters the lesson chat or the plan.
   */
  const teachSideSend = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const stepId = typeof params.stepId === "string" ? params.stepId.trim() : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (goalId === "") return invalid(id, "teach.side.send requires a goal id");
    if (stepId === "") return invalid(id, "teach.side.send requires a step id");
    if (!isSideStepId(stepId)) return invalid(id, "teach.side.send: stepId must look like step-1");
    if (text === "") return invalid(id, "teach.side.send requires a question");
    if (text.length > 2000) return invalid(id, "teach.side.send: question is at most 2000 characters");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return teachNoModel(id, goalId);

    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);

    const loaded = await readTeaching(folder);
    if (!loaded.ok) return teachFailure(id, goalId, loaded.error.message);
    const record = loaded.value;
    if (record === null) {
      return teachFailure(id, goalId, "this session has not been measured yet; measure it first");
    }
    const step = record.state.plan.find((entry) => entry.id === stepId);
    if (!step) return teachFailure(id, goalId, `there is no step "${stepId}" in this plan`);

    const open = record.current?.stepId === stepId ? record.current : undefined;
    return withSideLock(`${folder}:${stepId}`, async () => {
      const before = await readSideThread(folder, stepId);
      if (!before.ok) return teachFailure(id, goalId, before.error.message);

      let raw: string;
      try {
        raw = await generate(
          withPromptNote(sidePrompt({
            goal: record.state.goal,
            stepProse: open?.prose ?? step.title,
            stepQuestion: open?.question ?? "(this step is not open)",
            messages: before.value,
            question: text,
          }), current.value.promptNote?.("side")),
        );
      } catch (error) {
        return teachFailure(id, goalId, oneLine(messageOf(error)));
      }
      const reply = raw.trim();
      if (reply === "") {
        return teachFailure(id, goalId, "the side answer was empty; ask again");
      }

      const at = new Date().toISOString();
      const written = await appendSideExchange(
        folder,
        stepId,
        { role: "user", text, at },
        { role: "assistant", text: reply.slice(0, 4000), at },
      );
      if (!written.ok) return teachFailure(id, goalId, written.error.message);
      return success(id, { messages: written.value, reply });
    });
  };

  /** Clear one step's side thread. The lesson and the plan are untouched. */
  const teachSideClear = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const stepId = typeof params.stepId === "string" ? params.stepId.trim() : "";
    if (goalId === "") return invalid(id, "teach.side.clear requires a goal id");
    if (stepId === "") return invalid(id, "teach.side.clear requires a step id");
    if (!isSideStepId(stepId)) return invalid(id, "teach.side.clear: stepId must look like step-1");

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);
    return withSideLock(`${folder}:${stepId}`, async () => {
      const cleared = await clearSideThread(folder, stepId);
      if (!cleared.ok) return teachFailure(id, goalId, cleared.error.message);
      return success(id, { messages: [] });
    });
  };

  /* ------------------------------------------------------------------------ */
  /* Figures                                                                  */
  /* ------------------------------------------------------------------------ */

  /* ------------------------------------------------------------------------ */
  /* Research                                                                 */
  /* ------------------------------------------------------------------------ */

  const researchFailure = (id: RpcId, goalId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "research", goalId, message }, false);

  /**
   * Start one research brief.
   *
   * The reply returns as soon as the job is registered; `research.updated`
   * carries the outcome. Every source is fetched under the service's guards
   * (HTTPS, public host, text content, timeout, size cap) and the model must
   * cite at least one of them. A failure writes nothing.
   */
  const researchStart = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const question = typeof params.question === "string" ? params.question.trim() : "";
    if (goalId === "") return invalid(id, "research.start requires a goal id");
    if (question === "") return invalid(id, "research.start requires a question");
    if (question.length > 500) return invalid(id, "research.start: question is at most 500 characters");
    const rawUrls = params.urls;
    if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
      return invalid(id, "research.start requires at least one https source URL");
    }
    if (rawUrls.length > MAX_SOURCES) {
      return invalid(id, `research.start: at most ${MAX_SOURCES} sources`);
    }
    const urls: string[] = [];
    for (const entry of rawUrls) {
      if (typeof entry !== "string" || entry.trim() === "") {
        return invalid(id, "research.start: every source must be a URL string");
      }
      const checked = checkSourceUrl(entry);
      if (!checked.ok) return invalid(id, `research.start: ${checked.message}`);
      urls.push(checked.url.href);
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    if (!generate) return researchFailure(id, goalId, "link a model in Settings → Providers");

    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);

    const now = new Date();
    const researchId = newResearchId(question, now);
    const key = `${goalId}:${researchId}`;
    const job = { cancelled: false };
    researchJobs.set(key, job);
    const emit = (patch: Record<string, unknown>) =>
      notify({
        jsonrpc: "2.0",
        method: "research.updated",
        params: { goalId, id: researchId, ...patch },
      });

    void (async () => {
      try {
        const fetched: import("../services/teaching/research").FetchedSource[] = [];
        for (const url of urls) {
          if (job.cancelled) break;
          const result = await fetchSource(url, current.value.researchFetch);
          if (result.ok) fetched.push(result.value);
        }
        if (job.cancelled) {
          researchJobs.delete(key);
          emit({ status: "cancelled" });
          return;
        }
        if (fetched.length === 0) {
          researchJobs.delete(key);
          emit({ status: "failed", message: "none of the sources could be read" });
          return;
        }
        const raw = await generate(
          withPromptNote(
            researchPrompt({ question, sources: fetched }),
            current.value.promptNote?.("research"),
          ),
        );
        if (job.cancelled) {
          researchJobs.delete(key);
          emit({ status: "cancelled" });
          return;
        }
        const brief = normaliseBrief(raw, fetched.length);
        if (!brief.ok) {
          researchJobs.delete(key);
          emit({ status: "failed", message: brief.message });
          return;
        }
        const item: ResearchItem = {
          id: researchId,
          question,
          created: now.toISOString(),
          sources: fetched.map((source) => ({ url: source.url, title: source.title })),
        };
        const written = await writeResearch(folder, item, brief.text);
        researchJobs.delete(key);
        if (!written.ok) {
          emit({ status: "failed", message: written.error.message });
          return;
        }
        emit({ status: "done", item });
      } catch (error) {
        researchJobs.delete(key);
        emit({ status: "failed", message: oneLine(messageOf(error)) });
      }
    })();

    return success(id, { id: researchId, status: "running" });
  };

  /** Saved briefs for one goal, newest first. Read-only. */
  const researchList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    if (goalId === "") return invalid(id, "research.list requires a goal id");
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);
    const listed = await listResearch(folder);
    if (!listed.ok) return researchFailure(id, goalId, listed.error.message);
    return success(id, { items: listed.value });
  };

  /** One saved brief, Markdown included. Read-only. */
  const researchRead = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const researchId = typeof params.id === "string" ? params.id.trim() : "";
    if (goalId === "") return invalid(id, "research.read requires a goal id");
    if (researchId === "") return invalid(id, "research.read requires a research id");
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const folder = goalFolderFor(current.value.workspace, goalId);
    const meta = await readGoalMeta(folder);
    if (!meta.ok) return teachGoalFailure(id, goalId, meta.error.message);
    const read = await readResearch(folder, researchId);
    if (!read.ok) return researchFailure(id, goalId, read.error.message);
    return success(id, { item: read.value.item, markdown: read.value.markdown });
  };

  /** Ask a running brief to discard its result. The fetch/model call is not aborted. */
  const researchCancel = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const goalId = typeof params.goalId === "string" ? params.goalId.trim() : "";
    const researchId = typeof params.id === "string" ? params.id.trim() : "";
    if (goalId === "") return invalid(id, "research.cancel requires a goal id");
    if (researchId === "") return invalid(id, "research.cancel requires a research id");
    const job = researchJobs.get(`${goalId}:${researchId}`);
    if (!job) return success(id, { cancelled: false });
    job.cancelled = true;
    return success(id, { cancelled: true });
  };

  /* ------------------------------------------------------------------------ */
  /* Updates                                                                  */
  /* ------------------------------------------------------------------------ */

  /* ------------------------------------------------------------------------ */
  /* Prompt notes                                                             */
  /* ------------------------------------------------------------------------ */


  return {
    handlers: {
      teachState,
      teachMeasure,
      teachStep,
      teachCheck,
      teachPractice,
      teachPracticeResult,
      teachSideSnapshot,
      teachSideSend,
      teachSideClear,
      researchStart,
      researchList,
      researchRead,
      researchCancel,
    },
  };
}

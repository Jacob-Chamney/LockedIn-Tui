import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { SessionServices } from "./session-context";
import type { ChatController } from "../app/chat-controller";
import { createJsonlHistoryPort } from "../storage/chat-history";
import { loadGoalRows } from "../app/actions/skills";
import {
  createSkillCourse,
  gatherSkillSources,
  loadChapter,
  loadCourse,
  loadSkillChats,
  skillTools,
} from "../app/actions/skills";
import { chatSnapshot, type ChatState } from "./chat-wire";
import { archiveGoal, exportGoal } from "../services/skills/archive";
import { deleteGoal } from "../services/skills/delete";
import { LESSONS_DIR, buildLesson, lessonFileName } from "../services/skills/lesson";
import { CURRICULUM_FILE, renderCurriculum } from "../services/skills/create";
import { relative, sep } from "node:path";
import { goalFolderFor, readMeta as readGoalMeta, writeMeta as writeGoalMeta } from "../services/skills/progress";
import {
  MAX_SKILL_GOAL_CHARS,
  MAX_SKILL_PRIOR_CHARS,
  lessonPrompt,
  lessonSourceLines,
  parseLessonDraft,
  parseSkillPlan,
  skillPlanPrompt,
  readSkillMeta,
  skillSourceRows,
  skillStageRows,
  type LessonTarget,
} from "./skills";
import { openChat as openSkillChat } from "../services/skills/chats";
import { stepFailureMessage } from "../app/actions/lockin";
import { MAX_TITLE_CHARS, validateCurriculum, type CurriculumStage } from "../domain/curriculum";
import { replaceAtomic } from "./review-mark";
import { resolveArchiveBackend } from "./archive-backend";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  messageOf,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What a skill handler needs from the core beyond the session doors. */
export type SkillHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
  historyLimit: (current: C) => number;
  /** The settings in force, including an uncommitted patch. */
  settingsView: (current: C) => import("../types/settings").SettingsView;
};

/**
 * The Skills surface: goals, courses, staged lessons, gathered sources and
 * goal-scoped chat (`docs/product.md` §7).
 *
 * A goal's chat is **source-bound and read-only**: the toolbox is the goal's
 * own gathered `sources/`, every factual claim cites one of them or is labelled
 * `(agent explanation)`, and nothing on this path writes a lesson, an output or
 * an archive unless the method is one of the explicit writes.
 */
export function createSkillHandlers<C extends SessionServices>(
  ctx: SkillHandlerContext<C>,
): {
  handlers: Record<string, (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>>;
  /** Drop every goal-chat controller after a settings change. */
  resetSkillChats: () => void;
} {
  const { services, notify, historyLimit, settingsView } = ctx;

  /**
   * The Skills surface.
   *
   * `skill.list` is the goal manager's projection: the same rows the TUI builds
   * from each goal's `meta.json`, including a broken folder (it carries `broken`
   * and its reason) rather than a silently invented or dropped row.
   *
   * `skill.open` is the goal page: the course index, the goal's curriculum
   * stages and its saved chats. It reads `meta.json` and `chats/`, but **no
   * chapter file**; the index is the page, not the lesson. A goal folder can be
   * either shape — a course (`chapters`, written by `skill.create`) or a
   * curriculum (`stages`, the TUI's goal shape) — so the page serves both:
   * `chapters: []` for a curriculum goal and `stages: []` for a template course.
   *
   * `skill.chapter` is the **only** method that returns a chapter body. It reads
   * one Markdown file (the lesson, or the practical when `practical` is true)
   * through the service's confined path, so a chapter can never point outside
   * the goal's `chapters/`.
   *
   * `skill.create` is the wizard's Review step: it writes one goal folder and
   * the template plan. It makes **no provider call** — a model-written plan and
   * a staged lesson build are later packets — so every new course records
   * `plan: "template"`. Nothing here archives, deletes or chats.
   *
   * `skill.chat.*` is the goal-scoped chat (`Skill chat (T-021)` below): its
   * transcript is the goal's own `chats/<id>.jsonl`, its facts come only from
   * the goal's gathered sources (labelled `(agent explanation)` otherwise), its
   * tools are read-only, and it writes no lesson, output or archive.
   */
  const skillList = async (
    id: RpcId,
    _params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const rows = await loadGoalRows(current.value.workspace);
    return success(id, { skills: rows });
  };

  const skillOpen = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const raw = params.id;
    if (typeof raw !== "string" || raw.trim() === "") {
      return invalid(id, "skill.open requires a skill id");
    }
    const skillId = raw.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // `loadCourse` is `readCourse` with the typed error dropped, so an unknown
    // id, a corrupt `meta.json` and a missing folder are one failure shape: the
    // shell renders one readable message and offers the list, never a blank
    // page. The id is a folder name, never a path.
    const course = await loadCourse(current.value.workspace, skillId);
    // The stages come from the same `meta.json` reader the lesson methods
    // resolve a stage with, so a stage id the shell sends back is the one those
    // methods accept. A goal that cannot be read has no stages; the failure
    // itself is reported (or ignored) by the branch below.
    const goal = await readGoalMeta(goalFolderFor(current.value.workspace, skillId));
    const stages = goal.ok ? skillStageRows(goal.value.goal.stages) : [];
    // A folder that carries a chapter index is a course. A course that cannot be
    // read as one is still the typed error below: a malformed index is never
    // silently reported as an empty course.
    const hasChapters = goal.ok && Array.isArray(goal.value.meta.chapters);

    if (course === null) {
      if (!goal.ok || hasChapters) {
        const message = `the skill ${JSON.stringify(skillId)} has no readable course in this workspace`;
        return failure(id, BOOT_FAILED, message, { kind: "skill", id: skillId, message }, false);
      }
      // A goal folder that is not a course is the curriculum shape: `stages`
      // and no `chapters`. The page is that `meta.json`, so the lesson reader
      // can pick a stage without a second method.
      const curriculum = goal.value.goal;
      const curriculumChats = await loadSkillChats(current.value.workspace, skillId);
      return success(id, {
        skill: {
          id: curriculum.id === "" ? skillId : curriculum.id,
          name: curriculum.name === "" ? skillId : curriculum.name,
          goal: curriculum.statement,
          // A curriculum goal has no "prior knowledge" field and no chapter
          // plan; both are course concepts, and the shell renders them only for
          // a course.
          prior: "",
          created: curriculum.created,
          plan: "template",
          chapters: [],
          stages,
          chats: curriculumChats,
        },
      });
    }
    const chats = await loadSkillChats(current.value.workspace, skillId);

    return success(id, {
      skill: {
        id: course.id,
        name: course.name,
        goal: course.goal,
        prior: course.prior,
        created: course.created,
        // A course written before the model seam has no `plan`; it was built
        // from the template, and reporting that is more honest than `null`.
        plan: course.plan ?? "template",
        chapters: course.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          guide: chapter.guide,
          practical: chapter.practical,
          done: chapter.done,
        })),
        // A template course has no curriculum, so the stage picker is empty
        // rather than an error; `skill.lesson.*` refuses an unknown stage.
        stages,
        chats,
      },
    });
  };

  /**
   * One chapter body: the lesson, or the practical with `practical: true`.
   *
   * Two failure shapes, both reported once and never retried: an unreadable
   * course is the `skill` shape `skill.open` already uses, and a chapter that
   * does not exist or cannot be read is the `chapter` shape. The reply names the
   * chapter id and title so the shell does not have to re-derive them.
   */
  const skillChapter = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "skill.chapter requires a skill id");
    }
    const skillId = rawId.trim();
    const rawChapterId = params.chapterId;
    if (typeof rawChapterId !== "string" || rawChapterId.trim() === "") {
      return invalid(id, "skill.chapter requires a chapter id");
    }
    const chapterId = rawChapterId.trim();
    const rawPractical = params.practical;
    if (rawPractical !== undefined && typeof rawPractical !== "boolean") {
      return invalid(id, "skill.chapter practical must be a boolean");
    }
    const practical = rawPractical === true;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const course = await loadCourse(current.value.workspace, skillId);
    if (course === null) {
      const message = `the skill ${JSON.stringify(skillId)} has no readable course in this workspace`;
      return failure(id, BOOT_FAILED, message, { kind: "skill", id: skillId, message }, false);
    }

    const chapter = course.chapters.find((entry) => entry.id === chapterId);
    if (!chapter) {
      const message = `the skill ${JSON.stringify(skillId)} has no chapter ${JSON.stringify(chapterId)}`;
      return failure(id, BOOT_FAILED, message, { kind: "chapter", id: skillId, chapterId, message }, false);
    }

    const read = await loadChapter(current.value.workspace, course, chapterId, practical);
    if (!read.ok) {
      const message = oneLine(read.message);
      return failure(id, BOOT_FAILED, message, { kind: "chapter", id: skillId, chapterId, message }, false);
    }

    return success(id, {
      text: read.text,
      practical,
      chapter: { id: chapter.id, title: chapter.title },
    });
  };

  /**
   * Create one skill goal: the Skills wizard's Review step.
   *
   * The course service owns the transaction: it derives the id from the goal
   * against the ids already on disk, writes the chapter plan and both chapter
   * files into a temp folder, then renames it into place. A failure therefore
   * leaves no goal folder and no half-written file (`AGENTS.md` §2.9).
   *
   * When a model is configured, one completion writes the plan from the goal
   * and prior knowledge. The reply is asked for JSON only and parsed here; a
   * failed call, malformed JSON or a plan with no usable chapter falls back to
   * the built-in template rather than failing the wizard, and `plan` reports
   * which one was written. There is no retry. The shell receives `{id, name,
   * plan}` and calls `skill.open` for the chapters, so this response is not a
   * second copy of the course.
   */
  const skillCreate = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawGoal = params.goal;
    if (typeof rawGoal !== "string" || rawGoal.trim() === "") {
      return invalid(id, "skill.create requires a non-empty goal string");
    }
    const goal = rawGoal.trim();
    if (goal.length > MAX_SKILL_GOAL_CHARS) {
      return invalid(
        id,
        `skill.create: a goal is at most ${MAX_SKILL_GOAL_CHARS} characters`,
      );
    }
    const rawPrior = params.prior;
    if (rawPrior !== undefined && typeof rawPrior !== "string") {
      return invalid(id, "skill.create: prior must be a string");
    }
    const prior = typeof rawPrior === "string" ? rawPrior : "";
    if (prior.trim().length > MAX_SKILL_PRIOR_CHARS) {
      return invalid(
        id,
        `skill.create: prior is at most ${MAX_SKILL_PRIOR_CHARS} characters`,
      );
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Goal ids are derived from the goal text, so two goals with the same words
    // must not collide: the taken set makes the service suffix the second one.
    // `loadGoalRows` includes a broken folder's own id, so a folder this build
    // cannot read still reserves its name.
    const taken = (await loadGoalRows(current.value.workspace)).map((row) => row.id);
    // One model call writes the plan when a model is configured. The reply is
    // parsed here so `createCourse` only ever sees a usable plan or `[]`; a
    // throw from the provider is caught by the service, which keeps the
    // template. There is no retry.
    const generate = current.value.generate;
    const created = await createSkillCourse({
      workspace: current.value.workspace,
      goal,
      prior,
      created: new Date(),
      takenIds: taken,
      ...(generate
        ? {
            generate: async ({ goal: planGoal, prior: planPrior }) =>
              parseSkillPlan(await generate(skillPlanPrompt(planGoal, planPrior))),
          }
        : {}),
    });
    if (!created.ok) {
      const message = oneLine(created.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "skill-create", message }, false);
    }
    return success(id, {
      id: created.value.id,
      name: created.value.name,
      // A course written before the flag existed was template-built; `createCourse`
      // always sets it, and reporting the fallback is more honest than `null`.
      plan: created.value.plan ?? "template",
    });
  };

  /* ------------------------------------------------------------------------ */
  /* Staged lessons                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * Resolve one goal and stage for a lesson request.
   *
   * The stage list comes from the goal's `meta.json` (`readGoalMeta`), not from
   * a caller path, so the id is a folder name. An unreadable goal is the shared
   * `skill` shape; a stage that does not exist is the `stage` shape. `meta` is
   * returned too: the build prompt needs the goal's saved source excerpts.
   */
  const resolveLessonTarget = async (
    id: RpcId,
    current: C,
    rawGoal: unknown,
    rawStage: unknown,
    method: string,
  ): Promise<{ error: JsonRpcFailure } | LessonTarget> => {
    if (typeof rawGoal !== "string" || rawGoal.trim() === "") {
      return { error: invalid(id, `${method} requires a goal id`) };
    }
    if (typeof rawStage !== "string" || rawStage.trim() === "") {
      return { error: invalid(id, `${method} requires a stage id`) };
    }
    const goalId = rawGoal.trim();
    const stageId = rawStage.trim();
    const folder = goalFolderFor(current.workspace, goalId);

    const loaded = await readGoalMeta(folder);
    if (!loaded.ok) {
      const message = oneLine(loaded.error.message);
      return {
        error: failure(id, BOOT_FAILED, message, { kind: "skill", id: goalId, message }, false),
      };
    }

    const position = loaded.value.goal.stages.findIndex((stage) => stage.id === stageId);
    const stage = loaded.value.goal.stages[position];
    if (!stage) {
      const message = `the skill ${JSON.stringify(goalId)} has no stage ${JSON.stringify(stageId)}`;
      return {
        error: failure(id, BOOT_FAILED, message, { kind: "stage", goalId, stageId, message }, false),
      };
    }

    return {
      goalId,
      stageId,
      folder,
      position,
      title: stage.title,
      name: loaded.value.goal.name,
      meta: loaded.value.meta,
    };
  };

  /** The lesson failure shape: one goal, one stage, one message. */
  const lessonFailure = (
    id: RpcId,
    target: LessonTarget,
    message: string,
  ): JsonRpcFailure =>
    failure(
      id,
      BOOT_FAILED,
      message,
      { kind: "lesson", goalId: target.goalId, stageId: target.stageId, message },
      false,
    );

  /**
   * Build one stage's lesson: one model call, one atomic write.
   *
   * The model is asked for JSON only and every paragraph must cite one of the
   * goal's source names (`[src: name]`) or start with `(agent explanation)`.
   * `src/services/skills/lesson.ts` owns the trust check, the section order and
   * the write, so a malformed reply, an uncited claim or a citation of a source
   * this goal does not have is refused before the lesson file is touched.
   *
   * Replacing an existing `ready` lesson is a user decision: unless the caller
   * sends `confirmed: true` the service returns `confirm`, and the shell asks
   * by name before repeating the call. The reply's `path` is goal-relative
   * (`lessons/02-<slug>.md`), never absolute.
   */
  const skillLessonBuild = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawSolution = params.includeSolution;
    if (rawSolution !== undefined && typeof rawSolution !== "boolean") {
      return invalid(id, "skill.lesson.build: includeSolution must be a boolean");
    }
    const includeSolution = rawSolution === true;

    const rawConfirmed = params.confirmed;
    if (rawConfirmed !== undefined && typeof rawConfirmed !== "boolean") {
      return invalid(id, "skill.lesson.build: confirmed must be a boolean");
    }
    const confirmed = rawConfirmed === true;

    // Shape before boot: a malformed request never opens the workspace.
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.lesson.build requires a goal id");
    }
    if (typeof params.stageId !== "string" || params.stageId.trim() === "") {
      return invalid(id, "skill.lesson.build requires a stage id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const target = await resolveLessonTarget(
      id,
      current.value,
      params.goalId,
      params.stageId,
      "skill.lesson.build",
    );
    if ("error" in target) return target.error;

    const generate = current.value.generate;
    if (!generate) {
      const message = "link a model in Settings → Providers";
      return failure(id, BOOT_FAILED, message, { kind: "generation", id: target.goalId, message }, false);
    }

    const sources = lessonSourceLines(target.meta);
    if (sources === null) {
      return lessonFailure(
        id,
        target,
        "the goal's source list is malformed; fix meta.json in the goal folder",
      );
    }
    if (sources.length === 0) {
      return lessonFailure(id, target, "this goal has no source this lesson can cite");
    }

    let raw: string;
    try {
      raw = await generate(lessonPrompt(target.name, target.title, sources));
    } catch (error) {
      // One actionable sentence from the failure policy; there is no retry.
      const message = oneLine(stepFailureMessage(error));
      return failure(id, BOOT_FAILED, message, { kind: "generation", id: target.goalId, message }, false);
    }

    const parsed = parseLessonDraft(raw);
    if (!parsed.ok) return lessonFailure(id, target, parsed.message);

    const built = await buildLesson({
      workspace: current.value.workspace,
      goalId: target.goalId,
      stageId: target.stageId,
      draft: parsed.draft,
      ...(includeSolution ? { includeSolution: true } : {}),
      ...(confirmed ? { confirmed: true } : {}),
    });
    if (!built.ok) {
      const message = oneLine(built.error.message);
      if (built.error.kind === "confirm") {
        return failure(
          id,
          BOOT_FAILED,
          message,
          {
            kind: "confirm",
            goalId: target.goalId,
            stageId: target.stageId,
            status: built.error.status,
            message,
          },
          false,
        );
      }
      return lessonFailure(id, target, message);
    }

    // The service's path is absolute; the wire carries the goal-relative file
    // so a shell never receives a machine path it could re-open itself.
    const path = relative(target.folder, built.value.path).split(sep).join("/");
    return success(id, {
      path,
      markdown: built.value.markdown,
      status: built.value.status,
      citations: built.value.citations,
    });
  };

  /**
   * Read one stage's lesson without generating.
   *
   * The file name is derived from the stage's position and title with the same
   * `lessonFileName` the service writes (`lessons/NN-<slug>.md`), so read and
   * build cannot disagree. A missing file is `{markdown: "", exists: false}` —
   * the reader's empty state with a next action (`skill.lesson.build`), not an
   * error. This path writes nothing.
   */
  const skillLessonRead = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    // Shape before boot: a malformed request never opens the workspace.
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.lesson.read requires a goal id");
    }
    if (typeof params.stageId !== "string" || params.stageId.trim() === "") {
      return invalid(id, "skill.lesson.read requires a stage id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const target = await resolveLessonTarget(
      id,
      current.value,
      params.goalId,
      params.stageId,
      "skill.lesson.read",
    );
    if ("error" in target) return target.error;

    const path = join(
      target.folder,
      LESSONS_DIR,
      lessonFileName(target.position + 1, target.title),
    );
    try {
      return success(id, { markdown: await readFile(path, "utf8"), exists: true });
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return success(id, { markdown: "", exists: false });
      }
      return lessonFailure(id, target, oneLine(messageOf(error)));
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Skill chat (T-021)                                                       */
  /* ------------------------------------------------------------------------ */

  /**
   * One skill-goal chat controller, keyed by `goalId:chatId`.
   *
   * A goal has several chats (`chats/chat-<n>.jsonl`), so the key carries both
   * ids and every event echoes them back. The transcript is the goal's own file;
   * the toolbox is `skillTools(workspace, goalId)`, bound to that goal's
   * `sources/`. Chat is read-only: it never writes a lesson, an output or an
   * archive, and every fact it states is either cited from the gathered sources
   * or labelled `(agent explanation)` (`docs/product.md` §7.3).
   */
  type SkillChat = {
    goalId: string;
    chatId: string;
    controller: ChatController;
    state: ChatState;
    timer: ReturnType<typeof setTimeout> | null;
    unsubscribe: () => void;
    /** This stream's frame counter (see `chatSnapshot`). */
    seq: number;
  };

  /**
   * One entry per open chat, holding the in-flight build (not just the finished
   * controller) so two concurrent requests cannot create two history writers for
   * the same chat. A failed build is removed, so the next request starts from
   * scratch — a fresh request, never a retry of a turn.
   */
  const skillChats = new Map<string, Promise<SkillChat | null>>();

  const skillChatKey = (goalId: string, chatId: string): string => `${goalId}:${chatId}`;

  /** The skill-chat failure shape: one goal, one chat, one message. */
  const skillChatFailure = (
    id: RpcId,
    goalId: string,
    chatId: string,
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "chat", goalId, chatId, message }, false);

  const emitSkillState = (runtime: SkillChat): void => {
    runtime.seq += 1;
    notify({
      jsonrpc: "2.0",
      method: "skill.chat.state",
      params: {
        goalId: runtime.goalId,
        chatId: runtime.chatId,
        ...chatSnapshot(runtime.state, runtime.controller.usage(), runtime.seq),
      },
    });
  };

  /**
   * Build one skill chat controller on first use.
   *
   * The history is the goal's own `chats/<chat>.jsonl`, scoped by the same
   * `ui.chill_history_limit` every other chat uses. The context and tools come
   * from `skillTools`, which binds the toolbox to this goal's gathered sources,
   * so the wall is the toolbox binding rather than a sentence in the prompt.
   */
  const ensureSkillChat = (
    current: C,
    goalId: string,
    chatId: string,
    historyPath: string,
  ): Promise<SkillChat | null> => {
    const key = skillChatKey(goalId, chatId);
    const cached = skillChats.get(key);
    if (cached) return cached;

    let building!: Promise<SkillChat | null>;
    building = (async (): Promise<SkillChat | null> => {
      if (!current.createChat) return null;
      const history = createJsonlHistoryPort(
        historyPath,
        historyLimit(current),
      );
      const tools = skillTools({ workspace: current.workspace, goalId });
      const controller = current.createChat(history, "skills", "skill", tools.context, tools);
      await controller.load();
      // A settings patch may have dropped the cache while the history loaded; a
      // controller nobody can reach must not keep a subscription alive.
      if (skillChats.get(key) !== building) {
        controller.dispose();
        return null;
      }
      const runtime: SkillChat = {
        goalId,
        chatId,
        controller,
        state: controller.state(),
        timer: null,
        unsubscribe: () => {},
        seq: 0,
      };
      runtime.unsubscribe = controller.subscribe((state) => {
        runtime.state = state;
        if (runtime.timer !== null) return;
        runtime.timer = setTimeout(() => {
          runtime.timer = null;
          emitSkillState(runtime);
        }, 33);
      });
      return runtime;
    })();

    skillChats.set(key, building);
    void building.catch(() => {
      if (skillChats.get(key) === building) skillChats.delete(key);
    });
    return building;
  };

  /**
   * Drop every skill chat controller after a settings change, exactly like the
   * session and project controllers: the next snapshot or send rebuilds it with
   * the saved model. An unrelated settings patch leaves an in-flight reply alone.
   */
  const resetSkillChats = (): void => {
    const previous = [...skillChats.values()];
    skillChats.clear();
    for (const entry of previous) {
      void entry
        .then((runtime) => {
          if (!runtime) return;
          if (runtime.timer !== null) clearTimeout(runtime.timer);
          runtime.timer = null;
          runtime.unsubscribe();
          runtime.controller.dispose();
        })
        .catch(() => {});
    }
  };

  /**
   * Resolve one skill goal through `loadCourse`, never through a caller path.
   *
   * An unknown id, a missing folder and a corrupt `meta.json` are one failure
   * shape — the `skill` shape `skill.open` already uses — so the shell renders
   * one readable message and offers the list.
   */
  const resolveSkillGoal = async (
    id: RpcId,
    current: C,
    raw: unknown,
    method: string,
  ): Promise<{ error: JsonRpcFailure } | { goalId: string }> => {
    if (typeof raw !== "string" || raw.trim() === "") {
      return { error: invalid(id, `${method} requires a goal id`) };
    }
    const goalId = raw.trim();
    const course = await loadCourse(current.workspace, goalId);
    if (course === null) {
      const message = `the skill ${JSON.stringify(goalId)} has no readable course in this workspace`;
      return {
        error: failure(id, BOOT_FAILED, message, { kind: "skill", id: goalId, message }, false),
      };
    }
    return { goalId: course.id };
  };

  /**
   * Resolve one chat id and its history path.
   *
   * An omitted id resumes the newest stored chat, or starts `chat-<n+1>` through
   * the chat service (which registers it in `meta.json`). An explicit id must
   * already exist: a typo is refused rather than silently opening or creating a
   * different transcript. No shell-supplied path is ever used.
   */
  const resolveSkillChatRef = async (
    id: RpcId,
    current: C,
    goalId: string,
    raw: unknown,
  ): Promise<{ error: JsonRpcFailure } | { chatId: string; path: string }> => {
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "string" || raw.trim() === "") {
        return { error: invalid(id, "skill.chat: chatId must be a non-empty string when supplied") };
      }
      const chatId = raw.trim();
      const opened = await openSkillChat({ workspace: current.workspace, goalId, chatId });
      if (!opened.ok) {
        return { error: skillChatFailure(id, goalId, chatId, oneLine(opened.error.message)) };
      }
      return { chatId: opened.value.id, path: opened.value.path };
    }

    const chats = await loadSkillChats(current.workspace, goalId);
    const newest = chats.at(-1)?.id;
    const opened = await openSkillChat({
      workspace: current.workspace,
      goalId,
      ...(newest === undefined ? {} : { chatId: newest }),
    });
    if (!opened.ok) {
      // `newest` is the id the service was told to open; a failure here means
      // the goal's own `chats[]` names a file this build cannot read.
      return {
        error: skillChatFailure(
          id,
          goalId,
          newest ?? "chat-1",
          oneLine(opened.error.message),
        ),
      };
    }
    return { chatId: opened.value.id, path: opened.value.path };
  };

  /** The goal's chats, read-only: title, last use and message count per chat. */
  const skillChatList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.chat.list");
    if ("error" in goal) return goal.error;
    const chats = await loadSkillChats(current.value.workspace, goal.goalId);
    return success(id, { chats });
  };

  /**
   * Open one goal chat: the shell's entry point for the Skills chat surface.
   *
   * The snapshot is the same `ChatSnapshot` every chat method returns, loaded
   * once here so the shell does not re-read the file. With no model configured
   * it is an idle snapshot — never an error and never a crash.
   */
  const skillChatOpen = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawChat = params.chatId;
    if (rawChat !== undefined && rawChat !== null) {
      if (typeof rawChat !== "string" || rawChat.trim() === "") {
        return invalid(id, "skill.chat.open: chatId must be a non-empty string when supplied");
      }
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.chat.open");
    if ("error" in goal) return goal.error;

    const ref = await resolveSkillChatRef(id, current.value, goal.goalId, rawChat);
    if ("error" in ref) return ref.error;

    const runtime = await ensureSkillChat(current.value, goal.goalId, ref.chatId, ref.path);
    if (!runtime) {
      return failure(id, -32601, "Skill chat is not available in this build", undefined, false);
    }
    return success(id, {
      chatId: ref.chatId,
      snapshot: chatSnapshot(
        runtime.controller.state(),
        runtime.controller.usage(),
        runtime.seq,
      ),
    });
  };

  /**
   * Start one **new** chat in a goal: the explicit "new chat" action.
   *
   * `skill.chat.open` without an id resumes the newest chat, so a shell that
   * only opens can never get past `chat-1`. This method always registers the
   * next chat id (`chat-<n+1>`) through the same chat service `open` uses when a
   * goal has no chats, so the file exists and `meta.json` lists it; the id is
   * never reused or overwritten, and two calls in a row are `chat-2`, `chat-3`
   * when `chat-1` already exists. The controller is built lazily here exactly as
   * `open` builds it, so `skill.chat.send` works on the new chat immediately.
   */
  const skillChatCreate = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.chat.create");
    if ("error" in goal) return goal.error;

    // No `chatId`: the chat service allocates the next id, writes the empty
    // transcript and registers it in `meta.json` in one operation.
    const opened = await openSkillChat({ workspace: current.value.workspace, goalId: goal.goalId });
    if (!opened.ok) {
      const message = oneLine(opened.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "chat", goalId: goal.goalId, message }, false);
    }

    const runtime = await ensureSkillChat(current.value, goal.goalId, opened.value.id, opened.value.path);
    if (!runtime) {
      return failure(id, -32601, "Skill chat is not available in this build", undefined, false);
    }
    return success(id, {
      chatId: opened.value.id,
      snapshot: chatSnapshot(
        runtime.controller.state(),
        runtime.controller.usage(),
        runtime.seq,
      ),
    });
  };

  /**
   * Send one turn into one goal chat.
   *
   * The reply is keyed by `goalId` and `chatId` so a shell with two goals (or two
   * chats) open can route each update. The request returns as soon as the turn
   * is claimed; the state events are authoritative and the shell never appends a
   * local message. A goal chat is source-bound and read-only: no archive, lesson
   * or output is written by this path.
   */
  const skillChatSend = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const text = params.text;
    if (typeof text !== "string" || text.trim() === "") {
      return invalid(id, "skill.chat.send requires a non-empty text string");
    }
    const rawChat = params.chatId;
    if (typeof rawChat !== "string" || rawChat.trim() === "") {
      return invalid(id, "skill.chat.send requires a chat id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.chat.send");
    if ("error" in goal) return goal.error;

    const ref = await resolveSkillChatRef(id, current.value, goal.goalId, rawChat);
    if ("error" in ref) return ref.error;

    const runtime = await ensureSkillChat(current.value, goal.goalId, ref.chatId, ref.path);
    if (!runtime) {
      return failure(id, -32601, "Skill chat is not available in this build", undefined, false);
    }
    const goalId = runtime.goalId;
    const chatId = runtime.chatId;
    void runtime.controller
      .send(text)
      .then((outcome) => {
        notify({
          jsonrpc: "2.0",
          method: "skill.chat.done",
          params: { goalId, chatId, ...outcome },
        });
      })
      .catch((error: unknown) => {
        notify({
          jsonrpc: "2.0",
          method: "skill.chat.error",
          params: { goalId, chatId, message: oneLine(messageOf(error)) },
        });
      });
    return success(id, { turnId: skillChatKey(goalId, chatId) });
  };

  /** Stop a skill turn. A chat with nothing in flight is a no-op, not an error. */
  const skillChatCancel = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawChat = params.chatId;
    if (typeof rawChat !== "string" || rawChat.trim() === "") {
      return invalid(id, "skill.chat.cancel requires a chat id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.chat.cancel");
    if ("error" in goal) return goal.error;

    const cached = skillChats.get(skillChatKey(goal.goalId, rawChat.trim()));
    if (cached) {
      const runtime = await cached.catch(() => null);
      runtime?.controller.cancel();
    }
    return success(id, { ok: true });
  };

  /* ------------------------------------------------------------------------ */
  /* Skill sources (the material a goal chat may cite)                        */
  /* ------------------------------------------------------------------------ */

  /**
   * The skill-source failure shape: one goal, one verb, one message.
   *
   * Everything after the goal resolves — an unreadable `meta.json`, a malformed
   * source list, a refused or failed copy — is reported once with
   * `retryable: false`. An unknown goal is the shared `skill` shape instead
   * (`resolveSkillGoal`), so the shell can tell "no such goal" from "this goal's
   * sources could not be changed".
   */
  const skillSourceFailure = (
    id: RpcId,
    goalId: string,
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "source", goalId, message }, false);

  /**
   * List one goal's gathered sources.
   *
   * This is the read half of the goal's source panel and the list a chat cites:
   * `name`, the `sources/`-relative `storedPath`, `kind`, `hash` and the saved
   * excerpt. It reads the goal's own `meta.json` through `courseFolder`, so the
   * path is confined and the id remains a folder name, never a caller path. It
   * writes nothing, and a goal with no sources yet is `{sources: []}` — an empty
   * list with a next action, not an error.
   */
  const skillSourcesList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.sources.list");
    if ("error" in goal) return goal.error;

    const loaded = await readSkillMeta(current.value.workspace, goal.goalId);
    if ("message" in loaded) {
      return skillSourceFailure(id, goal.goalId, loaded.message);
    }
    const rows = skillSourceRows(loaded.meta);
    if (rows === null) {
      return skillSourceFailure(
        id,
        goal.goalId,
        "the goal's source list is malformed; fix meta.json in the goal folder",
      );
    }
    return success(id, { sources: rows });
  };

  /**
   * Gather user-picked files into one goal's `sources/`.
   *
   * The paths are files the user chose, never destinations: `gatherSkillSources`
   * copies each one under the goal's `sources/`, hashes it and records it in
   * `meta.json`. Identical bytes are stored once, so a repeat add is counted in
   * `skipped` and adds no row. A file that belongs to the school side is refused
   * by the service (the wall), and a refused or failed batch leaves no partial
   * row: the service removes what it wrote before reporting.
   *
   * This packet gathers **local files only** — no URL is accepted and no web
   * fetch happens here. `retrievedAt` is the core's clock.
   */
  const skillSourcesAdd = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawFiles = params.files;
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
      return invalid(id, "skill.sources.add requires a non-empty array of file paths");
    }
    if (!rawFiles.every((path) => typeof path === "string" && path.trim() !== "")) {
      return invalid(id, "skill.sources.add: every entry in files must be a non-empty string");
    }
    const files = rawFiles as string[];

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Resolve first so an unknown goal is the skill error naming the id, not a
    // generic copy failure for a folder that was never there.
    const goal = await resolveSkillGoal(id, current.value, params.goalId, "skill.sources.add");
    if ("error" in goal) return goal.error;

    const gathered = await gatherSkillSources({
      workspace: current.value.workspace,
      goalId: goal.goalId,
      files,
      retrievedAt: new Date().toISOString(),
    });
    if (!gathered.ok) {
      return skillSourceFailure(id, goal.goalId, oneLine(gathered.message));
    }
    return success(id, { added: gathered.added, skipped: gathered.skipped });
  };

  /* ------------------------------------------------------------------------ */
  /* Curriculum stages and the goal manager                                   */
  /* ------------------------------------------------------------------------ */

  /** One requested stage, already shape-checked. `id: null` means "new stage". */
  type StageEdit = { id: string | null; title: string; milestone: string };

  /** A save writes the whole curriculum, so the cap is the edit envelope. */
  const MAX_STAGE_ENTRIES = 16;
  /**
   * The draft path caps a milestone at `MAX_MILESTONE` (160 characters) in
   * `src/services/skills/create.ts`; an edit accepts up to 200 so a longer,
   * hand-written milestone is not refused for one word more than a draft.
   */
  const MAX_STAGE_MILESTONE_CHARS = 200;

  /** The shared `skill` failure shape `skill.open` already uses. */
  const skillFailure = (id: RpcId, goalId: string, message: string): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "skill", id: goalId, message }, false);

  /** A stage edit that was attempted and did not happen. */
  const stageFailure = (id: RpcId, goalId: string, message: string): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "stage", goalId, message }, false);

  /** A goal manager verb (archive/delete/export) that was attempted and failed. */
  const skillActionFailure = (
    id: RpcId,
    goalId: string,
    action: "archive" | "delete" | "export",
    message: string,
  ): JsonRpcFailure =>
    failure(id, BOOT_FAILED, message, { kind: "skill-action", id: goalId, action, message }, false);

  /**
   * Shape-check one `skill.stages.save` request.
   *
   * The whole curriculum arrives in order, so this is the only place the edit
   * envelope is enforced: 1–16 entries, a non-empty title of at most
   * `MAX_TITLE_CHARS`, an optional milestone string, and no two entries sharing
   * an id. Unknown fields are ignored.
   */
  const parseStageEdits = (
    raw: unknown,
  ): { ok: true; stages: StageEdit[] } | { ok: false; message: string } => {
    if (!Array.isArray(raw)) {
      return { ok: false, message: "skill.stages.save requires a stages array" };
    }
    if (raw.length < 1 || raw.length > MAX_STAGE_ENTRIES) {
      return {
        ok: false,
        message:
          `skill.stages.save: a curriculum holds 1–${MAX_STAGE_ENTRIES} stages; ` +
          `this save has ${raw.length}`,
      };
    }

    const stages: StageEdit[] = [];
    const ids = new Set<string>();
    for (const [index, entry] of raw.entries()) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return { ok: false, message: `skill.stages.save: stage ${index + 1} is not an object` };
      }
      const record = entry as Record<string, unknown>;

      const rawId = record.id;
      if (rawId !== undefined && rawId !== null) {
        if (typeof rawId !== "string" || rawId.trim() === "") {
          return {
            ok: false,
            message: `skill.stages.save: stage ${index + 1} has an empty id`,
          };
        }
      }
      const stageId = typeof rawId === "string" ? rawId.trim() : null;
      if (stageId !== null) {
        if (ids.has(stageId)) {
          return {
            ok: false,
            message: `skill.stages.save: two stages share the id ${JSON.stringify(stageId)}`,
          };
        }
        ids.add(stageId);
      }

      const rawTitle = record.title;
      if (typeof rawTitle !== "string" || rawTitle.trim() === "") {
        return { ok: false, message: `skill.stages.save: stage ${index + 1} needs a title` };
      }
      const title = rawTitle.trim();
      if (title.length > MAX_TITLE_CHARS) {
        return {
          ok: false,
          message:
            `skill.stages.save: stage ${index + 1} title is longer than ` +
            `${MAX_TITLE_CHARS} characters`,
        };
      }

      const rawMilestone = record.milestone;
      if (
        rawMilestone !== undefined &&
        rawMilestone !== null &&
        typeof rawMilestone !== "string"
      ) {
        return {
          ok: false,
          message: `skill.stages.save: stage ${index + 1} milestone must be a string`,
        };
      }
      const milestone = typeof rawMilestone === "string" ? rawMilestone.trim() : "";
      if (milestone.length > MAX_STAGE_MILESTONE_CHARS) {
        return {
          ok: false,
          message:
            `skill.stages.save: stage ${index + 1} milestone is longer than ` +
            `${MAX_STAGE_MILESTONE_CHARS} characters`,
        };
      }

      stages.push({ id: stageId, title, milestone });
    }

    return { ok: true, stages };
  };

  /**
   * Save one goal's whole curriculum, in order (`docs/product.md` §7.4).
   *
   * This is the curriculum editor's only write. An entry that names an existing
   * stage id keeps that stage's **status** and id, so reordering, renaming or
   * retitling a milestone never costs progress; an entry without an id is a new
   * stage with a fresh `stage-<n>` id and status `pending`; a stage absent from
   * the request is removed.
   *
   * Removing a `done` stage discards completed work, so it is refused unless the
   * shell passes `confirmed: true` after asking the user. The refusal names the
   * stages that would be lost.
   *
   * The write goes through `writeGoalMeta` — the same atomic metadata writer
   * `archive.restore` uses — so every other key in `meta.json` (a course's
   * `chapters`, `sources`, `chats`, `last_opened_at`) is preserved and the
   * derived `progress`/`complete` fields are refreshed. A failure writes
   * nothing. The human-readable `curriculum.md` mirror is **not** rewritten:
   * `meta.json` is authoritative for order and status
   * (`docs/data-model.md` §5.2), and no service exposes a mirror writer.
   */
  const skillStagesSave = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.stages.save requires a goal id");
    }
    const goalId = params.goalId.trim();
    const rawConfirmed = params.confirmed;
    if (rawConfirmed !== undefined && typeof rawConfirmed !== "boolean") {
      return invalid(id, "skill.stages.save: confirmed must be a boolean");
    }
    const confirmed = rawConfirmed === true;
    const parsed = parseStageEdits(params.stages);
    if (!parsed.ok) return invalid(id, parsed.message);

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const folder = goalFolderFor(current.value.workspace, goalId);
    if (basename(folder) !== goalId) {
      return skillFailure(id, goalId, `${JSON.stringify(goalId)} is not a goal in this workspace`);
    }
    const loaded = await readGoalMeta(folder);
    if (!loaded.ok) return skillFailure(id, goalId, oneLine(loaded.error.message));

    const existing = new Map(loaded.value.goal.stages.map((stage) => [stage.id, stage]));

    // An id the goal does not have is a stale request, never a silently new
    // stage: only an entry **without** an id creates one.
    for (const stage of parsed.stages) {
      if (stage.id === null) continue;
      if (!existing.has(stage.id)) {
        return invalid(
          id,
          `skill.stages.save: this goal has no stage ${JSON.stringify(stage.id)}`,
        );
      }
    }

    const kept = new Set(
      parsed.stages.flatMap((stage) => (stage.id === null ? [] : [stage.id])),
    );
    if (!confirmed) {
      const lost = loaded.value.goal.stages.filter(
        (stage) => !kept.has(stage.id) && stage.status === "done",
      );
      if (lost.length > 0) {
        const titles = lost.map((stage) => `“${stage.title}”`).join(", ");
        const message =
          `removing ${titles} discards completed progress; save again with confirmed: true`;
        return failure(
          id,
          BOOT_FAILED,
          message,
          { kind: "stage", goalId, message },
          false,
        );
      }
    }

    // Fresh ids follow the goal writer's `stage-<n>` scheme and never reuse an
    // id this goal already had in this call — including one being removed — so a
    // new stage cannot silently inherit a removed stage's progress.
    const taken = new Set(loaded.value.goal.stages.map((stage) => stage.id));
    let next = 1;
    const freshId = (): string => {
      for (;;) {
        const candidate = `stage-${next}`;
        next += 1;
        if (taken.has(candidate)) continue;
        taken.add(candidate);
        return candidate;
      }
    };

    const stages: CurriculumStage[] = parsed.stages.map((stage) => {
      if (stage.id !== null) {
        const previous = existing.get(stage.id)!;
        return {
          id: previous.id,
          title: stage.title,
          milestone: stage.milestone,
          status: previous.status,
        };
      }
      return { id: freshId(), title: stage.title, milestone: stage.milestone, status: "pending" };
    });

    const validated = validateCurriculum(stages);
    if (!validated.ok) return stageFailure(id, goalId, validated.error.message);

    const written = await writeGoalMeta(folder, loaded.value.meta, validated.value);
    if (!written.ok) return stageFailure(id, goalId, oneLine(written.error.message));

    // `meta.json` is authoritative, but the readable mirror is part of the
    // contract (`docs/data-model.md` §5.2): a stage edit that left it stale made
    // the Markdown lie about the curriculum. Both writes are atomic; a mirror
    // failure is reported once and a retry rewrites both.
    try {
      await replaceAtomic(
        join(folder, CURRICULUM_FILE),
        renderCurriculum({
          name: loaded.value.goal.name,
          stages: validated.value,
        }),
      );
    } catch (error) {
      return stageFailure(
        id,
        goalId,
        `the stages were saved but curriculum.md could not be rewritten (${oneLine(
          error instanceof Error ? error.message : String(error),
        )}); save again`,
      );
    }

    return success(id, { stages: skillStageRows(validated.value) });
  };

  /**
   * Drop every cached chat for one goal.
   *
   * `skill.chat.*` rebuilds a controller from the goal folder, so a controller
   * left behind by an archive or delete could never be reached again; closing it
   * releases its subscription and history writer instead of leaking them.
   */
  const dropSkillChatsForGoal = (goalId: string): void => {
    const prefix = `${goalId}:`;
    for (const key of [...skillChats.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const cached = skillChats.get(key);
      skillChats.delete(key);
      void cached
        ?.then((runtime) => {
          if (!runtime) return;
          if (runtime.timer !== null) clearTimeout(runtime.timer);
          runtime.timer = null;
          runtime.unsubscribe();
          runtime.controller.dispose();
        })
        .catch(() => {});
    }
  };

  /**
   * Archive one goal to the configured backend (`docs/product.md` §7.4).
   *
   * The backend is configuration, never a parameter, and it is resolved by the
   * same helper `session.archive` and `archive.list` use. With no usable backend
   * there is nowhere to put the goal, so the refusal happens **before** the goal
   * is read — one actionable sentence naming Settings, nothing touched, and the
   * live folder is never deleted in place of an archive.
   *
   * Destructive: the archived copy is made first and the live folder is removed
   * only after it lands. The shell asks the user before calling.
   */
  const skillArchive = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.archive requires a goal id");
    }
    const goalId = params.goalId.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const view = settingsView(current.value);
    const resolved = await resolveArchiveBackend(current.value, view);
    if (!resolved.ok) {
      return failure(id, BOOT_FAILED, resolved.message, {
        kind: "archive",
        id: goalId,
        message: resolved.message,
      }, false);
    }

    const folder = goalFolderFor(current.value.workspace, goalId);
    if (basename(folder) !== goalId) {
      return skillFailure(id, goalId, `${JSON.stringify(goalId)} is not a goal in this workspace`);
    }
    const loaded = await readGoalMeta(folder);
    if (!loaded.ok) return skillFailure(id, goalId, oneLine(loaded.error.message));

    const archived = await archiveGoal({
      workspace: current.value.workspace,
      id: goalId,
      backend: resolved.backend,
    });
    if (!archived.ok) {
      return skillActionFailure(id, goalId, "archive", oneLine(archived.error.message));
    }
    dropSkillChatsForGoal(goalId);
    return success(id, { action: "archive", backend: resolved.backend.id });
  };

  /**
   * Delete one live goal folder (`docs/product.md` §7.4).
   *
   * Destructive, and the shell confirms first. Only the live folder goes: no
   * archive copy, note or Work project is touched, so an archived copy of the
   * same id still restores later. A missing goal is the shared `skill` shape.
   */
  const skillRemove = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.remove requires a goal id");
    }
    const goalId = params.goalId.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const folder = goalFolderFor(current.value.workspace, goalId);
    if (basename(folder) !== goalId) {
      return skillFailure(id, goalId, `${JSON.stringify(goalId)} is not a goal in this workspace`);
    }
    const loaded = await readGoalMeta(folder);
    if (!loaded.ok) return skillFailure(id, goalId, oneLine(loaded.error.message));

    const removed = await deleteGoal({
      workspace: current.value.workspace,
      id: goalId,
      confirmed: true,
    });
    if (!removed.ok) {
      if (removed.error.kind === "missing") {
        return skillFailure(id, goalId, oneLine(removed.error.message));
      }
      return skillActionFailure(id, goalId, "delete", oneLine(removed.error.message));
    }
    dropSkillChatsForGoal(goalId);
    return success(id, { action: "delete" });
  };

  /**
   * Export one goal as one zip in this workspace's `exports/` folder.
   *
   * There is no destination parameter: `exportGoal` writes
   * `exports/goal-<id>.zip` itself, so the shell cannot point an export at a
   * path it does not own. The containment check below keeps that invariant even
   * if the service ever changed. Additive: the live goal is untouched.
   */
  const skillExport = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    if (typeof params.goalId !== "string" || params.goalId.trim() === "") {
      return invalid(id, "skill.export requires a goal id");
    }
    const goalId = params.goalId.trim();

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    const folder = goalFolderFor(current.value.workspace, goalId);
    if (basename(folder) !== goalId) {
      return skillFailure(id, goalId, `${JSON.stringify(goalId)} is not a goal in this workspace`);
    }
    const loaded = await readGoalMeta(folder);
    if (!loaded.ok) return skillFailure(id, goalId, oneLine(loaded.error.message));

    const exported = await exportGoal({ workspace: current.value.workspace, id: goalId });
    if (!exported.ok) {
      return skillActionFailure(id, goalId, "export", oneLine(exported.error.message));
    }

    const exportsRoot = resolve(current.value.workspace.paths.exports);
    const target = resolve(exported.value);
    if (target !== exportsRoot && !target.startsWith(exportsRoot + sep)) {
      return skillActionFailure(
        id,
        goalId,
        "export",
        "the export was written outside this workspace's exports folder",
      );
    }
    return success(id, { action: "export", path: exported.value });
  };

  return {
    handlers: {
      skillList,
      skillOpen,
      skillChapter,
      skillCreate,
      skillLessonBuild,
      skillLessonRead,
      skillChatList,
      skillChatOpen,
      skillChatCreate,
      skillChatSend,
      skillChatCancel,
      skillSourcesList,
      skillSourcesAdd,
      skillStagesSave,
      skillArchive,
      skillRemove,
      skillExport,
    },
    resetSkillChats,
  };
}

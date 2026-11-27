import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { ActivityRecord } from "../services/work/activity";
import { computeCoverage } from "../domain/coverage";
import { loadSessionHome, loadSessionRows } from "../app/actions/sessions";
import { listProjects } from "../services/work/register";
import { listReportRuns, readReport, verifyReportTaskFile } from "../services/work/report";
import { reviewQueue, type ReviewQueueResult } from "../services/review/queue";
import { markCard, markMistakeTarget, markStage, markStep } from "./review-mark";
import {
  REVIEW_MARK_RESULTS,
  REVIEW_SIDES,
  isReviewMarkResult,
  isReviewSide,
  parseReviewItemId,
  projectReviewSide,
  type ReviewMarkResult,
  type ReviewMarkTarget,
} from "./review";
import type { MarkOutcome } from "./review-mark";
import { loadLearningGraph } from "../services/knowledge/learning-graph";
import {
  KNOWLEDGE_HIT_LIMIT,
  KNOWLEDGE_SCOPES,
  KNOWLEDGE_TREE_SIDES,
  archiveKnowledge,
  capKnowledgeBody,
  goalKnowledge,
  indexedNoteCandidates,
  isKnowledgeScope,
  isKnowledgeTreeSide,
  knowledgeExcerpt,
  knowledgeScore,
  knowledgeSort,
  parseKnowledgeReadTarget,
  projectKnowledge,
  readKnowledgeTarget,
  readVaultNotes,
  sessionKnowledge,
  type KnowledgeCandidate,
  type KnowledgeHit,
  KNOWLEDGE_NO_TOPIC,
  type KnowledgeTopicGroup,
  type KnowledgeTreeNode,
  type KnowledgeTreeSide,
  type VaultNote,
  type KnowledgeScope,
} from "./knowledge";
import type { SessionServices } from "./session-context";
import type { SessionCoverageRow } from "./views";
import type { SwarmTaskEntry } from "../domain/review";
import type { SwarmService } from "../services/work/swarm";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  oneLine,
  messageOf,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/** What the review and knowledge surfaces need from the core. */

export type ReviewKnowledgeContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  swarmServiceFor: (current: C) => SwarmService;
  activitySink: (current: C) => ((record: ActivityRecord) => Promise<void>) | undefined;
};

/**
 * Review and Knowledge: the one actionable queue and the read-only reference
 * graph (`docs/product.md` §6).
 *
 * Review reports what the workspace already records and marks one item; memory
 * is history and is read-only. Knowledge is derived from the files on disk: it
 * writes nothing, rebuilds no index and contacts no network.
 */
export function createReviewKnowledgeHandlers<C extends SessionServices>(
  ctx: ReviewKnowledgeContext<C>,
): {
  handlers: Record<string, (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>>;
} {
  const { services, swarmServiceFor, activitySink } = ctx;

/**
   * Per-session coverage for the review snapshot.
   *
   * The queue service reads the session records for its items; coverage needs
   * each session's document text as well, so it is read here through the same
   * `loadSessionHome` the session home uses. A session that no longer opens is
   * skipped: the queue already reports it as a diagnostic, and one unreadable
   * folder must not fail the whole snapshot. An empty report is a real answer
   * (a session with no sources), not a missing one.
   */
  const schoolCoverage = async (
    workspace: C["workspace"],
  ): Promise<SessionCoverageRow[]> => {
    const rows: SessionCoverageRow[] = [];
    for (const row of await loadSessionRows(workspace)) {
      if (row.broken) continue;
      const home = await loadSessionHome(workspace, row.id);
      if (home === null) continue;
      rows.push({
        sessionId: row.id,
        name: home.name,
        report: computeCoverage(home.sources, home.documents),
      });
    }
    return rows;
  };

  /**
   * The read-only review queue (`docs/product.md` §6.1).
   *
   * Built from what the workspace already records — unchecked steps, missed
   * flashcards, unfinished skill stages and session memory — by the service;
   * this handler owns the `side` filter, the per-session coverage reports and
   * the failure shape. Nothing is written and nothing is marked: marking
   * known/missed is a later packet, so a shell must treat this as a snapshot.
   *
   * A broken session or goal folder is a **diagnostic inside the queue**, not a
   * request failure: one unreadable folder never hides the rest of the work. A
   * failure of the service itself (an unexpected read error) is one `-32000`
   * with `data.kind: "review"` and `retryable: false`.
   */
  /**
   * The unverified completed swarm tasks this process knows.
   *
   * A board is process state (`desktop/docs/protocol.md`): a restart forgets
   * every run, so this read returns nothing until a run happens again. The
   * report on disk keeps its last bytes; this queue deliberately does not invent
   * a run from a report it cannot verify in memory.
   */
  const reviewTasks = async (current: C): Promise<SwarmTaskEntry[]> => {
    let rows;
    try {
      rows = await listProjects(current.workspace);
    } catch {
      return [];
    }
    if (rows.length === 0) return [];
    const service = swarmServiceFor(current);
    const out: SwarmTaskEntry[] = [];
    for (const row of rows) {
      if (row.broken) continue;
      const boards = new Map(service.runs(row.id).map((board) => [board.runId, board]));
      for (const board of boards.values()) {
        for (const task of board.tasks) {
          out.push({
            projectId: row.id,
            projectName: row.name,
            runId: board.runId,
            taskId: task.id,
            title: task.title,
            status: task.status,
            verified: task.verified,
          });
        }
      }
      // Reports are the durable half: a restart forgets every board, but the
      // report keeps the task ids and statuses. A run still in memory is read
      // from the board only, so a task is never listed twice.
      for (const runId of await listReportRuns(current.workspace, row.id)) {
        if (boards.has(runId)) continue;
        const stored = await readReport(current.workspace, row.id, runId);
        if (stored === null) continue;
        for (const task of stored.report.tasks) {
          if (task.state !== "done") continue;
          out.push({
            projectId: row.id,
            projectName: row.name,
            runId,
            taskId: task.id,
            title: task.title === "" ? task.id : task.title,
            status: "done",
            verified: false,
          });
        }
      }
    }
    return out;
  };

  /**
   * Mark a Work task verified through the swarm service.
   *
   * `known` is verification: the run's report is rewritten and the activity log
   * records the decision. `missed` is refused — a completed task has no miss
   * signal, and inventing one would make the nudge state lie.
   */
  const markTaskItem = async (
    current: C,
    target: Extract<ReviewMarkTarget, { kind: "task" }>,
    result: ReviewMarkResult,
  ): Promise<MarkOutcome> => {
    if (result !== "known") {
      return {
        ok: false,
        message: "a completed task has no miss signal; verify it or leave it",
      };
    }
    const service = swarmServiceFor(current);
    // A run this process still knows: verify through the board, which also
    // rewrites the report and records the activity entry.
    if (service.board(target.projectId, target.runId) !== null) {
      const verified = await service.verify({
        projectId: target.projectId,
        runId: target.runId,
        taskId: target.taskId,
      });
      if (!verified.ok) return { ok: false, message: oneLine(verified.error.message) };
      return { ok: true };
    }

    // Report-only verification: the run outlived the process. Rewrite the one
    // line, then record the decision in the activity log exactly as the board
    // path does. A log failure is best-effort and never fails the verification.
    const written = await verifyReportTaskFile({
      workspace: current.workspace,
      projectId: target.projectId,
      runId: target.runId,
      taskId: target.taskId,
    });
    if (!written.ok) return { ok: false, message: oneLine(written.error.message) };
    if (!written.value.already) {
      const sink = activitySink(current);
      await sink?.({
        kind: "swarm",
        project: target.projectId,
        run: target.runId,
        event: "verified",
        task: target.taskId,
        status: "verified",
        at: new Date().toISOString(),
      });
    }
    return { ok: true };
  };

  const reviewQueueResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawSide = params.side;
    if (rawSide !== undefined && !isReviewSide(rawSide)) {
      return invalid(
        id,
        `review.queue: unknown side ${JSON.stringify(rawSide)}; expected one of ${REVIEW_SIDES.join(", ")}`,
      );
    }
    const side = rawSide ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);

    // Work tasks are only read for the projections that can show them: a
    // school- or skills-only view must not touch the Work registry.
    const tasks =
      side === "all" || side === "work" ? await reviewTasks(current.value) : [];
    let queue: ReviewQueueResult;
    try {
      queue = await reviewQueue(current.value.workspace, { tasks });
    } catch (error) {
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "review", message }, false);
    }

    const projected =
      side === "all" ? queue : projectReviewSide(queue, current.value.workspace, side);
    // Coverage is school-side material (`docs/product.md` §6.1); a skills-only
    // projection has none, and `all`/`school` get one report per session.
    const coverage =
      side === "skills" || side === "work"
        ? []
        : await schoolCoverage(current.value.workspace);
    return success(id, { queue: { ...projected, coverage } });
  };

  /* ------------------------------------------------------------------------ */
  /* Review marking — the write half of the Review surface                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Mark one review item known or missed (`docs/product.md` §6.1–6.2).
   *
   * Three kinds write; session memory is read-only and refused with a message.
   * The service already owns every rule behind each kind (the step toggle, the
   * deck codec, the curriculum transition), so this handler only parses the id,
   * dispatches and then returns a fresh queue: the shell replaces its snapshot
   * from one reply instead of guessing what the mark did to the list.
   *
   * A malformed id, an unknown `result` or a missing parameter is `-32602`; an
   * id that is well formed but names nothing, and memory, is one `-32000` with
   * `data.kind: "review"` and `retryable: false`. Nothing is retried.
   */
  const reviewMarkResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawItem = params.itemId;
    if (typeof rawItem !== "string" || rawItem.trim() === "") {
      return invalid(id, "review.mark requires a non-empty itemId string");
    }
    const itemId = rawItem.trim();

    const rawResult = params.result;
    if (!isReviewMarkResult(rawResult)) {
      return invalid(
        id,
        `review.mark: unknown result ${JSON.stringify(rawResult)}; expected one of ${REVIEW_MARK_RESULTS.join(", ")}`,
      );
    }
    const result = rawResult;

    const parsed = parseReviewItemId(itemId);
    if (!parsed.ok) return invalid(id, `review.mark: ${parsed.message}`);

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const target = parsed.target;
    if (target.kind === "memory") {
      return failure(
        id,
        BOOT_FAILED,
        "Session memory is read-only history; it cannot be marked known or missed.",
        {
          kind: "review",
          itemId,
          message: "session memory is read-only; it is history, not a review item",
        },
        false,
      );
    }

    const outcome =
      target.kind === "step"
        ? await markStep(workspace, target, result)
        : target.kind === "card"
          ? await markCard(workspace, target, result)
          : target.kind === "mistake"
            ? await markMistakeTarget(workspace, target, result)
            : target.kind === "task"
              ? await markTaskItem(current.value, target, result)
              : await markStage(workspace, target, result);
    if (!outcome.ok) {
      return failure(
        id,
        BOOT_FAILED,
        outcome.message,
        { kind: "review", itemId, message: outcome.message },
        false,
      );
    }

    // One call, one snapshot: the shell replaces its queue, never patches it.
    let queue: ReviewQueueResult;
    try {
      queue = await reviewQueue(workspace, { tasks: await reviewTasks(current.value) });
    } catch (error) {
      const message = oneLine(messageOf(error));
      return failure(id, BOOT_FAILED, message, { kind: "review", itemId, message }, false);
    }
    // The reply must be the same snapshot shape `review.queue` sends, coverage
    // included, or a mark would silently drop it from the shell's copy.
    return success(id, { queue: { ...queue, coverage: await schoolCoverage(workspace) } });
  };

  /* ------------------------------------------------------------------------ */
  /* Knowledge base — read-only search and topic tree                        */
  /* ------------------------------------------------------------------------ */

  /**
   * Unified knowledge search over both vaults and the workspace's own records
   * (`docs/product.md` §6.3).
   *
   * There is **one read** of every source and `scope` is a projection over that
   * result, never a second pass: a `school` request cannot see a skills row
   * because the row was labelled when it was built, not filtered afterwards into
   * existence. The vault notes come from the side's FTS index (refreshed as a
   * cache, never Markdown); no model is called and no network is contacted.
   *
   * Ranking is deterministic and lexical: a title/name prefix beats a whole-word
   * match, which beats a body substring; ties go to the most recently updated,
   * then the path. At most {@link KNOWLEDGE_HIT_LIMIT} hits are returned.
   */
  /**
   * The source-grounded learning graph (`desktop/docs/redesign.md` §6).
   *
   * Read-only and derived: goals, teaching steps with their citations, copied
   * sources, lock-in sessions and tasks, cards, research and figures. A broken
   * folder is a diagnostic in the reply; it is never a request failure.
   */
  const knowledgeGraphResponse = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    try {
      return success(id, { graph: await loadLearningGraph(current.value.workspace) });
    } catch (error) {
      return failure(
        id,
        BOOT_FAILED,
        oneLine(messageOf(error)),
        { kind: "knowledge-graph", message: oneLine(messageOf(error)) },
        false,
      );
    }
  };

  const knowledgeSearchResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawQuery = params.query;
    if (typeof rawQuery !== "string" || rawQuery.trim() === "") {
      return invalid(id, "knowledge.search requires a non-empty query string");
    }
    const query = rawQuery.trim();

    const rawScope = params.scope;
    if (rawScope !== undefined && !isKnowledgeScope(rawScope)) {
      return invalid(
        id,
        `knowledge.search: unknown scope ${JSON.stringify(rawScope)}; expected one of ${KNOWLEDGE_SCOPES.join(", ")}`,
      );
    }
    const scope: KnowledgeScope = rawScope ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const candidates: KnowledgeCandidate[] = [];
    candidates.push(...(await indexedNoteCandidates(workspace, "school", query)));
    candidates.push(...(await indexedNoteCandidates(workspace, "skills", query)));
    candidates.push(...(await sessionKnowledge(workspace)));
    candidates.push(...(await goalKnowledge(workspace)));
    candidates.push(...(await projectKnowledge(workspace)));
    candidates.push(...(await archiveKnowledge(workspace.paths.archiveIndex)));

    const lowered = query.toLowerCase();
    const hits: KnowledgeHit[] = [];
    for (const candidate of candidates) {
      const score = knowledgeScore(candidate, query);
      if (score === 0) continue;
      // Keep the excerpt on the field that actually matched, so a title-only hit
      // is not shown with the first line of an unrelated body.
      const excerptSource =
        candidate.text.toLowerCase().includes(lowered) || candidate.text === ""
          ? candidate.text
          : candidate.title;
      hits.push({
        id: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        excerpt: knowledgeExcerpt(excerptSource, query),
        side: candidate.side,
        path: candidate.path,
        updated: candidate.updated,
        score,
      });
    }

    hits.sort(knowledgeSort);
    const projected = scope === "all" ? hits : hits.filter((hit) => hit.side === scope);
    return success(id, { hits: projected.slice(0, KNOWLEDGE_HIT_LIMIT) });
  };

  /**
   * The topic forest built from vault note `topics` frontmatter.
   *
   * One group per first-level topic, with that group's notes sorted by topic
   * path then title. A note without topics lands in `(no topic)`. This reads the
   * Markdown directly: the index is a cache and is never opened or rebuilt here.
   */
  const knowledgeTreeResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawSide = params.side;
    if (rawSide !== undefined && !isKnowledgeTreeSide(rawSide)) {
      return invalid(
        id,
        `knowledge.tree: unknown side ${JSON.stringify(rawSide)}; expected one of ${KNOWLEDGE_TREE_SIDES.join(", ")}`,
      );
    }
    const side: KnowledgeTreeSide = rawSide ?? "all";

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const workspace = current.value.workspace;

    const notes: VaultNote[] = [];
    if (side === "all" || side === "school") {
      notes.push(...(await readVaultNotes(workspace.root, workspace.paths.schoolVault)));
    }
    if (side === "all" || side === "skills") {
      notes.push(...(await readVaultNotes(workspace.root, workspace.paths.skillVault)));
    }

    type Grouped = KnowledgeTreeNode & { topic: string };
    const grouped = new Map<string, Grouped[]>();
    for (const note of notes) {
      const topic = note.topics.find((entry) => entry.trim() !== "")?.trim() ?? KNOWLEDGE_NO_TOPIC;
      const firstLevel = topic.split("/")[0]?.trim() || KNOWLEDGE_NO_TOPIC;
      const list = grouped.get(firstLevel) ?? [];
      list.push({ path: note.path, title: note.title, updated: note.updated, topic });
      grouped.set(firstLevel, list);
    }

    const groups: KnowledgeTopicGroup[] = [...grouped.entries()]
      .map(([topic, entries]) => ({
        topic,
        notes: entries
          .sort((a, b) => {
            if (a.topic !== b.topic) return a.topic < b.topic ? -1 : 1;
            if (a.title !== b.title) return a.title < b.title ? -1 : 1;
            return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
          })
          .map(({ path, title, updated }) => ({ path, title, updated })),
      }))
      .sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));

    return success(id, { groups });
  };

  /**
   * Open one knowledge hit in a reader (`docs/product.md` §6.3).
   *
   * The `id` is exactly what `knowledge.search` returned, or a bare note path
   * from `knowledge.tree`; both resolve through the same scheme and the same
   * vault confinement the row builders use. The body is content, never a
   * citation: `hit.side` still says which side of the wall the item belongs to.
   * Read-only — no index rebuild, no model, no network, no write — and a body is
   * capped at {@link KNOWLEDGE_BODY_LIMIT} bytes with `truncated` set.
   */
  const knowledgeReadResponse = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "knowledge.read requires a non-empty item id");
    }
    const itemId = rawId.trim();
    const target = parseKnowledgeReadTarget(itemId);
    if (target === null) {
      const message = `there is no knowledge item "${itemId}"`;
      return failure(id, BOOT_FAILED, message, { kind: "knowledge", id: itemId, message }, false);
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const read = await readKnowledgeTarget(current.value.workspace, target, itemId);
    if (!read.ok) {
      return failure(
        id,
        BOOT_FAILED,
        read.message,
        { kind: "knowledge", id: itemId, message: read.message },
        false,
      );
    }
    const capped = capKnowledgeBody(read.body);
    return success(id, { hit: read.hit, body: capped.body, truncated: capped.truncated });
  };
  return {
    handlers: {
      reviewQueue: reviewQueueResponse,
      reviewMark: reviewMarkResponse,
      knowledgeGraph: knowledgeGraphResponse,
      knowledgeSearch: knowledgeSearchResponse,
      knowledgeTree: knowledgeTreeResponse,
      knowledgeRead: knowledgeReadResponse,
    },
  };
}

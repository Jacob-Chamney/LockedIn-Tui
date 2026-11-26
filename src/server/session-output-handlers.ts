import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { REVIEW_GRADES, reviewCard, type ReviewGrade } from "../domain/scheduler";
import { generateSessionDocument, markGuideSection, stepFailureMessage } from "../app/actions/lockin";
import {
  deckFailure,
  deckStateReply,
  readDeckFile,
} from "./deck-state";
import { mergeSchedules } from "../domain/scheduler";
import { sessionContextReport } from "../services/lockin/context";
import {
  FLASHCARDS_PROMPT,
  SESSION_OUTPUT_FILES,
  SESSION_OUTPUT_KINDS,
  STUDY_GUIDE_PROMPT,
  isSessionOutputKind,
  parseDeckCards,
  parseGuideSections,
  renderFlashcards,
  renderStudyAnswers,
  renderStudyGuide,
  writeOutputFiles,
} from "./outputs";
import { readSchedule, writeSchedule } from "../services/skills/schedule";
import {
  generationFailure,
  outputFailure,
  parseDocumentRequest,
  parseOutputReadRequest,
  readOutputFile,
} from "./session-documents";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import {
  bootFailureResponse,
  invalid,
  messageOf,
  oneLine,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/**
 * The generated outputs of a lock-in session: the three session documents, the
 * study guide, the flashcard deck and its schedule (`docs/product.md` §5).
 *
 * These are **generated outputs, not sources**: they never become a source row,
 * never enter source coverage and never count as a fact a chat may cite. Every
 * model call is explicit, never retried, and writes only through the service
 * that owns the file.
 */
export function createSessionOutputHandlers<C extends SessionServices>(
  ctx: SessionHandlerContext<C>,
): {
  sessionDocument: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionOutputBuild: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionOutputRead: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionOutputMark: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionDeckState: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionDeckGrade: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionDeckReset: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
} {
  const { services, resolveSession } = ctx;

/**
   * Generate one session study document from the session's own sources.
   *
   * Three Markdown documents live beside the steps (`docs/data-model.md` §4):
   * the assignment's done-when `contract`, the source `contradictions` report
   * and the `check` of one learner attempt. This is the same shape as
   * `session.generateSteps`: one provider run, one document written atomically
   * by the service, and one typed failure if anything goes wrong — a failed
   * generation leaves the previous file, if any, byte-identical.
   *
   * The reply is the document itself, not a session view: `text` is the bytes
   * the reader renders and `name` is the session-relative file they were
   * written to. These are **generated session documents**, never sources, and
   * no chat turn is created — the transcript is identical before and after.
   *
   * `attempt` is only meaningful for `check`; supplying a non-blank attempt for
   * `contract` or `contradictions` is refused rather than silently ignored.
   */
  const sessionDocument = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.document requires a session id");
    }
    const request = parseDocumentRequest(params);
    if ("error" in request) return invalid(id, request.error);
    const { kind: rawKind, attempt } = request;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Resolve first so an unknown id is the session error shape, like every
    // other `session.*` method.
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const generate = current.value.generate;
    if (!generate) {
      const message = "link a model in Settings → Providers";
      return generationFailure(id, sessionId, message);
    }

    const document = await generateSessionDocument({
      workspace: current.value.workspace,
      id: sessionId,
      kind: rawKind,
      generate,
      // An empty attempt is no attempt: the service only adds the block when
      // there is text to review.
      ...(rawKind === "check" && attempt !== "" ? { attempt } : {}),
    });
    if (!document.ok) {
      const message = oneLine(document.error.message);
      return generationFailure(id, sessionId, message);
    }
    return success(id, { text: document.value.text, name: document.value.name });
  };

  /* ------------------------------------------------------------------------ */
  /* Session outputs: study guide and flashcards                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Build one session output from the session's own sources.
   *
   * A study guide writes `study-guide.md` and `study-guide-answers.md`; a
   * flashcard deck writes `flashcards.md`. Both live under
   * `<workspace>/school/outputs/<id>/` (`docs/data-model.md` §7) and are
   * **generated outputs, not sources**: they never become a source row, never
   * enter source coverage and never count as a fact a chat may cite.
   *
   * Exactly one model call is made and it is never retried. The reply is asked
   * for JSON only and validated here; malformed JSON, a missing field or a card
   * without exactly four choices is one typed `generation` failure and writes
   * nothing. The service/workspace distinction stays the same as every other
   * `session.*` method: an unknown id is the session shape, a later failure is
   * this method's own shape with `retryable: false`.
   */
  const sessionOutputBuild = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.output.build requires a session id");
    }
    const rawKind = params.kind;
    if (!isSessionOutputKind(rawKind)) {
      return invalid(
        id,
        `session.output.build: unknown kind ${JSON.stringify(rawKind)}; expected one of ${SESSION_OUTPUT_KINDS.join(", ")}`,
      );
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Resolve first so an unknown id is the session error shape, like every
    // other `session.*` method.
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const generate = current.value.generate;
    if (!generate) {
      const message = "link a model in Settings → Providers";
      return generationFailure(id, sessionId, message);
    }

    // Sources plus `prompt.md`, and `assignment-steps.md` when the session has
    // one. The existing outputs are excluded: a rebuild derives a fresh
    // document rather than paraphrasing the previous one.
    const report = await sessionContextReport(current.value.workspace, sessionId, {
      includeOutputs: false,
    });
    // The session's own files are always in the context, so testing the whole
    // context against `""` only caught a completely empty session: a session
    // whose sources were all images or PDFs without a text layer still "built" a
    // guide from its prompt. `readableSources` counts the copied sources.
    if (report.readableSources === 0) {
      const message =
        report.unreadable.length === 0
          ? "this session has no readable sources"
          : "this session has no readable sources: " +
            report.unreadable.map((entry) => `${entry.name} (${entry.kind}): ${entry.message}`).join("; ");
      return generationFailure(id, sessionId, message);
    }
    const context = report.text;

    const prompt = rawKind === "study-guide" ? STUDY_GUIDE_PROMPT : FLASHCARDS_PROMPT;
    let raw: string;
    try {
      raw = await generate([prompt, "", context].join("\n"));
    } catch (error) {
      // One actionable sentence from the failure policy; there is no retry.
      const message = oneLine(stepFailureMessage(error));
      return generationFailure(id, sessionId, message);
    }

    const folder = join(current.value.workspace.paths.root, "school", "outputs", sessionId);
    const name = resolved.opened.session.name;

    if (rawKind === "study-guide") {
      const parsed = parseGuideSections(raw);
      if (!parsed.ok) {
        const message = parsed.message;
        return generationFailure(id, sessionId, message);
      }
      const markdown = renderStudyGuide(name, parsed.sections);
      const answers = renderStudyAnswers(name, parsed.sections);
      try {
        await writeOutputFiles(folder, [
          { path: join(folder, SESSION_OUTPUT_FILES.guide), text: markdown },
          { path: join(folder, SESSION_OUTPUT_FILES.answers), text: answers },
        ]);
      } catch (error) {
        const message = oneLine(messageOf(error));
        return generationFailure(id, sessionId, message);
      }
      return success(id, {
        kind: rawKind,
        markdown,
        answers,
        files: {
          guide: SESSION_OUTPUT_FILES.guide,
          answers: SESSION_OUTPUT_FILES.answers,
        },
      });
    }

    const parsed = parseDeckCards(raw);
    if (!parsed.ok) {
      const message = parsed.message;
      return generationFailure(id, sessionId, message);
    }
    const markdown = renderFlashcards(name, parsed.cards);
    try {
      await writeOutputFiles(folder, [
        { path: join(folder, SESSION_OUTPUT_FILES.cards), text: markdown },
      ]);
    } catch (error) {
      const message = oneLine(messageOf(error));
      return generationFailure(id, sessionId, message);
    }
    return success(id, {
      kind: rawKind,
      markdown,
      files: { cards: SESSION_OUTPUT_FILES.cards },
    });
  };

  /**
   * Read one already-built session output.
   *
   * This is the reader's read half and never generates: a missing file is
   * `{markdown: "", exists: false}` — an empty state with a next action, not an
   * error. `part` defaults to the kind's primary document; a part that belongs
   * to another kind (`answers` on a deck, `cards` on a guide) is a `-32602`
   * refusal rather than a silent substitution.
   */
  const sessionOutputRead = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.output.read requires a session id");
    }
    const request = parseOutputReadRequest(params);
    if ("error" in request) return invalid(id, request.error);
    const { part } = request;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    // A **missing** output is the documented empty state, not a failure; an
    // unreadable one is a failure with a permissions hint.
    const read = await readOutputFile(current.value.workspace, sessionId, part);
    if (!read.ok) return outputFailure(id, sessionId, read.message);
    return success(id, { markdown: read.markdown, exists: read.exists });
  };


  /**
   * The flashcard schedule for one session (`session.deck.*`).
   *
   * The deck Markdown is the truth for a card's content; this reads the
   * schedule beside it and pairs the two by question. A missing schedule is
   * every card due now, which is the honest state for a deck that has never
   * been reviewed. Nothing here writes.
   */
  const sessionDeckState = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.deck.state requires a session id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    return deckStateReply(id, current.value.workspace, resolved.opened.session.id, new Date());
  };

  /**
   * Grade one card and persist the new schedule.
   *
   * One write, atomic. `again` brings the card back in ten minutes; the other
   * grades move it out. The deck's `M`/`K` lines are deliberately untouched:
   * they record a manual known/missed judgement, while the schedule records
   * when to ask again. A card can be both.
   */
  const sessionDeckGrade = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.deck.grade requires a session id");
    }
    const grade = params.grade;
    if (typeof grade !== "string" || !(REVIEW_GRADES as readonly string[]).includes(grade)) {
      return invalid(
        id,
        `session.deck.grade: unknown grade; expected one of ${REVIEW_GRADES.join(", ")}`,
      );
    }
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return invalid(id, "session.deck.grade requires a whole card index");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;
    const folder = join(current.value.workspace.root, "school", "outputs", sessionId);

    const deck = await readDeckFile(folder);
    if (!deck.ok) return deckFailure(id, sessionId, deck.message);
    if (index >= deck.value.length) {
      return deckFailure(
        id,
        sessionId,
        `there is no card at index ${index} (the deck has ${deck.value.length})`,
      );
    }
    const now = new Date();
    const stored = await readSchedule(folder);
    if (!stored.ok) return deckFailure(id, sessionId, stored.error.message);
    const merged = mergeSchedules(
      deck.value.map((card) => card.question),
      stored.value,
      now,
    );
    merged[index] = reviewCard(merged[index]!, grade as ReviewGrade, now);
    const written = await writeSchedule(folder, merged);
    if (!written.ok) return deckFailure(id, sessionId, written.error.message);
    return deckStateReply(id, current.value.workspace, sessionId, now);
  };

  /** Clear a session's flashcard schedule: every card due now again. */
  const sessionDeckReset = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.deck.reset requires a session id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;
    const folder = join(current.value.workspace.root, "school", "outputs", sessionId);
    try {
      await rm(join(folder, "flashcards-schedule.json"), { force: true });
    } catch (error) {
      return deckFailure(id, sessionId, oneLine(messageOf(error)));
    }
    return deckStateReply(id, current.value.workspace, sessionId, new Date());
  };

  /**
   * Mark one study-guide section reviewed (`docs/product.md` §5.2).
   *
   * `session.output.read` returns the guide; this is its one write. The core
   * rewrites **one bracket character and the progress line** and replaces the
   * file atomically, so every other byte — including the learner's own prose —
   * survives. The reply carries the whole document, so the shell never re-reads
   * or re-parses it.
   */
  const sessionOutputMark = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.output.mark requires a session id");
    }
    const rawIndex = params.index;
    if (typeof rawIndex !== "number" || !Number.isInteger(rawIndex) || rawIndex < 0) {
      return invalid(id, "session.output.mark: index must be a non-negative whole number");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const marked = await markGuideSection({
      workspace: current.value.workspace,
      id: sessionId,
      index: rawIndex,
    });
    if (!marked.ok) {
      return outputFailure(id, sessionId, oneLine(marked.error.message));
    }
    const markdown = marked.value.markdown;
    return success(id, {
      index: marked.value.index,
      checked: marked.value.checked,
      done: marked.value.done,
      total: marked.value.total,
      markdown,
      hash: `sha256:${createHash("sha256").update(markdown).digest("hex")}`,
    });
  };


  return {
    sessionDocument,
    sessionOutputBuild,
    sessionOutputRead,
    sessionOutputMark,
    sessionDeckState,
    sessionDeckGrade,
    sessionDeckReset,
  };
}

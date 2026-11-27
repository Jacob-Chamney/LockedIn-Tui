import { join } from "node:path";

import type { OpenResult } from "../services/lockin/manager";
import {
  addFigure,
  annotateFigure,
  confineSource,
  figuresDir,
  readFigureBytes,
  readFigures,
  removeFigure,
  renderFigure as renderPdfFigure,
  validateCrop,
} from "../services/lockin/figures";
import {
  correctMistake,
  listMistakes,
  promoteMistake,
  recordMistake,
  type MistakeRow,
} from "../services/lockin/mistakes";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/**
 * Session figures and the misconception ledger (`docs/product.md` §4.3).
 *
 * A figure is a crop of the session's own copied PDF, rendered with argv and
 * capped at 8 MB; a mistake is the learner's own record and can graduate into a
 * knowledge note. Neither is a source: figures never enter coverage, and the
 * ledger is history the learner owns.
 */
export function createSessionExtrasHandlers<C extends SessionServices>(
  ctx: SessionHandlerContext<C>,
): {
  handlers: {
    sessionFigureList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionFigureExtract: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionFigureRead: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionFigureAnnotate: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionFigureRemove: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionMistakeList: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionMistakeRecord: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionMistakePromote: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionMistakeCorrect: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
} {
  const { services, resolveSession } = ctx;

  const figureFailure = (id: RpcId, sessionId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "figure", id: sessionId, message }, false);

  /** The session's copied PDFs, and which one a request names. */
  const pickPdf = (
    opened: OpenResult,
    rawSource: unknown,
  ): { ok: true; source: string } | { ok: false; message: string } => {
    const sources = opened.session.sources;
    const pdfs = sources.filter(
      (source) =>
        source.kind === "pdf" || source.name.toLowerCase().endsWith(".pdf"),
    );
    if (typeof rawSource === "string" && rawSource.trim() !== "") {
      const match = pdfs.find(
        (source) =>
          source.storedPath === rawSource.trim() ||
          source.name === rawSource.trim() ||
          source.storedPath.endsWith(`/${rawSource.trim()}`),
      );
      return match
        ? { ok: true, source: match.storedPath }
        : { ok: false, message: `"${rawSource.trim()}" is not a PDF copied into this session` };
    }
    const instructions = opened.session.instructions;
    if (instructions && (instructions.kind === "pdf" || instructions.name.toLowerCase().endsWith(".pdf"))) {
      return { ok: true, source: instructions.storedPath };
    }
    if (pdfs[0]) return { ok: true, source: pdfs[0].storedPath };
    return { ok: false, message: "add a PDF to this session first; a figure is cropped from your own source" };
  };

  /** Save one figure cropped from the session's own PDF. */
  const sessionFigureExtract = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const page = params.page;
    if (typeof page !== "number" || !Number.isInteger(page)) {
      return invalid(id, "session.figure.extract requires a whole page number");
    }
    let cropInput: import("../services/lockin/figures").FigureCrop = { page };
    for (const key of ["x", "y", "width", "height", "dpi"] as const) {
      const value = params[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return invalid(id, `session.figure.extract: ${key} must be a whole number`);
      }
      cropInput = { ...cropInput, [key]: value };
    }
    if (params.caption !== undefined && typeof params.caption !== "string") {
      return invalid(id, "session.figure.extract: caption must be a string");
    }
    if (params.note !== undefined && typeof params.note !== "string") {
      return invalid(id, "session.figure.extract: note must be a string");
    }
    const caption = typeof params.caption === "string" ? params.caption.trim().slice(0, 300) : "";
    const note = typeof params.note === "string" ? params.note.trim().slice(0, 2000) : "";
    const checked = validateCrop(cropInput);
    if (!checked.ok) return invalid(id, `session.figure.extract: ${checked.message}`);

    const picked = pickPdf(resolved.opened, params.source);
    if (!picked.ok) return figureFailure(id, sessionId, picked.message);
    const confined = confineSource(resolved.opened.folder, picked.source);
    if (!confined.ok) return figureFailure(id, sessionId, confined.message);

    const render = current.value.renderFigure ?? renderPdfFigure;
    const prefix = join(figuresDir(resolved.opened.folder), `.tmp-${crypto.randomUUID()}`);
    const rendered = await render({
      ...checked.crop,
      sourcePath: confined.path,
      outputPrefix: prefix,
      dpi: checked.dpi,
    });
    if (!rendered.ok) {
      return figureFailure(id, sessionId, rendered.error.message);
    }
    const added = await addFigure(resolved.opened.folder, {
      source: picked.source,
      crop: checked.crop,
      caption,
      note,
      bytes: rendered.value,
      now: new Date(),
    });
    if (!added.ok) return figureFailure(id, sessionId, added.error.message);
    return success(id, { figure: added.value });
  };

  /**
   * `session.mistake.correct` — write the right answer under a promoted note.
   *
   * Promotion is not one-way: this replaces only the `## Corrected understanding`
   * section, keeps the provenance, and sets `status: corrected`, so the note
   * settles and leaves the Review queue. The ledger entry itself is untouched.
   */
  const sessionMistakeCorrect = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.mistake.correct requires a session id");
    }
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return invalid(id, "session.mistake.correct requires a whole mistake index");
    }
    if (typeof params.correction !== "string") {
      return invalid(id, "session.mistake.correct requires correction text");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const corrected = await correctMistake({
      workspace: current.value.workspace,
      sessionId,
      index,
      correction: params.correction,
    });
    if (!corrected.ok) {
      const message =
        corrected.error.kind === "invalid"
          ? corrected.error.message
          : "the correction could not be written";
      return mistakeFailure(id, sessionId, message);
    }
    return success(id, { note: corrected.value.note });
  };

  /** The mistake ledger's failure shape: one session, one message. */
  const mistakeFailure = (id: RpcId, sessionId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "mistake", id: sessionId, message }, false);

  const mistakeReply = (id: RpcId, entries: MistakeRow[]): JsonRpcResponse =>
    success(id, { entries });

  /**
   * `session.mistake.list` — the session's misconception ledger.
   *
   * Read-only. Each row carries the note it was promoted into, when it has
   * one, so the reader can show "promoted" without a second request.
   */
  const sessionMistakeList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.mistake.list requires a session id");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const listed = await listMistakes({ workspace: current.value.workspace, sessionId });
    if (!listed.ok) return mistakeFailure(id, sessionId, listed.error.message);
    return mistakeReply(id, listed.value.entries);
  };

  /**
   * `session.mistake.record` — append one entry and return the ledger.
   *
   * The text is normalised to one line and bounded; an over-long entry is
   * refused with its length rather than silently cut. The record is process
   * history, never a source.
   */
  const sessionMistakeRecord = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.mistake.record requires a session id");
    }
    if (typeof params.text !== "string") {
      return invalid(id, "session.mistake.record requires mistake text");
    }
    if (params.step !== undefined && typeof params.step !== "string") {
      return invalid(id, "session.mistake.record: step must be a string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const recorded = await recordMistake({
      workspace: current.value.workspace,
      sessionId,
      text: params.text,
      ...(params.step === undefined ? {} : { step: params.step as string }),
    });
    if (!recorded.ok) {
      const message =
        recorded.error.kind === "invalid" ? recorded.error.message : "the mistake could not be recorded";
      return mistakeFailure(id, sessionId, message);
    }
    return mistakeReply(id, recorded.value.entries);
  };

  /**
   * `session.mistake.promote` — graduate one entry into a labelled note.
   *
   * The note lands in the school vault's `knowledge/` folder with its session,
   * entry and step in the frontmatter, so it is searchable and readable like
   * any other note and still labelled as the learner's own record. Promoting
   * the same entry twice returns the existing note (`already: true`).
   */
  const sessionMistakePromote = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.mistake.promote requires a session id");
    }
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return invalid(id, "session.mistake.promote requires a whole mistake index");
    }
    if (params.correction !== undefined && typeof params.correction !== "string") {
      return invalid(id, "session.mistake.promote: correction must be a string");
    }
    if (params.title !== undefined && typeof params.title !== "string") {
      return invalid(id, "session.mistake.promote: title must be a string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const promoted = await promoteMistake({
      workspace: current.value.workspace,
      sessionId,
      index,
      ...(params.correction === undefined ? {} : { correction: params.correction as string }),
      ...(params.title === undefined ? {} : { title: params.title as string }),
    });
    if (!promoted.ok) {
      const message =
        promoted.error.kind === "invalid" ? promoted.error.message : "the note could not be written";
      return mistakeFailure(id, sessionId, message);
    }
    return success(id, {
      note: promoted.value.note,
      already: promoted.value.already,
    });
  };

  const sessionFigureList = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const listed = await readFigures(resolved.opened.folder);
    if (!listed.ok) return figureFailure(id, resolved.opened.session.id, listed.error.message);
    return success(id, { figures: listed.value });
  };

  /** One figure's PNG as base64, for the shell's `Image.memory`. */
  const sessionFigureRead = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const figureId = typeof params.figureId === "string" ? params.figureId.trim() : "";
    if (figureId === "") return invalid(id, "session.figure.read requires a figure id");
    const listed = await readFigures(resolved.opened.folder);
    if (!listed.ok) return figureFailure(id, resolved.opened.session.id, listed.error.message);
    const figure = listed.value.find((entry) => entry.id === figureId);
    if (!figure) {
      return figureFailure(id, resolved.opened.session.id, `there is no figure "${figureId}"`);
    }
    const bytes = await readFigureBytes(resolved.opened.folder, figure);
    if (!bytes.ok) return figureFailure(id, resolved.opened.session.id, bytes.error.message);
    return success(id, {
      figure,
      base64: Buffer.from(bytes.value).toString("base64"),
      mediaType: "image/png",
    });
  };

  const sessionFigureAnnotate = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const figureId = typeof params.figureId === "string" ? params.figureId.trim() : "";
    if (figureId === "") return invalid(id, "session.figure.annotate requires a figure id");
    if (params.caption !== undefined && typeof params.caption !== "string") {
      return invalid(id, "session.figure.annotate: caption must be a string");
    }
    if (params.note !== undefined && typeof params.note !== "string") {
      return invalid(id, "session.figure.annotate: note must be a string");
    }
    const written = await annotateFigure(resolved.opened.folder, figureId, {
      ...(typeof params.caption === "string" ? { caption: params.caption.trim().slice(0, 300) } : {}),
      ...(typeof params.note === "string" ? { note: params.note.trim().slice(0, 2000) } : {}),
    });
    if (!written.ok) return figureFailure(id, resolved.opened.session.id, written.error.message);
    return success(id, { figure: written.value });
  };

  const sessionFigureRemove = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const figureId = typeof params.figureId === "string" ? params.figureId.trim() : "";
    if (figureId === "") return invalid(id, "session.figure.remove requires a figure id");
    const removed = await removeFigure(resolved.opened.folder, figureId);
    if (!removed.ok) return figureFailure(id, resolved.opened.session.id, removed.error.message);
    return success(id, removed.value);
  };
  return {
    handlers: {
      sessionFigureList,
      sessionFigureExtract,
      sessionFigureRead,
      sessionFigureAnnotate,
      sessionFigureRemove,
      sessionMistakeList,
      sessionMistakeRecord,
      sessionMistakePromote,
      sessionMistakeCorrect,
    },
  };
}

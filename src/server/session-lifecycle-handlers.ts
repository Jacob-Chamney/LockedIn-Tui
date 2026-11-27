import { parseProgress } from "../domain/progress";
import { computeCoverage } from "../domain/coverage";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import {
  loadSessionPrompt,
  loadSessionSteps,
  regenerateSessionSteps,
  toggleSessionStep,
} from "../app/actions/lockin";
import { readMemory } from "../services/lockin/memory";
import { MAX_SESSION_NAME } from "../domain/session";
import { generationFailure } from "./session-documents";
import { createHash } from "node:crypto";
import { loadSessionHome } from "../app/actions/sessions";
import { createLockInSession } from "../services/lockin/create";
import { memoryRow } from "./chat-memory";
import { sourceRows } from "./views";
import type { SessionDetailView } from "./views";
import {
  BOOT_FAILED,
  bootFailureResponse,
  failure,
  invalid,
  oneLine,
  success,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";

/**
 * Session lifecycle: open, coverage, create, step toggle and step generation.
 *
 * A created session copies its sources and writes `meta.json`/`prompt.md` in one
 * transaction, so a failure leaves no folder and no half-written file. A step
 * toggle rewrites exactly one bracket and the progress line, and a regeneration
 * merges checked work by exact step text.
 */
export function createSessionLifecycleHandlers<C extends SessionServices>(
  ctx: SessionHandlerContext<C>,
): {
  handlers: {
    sessionOpen: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionCoverage: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionCreate: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionToggleStep: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionGenerateSteps: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
} {
  const { services, resolveSession } = ctx;

  const sessionOpen = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;

    const { session } = resolved.opened;
    // `prompt.md` is the text the model reads; `meta.prompt` is the fallback for
    // a folder that predates the file. Both are internal absolute reads: the
    // shell only ever sends an id.
    const prompt = (await loadSessionPrompt(current.value.workspace, session.id)) ?? session.prompt;
    const markdown = (await loadSessionSteps(current.value.workspace, session.id)) ?? "";
    const counts = parseProgress(markdown);
    // Memory is labelled history, never a source (`docs/product.md` §4.5). A
    // read failure is an absent memory block, not a session error: the session
    // itself opened, and the reader simply has nothing to show yet. The key is
    // omitted (rather than `null`) when nothing is stored, so an existing
    // no-memory `session.open` shape is unchanged; the shell reads absent and
    // `null` alike.
    const memory = await readMemory(resolved.opened.folder, session.id);
    const memoryView = memoryRow(memory.ok ? memory.value : null);

    const detail: SessionDetailView = {
      id: session.id,
      name: session.name,
      created: session.created,
      archived: session.archived,
      prompt,
      sources: sourceRows(session),
      steps: {
        done: counts.ok ? counts.value.checked : 0,
        total: counts.ok ? counts.value.total : 0,
        exists: markdown.trim() !== "",
        markdown,
      },
      ...(memoryView === null ? {} : { memory: memoryView }),
    };
    return success(id, { session: detail });
  };

  /**
   * Source coverage for one lock-in session (`docs/product.md` §4.3).
   *
   * Pure read: the sources and the labelled documents are exactly what
   * `loadSessionHome` reads for the session home, and the report is
   * `computeCoverage` unchanged — this handler adds no rule of its own. Memory
   * is one of the document kinds and is never a source, so a source mentioned
   * only there keeps `fromMemoryOnly: true`.
   *
   * An unknown session is the shared session error shape; a blank id is
   * `-32602`. Nothing is written and no model is contacted.
   */
  const sessionCoverage = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;

    const sessionId = resolved.opened.session.id;
    const home = await loadSessionHome(current.value.workspace, sessionId);
    if (home === null) {
      const message = `session "${sessionId}" could not be read`;
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "session", id: sessionId, message },
        false,
      );
    }

    return success(id, { coverage: computeCoverage(home.sources, home.documents) });
  };

  /**
   * Create one lock-in session: the wizard's Review step.
   *
   * The service owns the transaction (copy sources, extract an instructions
   * file, write `meta.json` and `prompt.md`, then rename), so this handler only
   * validates the shapes, supplies the clock and maps the typed failure. The
   * shell receives `{id, name}` and calls `session.open` for the detail; the
   * response is deliberately not a second copy of it.
   */
  /**
   * The result of one `session.create`, cached by the shell's request id.
   *
   * The shell gives an attempt an id so a timed-out retry can join the first
   * create instead of starting a second one (`docs/decisions/0019`). Only
   * successful results are kept: a validation or copy failure is dropped, so a
   * corrected retry is a fresh attempt. The map is process state and is empty
   * after a restart.
   */
  type SessionCreateOutcome =
    | { ok: true; id: string; name: string }
    | { ok: false; message: string; field?: string };

  const sessionCreates = new Map<
    string,
    { promise: Promise<SessionCreateOutcome>; done?: SessionCreateOutcome }
  >();

  const createReply = (id: RpcId, outcome: SessionCreateOutcome): JsonRpcResponse =>
    outcome.ok
      ? success(id, { id: outcome.id, name: outcome.name })
      : failure(
          id,
          BOOT_FAILED,
          outcome.message,
          {
            kind: "session-create",
            message: outcome.message,
            ...(outcome.field === undefined ? {} : { field: outcome.field }),
          },
          false,
        );

  /** Keep the last 32 settled creates; older keys are only a retry aid. */
  const trimCreates = (): void => {
    while (sessionCreates.size > 32) {
      const oldest = sessionCreates.keys().next().value;
      if (oldest === undefined) break;
      sessionCreates.delete(oldest);
    }
  };

  const sessionCreate = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawName = params.name;
    if (typeof rawName !== "string" || rawName.trim() === "") {
      return invalid(id, "session.create requires a non-empty name string");
    }
    const name = rawName.trim();
    if (name.length > MAX_SESSION_NAME) {
      return invalid(
        id,
        `session.create: session names are capped at ${MAX_SESSION_NAME} characters`,
      );
    }
    const prompt = params.prompt;
    if (prompt !== undefined && typeof prompt !== "string") {
      return invalid(id, "session.create: prompt must be a string");
    }
    const files = params.files;
    if (
      files !== undefined &&
      (!Array.isArray(files) ||
        !files.every((path) => typeof path === "string" && path.trim() !== ""))
    ) {
      return invalid(id, "session.create: files must be an array of non-empty path strings");
    }
    const instructionsFile = params.instructionsFile;
    if (
      instructionsFile !== undefined &&
      (typeof instructionsFile !== "string" || instructionsFile.trim() === "")
    ) {
      return invalid(id, "session.create: instructionsFile must be a non-empty path string");
    }
    const steps = params.steps;
    if (steps !== undefined && typeof steps !== "boolean") {
      return invalid(id, "session.create: steps must be a boolean");
    }
    const rawRequestId = params.requestId;
    if (rawRequestId !== undefined) {
      if (
        typeof rawRequestId !== "string" ||
        rawRequestId.trim() === "" ||
        rawRequestId.length > 128
      ) {
        return invalid(
          id,
          "session.create: requestId must be a non-empty string of at most 128 characters",
        );
      }
    }
    const requestId = typeof rawRequestId === "string" ? rawRequestId : undefined;

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // The service is the single writer: a refusal leaves no session, no temp
    // directory and no half-written `meta.json` (`AGENTS.md` §2.9).
    const runCreate = async (): Promise<SessionCreateOutcome> => {
      const created = await createLockInSession({
        workspace: current.value.workspace,
        created: new Date(),
        name,
        ...(prompt === undefined ? {} : { prompt }),
        ...(files === undefined ? {} : { files: files as string[] }),
        ...(instructionsFile === undefined ? {} : { instructionsFile }),
        ...(steps === undefined ? {} : { steps }),
      });
      if (!created.ok) {
        const error = created.error;
        return {
          ok: false,
          message: oneLine(error.message),
          ...(error.kind === "invalid-session" ? { field: error.field } : {}),
        };
      }
      return {
        ok: true,
        id: created.value.session.id,
        name: created.value.session.name,
      };
    };

    if (requestId === undefined) return createReply(id, await runCreate());

    const existing = sessionCreates.get(requestId);
    if (existing?.done !== undefined) return createReply(id, existing.done);
    if (existing !== undefined) {
      const message = "still creating — check Sessions";
      return failure(
        id,
        BOOT_FAILED,
        message,
        { kind: "session-create", requestId, status: "creating", message },
        false,
      );
    }

    const entry: {
      promise: Promise<SessionCreateOutcome>;
      done?: SessionCreateOutcome;
    } = { promise: runCreate() };
    sessionCreates.set(requestId, entry);
    const outcome = await entry.promise;
    entry.done = outcome;
    if (!outcome.ok) {
      // A failure is not an idempotent result: a corrected retry must run.
      sessionCreates.delete(requestId);
    } else {
      trimCreates();
    }
    return createReply(id, outcome);
  };

  /**
   * Toggle one assignment step: the steps reader's only write.
   *
   * The service rewrites exactly one bracket character and the progress line
   * (`docs/product.md` §5.1, `src/domain/progress.ts`), so the response carries
   * the whole file instead of a patch: the shell replaces its copy and renders
   * the counts from this reply, never from a second read or a local guess.
   */
  const sessionToggleStep = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.toggleStep requires a session id");
    }
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return invalid(id, "session.toggleStep requires a non-negative integer index");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    // Resolve first so an unknown id is the session error shape, not a steps
    // failure for a folder that was never there.
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const toggled = await toggleSessionStep(current.value.workspace, sessionId, index);
    if (!toggled.ok) {
      const message = oneLine(toggled.error.message);
      return failure(id, BOOT_FAILED, message, { kind: "steps", id: sessionId, message }, false);
    }

    // One document in, one document out: the counts and the hash describe the
    // same bytes the shell is about to render.
    const markdown = toggled.value;
    const counts = parseProgress(markdown);
    const items = counts.ok ? counts.value.items : [];
    return success(id, {
      index,
      checked: items[index]?.checked ?? false,
      done: counts.ok ? counts.value.checked : 0,
      total: counts.ok ? counts.value.total : 0,
      markdown,
      hash: `sha256:${createHash("sha256").update(markdown).digest("hex")}`,
    });
  };

  /**
   * Build or rebuild one session's assignment steps from its own sources.
   *
   * The service owns the whole transaction: it reads the session context (steps
   * and generated outputs excluded), asks the model for a plan, validates it,
   * merges checked work by exact step text and writes the file atomically. This
   * handler therefore supplies the one-shot completion and maps the failure; a
   * provider error, an unreadable source or a rejected plan is one message and
   * leaves the previous steps untouched (`AGENTS.md` §2.9).
   *
   * A workspace with no model has no completion to offer, so the reply is the
   * one actionable sentence that fixes it; the shell does not retry.
   */
  const sessionGenerateSteps = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.generateSteps requires a session id");
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

    const generated = await regenerateSessionSteps({
      workspace: current.value.workspace,
      id: sessionId,
      generate,
    });
    if (!generated.ok) {
      const message = oneLine(generated.error.message);
      return generationFailure(id, sessionId, message);
    }
    // `kept`/`lost` describe the checked work the merge compared, so the shell
    // can say "kept 2, dropped 1" without re-reading the old file.
    return success(id, {
      markdown: generated.value.markdown,
      kept: generated.value.kept,
      lost: generated.value.lost,
    });
  };
  return {
    handlers: {
      sessionOpen,
      sessionCoverage,
      sessionCreate,
      sessionToggleStep,
      sessionGenerateSteps,
    },
  };
}

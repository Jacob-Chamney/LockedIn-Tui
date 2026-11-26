import type { BootFailure } from "../app/boot";
import type { Result } from "../domain/markdown";
import type { OpenResult } from "../services/lockin/manager";
import {
  importSessionInstructionsFile,
  loadSessionInstructions,
  reExtractSessionInstructions,
  saveSessionInstructions,
} from "../app/actions/lockin";
import type { Workspace } from "../storage/workspace";
import {
  bootFailureResponse,
  invalid,
  oneLine,
  success,
  type JsonRpcFailure,
  type JsonRpcResponse,
  type RpcId,
} from "./rpc";
import { instructionsFailure } from "./session-documents";
import { instructionsRow } from "./views";

/** What a session handler needs from the core, and nothing more. */
export type SessionServices = { workspace: Workspace };

/**
 * The two doors a session handler uses: boot once, and resolve one id.
 *
 * They are passed in rather than imported so this module can be tested with a
 * real workspace and no process, which is the whole point of moving the
 * handlers out of the closure.
 */
export type SessionHandlerContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  resolveSession: (
    id: RpcId,
    current: C,
    raw: unknown,
    field?: "id" | "sessionId",
  ) => Promise<{ error: JsonRpcFailure } | { opened: OpenResult }>;
};

/**
 * The session settings pane: read `prompt.md`, replace its text, import a file
 * and re-extract the copied original (`docs/product.md` §4.3).
 *
 * None of these accepts a destination from the shell: the only inputs are a
 * session id and instruction text or a user-picked file the core copies into
 * that session.
 */
export function createSessionInstructionHandlers<C extends SessionServices>(
  ctx: SessionHandlerContext<C>,
): {
  sessionInstructionsGet: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionInstructionsSave: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionInstructionsImport: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  sessionInstructionsReextract: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
} {
  const { services, resolveSession } = ctx;

  /**
   * Read the session's current instructions.
   *
   * `prompt.md` is the text the model reads; `instructionsSource` is the copied
   * original's provenance when the prompt came from a file. The shell edits the
   * text and never sends a path back, so this is the read half of the session
   * settings pane (`docs/product.md` §4.3).
   */
  const sessionInstructionsGet = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.instructions.get requires a session id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const loaded = await loadSessionInstructions(current.value.workspace, sessionId);
    if (!loaded.ok) {
      return instructionsFailure(id, sessionId, oneLine(loaded.error.message));
    }
    const { prompt, instructions } = loaded.value;
    return success(id, {
      prompt,
      ...(instructions === null ? {} : { instructionsSource: instructionsRow(instructions) }),
    });
  };

  /**
   * Replace the instruction text in `prompt.md`.
   *
   * The text is the only input: the service writes `prompt.md` and the matching
   * `meta.prompt` atomically. An empty string is accepted by the service and
   * clears the prompt; a source file is not required for that. The original
   * instruction file, when there is one, is provenance and is left in place.
   */
  const sessionInstructionsSave = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.instructions.save requires a session id");
    }
    const text = params.text;
    if (typeof text !== "string") {
      return invalid(id, "session.instructions.save requires a text string (empty clears the prompt)");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const saved = await saveSessionInstructions({
      workspace: current.value.workspace,
      id: sessionId,
      text,
    });
    if (!saved.ok) {
      return instructionsFailure(id, sessionId, oneLine(saved.error.message));
    }
    return success(id, { prompt: saved.value.prompt });
  };

  /**
   * Load a user-picked file as the instructions.
   *
   * `file` is the original the user chose, never a destination: the service
   * copies it into this session's `sources/`, extracts its text into
   * `prompt.md` and records the provenance in `meta.json`, all in one
   * transaction. A duplicate copy is counted in `added: false` without a second
   * source row. A scanned PDF with no text layer is the service's typed refusal
   * and leaves the previous prompt and metadata untouched.
   */
  const sessionInstructionsImport = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.instructions.import requires a session id");
    }
    const file = params.file;
    if (typeof file !== "string" || file.trim() === "") {
      return invalid(id, "session.instructions.import requires a non-empty file path");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const imported = await importSessionInstructionsFile({
      workspace: current.value.workspace,
      id: sessionId,
      file,
    });
    if (!imported.ok) {
      return instructionsFailure(id, sessionId, oneLine(imported.error.message));
    }
    return success(id, {
      prompt: imported.value.prompt,
      instructions: instructionsRow(imported.value.instructions),
      added: imported.value.added,
    });
  };

  /**
   * Re-extract the copied original into `prompt.md`, replacing manual edits.
   *
   * This is only possible when the session has an instruction file; a
   * text-only session is the service's blocked message. The copied original is
   * the source of truth for this action, not the user's original path, so a
   * later edit to that original cannot change the session.
   */
  const sessionInstructionsReextract = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const rawId = params.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return invalid(id, "session.instructions.reextract requires a session id");
    }

    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, rawId);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;

    const extracted = await reExtractSessionInstructions(current.value.workspace, sessionId);
    if (!extracted.ok) {
      return instructionsFailure(id, sessionId, oneLine(extracted.error.message));
    }
    return success(id, {
      prompt: extracted.value.prompt,
      instructions: instructionsRow(extracted.value.instructions),
    });
  };

  return {
    sessionInstructionsGet,
    sessionInstructionsSave,
    sessionInstructionsImport,
    sessionInstructionsReextract,
  };
}

import type { SessionDocumentKind } from "../app/actions/lockin";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Workspace } from "../storage/workspace";
import {
  SESSION_OUTPUT_DEFAULT_PART,
  SESSION_OUTPUT_FILES,
  SESSION_OUTPUT_KINDS,
  SESSION_OUTPUT_PARTS,
  SESSION_OUTPUT_PARTS_FOR,
  isSessionOutputKind,
  isSessionOutputPart,
  type SessionOutputKind,
  type SessionOutputPart,
} from "./outputs";
import {
  BOOT_FAILED,
  failure,
  type JsonRpcFailure,
  type RpcId,
} from "./rpc";

/** The outputs folder for one session: `<workspace>/school/outputs/<id>`. */
export function outputFolder(workspace: Workspace, sessionId: string): string {
  return join(workspace.root, "school", "outputs", sessionId);
}

/** One output file's absolute path, inside that session's outputs folder. */
export function outputFilePath(
  workspace: Workspace,
  sessionId: string,
  part: SessionOutputPart,
): string {
  return join(outputFolder(workspace, sessionId), SESSION_OUTPUT_FILES[part]);
}

/**
 * Read one already-built output.
 *
 * A **missing** file is the documented empty state (`exists: false`), not a
 * failure: reporting it as a failure showed the reader's "build it" action over
 * a guide that exists, and the build then replaced it. An unreadable file is a
 * failure with the permissions hint.
 */
export async function readOutputFile(
  workspace: Workspace,
  sessionId: string,
  part: SessionOutputPart,
): Promise<{ ok: true; markdown: string; exists: boolean } | { ok: false; message: string }> {
  const path = outputFilePath(workspace, sessionId, part);
  try {
    const markdown = await readFile(path, "utf8");
    return { ok: true, markdown, exists: true };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { ok: true, markdown: "", exists: false };
    }
    const message =
      `the ${SESSION_OUTPUT_FILES[part]} file cannot be read ` +
      `(${error instanceof Error ? error.message : String(error)}); fix its permissions`;
    return { ok: false, message };
  }
}

/** The one output failure shape: one session, one message, never retried. */
export function outputFailure(id: RpcId, sessionId: string, message: string): JsonRpcFailure {
  return failure(id, BOOT_FAILED, message, { kind: "output", id: sessionId, message }, false);
}

/**
 * The one generation failure shape: one session, one message, never retried.
 *
 * Every model call a `session.*` method makes — steps, a generated document, a
 * study guide or a deck — reports a failure the same way, so the shell has one
 * shape to render.
 */
export function generationFailure(
  id: RpcId,
  sessionId: string,
  message: string,
): JsonRpcFailure {
  return failure(id, BOOT_FAILED, message, { kind: "generation", id: sessionId, message }, false);
}

/** The instruction failure shape: one session, one message, never retried. */
export function instructionsFailure(
  id: RpcId,
  sessionId: string,
  message: string,
): JsonRpcFailure {
  return failure(id, BOOT_FAILED, message, { kind: "instructions", id: sessionId, message }, false);
}

/**
 * Validate one `session.output.read` request.
 *
 * The default part is the kind's primary document (`guide` for a study guide,
 * `cards` for a deck); a part that belongs to the other kind is refused rather
 * than silently substituted.
 */
export function parseOutputReadRequest(
  params: Record<string, unknown>,
):
  | { error: string }
  | { kind: SessionOutputKind; part: SessionOutputPart } {
  const rawKind = params.kind;
  if (!isSessionOutputKind(rawKind)) {
    return {
      error: `session.output.read: unknown kind ${JSON.stringify(rawKind)}; expected one of ${SESSION_OUTPUT_KINDS.join(", ")}`,
    };
  }
  const rawPart = params.part;
  if (rawPart !== undefined && !isSessionOutputPart(rawPart)) {
    return {
      error: `session.output.read: unknown part ${JSON.stringify(rawPart)}; expected one of ${SESSION_OUTPUT_PARTS.join(", ")}`,
    };
  }
  const parts = SESSION_OUTPUT_PARTS_FOR[rawKind];
  if (rawPart !== undefined && !parts.includes(rawPart)) {
    return {
      error: `session.output.read: kind "${rawKind}" has ${parts.join(", ")}; ${JSON.stringify(rawPart)} belongs to another kind`,
    };
  }
  return { kind: rawKind, part: rawPart ?? SESSION_OUTPUT_DEFAULT_PART[rawKind] };
}

/**
 * The three generated session documents (`docs/data-model.md` §4).
 *
 * The names are the `SESSION_FILES` entries the lock-in service writes:
 * `contract.md`, `contradictions.md` and `check.md`. The type comes from the
 * action module, so adding a fourth kind cannot leave this list behind.
 */
export const SESSION_DOCUMENT_KINDS: readonly SessionDocumentKind[] = [
  "contract",
  "contradictions",
  "check",
];

export function isSessionDocumentKind(value: unknown): value is SessionDocumentKind {
  return (
    typeof value === "string" && (SESSION_DOCUMENT_KINDS as readonly string[]).includes(value)
  );
}


/**
 * Validate one `session.document` request.
 *
 * `attempt` only applies to `check`; supplying it with `contract` or
 * `contradictions` is a refusal rather than a silent drop, and a blank attempt
 * is treated as absent.
 */
export function parseDocumentRequest(
  params: Record<string, unknown>,
): { error: string } | { kind: SessionDocumentKind; attempt: string } {
  const rawKind = params.kind;
  if (!isSessionDocumentKind(rawKind)) {
    return {
      error: `session.document: unknown kind ${JSON.stringify(rawKind)}; expected one of ${SESSION_DOCUMENT_KINDS.join(", ")}`,
    };
  }
  const rawAttempt = params.attempt;
  if (rawAttempt !== undefined && typeof rawAttempt !== "string") {
    return { error: "session.document: attempt must be a string" };
  }
  const attempt = typeof rawAttempt === "string" ? rawAttempt.trim() : "";
  if (rawKind !== "check" && attempt !== "") {
    return { error: 'session.document: attempt only applies to kind "check"' };
  }
  return { kind: rawKind, attempt };
}

import { readFile } from "node:fs/promises";

import { createJsonlHistoryPort } from "../storage/chat-history";
import { sessionTools } from "../app/actions/lockin";
import { COMPACT_KEEP, compactPrompt, contextView, normaliseSummary, type ContextMessage } from "../domain/context";
import { withPromptNote } from "../domain/prompts";
import type { ChatController } from "../app/chat-controller";
import type { OpenResult } from "../services/lockin/manager";
import type { TurnOutcome } from "../services/lockin/memory";
import { finalAnswerText, extractMemoryPoints } from "./chat-memory";
import { chatSnapshot, type ChatState } from "./chat-wire";
import type { SessionHandlerContext, SessionServices } from "./session-context";
import {
  clearContextPlan,
  readContextPlan,
  writeContextPlan,
} from "../services/lockin/context-state";
import { recordTurn } from "../services/lockin/memory";
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

/** One notification the core pushes to the shell. */
export type EmitNotification = (notification: {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}) => void;

/** What the session chat family needs beyond the shared session doors. */
export type SessionChatContext<C extends SessionServices> = SessionHandlerContext<C> & {
  notify: EmitNotification;
  /** The history limit in force, including an uncommitted settings patch. */
  historyLimit: (current: C) => number;
};

/**
 * One lock-in session chat: `session.chat.*` and the transcript's context meter.
 *
 * A session chat is source-bound and read-only: the toolbox reads only that
 * session's copied `sources/`, the request runs in locked `learn` mode, and a
 * turn is appended to `chat.jsonl` only after it completes. Memory is written
 * after the terminal event so the shell never waits for a disk write.
 */
export function createSessionChatHandlers<C extends SessionServices>(
  ctx: SessionChatContext<C>,
): {
  handlers: {
    sessionChatSnapshot: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionChatContext: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionChatCompact: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionChatUncompact: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionChatSend: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    sessionChatCancel: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
  };
  /** Drop every controller after a settings change. */
  resetSessionChats: () => void;
  /** Drop one controller before its folder moves or disappears. */
  dropSessionChat: (sessionId: string) => void;
} {
  const { services, resolveSession, notify, historyLimit } = ctx;

  /** One lock-in session chat, built on first use and reused thereafter. */
  type SessionChat = {
    sessionId: string;
    controller: ChatController;
    state: ChatState;
    timer: ReturnType<typeof setTimeout> | null;
    unsubscribe: () => void;
    /** This stream's frame counter (see `chatSnapshot`). */
    seq: number;
  };

  /**
   * One controller per open session.
   *
   * The map holds the in-flight build, not just the finished controller, so two
   * concurrent requests cannot create two controllers (and two history writers)
   * for the same session. A failed build is removed so the next request retries
   * from scratch — that is a fresh request, never a retry of a chat turn.
   */
  const sessionChats = new Map<string, Promise<SessionChat | null>>();

  const emitSessionState = (runtime: SessionChat): void => {
    runtime.seq += 1;
    notify({
      jsonrpc: "2.0",
      method: "session.chat.state",
      params: {
        sessionId: runtime.sessionId,
        ...chatSnapshot(runtime.state, runtime.controller.usage(), runtime.seq),
      },
    });
  };

  const ensureSessionChat = (
    current: C,
    opened: OpenResult,
  ): Promise<SessionChat | null> => {
    const sessionId = opened.session.id;
    const cached = sessionChats.get(sessionId);
    if (cached) return cached;

    let building!: Promise<SessionChat | null>;
    building = (async (): Promise<SessionChat | null> => {
      if (!current.createChat) return null;
      const history = createJsonlHistoryPort(
        opened.chatPath,
        historyLimit(current),
      );
      // A session chat is source-bound: the toolbox reads only this session's
      // `sources/`, and the context is built from the same files.
      const tools = sessionTools(current.workspace, sessionId);
      const controller = current.createChat(history, "school", "lockin", tools.context, tools);
      // A stored summary is a *view* of the transcript used to build the next
      // request; the log itself is never rewritten. A missing file means full
      // history, which is the safe default.
      if (typeof controller.setContextPlan === "function") {
        controller.setContextPlan(async () => {
          const plan = await readContextPlan(opened.folder);
          return plan.ok && plan.value !== null
            ? { summary: plan.value.summary, through: plan.value.through }
            : null;
        });
      }
      await controller.load();
      // A settings patch may have dropped the cache while the history loaded;
      // a controller nobody can reach must not keep a subscription alive.
      if (sessionChats.get(sessionId) !== building) {
        controller.dispose();
        return null;
      }
      const runtime: SessionChat = {
        sessionId,
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
          emitSessionState(runtime);
        }, 33);
      });
      return runtime;
    })();

    sessionChats.set(sessionId, building);
    void building.catch(() => {
      if (sessionChats.get(sessionId) === building) sessionChats.delete(sessionId);
    });
    return building;
  };

  /**
   * Drop every session controller after a settings change. The next snapshot or
   * send rebuilds it, so a newly linked model takes effect without a restart.
   */
  const resetSessionChats = (): void => {
    const previous = [...sessionChats.values()];
    sessionChats.clear();
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
   * Drop one cached session chat before its folder moves or disappears.
   *
   * `session.chat.*` rebuilds a controller from the session folder, so a stale
   * controller could never be reached again after an archive or delete; closing
   * it releases its subscription and history writer instead of leaking them.
   */
  const dropSessionChat = (sessionId: string): void => {
    const cached = sessionChats.get(sessionId);
    if (!cached) return;
    sessionChats.delete(sessionId);
    void cached
      .then((runtime) => {
        if (!runtime) return;
        if (runtime.timer !== null) clearTimeout(runtime.timer);
        runtime.timer = null;
        runtime.unsubscribe();
        runtime.controller.dispose();
      })
      .catch(() => {});
  };


  const sessionChatSnapshot = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const runtime = await ensureSessionChat(current.value, resolved.opened);
    if (!runtime) {
      return failure(id, -32601, "Session chat is not available in this build", undefined, false);
    }
    return success(
      id,
      chatSnapshot(runtime.controller.state(), runtime.controller.usage(), runtime.seq),
    );
  };

  /** Read a transcript as plain records, for context accounting. */
  const readTranscript = async (path: string): Promise<ContextMessage[]> => {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }
    const records: ContextMessage[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const row = parsed as { role?: unknown; content?: unknown };
      if (row.role !== "user" && row.role !== "assistant") continue;
      if (typeof row.content !== "string" || row.content.trim() === "") continue;
      records.push({ role: row.role, content: row.content });
    }
    return records;
  };

  const contextFailure = (id: RpcId, sessionId: string, message: string): JsonRpcResponse =>
    failure(id, BOOT_FAILED, message, { kind: "context", id: sessionId, message }, false);

  /**
   * The conversation's context meter.
   *
   * Read-only: it estimates the tokens the next request would carry, and says
   * whether there is enough older history to compact. It never calls a model.
   */
  const sessionChatContext = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;
    try {
      const records = await readTranscript(resolved.opened.chatPath);
      const stored = await readContextPlan(resolved.opened.folder);
      if (!stored.ok) return contextFailure(id, sessionId, stored.error.message);
      return success(id, {
        ...contextView({ records, plan: stored.value }),
        ...(stored.value === null ? {} : { summary: stored.value.summary }),
      });
    } catch (error) {
      return contextFailure(id, sessionId, oneLine(messageOf(error)));
    }
  };

  /**
   * Compact the older part of a session chat.
   *
   * One model call, explicit and never automatic. The last [COMPACT_KEEP]
   * messages are left alone; everything before them becomes one paragraph in
   * `context.json`. The transcript is byte-identical afterwards.
   */
  const sessionChatCompact = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const generate = current.value.generate;
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;
    if (!generate) {
      return contextFailure(id, sessionId, "link a model in Settings → Providers");
    }
    let records: ContextMessage[];
    try {
      records = await readTranscript(resolved.opened.chatPath);
    } catch (error) {
      return contextFailure(id, sessionId, oneLine(messageOf(error)));
    }
    const keep = Math.max(0, records.length - COMPACT_KEEP);
    if (keep === 0) {
      return contextFailure(
        id,
        sessionId,
        `nothing to compact yet; a summary needs more than ${COMPACT_KEEP} messages`,
      );
    }
    let raw: string;
    try {
      raw = await generate(
        withPromptNote(compactPrompt(records.slice(0, keep)), current.value.promptNote?.("compact")),
      );
    } catch (error) {
      return contextFailure(id, sessionId, oneLine(messageOf(error)));
    }
    const summary = normaliseSummary(raw);
    if (summary === null) return contextFailure(id, sessionId, "the summary was empty; try again");
    const plan = {
      summary,
      through: keep,
      updatedAt: new Date().toISOString(),
    };
    const written = await writeContextPlan(resolved.opened.folder, plan);
    if (!written.ok) return contextFailure(id, sessionId, written.error.message);
    return success(id, {
      ...contextView({ records, plan }),
      summary,
    });
  };

  /** Drop the stored summary; the next request sends the full history again. */
  const sessionChatUncompact = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const sessionId = resolved.opened.session.id;
    const cleared = await clearContextPlan(resolved.opened.folder);
    if (!cleared.ok) return contextFailure(id, sessionId, cleared.error.message);
    try {
      const records = await readTranscript(resolved.opened.chatPath);
      return success(id, contextView({ records, plan: null }));
    } catch (error) {
      return contextFailure(id, sessionId, oneLine(messageOf(error)));
    }
  };

  const sessionChatSend = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const text = params.text;
    if (typeof text !== "string" || text.trim() === "") {
      return invalid(id, "session.chat.send requires a non-empty text string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const runtime = await ensureSessionChat(current.value, resolved.opened);
    if (!runtime) {
      return failure(id, -32601, "Session chat is not available in this build", undefined, false);
    }
    const sessionId = runtime.sessionId;
    const folder = resolved.opened.folder;
    void runtime.controller
      .send(text)
      .then((outcome) => {
        const terminal: TurnOutcome = outcome.kind === "sent" ? outcome.outcome : "error";
        notify({
          jsonrpc: "2.0",
          method: "session.chat.done",
          params: { sessionId, ...outcome },
        });
        // Memory is recorded **after** the terminal event, so the shell never
        // waits for a disk write to see the answer. Only a completed turn
        // writes it (`recordTurn` no-ops cancelled and failed turns), and a
        // memory failure is not a turn failure: the answer streamed and the
        // transcript is saved, so it is dropped silently rather than reported
        // as a second error for one turn. `points` is read synchronously, so a
        // later turn cannot change what this one contributes.
        const points = extractMemoryPoints(finalAnswerText(runtime.state));
        void recordTurn({
          folder,
          sessionId,
          outcome: terminal,
          points,
          now: new Date().toISOString(),
        }).catch(() => {
          // Storage is best-effort here by design; see the note above.
        });
      })
      .catch((error: unknown) => {
        notify({
          jsonrpc: "2.0",
          method: "session.chat.error",
          params: { sessionId, message: oneLine(messageOf(error)) },
        });
      });
    return success(id, { turnId: sessionId });
  };

  const sessionChatCancel = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const resolved = await resolveSession(id, current.value, params.id);
    if ("error" in resolved) return resolved.error;
    const cached = sessionChats.get(resolved.opened.session.id);
    if (cached) {
      const runtime = await cached.catch(() => null);
      runtime?.controller.cancel();
    }
    // Cancelling a session with nothing in flight is a no-op, not an error.
    return success(id, { ok: true });
  };


  return {
    handlers: {
      sessionChatSnapshot,
      sessionChatContext,
      sessionChatCompact,
      sessionChatUncompact,
      sessionChatSend,
      sessionChatCancel,
    },
    resetSessionChats,
    dropSessionChat,
  };
}

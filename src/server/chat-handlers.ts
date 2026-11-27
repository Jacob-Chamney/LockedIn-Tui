import { basename } from "node:path";

import type { Result } from "../domain/markdown";
import type { BootFailure } from "../app/boot";
import type { ChatController } from "../app/chat-controller";
import { MAX_IMAGES } from "../llm/chat";
import { chatSnapshot, imageMediaType, type ChatState } from "./chat-wire";
import type { SessionServices } from "./session-context";
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

/** What the Chill chat needs from the core. */
export type ChillChatContext<C extends SessionServices> = {
  services: () => Promise<Result<C, BootFailure>>;
  notify: (notification: {
    jsonrpc: "2.0";
    method: string;
    params: Record<string, unknown>;
  }) => void;
};

/**
 * Chill chat: the tool-free, read-only conversation that is the app's home
 * (`docs/product.md` §3).
 *
 * One controller per process, loaded on first use. A turn streams as coalesced
 * `chat.state` frames and ends with exactly one of `chat.done` or `chat.error`;
 * a cancelled reply is discarded by the controller and never persisted. Nothing
 * on this path reads the vault, writes a note or calls a tool.
 */
export function createChillChatHandlers<C extends SessionServices>(
  ctx: ChillChatContext<C>,
): {
  handlers: {
    chatSnapshot: (id: RpcId) => Promise<JsonRpcResponse>;
    chatSend: (id: RpcId, params: Record<string, unknown>) => Promise<JsonRpcResponse>;
    chatCancel: (id: RpcId) => Promise<JsonRpcResponse>;
    chatClear: (id: RpcId) => Promise<JsonRpcResponse>;
  };
  /** Rebuild the controller after a model change (settings.patch owns the call). */
  rebuild: (current: C) => Promise<void>;
} {
  const { services, notify } = ctx;

  let chatLoaded = false;
  let chatUnsubscribe: (() => void) | null = null;
  let chatState: ChatState | null = null;
  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  let chatController: ChatController | null = null;
  let chatSeq = 0;

  /** The Chill stream's frame counter (see `chatSnapshot`). */
  const emitChat = (): void => {
    if (chatState === null || chatUnsubscribe === null) return;
    const controller = (chatController as ChatController | null);
    if (controller === null) return;
    chatSeq += 1;
    notify({
      jsonrpc: "2.0",
      method: "chat.state",
      params: chatSnapshot(chatState, controller.usage(), chatSeq),
    });
  };


  const scheduleChat = (state: ChatState): void => {
    chatState = state;
    if (chatTimer !== null) return;
    chatTimer = setTimeout(() => {
      chatTimer = null;
      emitChat();
    }, 33);
  };

  const ensureChat = async (current: C): Promise<ChatController | null> => {
    const controller = current.controller;
    if (!controller) return null;
    if (!chatLoaded) {
      await controller.load();
      chatLoaded = true;
    }
    if (chatUnsubscribe === null) {
      chatController = controller;
      chatUnsubscribe = controller.subscribe(scheduleChat);
    }
    return controller;
  };

  const chatSnapshotResponse = async (id: RpcId): Promise<JsonRpcResponse> => {
  const current = await services();
  if (!current.ok) return bootFailureResponse(id, current.error);
  const controller = await ensureChat(current.value);
  if (!controller) return failure(id, -32601, "Chat is not available in this build", undefined, false);
  return success(id, chatSnapshot(controller.state(), controller.usage(), chatSeq));
  };

  const chatSend = async (
    id: RpcId,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> => {
    const text = params.text;
    if (text !== undefined && typeof text !== "string") {
      return invalid(id, "chat.send text must be a string");
    }
    const requested = params.images;
    if (requested !== undefined && !Array.isArray(requested)) {
      return invalid(id, "chat.send images must be an array of image file paths");
    }
    const imagePaths: string[] = [];
    for (const entry of requested ?? []) {
      if (typeof entry !== "string" || entry.trim() === "") {
        return invalid(id, "chat.send images must be non-empty file paths");
      }
      imagePaths.push(entry);
    }
    if (imagePaths.length > MAX_IMAGES) {
      return invalid(id, `chat.send accepts at most ${MAX_IMAGES} images`);
    }
    // An image is content, so a text-less turn is a real request; text only
    // still has to say something.
    if ((text ?? "").trim() === "" && imagePaths.length === 0) {
      return invalid(id, "chat.send requires a non-empty text string");
    }
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const controller = await ensureChat(current.value);
    if (!controller) return failure(id, -32601, "Chat is not available in this build", undefined, false);
    for (const path of imagePaths) {
      const attached = controller.attachImage({
        path,
        name: basename(path),
        mediaType: imageMediaType(path),
        sha256: "",
      });
      if (!attached.ok) {
        const message = oneLine(attached.reason);
        return failure(id, BOOT_FAILED, message, { kind: "image", message }, false);
      }
    }
    void controller
      .send(text)
      .then((outcome) => {
        notify({ jsonrpc: "2.0", method: "chat.done", params: { ...outcome } });
      })
      .catch((error: unknown) => {
        notify({
          jsonrpc: "2.0",
          method: "chat.error",
          params: { message: oneLine(messageOf(error)) },
        });
      });
    return success(id, { turnId: "chill" });
  };

  const chatCancel = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const controller = await ensureChat(current.value);
    controller?.cancel();
    return success(id, { ok: true });
  };

  /**
   * `:clear` — empty the Chill transcript and its local history.
   *
   * The controller owns the rule: a streaming reply cannot be cleared from
   * under the stream, so it refuses and the shell shows the one sentence. The
   * write goes through the history port, and the cleared transcript is emitted
   * as a normal state frame.
   */
  const chatClear = async (id: RpcId): Promise<JsonRpcResponse> => {
    const current = await services();
    if (!current.ok) return bootFailureResponse(id, current.error);
    const controller = await ensureChat(current.value);
    if (!controller) {
      return failure(id, -32601, "Chat is not available in this build", undefined, false);
    }
    const cleared = controller.clearTranscript();
    if (!cleared.ok) {
      return failure(
        id,
        BOOT_FAILED,
        cleared.reason,
        { kind: "busy", context: "chat", message: cleared.reason },
        false,
      );
    }
    return success(id, { ok: true });
  };

  /** Rebuild the controller after a model change. */
  const rebuild = async (current: C): Promise<void> => {
    if (!current.createChat || !current.history) return;
    const next = current.createChat(current.history);
    (current as { controller?: ChatController }).controller = next;
    chatUnsubscribe?.();
    chatUnsubscribe = null;
    chatController = next;
    chatLoaded = false;
    await ensureChat(current);
  };

  return {
    handlers: {
      chatSnapshot: chatSnapshotResponse,
      chatSend,
      chatCancel,
      chatClear,
    },
    rebuild,
  };
}

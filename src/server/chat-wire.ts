import { basename } from "node:path";

import type { ChatController } from "../app/chat-controller";

export type ChatState = ReturnType<ChatController["state"]>;
export type ChatUsage = ReturnType<ChatController["usage"]>;

export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

export function imageMediaType(path: string): string {
  const leaf = basename(path)
  const dot = leaf.lastIndexOf(".")
  if (dot <= 0 || dot === leaf.length - 1) return "application/octet-stream"
  return IMAGE_MEDIA_TYPES[leaf.slice(dot + 1).toLowerCase()] ?? "application/octet-stream"
}

/**
 * One chat projection.
 *
 * `seq` is the stream's own monotonic counter: every snapshot and every state
 * event on that chat carries the same series, so a shell that receives an
 * older frame after a newer one (a reconnect, a coalesced flush racing a
 * request) can drop exactly the stale frame instead of overwriting the
 * transcript. A stream starts at 0 and increments once per emitted frame.
 */
/** One message in a chat snapshot (`chat.state`, `session.chat.state`, …). */
export type ChatMessageWire = {
  id: string;
  role: string;
  text: string;
  outcome: string | null;
};

/** The usage figures a chat snapshot carries. */
export type ChatUsageWire = {
  tokens: number;
  costMicroUsd: number | null;
  durationMs: number | null;
};

export type ChatBlockedWire = { reason: string; fix: string };

export type ChatErrorWire = { failed: string; kept: string; next: string };

/**
 * One chat projection. `seq` is the stream's frame number; the Flutter shell
 * tracks it separately and does not store it on its snapshot model.
 */
export type ChatSnapshotView = {
  seq: number;
  status: string;
  model: string | null;
  streamed: string;
  messages: ChatMessageWire[];
  blocked: ChatBlockedWire | null;
  error: ChatErrorWire | null;
  usage: ChatUsageWire;
};

export function chatSnapshot(
  state: ChatState,
  usage: ChatUsage,
  seq: number,
): Record<string, unknown> {
  const blocked: ChatBlockedWire | null = state.blocked ?? null;
  const error: ChatErrorWire | null = state.error ?? null;
  const snapshotUsage: ChatUsageWire = {
    tokens: usage.tokens,
    costMicroUsd: usage.costMicroUsd,
    durationMs: usage.durationMs,
  };
  return {
    seq,
    status: state.status,
    model: state.model,
    streamed: state.streamed,
    messages: state.messages.map(
      (message): ChatMessageWire => ({
        id: message.id,
        role: message.role,
        text: message.text,
        outcome: message.outcome ?? null,
      }),
    ),
    blocked,
    error,
    usage: snapshotUsage,
  } satisfies ChatSnapshotView;
}


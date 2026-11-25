/**
 * Compaction at the controller boundary: a stored summary replaces the messages
 * it covers, the recent turn stays, and a reader failure falls back to the full
 * history instead of failing the send.
 */
import { expect, test } from "bun:test";

import { createChatController } from "../../src/app/chat-controller";
import type { ChatRequest } from "../../src/llm/chat";
import type { HistoryRecord } from "../../src/app/chat-controller";

const HISTORY: HistoryRecord[] = Array.from({ length: 12 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `record ${index}`,
  at: "2026-11-24T10:00:00.000Z",
}));

function make(plan?: () => Promise<{ summary: string; through: number } | null>) {
  const seen: ChatRequest[] = [];
  const controller = createChatController({
    scope: "school",
    service: {
      active: () => [],
      cancel() {},
      async *send(request: ChatRequest) {
        seen.push(request);
        yield { type: "done", text: "ok", steps: [], usage: { input: 1, output: 1, total: 2 } };
      },
    } as never,
    budget: {
      check: () => ({ block: null, state: {} as never }),
      overrideOnce() {},
      key: () => "",
      isOverridden: () => false,
    },
    history: { load: async () => HISTORY, save: async () => {} },
    config: () => ({
      model: "openai/gpt-4.1-mini",
      maxToolCalls: 8,
      maxTokens: 1000,
      chillHistoryLimit: 20,
      mode: "lockin",
    }),
  });
  if (plan) controller.setContextPlan(plan);
  return { controller, seen };
}

function text(request: ChatRequest): string {
  return request.messages.map((message) => String(message.content)).join("\n");
}

test("a summary replaces the messages it covers and keeps the rest", async () => {
  const { controller, seen } = make(async () => ({
    summary: "the learner was working on registers",
    through: 4,
  }));
  await controller.load();
  await controller.send("a new question");

  const request = seen[0]!;
  expect(text(request)).toContain("the learner was working on registers");
  expect(text(request)).not.toContain("record 0");
  expect(text(request)).not.toContain("record 3");
  expect(text(request)).toContain("record 4");
  expect(text(request)).toContain("record 11");
  expect(text(request)).toContain("a new question");
  // The transcript itself is not touched by compaction.
  expect(controller.state().messages.map((message) => message.text)).toContain("record 0");
});

test("no summary sends the full history", async () => {
  const { controller, seen } = make();
  await controller.load();
  await controller.send("a new question");
  const body = text(seen[0]!);
  expect(body).toContain("record 0");
  expect(body).toContain("record 11");
});

test("a reader failure falls back to the full history, not a failed turn", async () => {
  const { controller, seen } = make(async () => {
    throw new Error("context.json is broken");
  });
  await controller.load();
  const outcome = await controller.send("still works");
  expect(outcome.kind).toBe("sent");
  expect(outcome.kind === "sent" ? outcome.outcome : null).toBe("done");
  expect(text(seen[0]!)).toContain("record 0");
});

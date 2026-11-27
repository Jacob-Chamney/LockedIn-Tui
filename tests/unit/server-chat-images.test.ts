/**
 * Chill image attachments (`docs/product.md` §3.1) at both seams.
 *
 * The shell may send up to four local image paths with `chat.send`; the core
 * records them on the controller and the controller maps them into
 * `ChatRequest.images`. Nothing here opens a file, calls a provider or touches
 * the network, so an unreadable image is the LLM layer's later typed error.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createChatController } from "../../src/app/chat-controller";
import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import type { ChatRequest } from "../../src/llm/chat";
import type { ChatEvent } from "../../src/llm/events";
import {
  createCoreServer,
  type CoreNotification,
  type CoreServices,
} from "../../src/server/protocol";

type Attached = { path: string; name: string; mediaType: string; sha256: string };
type Listener = (state: Record<string, unknown>) => void;

/**
 * A controller that records what the protocol asked it to do.
 *
 * `order` interleaves attaches and sends so a test can prove the images were
 * attached *before* the turn started, which is what the controller's `send`
 * reads.
 */
function fakeController(options: { refusePath?: string } = {}) {
  const order: string[] = [];
  const calls = { attached: [] as Attached[], send: [] as Array<string | undefined>, load: 0 };
  const listeners: Listener[] = [];
  let attachments: Attached[] = [];
  let state: Record<string, unknown> = {
    status: "idle",
    model: null,
    streamed: "",
    messages: [],
    attachments: [],
    blocked: null,
    error: null,
  };
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  const controller = {
    state: () => state,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe: (listener: Listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    load: async () => {
      calls.load += 1;
    },
    attachImage: (image: Attached) => {
      if (options.refusePath !== undefined && image.path === options.refusePath) {
        return { ok: false, reason: `${image.name} could not be attached` };
      }
      if (attachments.length >= 4) {
        return { ok: false, reason: "Up to 4 images per message." };
      }
      order.push(`attach:${image.path}`);
      calls.attached.push(image);
      attachments = [...attachments, image];
      state = { ...state, attachments };
      emit();
      return { ok: true, count: attachments.length };
    },
    send: async (text?: string) => {
      order.push(`send:${text ?? ""}`);
      calls.send.push(text);
      state = { ...state, attachments: [] };
      attachments = [];
      emit();
      return { kind: "sent", requestId: "r1", outcome: "done" };
    },
    cancel: () => {},
  } as unknown as NonNullable<CoreServices["controller"]>;
  return { controller, calls, order };
}

function makeServer(
  controller: NonNullable<CoreServices["controller"]>,
  notifications: CoreNotification[] = [],
) {
  const services = {
    workspace: { root: join(tmpdir(), "lockedin-images-ws"), paths: { schoolSessions: join(tmpdir(), "none") } },
    settings: {
      username: "friend",
      theme: "lockedin",
      chatModel: "openai/gpt-4.1-mini",
      baseUrl: "",
      maxToolCalls: 8,
      maxTokensPerRequest: 16000,
      budgetUsd: 0,
      period: "day",
      warnAt: 0.8,
      pauseAtLimit: false,
      dataDir: join(tmpdir(), "lockedin-images-data"),
      archiveBackend: "folder",
      archiveFolder: "",
      archiveGithubRepo: "",
      archiveGithubBranch: "main",
      archiveGithubConsent: false,
      historyLimit: 20,
      responseStyle: "normal",
      tutorPolicy: "direct",
      pluginServers: [],
      hideHints: false,
      pluginDirs: [],
      disabledPlugins: [],
    },
    controller,
  } as unknown as CoreServices;
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
    notify: (notification) => notifications.push(notification),
  });
}

function req(id: number, method: string, params?: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function stubBudget() {
  return {
    check: () => ({ block: null, state: {} as never }),
    overrideOnce() {},
    key: () => "",
    isOverridden: () => false,
  };
}

/** A controller whose service records the request and completes at once. */
function recordingController() {
  const requests: ChatRequest[] = [];
  const controller = createChatController({
    scope: "school",
    service: {
      active: () => [],
      cancel() {},
      async *send(request: ChatRequest): AsyncGenerator<ChatEvent> {
        requests.push(request);
        yield { type: "done", text: "ok", steps: ["ok"], usage: { input: 1, output: 1, total: 2 }, durationMs: 1 };
      },
    },
    budget: stubBudget(),
    history: { load: async () => [], save: async () => {} },
    config: () => ({
      model: "openai/gpt-4.1-mini",
      maxToolCalls: 4,
      maxTokens: 100,
      chillHistoryLimit: 20,
    }),
  });
  return { controller, requests };
}

describe("chat.send images", () => {
  test("attaches every path before the turn starts", async () => {
    const { controller, calls, order } = fakeController();
    const server = makeServer(controller);

    const response = await server.handle(
      req(1, "chat.send", { text: "what is this?", images: ["/tmp/shot.png", "/tmp/diagram.JPG"] }),
    );

    expect(response).toMatchObject({ id: 1, result: { turnId: "chill" } });
    expect(calls.attached).toEqual([
      { path: "/tmp/shot.png", name: "shot.png", mediaType: "image/png", sha256: "" },
      { path: "/tmp/diagram.JPG", name: "diagram.JPG", mediaType: "image/jpeg", sha256: "" },
    ]);
    // Attach, attach, send — never send first and attach later.
    expect(order).toEqual(["attach:/tmp/shot.png", "attach:/tmp/diagram.JPG", "send:what is this?"]);
  });

  test("the media type comes from the extension, never from the bytes", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller);

    // None of these files exist; attachImage must not open them.
    const response = await server.handle(
      req(1, "chat.send", {
        text: "look",
        images: ["/tmp/a.webp", "/tmp/b.gif", "/tmp/c.tiff", "/tmp/d"],
      }),
    );

    expect(response).toMatchObject({ id: 1, result: { turnId: "chill" } });
    expect(calls.attached.map((image) => image.mediaType)).toEqual([
      "image/webp",
      "image/gif",
      "application/octet-stream",
      "application/octet-stream",
    ]);
  });

  test("more than four images is an invalid request and attaches nothing", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller);

    const response = await server.handle(
      req(2, "chat.send", {
        text: "too many",
        images: ["/a.png", "/b.png", "/c.png", "/d.png", "/e.png"],
      }),
    );

    expect(response).toMatchObject({ id: 2, error: { code: -32602 } });
    expect(calls.attached).toEqual([]);
    expect(calls.send).toEqual([]);
    expect(calls.load).toBe(0);
  });

  test("an empty message is allowed when an image is attached", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller);

    const response = await server.handle(req(3, "chat.send", { text: "", images: ["/tmp/shot.png"] }));

    expect(response).toMatchObject({ id: 3, result: { turnId: "chill" } });
    expect(calls.attached).toHaveLength(1);
    expect(calls.send).toEqual([""]);
  });

  test("text-only is unchanged: no attach, same send", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller);

    const response = await server.handle(req(4, "chat.send", { text: "hello" }));

    expect(response).toMatchObject({ id: 4, result: { turnId: "chill" } });
    expect(calls.attached).toEqual([]);
    expect(calls.send).toEqual(["hello"]);
  });

  test("a refused image is one typed failure and starts no turn", async () => {
    const { controller, calls } = fakeController({ refusePath: "/tmp/broken.png" });
    const server = makeServer(controller);

    const response = await server.handle(
      req(5, "chat.send", { text: "look", images: ["/tmp/broken.png"] }),
    );

    expect(response).toMatchObject({
      id: 5,
      error: {
        code: -32000,
        message: "broken.png could not be attached",
        retryable: false,
        data: { kind: "image", message: "broken.png could not be attached" },
      },
    });
    expect(calls.send).toEqual([]);
  });

  test("malformed image lists are invalid params, before any boot", async () => {
    const { controller, calls } = fakeController();
    const server = makeServer(controller);
    const cases: Array<Record<string, unknown>> = [
      { text: "x", images: "shot.png" },
      { text: "x", images: [1] },
      { text: "x", images: [""] },
      { text: "x", images: ["   "] },
      { text: 42 },
      {},
    ];
    for (const [index, params] of cases.entries()) {
      const response = await server.handle(req(10 + index, "chat.send", params));
      expect(response).toMatchObject({ id: 10 + index, error: { code: -32602 } });
    }
    expect(calls.attached).toEqual([]);
    expect(calls.send).toEqual([]);
    expect(calls.load).toBe(0);
  });
});

describe("controller attachImage", () => {
  test("caps the composer at four images and reports the count", async () => {
    const { controller } = recordingController();

    for (let index = 0; index < 4; index++) {
      const attached = controller.attachImage({
        path: `/tmp/${index}.png`,
        name: `${index}.png`,
        mediaType: "image/png",
      });
      expect(attached).toEqual({ ok: true, count: index + 1 });
    }
    const fifth = controller.attachImage({ path: "/tmp/4.png", name: "4.png", mediaType: "image/png" });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.reason).toContain("Up to 4 images");
    expect(controller.state().attachments).toHaveLength(4);
  });

  test("refuses a blank path without attaching anything", async () => {
    const { controller } = recordingController();

    const result = controller.attachImage({ path: "   ", name: "shot.png", mediaType: "image/png" });

    expect(result).toEqual({ ok: false, reason: "an image needs a file path" });
    expect(controller.state().attachments).toEqual([]);
  });

  test("refuses while a reply is streaming", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createChatController({
      scope: "school",
      service: {
        active: () => [],
        cancel() {},
        async *send(): AsyncGenerator<ChatEvent> {
          yield { type: "text", delta: "…" };
          await gate;
          yield { type: "done", text: "…", steps: [], usage: { input: 1, output: 1, total: 2 }, durationMs: 1 };
        },
      },
      budget: stubBudget(),
      history: { load: async () => [], save: async () => {} },
      config: () => ({
        model: "openai/gpt-4.1-mini",
        maxToolCalls: 4,
        maxTokens: 100,
        chillHistoryLimit: 20,
      }),
    });

    const run = controller.send("look");
    expect(controller.state().status).toBe("streaming");
    const refused = controller.attachImage({ path: "/tmp/shot.png", name: "shot.png", mediaType: "image/png" });
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.reason).toContain("streaming");
    expect(controller.state().attachments).toEqual([]);

    release();
    expect(await run).toMatchObject({ kind: "sent", outcome: "done" });
  });

  test("send maps the attached paths into the request images", async () => {
    const { controller, requests } = recordingController();
    controller.attachImage({ path: "/tmp/shot.png", name: "shot.png", mediaType: "image/png" });
    controller.attachImage({ path: "/tmp/diagram.jpg", name: "diagram.jpg", mediaType: "image/jpeg" });

    const outcome = await controller.send("what is this?");

    expect(outcome).toMatchObject({ kind: "sent", outcome: "done" });
    expect(requests).toHaveLength(1);
    expect(requests[0].images).toEqual([
      { path: "/tmp/shot.png", name: "shot.png", mediaType: "image/png", sha256: "" },
      { path: "/tmp/diagram.jpg", name: "diagram.jpg", mediaType: "image/jpeg", sha256: "" },
    ]);
    // A completed turn consumes the chips, exactly like text.
    expect(controller.state().attachments).toEqual([]);
  });
});

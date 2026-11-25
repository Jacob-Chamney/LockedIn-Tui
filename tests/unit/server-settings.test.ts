/** Provider linking and settings patches over the JSON-RPC core. */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BootFailure } from "../../src/app/boot";
import type { Result } from "../../src/domain/markdown";
import type { SettingsView } from "../../src/types/settings";
import {
  createCoreServer,
  type CoreServices,
} from "../../src/server/protocol";

function view(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    username: "friend",
    theme: "lockedin",
    chatModel: "",
    baseUrl: "",
    maxToolCalls: 8,
    maxTokensPerRequest: 16000,
    responseStyle: "normal",
    tutorPolicy: "direct",
    budgetUsd: 0,
    period: "day",
    warnAt: 0.8,
    pauseAtLimit: false,
    dataDir: join(tmpdir(), "lockedin-settings-data"),
    archiveBackend: "folder",
    archiveFolder: "",
    historyLimit: 20,
    pluginServers: [],
    hideHints: false,
    pluginDirs: [],
    disabledPlugins: [],
    ...overrides,
  };
}

function controller(model: string | null = null) {
  const state = {
    status: "idle",
    model,
    streamed: "",
    messages: [],
    blocked: null,
    error: null,
  };
  return {
    state: () => state,
    usage: () => ({ tokens: 0, costMicroUsd: null, durationMs: null }),
    subscribe: () => () => {},
    load: async () => {},
    send: async () => ({ kind: "no-model", reason: "no model", fix: "link" }),
    cancel: () => {},
  } as unknown as NonNullable<CoreServices["controller"]>;
}

function makeServices() {
  let current = view();
  const calls = {
    link: [] as Array<{ providerId: string; key: string; baseUrl?: string }>,
    saved: [] as Array<Record<string, unknown>>,
    built: [] as string[],
  };
  const services = {
    workspace: {
      root: join(tmpdir(), "lockedin-settings-ws"),
      paths: { schoolSessions: join(tmpdir(), "none") },
    },
    settings: current,
    controller: controller(),
    history: {} as CoreServices["history"],
    createChat: (() => {
      calls.built.push("controller");
      return controller("openai/gpt-4.1-mini");
    }) as CoreServices["createChat"],
    linkProvider: (async (input: { providerId: string; key: string; baseUrl?: string }) => {
      calls.link.push(input);
      if (input.key === "bad") {
        return {
          ok: false as const,
          error: { kind: "auth" as const, provider: input.providerId, message: "the provider rejected the key" },
        };
      }
      return {
        ok: true as const,
        value: {
          providerId: input.providerId,
          models: ["gpt-4.1-mini", "gpt-4.1"],
          modelSelected: null as null,
          requests: 1 as const,
          secretRef: `lockedin/${input.providerId}`,
        },
      };
    }) as CoreServices["linkProvider"],
    linkedProviders: async () => ["openai"],
    saveConfig: async (patch: Record<string, unknown>) => {
      calls.saved.push(patch);
      if (patch.models && typeof patch.models === "object") {
        const models = patch.models as Record<string, unknown>;
        if (typeof models.chat === "string") current = { ...current, chatModel: models.chat };
      }
      return { ok: true as const, value: current };
    },
  } as unknown as CoreServices;
  return { services, calls };
}

function makeServer(services: CoreServices) {
  return createCoreServer({
    boot: async () => ({ ok: true, value: services }) as Result<CoreServices, BootFailure>,
  });
}

describe("provider and settings methods", () => {
  test("provider.list names every catalogue entry and the linked ones", async () => {
    const { services } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "provider.list" });
    expect(response).toMatchObject({ id: 1, result: { linked: ["openai"] } });
    const providers = (response as unknown as { result: { providers: Array<{ id: string; linked: boolean }> } }).result.providers;
    expect(providers.map((entry) => entry.id)).toContain("openai");
    expect(providers.map((entry) => entry.id)).toContain("custom");
    expect(providers.find((entry) => entry.id === "openai")?.linked).toBe(true);
    expect(providers.find((entry) => entry.id === "anthropic")?.linked).toBe(false);
  });

  test("provider.link forwards the key and returns the models, never selecting one", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "provider.link",
      params: { providerId: "custom", key: "local-placeholder", baseUrl: "http://localhost:11434/v1" },
    });
    expect(response).toMatchObject({
      id: 2,
      result: { providerId: "custom", models: ["gpt-4.1-mini", "gpt-4.1"], modelSelected: null, requests: 1 },
    });
    expect(calls.link).toEqual([
      { providerId: "custom", key: "local-placeholder", baseUrl: "http://localhost:11434/v1" },
    ]);
  });

  test("a rejected key is one typed error, not a saved setting", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "provider.link",
      params: { providerId: "openai", key: "bad" },
    });
    expect(response).toMatchObject({
      id: 3,
      error: { code: -32000, message: "the provider rejected the key", data: { kind: "auth" } },
    });
    expect(calls.saved).toEqual([]);
  });

  test("provider.link rejects an unknown provider without calling the network", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "provider.link",
      params: { providerId: "nope", key: "whatever" },
    });
    expect(response).toMatchObject({ id: 4, error: { code: -32602 } });
    expect(calls.link).toEqual([]);
  });

  test("settings.patch persists, updates the view and rebuilds the chat controller", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "settings.patch",
      params: { patch: { models: { chat: "openai/gpt-4.1-mini" } } },
    });
    expect(response).toMatchObject({ id: 5, result: { chatModel: "openai/gpt-4.1-mini" } });
    expect(calls.saved).toEqual([{ models: { chat: "openai/gpt-4.1-mini" } }]);
    expect(calls.built).toHaveLength(1);

    const get = await server.handle({ jsonrpc: "2.0", id: 6, method: "settings.get" });
    expect(get).toMatchObject({ id: 6, result: { chatModel: "openai/gpt-4.1-mini" } });
    const info = await server.handle({ jsonrpc: "2.0", id: 7, method: "workspace.info" });
    expect(info).toMatchObject({
      id: 7,
      result: { configured: true, model: "openai/gpt-4.1-mini", provider: "openai" },
    });
  });

  test("settings.patch refuses a non-object patch", async () => {
    const { services, calls } = makeServices();
    const server = makeServer(services);
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 8,
      method: "settings.patch",
      params: { patch: [] },
    });
    expect(response).toMatchObject({ id: 8, error: { code: -32602 } });
    expect(calls.saved).toEqual([]);
  });
});

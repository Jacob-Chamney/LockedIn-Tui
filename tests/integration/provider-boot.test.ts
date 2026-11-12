/**
 * Provider glue + boot wiring (WP-813).
 *
 * Two halves: the refusal table for `createProviderService`, and one real turn
 * through `boot()` against a local fake OpenAI-compatible server. No external
 * network, no real key.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProviderService, modelNameOf, type ProviderService } from "../../src/llm/provider"
import { boot } from "../../src/app/boot"
import { patchConfig } from "../../src/storage/config"

const FAKE_KEY = "sk-spike-0123456789abcdef0123456789abcdef"

type LogEntry = { model: string; messages: unknown[] }
const log: LogEntry[] = []

function sse(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const payload = (await req.json().catch(() => ({}))) as { model?: string; messages?: unknown[] }
    log.push({ model: payload.model ?? "", messages: payload.messages ?? [] })
    const parts = [
      sse({ role: "assistant" }),
      sse({ content: "hello from " }),
      sse({ content: "the fake" }),
      sse({}, "stop"),
      `data: ${JSON.stringify({
        id: "chatcmpl-fake",
        object: "chat.completion.chunk",
        created: 0,
        model: "fake",
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ]
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (const part of parts) {
            await new Promise((resolve) => setTimeout(resolve, 1))
            controller.enqueue(encoder.encode(part))
          }
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

const baseUrl = `http://127.0.0.1:${server.port}/v1`

afterAll(() => {
  server.stop(true)
})

function reader(key: string | null) {
  const calls: string[] = []
  return {
    calls,
    readKey: async (ref: string) => {
      calls.push(ref)
      return key
    },
  }
}

const refusal = (result: ProviderService) => (result.ok ? "ok" : result.reason)

describe("provider refusal table", () => {
  test("no provider prefix is refused by name", async () => {
    const key = reader(FAKE_KEY)
    const result = await createProviderService({
      providerId: "",
      model: "gpt-4.1-mini",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("no-model-prefix")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("no provider")
    // No key is read for a request that cannot be built.
    expect(key.calls).toEqual([])
  })

  test("a remote base URL must use https", async () => {
    const key = reader(FAKE_KEY)
    const result = await createProviderService({
      providerId: "custom",
      model: "custom/llama3.2",
      baseUrl: "http://api.example.com/v1",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("insecure-base-url")
    expect(key.calls).toEqual([])
  })

  test("an unknown provider is refused", async () => {
    const key = reader(FAKE_KEY)
    const result = await createProviderService({
      providerId: "mystery",
      model: "mystery/model-x",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("unknown-provider")
    expect(key.calls).toEqual([])
  })

  test("a native-wire provider is refused rather than spoken to wrongly", async () => {
    const key = reader(FAKE_KEY)
    const result = await createProviderService({
      providerId: "anthropic",
      model: "anthropic/claude-sonnet-4-5",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("unsupported-wire")
    expect(key.calls).toEqual([])
  })

  test("a custom provider with no base URL is refused", async () => {
    const key = reader(null)
    const result = await createProviderService({
      providerId: "custom",
      model: "custom/some-model",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("missing-base-url")
  })

  test("a missing key is refused, and the key is read exactly once", async () => {
    const key = reader(null)
    const result = await createProviderService({
      providerId: "openai",
      model: "openai/gpt-4.1-mini",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(refusal(result)).toBe("missing-key")
    expect(key.calls).toEqual(["lockedin/openai"])
    if (!result.ok) {
      // The message names the provider, never a secret.
      expect(result.message).toContain("OpenAI")
      expect(result.message).not.toContain(FAKE_KEY)
    }
  })

  test("a linked key plus a known provider returns a service", async () => {
    const key = reader(FAKE_KEY)
    const result = await createProviderService({
      providerId: "openai",
      model: "openai/gpt-4.1-mini",
      baseUrl: "",
      readKey: key.readKey,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelName).toBe("gpt-4.1-mini")
      expect(typeof result.service.send).toBe("function")
    }
    // Read once, at most.
    expect(key.calls).toEqual(["lockedin/openai"])
  })

  test("a loopback base URL needs no key and reads none", async () => {
    const key = reader(null)
    const result = await createProviderService({
      providerId: "custom",
      model: "custom/llama-local",
      baseUrl,
      readKey: key.readKey,
    })
    expect(result.ok).toBe(true)
    expect(key.calls).toEqual([])
  })

  test("modelNameOf strips only the provider prefix", () => {
    expect(modelNameOf("openai/gpt-4.1-mini")).toBe("gpt-4.1-mini")
    expect(modelNameOf("openrouter/anthropic/claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5")
    expect(modelNameOf("bare-model")).toBe("bare-model")
  })
})

describe("boot wiring", () => {
  async function bootWithModel(overrides: { model: string; baseUrl?: string; key?: string | null }) {
    // A non-existent path: boot creates the workspace, but refuses to adopt an empty folder.
    const root = join(mkdtempSync(join(tmpdir(), "boot-")), "ws")
    const dataDir = mkdtempSync(join(tmpdir(), "boot-data-"))
    const first = await boot({ workspaceRoot: root, dataDir })
    if (!first.ok) throw new Error(`boot failed: ${first.error.message}`)

    // Configure the model the way Settings would.
    const patched = await patchConfig(first.value.workspace.paths, {
      models: { chat: overrides.model, base_url: overrides.baseUrl ?? "" },
    })
    if (!patched.ok) throw new Error(`patch failed: ${patched.error.message}`)

    const keyCalls: string[] = []
    const second = await boot({
      workspaceRoot: root,
      dataDir,
      readKey: async (ref) => {
        keyCalls.push(ref)
        return overrides.key ?? null
      },
    })
    if (!second.ok) throw new Error(`boot failed: ${second.error.message}`)
    return { booted: second.value, keyCalls, root }
  }

  test("a configured loopback model produces a controller that sends", async () => {
    const before = log.length
    const { booted } = await bootWithModel({ model: "custom/local-model", baseUrl })

    const outcome = await booted.controller.send("hello there")
    expect(outcome.kind).toBe("sent")
    if (outcome.kind === "sent") expect(outcome.outcome).toBe("done")

    const state = booted.controller.state()
    const assistant = state.messages.at(-1)
    expect(assistant?.text).toBe("hello from the fake")

    expect(log.length - before).toBe(1)
    expect(log.at(-1)!.model).toBe("local-model")
    // Usage was persisted with the configured scope.
    const usage = JSON.parse(readFileSync(join(booted.workspace.paths.dataDir, "usage.json"), "utf8"))
    expect(usage.runs).toHaveLength(1)
    expect(usage.runs[0].model).toBe("custom/local-model")
  })

  test("a keyed provider with no key still boots and refuses to send", async () => {
    // No base URL override: the glue asks the keychain once, finds nothing, and
    // reports the blocked state. Nothing is sent, so no network is touched.
    const { booted, keyCalls } = await bootWithModel({ model: "openai/gpt-4.1-mini", key: null })

    expect(keyCalls).toEqual(["lockedin/openai"])
    const outcome = await booted.controller.send("hello")
    expect(outcome.kind).toBe("no-model")
  })

  test("a loopback base URL needs no key but still produces a working controller", async () => {
    const { booted, keyCalls } = await bootWithModel({
      model: "openai/gpt-4.1-mini",
      baseUrl,
      key: FAKE_KEY,
    })
    // Local endpoint: the key is never read, not even to be ignored.
    expect(keyCalls).toEqual([])
    const outcome = await booted.controller.send("hello")
    expect(outcome.kind).toBe("sent")
  })

  test("no model still boots and reports no model configured", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "boot-empty-")), "ws")
    const dataDir = mkdtempSync(join(tmpdir(), "boot-empty-data-"))
    const booted = await boot({ workspaceRoot: root, dataDir, readKey: async () => FAKE_KEY })
    expect(booted.ok).toBe(true)
    if (!booted.ok) return

    const outcome = await booted.value.controller.send("hello")
    expect(outcome.kind).toBe("no-model")
    if (outcome.kind === "no-model") expect(outcome.reason).toContain("no model configured")
  })
})

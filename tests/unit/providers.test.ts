/**
 * Provider catalogue, local format check and link/unlink flow (WP-201).
 *
 * No network here: `fetch` is injected, so the unit layer stays deterministic
 * (`docs/testing.md` §1). The live path is in the contract suite.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SecretResult } from "../../src/security/secret-store"
import { createMemorySecretStore } from "../contract/fakes/memory-secret-store"
import {
  checkKeyFormat,
  getProvider,
  keyShapeHint,
  listFirstClassProviders,
  listProviders,
  providersRequiringKey,
  resolveBaseUrl,
  resolveDiscoveryBaseUrl,
} from "../../src/llm/catalogue"
import { CUSTOM_PROVIDER_ID, providerIdOfModel, transportHeaders, type ProviderSpec } from "../../src/llm/provider-spec"
import { mapProviderError } from "../../src/llm/stream"
import {
  keyErrorCopy,
  linkProviderKey,
  unlinkConfirmation,
  unlinkProviderKey,
  validateKeyOnce,
  type LlmError,
} from "../../src/llm/validate"

const ROOT = join(import.meta.dir, "..", "..")
const OK_KEY = "sk-spike-0123456789abcdef0123456789abcdef"

function spec(id: string): ProviderSpec {
  const found = getProvider(id)
  if (!found) throw new Error(`missing provider ${id}`)
  return found
}

/** A fetch that answers one `/models` request and counts calls. */
function fakeFetch(models: string[]) {
  const calls: string[] = []
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return Response.json({ data: models.map((id) => ({ id })) })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe("catalogue", () => {
  test("lists the first-class providers plus custom, as data", () => {
    expect(listProviders()).toHaveLength(7)
    expect(listFirstClassProviders().map((p) => p.id)).toEqual([
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "opencode-zen",
      "opencode-go",
    ])
    expect(getProvider(CUSTOM_PROVIDER_ID)?.keyRequired).toBe(false)
    expect(getProvider(CUSTOM_PROVIDER_ID)?.baseUrl).toBe("")
    expect(providersRequiringKey().map((p) => p.id)).not.toContain(CUSTOM_PROVIDER_ID)

    for (const provider of listProviders()) {
      expect(provider.label.length).toBeGreaterThan(0)
      expect(["openai-compatible", "native"]).toContain(provider.wire)
      expect(["bearer", "x-api-key", "google-api-key"]).toContain(provider.auth)
      expect(["models-endpoint", "probe-completion"]).toContain(provider.discovery.kind)
      if (provider.keyRequired) expect(provider.keyFormat).not.toBeNull()
    }
  })

  test("importing the catalogue performs no network call and reads no secret", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input))
      return Promise.reject(new Error("network is forbidden at import time"))
    }) as unknown as typeof fetch
    try {
      // A fresh module instance: import side effects would run now.
      const fresh = await import(`../../src/llm/catalogue.ts?fresh=${Date.now()}`)
      fresh.listProviders()
      fresh.listFirstClassProviders()
      fresh.providersRequiringKey()
      fresh.getProvider("openai")
      fresh.checkKeyFormat(fresh.getProvider("openai")!, OK_KEY)
      fresh.keyShapeHint(fresh.getProvider("anthropic")!)
    } finally {
      globalThis.fetch = original
    }
    expect(calls).toEqual([])

    // The data modules cannot reach the network or the keychain at all.
    for (const file of ["catalogue.ts", "provider-spec.ts"]) {
      const source = readFileSync(join(ROOT, "src", "llm", file), "utf8")
      expect(source).not.toMatch(/\bfetch\(|node:fs|Bun\.spawn|secret-store|SecretStore/)
    }
  })

  test("resolveBaseUrl trims slashes and honours the custom override", () => {
    expect(resolveBaseUrl(spec("openai"))).toBe("https://api.openai.com/v1")
    expect(resolveBaseUrl(spec("openai"), "http://localhost:11434/v1/")).toBe("http://localhost:11434/v1")
    expect(resolveBaseUrl(spec(CUSTOM_PROVIDER_ID))).toBe("")
    expect(keyShapeHint(spec("openai"))).toContain("sk-")
    expect(keyShapeHint(spec(CUSTOM_PROVIDER_ID))).toContain("Optional")
  })

  test("providerIdOfModel reads the prefix, or null", () => {
    expect(providerIdOfModel("openai/gpt-4.1-mini")).toBe("openai")
    expect(providerIdOfModel("claude-sonnet-4-5")).toBeNull()
  })
})

describe("local key format check", () => {
  test("accepts plausible shapes and rejects the rest without echoing the value", () => {
    const cases: [string, string[]][] = [
      ["openai", ["sk-spike-" + "a".repeat(24), "sk-proj-" + "b".repeat(24)]],
      ["anthropic", ["sk-ant-spike-" + "a".repeat(16)]],
      ["google", ["AIza" + "a".repeat(35)]],
      ["openrouter", ["sk-or-v1-" + "a".repeat(32)]],
      ["opencode-zen", ["opencode-zen-placeholder-000000"]],
      ["opencode-go", ["opencode-spike-placeholder-000000"]],
    ]

    for (const [id, good] of cases) {
      const provider = spec(id)
      for (const value of good) {
        expect({ id, value: checkKeyFormat(provider, value) }).toEqual({ id, value: { ok: true } })
      }
      for (const value of ["https://example.com/key", "user@example.com", "not-a-key", "sk- short"]) {
        const result = checkKeyFormat(provider, value)
        expect({ id, value, ok: result.ok }).toEqual({ id, value, ok: false })
        if (!result.ok) {
          // Fixed shape, and the rejected value is never echoed back.
          expect(result.message).not.toContain(value.trim())
          expect(result.message).toMatch(/expected /)
        }
      }
    }
  })

  test("custom endpoints may be keyless, but a supplied key must be plausible", () => {
    const custom = spec(CUSTOM_PROVIDER_ID)
    expect(checkKeyFormat(custom, "")).toEqual({ ok: true })
    expect(checkKeyFormat(custom, "local-placeholder").ok).toBe(true)
    expect(checkKeyFormat(custom, "has space").ok).toBe(false)
  })

  test("an empty required key names the provider and its shape", () => {
    const result = checkKeyFormat(spec("anthropic"), "")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("Anthropic")
      expect(result.message).toContain("sk-ant-")
    }
  })
})

describe("link flow", () => {
  test("a malformed key is rejected locally with zero requests and nothing stored", async () => {
    const store = createMemorySecretStore()
    const { impl, calls } = fakeFetch(["gpt-4.1-mini"])
    const result = await linkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      key: "https://example.com/not-a-key",
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("config")
    expect(calls).toEqual([])
    expect(store.entries.size).toBe(0)
  })

  test("a good key is validated once, stored once, and selects no model", async () => {
    const store = createMemorySecretStore()
    const { impl, calls } = fakeFetch(["gpt-4.1-mini", "gpt-4.1"])
    const result = await linkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      key: OK_KEY,
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.modelSelected).toBeNull()
      expect(result.value.models).toEqual(["gpt-4.1-mini", "gpt-4.1"])
      expect(result.value.secretRef).toBe("lockedin/openai")
      expect(result.value.requests).toBe(1)
    }
    expect(calls).toHaveLength(1)
    expect(store.entries.get("lockedin/openai")).toBe(OK_KEY)
  })

  test("no keychain backend aborts before any request and stores nothing", async () => {
    const store = createMemorySecretStore({ mode: "unavailable" })
    const { impl, calls } = fakeFetch(["gpt-4.1-mini"])
    const result = await linkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      key: OK_KEY,
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === "keychain") expect(result.error.hint).toContain("not saved")
    expect(calls).toEqual([])
    expect(store.entries.size).toBe(0)
  })

  test("a locked keychain on write is reported with its own hint", async () => {
    const store = createMemorySecretStore()
    const { impl } = fakeFetch(["gpt-4.1-mini"])
    store.set = async (): Promise<SecretResult<void>> => ({
      ok: false,
      error: { kind: "locked", backend: "memory", message: "lock state", hint: "Unlock the keychain and retry." },
    })
    const result = await linkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      key: OK_KEY,
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === "keychain") expect(result.error.hint).toContain("Unlock")
  })

  test("a keyless custom endpoint links without storing anything", async () => {
    const store = createMemorySecretStore()
    const { impl, calls } = fakeFetch(["llama3.2"])
    const result = await linkProviderKey({
      providerId: CUSTOM_PROVIDER_ID,
      spec: spec(CUSTOM_PROVIDER_ID),
      baseUrl: "http://localhost:11434/v1",
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.modelSelected).toBeNull()
    expect(calls).toHaveLength(1)
    expect(store.entries.size).toBe(0)
  })

  test("a model the provider does not list is refused by name", async () => {
    const store = createMemorySecretStore()
    const { impl } = fakeFetch(["gpt-4.1-mini"])
    const result = await linkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      key: OK_KEY,
      model: "gpt-9-imaginary",
      store,
      fetchImpl: impl,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === "provider") expect(result.error.message).toContain("gpt-9-imaginary")
    expect(store.entries.size).toBe(0)
  })
})

describe("unlink", () => {
  test("confirmation names the provider and is required", async () => {
    const store = createMemorySecretStore()
    await store.set("openai", OK_KEY)
    expect(unlinkConfirmation(spec("openai"))).toContain("OpenAI")

    const refused = await unlinkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      store,
      confirmed: false,
      selectedModel: "openai/gpt-4.1-mini",
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.kind).toBe("config")
    expect(store.entries.get("lockedin/openai")).toBe(OK_KEY)
  })

  test("confirmed unlink removes the key and clears a matching selection", async () => {
    const store = createMemorySecretStore()
    await store.set("openai", OK_KEY)
    const cleared = await unlinkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      store,
      confirmed: true,
      selectedModel: "openai/gpt-4.1-mini",
    })
    expect(cleared.ok && cleared.value.selectionCleared).toBe(true)
    expect(store.entries.size).toBe(0)
  })

  test("a selection from another provider is kept", async () => {
    const store = createMemorySecretStore()
    await store.set("openai", OK_KEY)
    const kept = await unlinkProviderKey({
      providerId: "openai",
      spec: spec("openai"),
      store,
      confirmed: true,
      selectedModel: "anthropic/claude-sonnet-4-5",
    })
    expect(kept.ok && kept.value.selectionCleared).toBe(false)
  })
})

describe("error copy", () => {
  test("one mapping covers every failure with a title and a next step", () => {
    const errors: LlmError[] = [
      { kind: "config", message: "that does not look like a OpenAI key (expected sk-…)" },
      { kind: "auth", provider: "openai", message: "rejected" },
      { kind: "rate-limit", provider: "openai", retryAfter: 30 },
      { kind: "network", message: "unreachable" },
      { kind: "provider", provider: "openai", status: 500, message: "OpenAI returned 500: boom" },
      { kind: "keychain", provider: "openai", message: "locked", hint: "Unlock it and retry." },
    ]
    for (const error of errors) {
      const copy = keyErrorCopy(error)
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.next.length).toBeGreaterThan(0)
    }
    expect(keyErrorCopy(errors[2]!).next).toContain("30s")
    expect(keyErrorCopy(errors[1]!).next).toContain("Settings → Providers")
  })
})


describe("OpenCode endpoints", () => {
  test("Go chats through /go/openai/v1 and discovers models through /go/v1", () => {
    const spec = getProvider("opencode-go")
    expect(spec?.baseUrl).toBe("https://opencode.ai/inference/go/openai/v1")
    expect(spec?.discovery).toEqual({
      kind: "models-endpoint",
      path: "/models",
      baseUrl: "https://opencode.ai/inference/go/v1",
    })
    expect(resolveDiscoveryBaseUrl(spec!)).toBe("https://opencode.ai/inference/go/v1")
  })

  test("Zen chats through /openai/v1 and discovers models through /v1", () => {
    const spec = getProvider("opencode-zen")
    expect(spec?.baseUrl).toBe("https://opencode.ai/inference/openai/v1")
    expect(spec?.discovery).toEqual({
      kind: "models-endpoint",
      path: "/models",
      baseUrl: "https://opencode.ai/inference/v1",
    })
    expect(resolveDiscoveryBaseUrl(spec!)).toBe("https://opencode.ai/inference/v1")
  })
})


describe("OpenCode model discovery", () => {
  test("discovers from the catalogue URL and hides models this client cannot call", async () => {
    const calls: string[] = []
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({
        data: [
          { id: "kimi-k3", api: { "chat-completions": { base_url: "x" } } },
          { id: "glm-5.3", api: { "chat-completions": { base_url: "x" } } },
          { id: "gpt-6.1-sol", api: { responses: { base_url: "x" } } },
          { id: "claude-sonnet-5-5", api: { messages: { base_url: "x" } } },
        ],
      })
    }) as unknown as typeof fetch

    const result = await validateKeyOnce({
      spec: spec("opencode-go"),
      key: "opencode-spike-placeholder-000000",
      fetchImpl: impl,
    })
    expect(calls).toEqual(["https://opencode.ai/inference/go/v1/models"])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.models).toEqual(["kimi-k3", "glm-5.3"])
  })
})


describe("OpenCode routing headers", () => {
  test("OpenCode requests carry a stable session id; other providers carry none", () => {
    expect(transportHeaders(spec("opencode-go"), "session-1")).toMatchObject({
      "x-opencode-session": "session-1",
      "user-agent": "lockedin/0.1",
    })
    expect(transportHeaders(spec("opencode-zen"), "session-2")["x-opencode-session"]).toBe("session-2")
    expect(transportHeaders(spec("openai"), "session-3")).toEqual({})
  })
})


describe("provider failures", () => {
  test("an overloaded 429 is named as overload, not a rate limit", () => {
    const error = mapProviderError("opencode-go", {
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { type: "server_error", message: "Upstream request failed: [overloaded] retry shortly" },
      }),
    })
    expect(error.kind).toBe("provider")
    if (error.kind === "provider") {
      expect(error.status).toBe(429)
      expect(error.message).toContain("overloaded")
    }
  })

  test("a real 429 stays a rate limit", () => {
    const error = mapProviderError("openai", {
      statusCode: 429,
      responseBody: JSON.stringify({ error: { message: "Rate limit reached for requests" } }),
    })
    expect(error.kind).toBe("rate-limit")
  })
})

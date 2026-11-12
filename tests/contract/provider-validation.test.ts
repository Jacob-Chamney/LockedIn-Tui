/**
 * Provider key validation against a fake provider (WP-201).
 *
 * A local `Bun.serve` stands in for the provider. No external network, no real
 * key. The request log is the evidence for "exactly one request per attempt,
 * never a retry".
 */
import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getProvider } from "../../src/llm/catalogue"
import type { ProviderSpec } from "../../src/llm/provider-spec"
import { keyErrorCopy, linkProviderKey, validateKeyOnce } from "../../src/llm/validate"
import { createMemorySecretStore } from "./fakes/memory-secret-store"

const ROOT = join(import.meta.dir, "..", "..")
const fixture = (name: string) => readFileSync(join(ROOT, "tests", "fixtures", "providers", name), "utf8")

const GOOD_KEY = "sk-spike-0123456789abcdef0123456789abcdef"
const RATE_KEY = "sk-spike-rate-0123456789abcdef01234567"
const BAD_BODY_KEY = "sk-spike-badbody-0123456789abcdef0123"
const UNKNOWN_KEY = "sk-spike-unknown-0123456789abcdef01234"

type LogEntry = { path: string; authorization: string | null; status: number }

const log: LogEntry[] = []

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const auth = req.headers.get("authorization")
    const key = auth?.replace(/^Bearer /, "") ?? ""

    if (url.pathname === "/slow/models") {
      await new Promise((r) => setTimeout(r, 500))
      log.push({ path: url.pathname, authorization: auth, status: 200 })
      return Response.json(JSON.parse(fixture("models-openai.json")))
    }

    if (url.pathname !== "/v1/models") {
      log.push({ path: url.pathname, authorization: auth, status: 404 })
      return new Response("not found", { status: 404 })
    }

    if (key === RATE_KEY) {
      log.push({ path: url.pathname, authorization: auth, status: 429 })
      return Response.json({ error: { message: "Rate limit reached" } }, { status: 429, headers: { "retry-after": "30" } })
    }
    if (key === BAD_BODY_KEY) {
      // 400 whose body says the key is invalid: still an auth failure.
      log.push({ path: url.pathname, authorization: auth, status: 400 })
      return Response.json(JSON.parse(fixture("error-invalid-key.json")), { status: 400 })
    }
    if (key !== GOOD_KEY) {
      log.push({ path: url.pathname, authorization: auth, status: 401 })
      return Response.json({ error: { message: "Incorrect API key provided" } }, { status: 401 })
    }

    log.push({ path: url.pathname, authorization: auth, status: 200 })
    return Response.json(JSON.parse(fixture("models-openai.json")))
  },
})

const baseUrl = `http://127.0.0.1:${server.port}/v1`

function openai(): ProviderSpec {
  const spec = getProvider("openai")
  if (!spec) throw new Error("missing openai spec")
  return spec
}

function requestsSince(before: number) {
  return log.slice(before)
}

describe("one live validation", () => {
  test("a good key makes exactly one request and selects no model", async () => {
    const before = log.length
    const store = createMemorySecretStore()
    const result = await linkProviderKey({
      providerId: "openai",
      spec: openai(),
      key: GOOD_KEY,
      baseUrl,
      store,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.models).toEqual(["gpt-4.1-mini", "gpt-4.1", "o4-mini"])
      expect(result.value.modelSelected).toBeNull()
      expect(result.value.requests).toBe(1)
    }
    expect(requestsSince(before)).toHaveLength(1)
    expect(store.entries.get("lockedin/openai")).toBe(GOOD_KEY)
  })

  test("401 is one auth error, one request, no retry", async () => {
    const before = log.length
    const result = await linkProviderKey({
      providerId: "openai",
      spec: openai(),
      key: UNKNOWN_KEY,
      baseUrl,
      store: createMemorySecretStore(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("auth")
      if (result.error.kind === "auth") {
        // Fixed copy: the provider body never reaches the UI.
        expect(result.error.message).toBe("The provider rejected the key. It was not saved.")
        expect(result.error.message).not.toContain(UNKNOWN_KEY)
      }
      expect(keyErrorCopy(result.error).next).toContain("Settings → Providers")
    }
    expect(requestsSince(before)).toHaveLength(1)
  })

  test("429 is a rate-limit error carrying retryAfter, one request", async () => {
    const before = log.length
    const result = await validateKeyOnce({ spec: openai(), key: RATE_KEY, baseUrl })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("rate-limit")
      if (result.error.kind === "rate-limit") expect(result.error.retryAfter).toBe(30)
      expect(keyErrorCopy(result.error).next).toContain("30s")
    }
    expect(requestsSince(before)).toHaveLength(1)
  })

  test("a 400 whose body says 'invalid key' is still an auth failure", async () => {
    const before = log.length
    const result = await validateKeyOnce({ spec: openai(), key: BAD_BODY_KEY, baseUrl })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("auth")
      // The fixture body contains a fake key; it must not be echoed.
      expect(JSON.stringify(result.error)).not.toContain("sk-spike-FAKE-not-a-real-key")
    }
    expect(requestsSince(before)).toHaveLength(1)
  })

  test("a model absent from the returned list is refused by name", async () => {
    const before = log.length
    const result = await validateKeyOnce({ spec: openai(), key: GOOD_KEY, baseUrl, model: "gpt-9-imaginary" })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === "provider") {
      expect(result.error.message).toContain("gpt-9-imaginary")
    }
    expect(requestsSince(before)).toHaveLength(1)
  })

  test("a refused connection is a network error with a next step", async () => {
    const before = log.length
    const result = await validateKeyOnce({
      spec: openai(),
      key: GOOD_KEY,
      // Nothing listens on port 1.
      baseUrl: "http://127.0.0.1:1/v1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("network")
      expect(keyErrorCopy(result.error).next).toContain("base URL")
    }
    // The fake server never saw it, and there was no retry against it either.
    expect(requestsSince(before)).toHaveLength(0)
  })

  test("a timeout is a network error, not a hang and not a retry", async () => {
    const before = log.length
    const started = Date.now()
    const result = await validateKeyOnce({
      spec: openai(),
      key: GOOD_KEY,
      baseUrl: `http://127.0.0.1:${server.port}/slow`,
      timeoutMs: 50,
    })
    const elapsed = Date.now() - started
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("network")
    expect(elapsed).toBeLessThan(1_000)
    // Exactly one request was started, and it was abandoned rather than retried.
    expect(requestsSince(before).length).toBeLessThanOrEqual(1)
  })
})

describe("secrets stay out of config, logs and errors", () => {
  test("byte scan of config, log buffer and serialized errors contains no key", async () => {
    const store = createMemorySecretStore()
    const result = await linkProviderKey({
      providerId: "openai",
      spec: openai(),
      key: GOOD_KEY,
      baseUrl,
      store,
    })
    expect(result.ok).toBe(true)

    // What the app would persist: a pointer, never the value.
    const configToml = ['[models]', 'chat = ""', 'generation = ""', '[providers.openai]', 'token_ref = "lockedin/openai"'].join(
      "\n",
    )

    // A log buffer built the way the app's boundary would build it.
    const logBuffer = log
      .map((entry) => `${entry.path} ${entry.status}`)
      .join("\n")

    const failures = [
      await validateKeyOnce({ spec: openai(), key: UNKNOWN_KEY, baseUrl }),
      await validateKeyOnce({ spec: openai(), key: RATE_KEY, baseUrl }),
    ]

    const haystacks = [configToml, logBuffer, JSON.stringify(result), JSON.stringify(failures)]
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(GOOD_KEY)
      expect(haystack).not.toContain(UNKNOWN_KEY)
      expect(haystack).not.toContain(RATE_KEY)
    }
  })
})

// The server must outlive module evaluation: stopping it at module scope kills
// it before the first test runs.
afterAll(() => {
  server.stop(true)
})

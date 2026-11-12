/**
 * Contract suite for the `SecretStore` port (WP-103, matrix §11.3).
 *
 * The same sequence runs against the memory fake (always) and against the real
 * backend (when one is available), so an adapter cannot pass by being special.
 *
 * A keychain is machine state, not a fixture: every value here is a fake
 * `sk-spike-…` string that never leaves this test.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  MAX_NAME_LENGTH,
  NAMESPACE,
  namespacedName,
  secretRefFor,
  validateSecretName,
  type SecretStore,
} from "../../src/security/secret-store"
import {
  REDACTED,
  createRedactor,
  findSecretLeaks,
} from "../../src/security/redaction"
import {
  classifyKeychainFailure,
  createCommandKeychain,
  createNativeKeychain,
  resetNativeProbe,
} from "../../src/security/keyring"
import { createMemorySecretStore } from "./fakes/memory-secret-store"

/** A fake key. Shaped like a real one so redaction tests are realistic. */
const SECRET = "sk-spike-0123456789abcdef0123456789abcdef"

const ROOT = join(import.meta.dir, "..", "..")

/**
 * The adapter-agnostic sequence. Returns one entry per step so a failure names
 * the step instead of a bare boolean.
 */
async function runContract(store: SecretStore): Promise<{ step: string; ok: boolean; detail: string }[]> {
  const out: { step: string; ok: boolean; detail: string }[] = []
  const record = (step: string, ok: boolean, detail = "") => out.push({ step, ok, detail })

  const name = `contract/round-trip-${Math.random().toString(36).slice(2, 10)}`

  record("available returns a boolean", typeof (await store.available()) === "boolean")

  const set = await store.set(name, SECRET)
  record("set succeeds", set.ok, set.ok ? "" : `${set.error.kind}: ${set.error.message}`)
  if (!set.ok) return out

  const got = await store.get(name)
  record(
    "get returns a byte-identical value",
    got.ok && got.value === SECRET,
    got.ok ? (got.value === SECRET ? "" : `got ${got.value === null ? "null" : "a different value"}`) : got.error.kind,
  )

  const other = await store.get(`${name}-absent`)
  record("absent entry reads as null", other.ok && other.value === null, other.ok ? "" : other.error.kind)

  const removed = await store.delete(name)
  record("delete reports true", removed.ok && removed.value === true, removed.ok ? "" : removed.error.kind)

  const gone = await store.get(name)
  record("entry is gone after delete", gone.ok && gone.value === null, gone.ok ? "" : gone.error.kind)

  const twice = await store.delete(name)
  record("second delete reports false", twice.ok && twice.value === false, twice.ok ? "" : twice.error.kind)

  // Values are opaque bytes as far as the store is concerned.
  const weird = `${name}-weird`
  const weirdValue = "line one\nline two · ünïcode ✓ 0123456789"
  const setWeird = await store.set(weird, weirdValue)
  const gotWeird = setWeird.ok ? await store.get(weird) : null
  record(
    "round-trips newlines and unicode",
    !!setWeird.ok && !!gotWeird?.ok && gotWeird.value === weirdValue,
    setWeird.ok ? "" : setWeird.error.kind,
  )
  if (setWeird.ok) await store.delete(weird)

  // Name validation happens before any I/O.
  for (const bad of ["", "Provider/OpenAI", "providers/open ai", "../escape", "/abs", "x".repeat(MAX_NAME_LENGTH + 1)]) {
    const result = await store.set(bad, SECRET)
    record(
      `rejects name ${JSON.stringify(bad.slice(0, 24))}`,
      !result.ok && result.error.kind === "invalid-name",
      result.ok ? "accepted" : result.error.kind,
    )
  }

  return out
}

function expectAllPassed(results: { step: string; ok: boolean; detail: string }[]) {
  const failed = results.filter((r) => !r.ok)
  expect({ failed: failed.map((f) => `${f.step} (${f.detail})`) }).toEqual({ failed: [] })
}

const commandStore = createCommandKeychain()
const commandAvailable = await commandStore.available()
const nativeStore = createNativeKeychain()
resetNativeProbe()

describe("secret store", () => {
  test("fake passes the contract", async () => {
    const store = createMemorySecretStore()
    expectAllPassed(await runContract(store))
    // Namespacing is observable in the fake's storage keys.
    for (const key of store.entries.keys()) expect(key.startsWith(`${NAMESPACE}/`)).toBe(true)
  })

  test.skipIf(!commandAvailable)("real backend round-trips", async () => {
    const results = await runContract(commandStore)
    expectAllPassed(results)
  })

  test("missing backend never falls back to a file", async () => {
    const store = createMemorySecretStore({ mode: "unavailable" })
    const result = await store.set("providers/openai", SECRET)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe("unavailable")
    expect(result.error.hint).toContain("never written to a file")
    expect(store.entries.size).toBe(0)

    // The adapters must have no way to write a file at all: a fallback would
    // need an fs import, and neither module has one.
    for (const file of ["secret-store.ts", "keyring.ts"]) {
      const source = readFileSync(join(ROOT, "src", "security", file), "utf8")
      expect(source).not.toMatch(/node:fs|from ["']fs["']|Bun\.write|writeFile|appendFile|createWriteStream/)
    }

    // The native adapter is either usable on this machine or reports a typed
    // `unsupported` error. It must never crash or downgrade to a file.
    resetNativeProbe()
    const nativeAvailable = await nativeStore.available()
    expect(typeof nativeAvailable).toBe("boolean")
    if (nativeAvailable) {
      const name = `spike/contract-${Date.now()}`
      expect((await nativeStore.set(name, SECRET)).ok).toBe(true)
      const read = await nativeStore.get(name)
      expect(read.ok && read.value).toBe(SECRET)
      expect((await nativeStore.delete(name)).ok).toBe(true)
    } else {
      const noAddon = await nativeStore.set("providers/openai", SECRET)
      expect(noAddon.ok).toBe(false)
      if (!noAddon.ok) {
        // Both kinds mean "there is no usable backend", and which one you get is
        // a property of the machine, not of the adapter: `unsupported` when the
        // addon or helper is absent, `unavailable` when it exists but the store
        // cannot be reached (a container with no Secret Service or D-Bus, which
        // is exactly the CI runner). Asserting one spelling made a green local
        // run and a green CI run disagree — see WP-812.
        expect(["unsupported", "unavailable"]).toContain(noAddon.error.kind)
        // The invariant that actually matters: no plaintext fallback, ever.
        expect(noAddon.error.message.length).toBeGreaterThan(0)
        expect(noAddon.error.message).not.toContain(SECRET)
      }
    }
  })

  test("locked keyring is reported once", async () => {
    const store = createMemorySecretStore({ mode: "locked" })
    const result = await store.set("providers/openai", SECRET)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("locked")
      expect(result.error.hint).toContain("Unlock")
    }
    // Reported once: no retry loop inside the adapter.
    expect(store.calls.set).toBe(1)

    const read = await store.get("providers/openai")
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.kind).toBe("locked")
    expect(store.calls.get).toBe(1)
  })

  test("values never reach logs or config", async () => {
    const redactor = createRedactor()
    expect(redactor.add(SECRET)).toBe(1)

    // A provider error body and an MCP tool output both carry the value.
    const providerError = `401 Incorrect API key provided: ${SECRET}`
    const mcpOutput = { content: `Authorization: Bearer ${SECRET}` }

    expect(redactor.redact(providerError)).not.toContain(SECRET)
    expect(redactor.redact(providerError)).toContain(REDACTED)
    expect(JSON.stringify(redactor.redactRecord({ error: providerError, mcp: mcpOutput }))).not.toContain(SECRET)
    expect(redactor.redactError(new Error(`boom ${SECRET}`))).not.toContain(SECRET)
    expect(redactor.redactError(new Error(`boom ${SECRET}`))).not.toContain("\n")

    // A typed secret error never carries the value either.
    const store = createMemorySecretStore({ mode: "denied" })
    const failed = await store.set("providers/openai", SECRET)
    expect(failed.ok).toBe(false)
    expect(JSON.stringify(failed)).not.toContain(SECRET)

    // The guard used by the config writer and the archive index.
    expect(findSecretLeaks(`api_key = "${SECRET}"`, [SECRET])).toHaveLength(1)
    expect(findSecretLeaks(`api_key = "${REDACTED}"`, [SECRET])).toHaveLength(0)

    // Very short values are not indexed: redacting "abc" would shred messages.
    const tiny = createRedactor()
    expect(tiny.add("abc")).toBe(0)
  })

  test("link flow leaves config secret-free", async () => {
    const store = createMemorySecretStore()
    const linked = await store.set("providers/openai", SECRET)
    expect(linked.ok).toBe(true)

    // The only thing the config may hold is a pointer into the keychain.
    const config = {
      providers: { openai: { token_ref: secretRefFor("providers/openai") } },
      models: { chat: "openai/gpt-4.1-mini" },
    }

    expect(config.providers.openai.token_ref).toBe("lockedin/providers/openai")
    const serialized = JSON.stringify(config, null, 2)
    expect(findSecretLeaks(serialized, [SECRET])).toEqual([])

    // …and the value is still available from the keychain, nowhere else.
    const read = await store.get("providers/openai")
    expect(read.ok && read.value === SECRET).toBe(true)
    expect([...store.entries.values()].includes(SECRET)).toBe(true)
  })
})

describe("secret names", () => {
  test("names are namespaced and validated locally", () => {
    expect(namespacedName("providers/openai")).toBe("lockedin/providers/openai")
    expect(namespacedName("github/token")).toBe("lockedin/github/token")
    expect(secretRefFor("github/token")).toBe("lockedin/github/token")

    for (const good of ["providers/openai", "github/token", "a.b-c_d/e"]) {
      expect(validateSecretName(good)).toBeNull()
    }
    for (const bad of [
      "",
      "Providers/OpenAI",
      "providers/../openai",
      "/leading",
      "trailing/",
      "with space",
      "with\nnewline",
      "lockedin/doubled",
      "x".repeat(MAX_NAME_LENGTH + 1),
    ]) {
      const error = validateSecretName(bad)
      expect({ name: bad.slice(0, 20), kind: error?.kind }).toEqual({
        name: bad.slice(0, 20),
        kind: "invalid-name",
      })
    }
  })

  test("failure classification maps backend messages to actionable kinds", () => {
    expect(classifyKeychainFailure("The keyring is locked")).toBe("locked")
    expect(classifyKeychainFailure("prompt dismissed by the user")).toBe("locked")
    expect(classifyKeychainFailure("secret-tool: Could not connect: No such file or directory")).toBe("unavailable")
    expect(classifyKeychainFailure("PlatformFailure(ZbusError: Connection refused)")).toBe("unavailable")
    expect(classifyKeychainFailure("Access denied by the keyring")).toBe("denied")
    expect(classifyKeychainFailure("something nobody has seen")).toBe("failed")
  })
})

/**
 * `LOCKEDIN_KEYRING_ADDON` — the packaged-core addon override (T-043).
 *
 * `bun build --compile` cannot embed the N-API addon, so the release bundles the
 * addon beside the core and points the app at it. This test proves the override
 * is really loaded (the fake is the only backend that can answer), that the
 * pinned `secret-service` store survives, and that an unset variable still uses
 * the bare `@napi-rs/keyring` import.
 *
 * Everything here is a fake secret; no keychain is touched and nothing is
 * written to disk.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { KEYRING_ADDON_ENV, createNativeKeychain, resetNativeProbe } from "../../src/security/keyring"

/** Shaped like a real key so a leak would be recognisable. Never a real one. */
const SECRET = "sk-test-0123456789abcdef0123456789abcdef"
const NAME = "providers/openai"

const ADDON = join(import.meta.dir, "..", "fixtures", "keyring-fake.mjs")
const ADDON_URL = pathToFileURL(ADDON).href

type FakeModule = {
  __fake: {
    entries: Map<string, string>
    constructed: number
    options: unknown[]
    reset(): void
  }
}

/** Same resolved file URL the adapter imports, so this is the same module instance. */
const fake = (await import(ADDON_URL)) as unknown as FakeModule

const original = process.env[KEYRING_ADDON_ENV]

beforeEach(() => {
  fake.__fake.reset()
  resetNativeProbe()
})

afterEach(() => {
  if (original === undefined) delete process.env[KEYRING_ADDON_ENV]
  else process.env[KEYRING_ADDON_ENV] = original
  resetNativeProbe()
})

describe("keyring addon override", () => {
  test("loads the addon entry file named by the variable", async () => {
    process.env[KEYRING_ADDON_ENV] = ADDON

    const store = createNativeKeychain()
    expect(await store.available()).toBe(true)
    // The probe constructed an entry, so the fake really is the backend.
    expect(fake.__fake.constructed).toBeGreaterThan(0)

    const set = await store.set(NAME, SECRET)
    expect(set.ok).toBe(true)

    const got = await store.get(NAME)
    expect(got.ok && got.value).toBe(SECRET)

    // The entry is namespaced: the adapter, not the caller, owns the prefix.
    expect(fake.__fake.entries.has(`lockedin-tui\u0000lockedin/${NAME}`)).toBe(true)

    // The pinned builder option survives the override.
    for (const options of fake.__fake.options) {
      expect(options).toEqual({ linux: { store: "secret-service" } })
    }
  })

  test("trims the value and accepts a file URL", async () => {
    process.env[KEYRING_ADDON_ENV] = `  ${ADDON_URL}  `

    const store = createNativeKeychain()
    expect(await store.available()).toBe(true)

    expect((await store.set(NAME, SECRET)).ok).toBe(true)
    const got = await store.get(NAME)
    expect(got.ok && got.value).toBe(SECRET)
  })

  test("round-trips delete through the addon", async () => {
    process.env[KEYRING_ADDON_ENV] = ADDON

    const store = createNativeKeychain()
    expect((await store.set(NAME, SECRET)).ok).toBe(true)

    const removed = await store.delete(NAME)
    expect(removed.ok && removed.value).toBe(true)

    const gone = await store.get(NAME)
    expect(gone.ok && gone.value).toBeNull()
  })

  test("an unset or blank variable keeps the bare package import", async () => {
    delete process.env[KEYRING_ADDON_ENV]
    const store = createNativeKeychain()
    expect(typeof (await store.available())).toBe("boolean")
    expect(fake.__fake.constructed).toBe(0)

    resetNativeProbe()
    process.env[KEYRING_ADDON_ENV] = "   "
    expect(typeof (await store.available())).toBe("boolean")
    expect(fake.__fake.constructed).toBe(0)
  })
})

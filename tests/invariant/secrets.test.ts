/**
 * Invariant suite — secrets (WP-109).
 *
 * Guards docs/testing.md §11.3 / §11.8 and AGENTS.md §2.11:
 * - the keychain is the only place a secret may live, so a missing backend is a
 *   typed error, never a plaintext fallback anywhere on disk;
 * - names are namespaced `lockedin/<name>`;
 * - no value reaches an error message, a log line or `config.toml`.
 *
 * The double is the same memory fake the contract suite uses, so this file needs
 * no keyring, no network and no macOS/Linux-specific state.
 */

import { describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySecretStore } from "../contract/fakes/memory-secret-store";
import { NAMESPACE, namespacedName, secretRefFor, validateSecretName } from "../../src/security/secret-store";
import { REDACTED, createRedactor, findSecretLeaks } from "../../src/security/redaction";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const SECURITY_SRC = join(import.meta.dir, "..", "..", "src", "security")

/** A fake key: shaped like a real one, used only in this file. */
const SECRET = "sk-invariant-0123456789abcdef0123456789"

function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const rel = prefix === "" ? name : `${prefix}/${name}`
      const stat = statSync(abs)
      if (stat.isDirectory()) {
        out[`${rel}/`] = "dir"
        walk(abs, rel)
      } else {
        out[rel] = new Bun.CryptoHasher("sha256").update(readFileSync(abs)).digest("hex")
      }
    }
  }
  walk(root, "")
  return out
}

describe("secret store invariants", () => {
  test("P1-KC-05 names are namespaced and a config pointer is the only reference", () => {
    expect(NAMESPACE).toBe("lockedin")
    expect(namespacedName("github-token")).toBe("lockedin/github-token")
    expect(secretRefFor("github-token")).toBe("lockedin/github-token")

    // The stored name can never escape the namespace.
    for (const bad of [
      "../escape",
      "",
      "x".repeat(400),
      "name with space",
      "UPPER",
      "/leading",
      "trailing/",
      "lockedin/already-namespaced",
      "a/\u0000/control",
    ]) {
      expect(validateSecretName(bad)?.kind).toBe("invalid-name")
    }
    // Segment paths are allowed: they are how names are grouped.
    expect(validateSecretName("github-token")).toBeNull()
    expect(validateSecretName("providers/openai")).toBeNull()
  })

  test("P1-KC-03 a missing backend is a typed error, not a file", async () => {
    const dir = await mkdtemp(join(TEMP_BASE, "lockedin-inv-sec-"))
    try {
      const before = hashTree(dir)

      const store = createMemorySecretStore({ mode: "unavailable" })
      expect(await store.available()).toBe(false)

      const result = await store.set("github-token", SECRET)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.kind).toBe("unavailable")
        // The hint tells the user what to do and promises no file fallback.
        expect(result.error.hint).toContain("never written to a file")
        // The value never appears in the error.
        expect(result.error.message).not.toContain(SECRET)
        expect(result.error.hint).not.toContain(SECRET)
      }

      // Nothing was created by the attempt.
      expect(hashTree(dir)).toEqual(before)
      // One attempt, no retry (AGENTS.md §2.10).
      expect(store.calls.set).toBe(1)
    } finally {
      await removeTemp(dir)
    }
  })

  test("P1-KC-03 no adapter in src/security writes a secret to a file", () => {
    // A plaintext fallback is a stack blocker (AGENTS.md §8). If someone adds
    // one, this fails before a key can leak.
    const offenders: string[] = []
    for (const name of readdirSync(SECURITY_SRC)) {
      if (!name.endsWith(".ts")) continue
      const source = readFileSync(join(SECURITY_SRC, name), "utf8")
      for (const banned of ["writeFile", "appendFile", "createWriteStream", "writeFileSync"]) {
        // `writeFile` appears in comments only if the file documents the rule;
        // require an actual call or import binding to fail the test.
        const pattern = new RegExp(`\\b${banned}\\s*\\(`)
        if (pattern.test(source)) offenders.push(`${name}: ${banned}(`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("P1-KC-04 a locked keychain is reported once with an unlock hint", async () => {
    const store = createMemorySecretStore({ mode: "locked" })
    const result = await store.get("github-token")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe("locked")
      expect(result.error.hint.toLowerCase()).toContain("unlock")
    }
    expect(store.calls.get).toBe(1)
  })

  test("P1-KC-05 no value reaches a log line, an error or a config record", async () => {
    const store = createMemorySecretStore()
    expect((await store.set("github-token", SECRET)).ok).toBe(true)
    expect((await store.get("github-token")).ok).toBe(true)

    const redactor = createRedactor()
    redactor.add(SECRET)
    expect(redactor.size()).toBe(1)

    const noisy = [
      `provider error: Authorization: Bearer ${SECRET}`,
      `auth failed for key ${SECRET} (401)`,
      JSON.stringify({ token: SECRET, nested: { key: SECRET } }),
    ]
    for (const line of noisy) {
      expect(findSecretLeaks(line, [SECRET]).length).toBeGreaterThan(0)
      expect(redactor.redact(line)).not.toContain(SECRET)
      expect(redactor.redact(line)).toContain(REDACTED)
    }

    // A record is redacted in place before it can be logged.
    const redacted = redactor.redactRecord({
      kind: "auth",
      message: `bad key ${SECRET}`,
      nested: { detail: SECRET },
    })
    expect(JSON.stringify(redacted)).not.toContain(SECRET)

    // And the value is still readable from the store — redaction is display-only.
    const readBack = await store.get("github-token")
    expect(readBack.ok && readBack.value).toBe(SECRET)
  })
})

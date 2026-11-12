/**
 * In-memory `SecretStore` for contract tests and for CI where no keychain
 * exists. It mimics the real adapters exactly: same namespace, same typed
 * errors, same "absent entry" semantics — only the storage is a Map.
 *
 * It also counts calls, so a test can prove that a failure was reported once
 * and never retried.
 */
import {
  namespacedName,
  secretError,
  secretOk,
  validateSecretName,
  type SecretErrorKind,
  type SecretResult,
  type SecretStore,
} from "../../../src/security/secret-store"

export type FakeMode = "ok" | "unavailable" | "locked" | "denied" | "failed"

export type FakeSecretStore = SecretStore & {
  /** Namespaced name → value. Never logged by the test. */
  readonly entries: Map<string, string>
  readonly calls: { available: number; get: number; set: number; delete: number }
  setMode(mode: FakeMode): void
}

export function createMemorySecretStore(options: { mode?: FakeMode } = {}): FakeSecretStore {
  let mode: FakeMode = options.mode ?? "ok"
  const entries = new Map<string, string>()
  const calls = { available: 0, get: 0, set: 0, delete: 0 }

  const failure = <T>(): SecretResult<T> => {
    const kind: SecretErrorKind = mode === "ok" ? "failed" : mode
    return {
      ok: false,
      error: secretError(kind, "memory", mode === "unavailable" ? "no backend" : `backend is ${mode}`),
    }
  }

  return {
    id: "memory-fake",

    entries,
    calls,

    setMode(next) {
      mode = next
    },

    async available() {
      calls.available += 1
      return mode === "ok"
    },

    async get(name) {
      calls.get += 1
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (mode !== "ok") return failure()
      return secretOk(entries.get(namespacedName(name)) ?? null)
    },

    async set(name, value) {
      calls.set += 1
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (mode !== "ok") return failure()
      if (value.length === 0) {
        return { ok: false, error: secretError("failed", "memory", "empty value is not a secret") }
      }
      entries.set(namespacedName(name), value)
      return secretOk(undefined)
    },

    async delete(name) {
      calls.delete += 1
      const invalid = validateSecretName(name)
      if (invalid) return { ok: false, error: invalid }
      if (mode !== "ok") return failure()
      return secretOk(entries.delete(namespacedName(name)))
    },
  }
}
